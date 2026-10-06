import Phaser from 'phaser';
import { ShellWatch } from './effects.js';
import type { ShellEvents } from './effects.js';
import { CRATE, FLOOR, GRID, ME, SHIELD, SPARK, WALL, WALL_EDGE, tint } from './palette.js';
import type { ArenaPicture, Picture, TankPicture } from './picture.js';
import { PX, radians } from './picture.js';
import { Sounds } from './sounds.js';
import { ATLAS, DETAIL, buildAtlas } from './textures.js';
import { CameraRig, zoomFor } from './view.js';

export interface SceneOptions {
  readonly arena: ArenaPicture;
  /** The picture at `performance.now()` — called once a frame, at the display's rate. */
  readonly picture: (now: number) => Picture;
}

/** A tank's sprites, kept and reused while its id is in the picture. */
interface TankSprites {
  id: number;
  readonly hull: Phaser.GameObjects.Image;
  readonly turret: Phaser.GameObjects.Image;
  readonly ring: Phaser.GameObjects.Image;
  pass: number;
  /** When it last fired (the turret's recoil) and was last hit (a white flash), ms. */
  firedAt: number;
  hitAt: number;
}

/** A server ghost's outlines, kept and reused while its id is in the picture. */
interface GhostSprites {
  readonly hull: Phaser.GameObjects.Image;
  readonly turret: Phaser.GameObjects.Image;
  pass: number;
}

interface ShellSprite {
  readonly core: Phaser.GameObjects.Image;
  pass: number;
}

/** How far a turret kicks back when it fires, world pixels, and how fast it returns, ms. */
const RECOIL = 5;
const RECOIL_MS = 70;
/** How long a hit tank flashes white, ms. */
const FLASH_MS = 90;

/** The minimap's side, CSS pixels, and its margin from the corner. */
const MINIMAP = 132;
const MARGIN = 12;

/**
 * The arena (ROADMAP C1): the floor, the walls, the crates, every tank as a hull and a turret
 * tinted by player, the shells, the camera on the own tank leading toward the aim, the minimap, and
 * pooled particles and sounds. It is handed a picture each frame and draws it; it knows nothing of
 * the wire. Phaser's physics is not used — the world's physics is `sim`'s.
 *
 * Steady play allocates nothing here: sprites are pooled by id and reused, the particles are
 * Phaser's own pools, and the effects' records are reused (`ShellWatch`).
 */
export class ArenaScene extends Phaser.Scene {
  private world!: Phaser.GameObjects.Layer;
  private ui!: Phaser.GameObjects.Layer;
  private hud!: Phaser.Cameras.Scene2D.Camera;
  private readonly tanks = new Map<number, TankSprites>();
  private readonly spareTanks: TankSprites[] = [];
  private readonly ghosts = new Map<number, GhostSprites>();
  private readonly spareGhosts: GhostSprites[] = [];
  private readonly shells = new Map<number, ShellSprite>();
  private readonly spareShells: ShellSprite[] = [];
  private crates: Phaser.GameObjects.Image[] = [];
  private muzzle!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private bursts!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sounds!: Sounds;
  private minimap!: Phaser.GameObjects.Graphics;
  private dot!: Phaser.GameObjects.Image;
  /** Where the minimap's arena sits on the canvas, and its scale from eighths. */
  private minimapAt = { x0: 0, y0: 0, k: 0 };
  private readonly rig = new CameraRig();
  private readonly watch = new ShellWatch();
  private readonly pointer = new Phaser.Math.Vector2();
  private pass = 0;
  private last = 0;
  private me: TankPicture | null = null;
  /** Frames drawn, and the work of the last — the perf script's numbers. */
  frames = 0;
  workMs = 0;
  private readonly on: ShellEvents;
  private now = 0;

  constructor(private readonly opts: SceneOptions) {
    super({ key: 'arena' });
    this.on = {
      fired: (x, y, dir, owner) => this.fired(x, y, dir, owner),
      bounced: (x, y) => {
        this.sparks.explode(6, x * PX, y * PX);
        this.sounds.play('ricochet', this.distance(x, y));
      },
    };
  }

  private silent = false;

  /** Sound on or off — the player's setting; it holds from before the scene has started. */
  set muted(muted: boolean) {
    this.silent = muted;
    if (this.sys.isActive()) this.sounds.muted = muted;
  }

  /** How far a point is from the camera's centre, units — what a sound is heard from. */
  private distance(x: number, y: number): number {
    const cam = this.cameras.main;
    return Math.hypot(x * PX - cam.midPoint.x, y * PX - cam.midPoint.y);
  }

  /** A muzzle flash, the shot's sound and the turret's recoil. */
  private fired(x: number, y: number, dir: number, owner: number): void {
    const a = radians(dir);
    this.muzzle.setParticleTint(tint(owner));
    this.muzzle.explode(3, x * PX + Math.cos(a) * 34, y * PX + Math.sin(a) * 34);
    this.sounds.play('shot', this.distance(x, y));
    const t = this.tanks.get(owner);
    if (t) t.firedAt = this.now;
  }

  /** What came due: every hit, kill and spawn from the server's word; ends, fizzles, crates. */
  private show(e: Picture['effects'][number]): void {
    switch (e.kind) {
      case 'fire':
        return this.fired(e.x, e.y, e.dir, e.owner);
      case 'hit': {
        this.bursts.setParticleTint(0xffffff);
        this.bursts.explode(10, e.x * PX, e.y * PX);
        this.sparks.explode(10, e.x * PX, e.y * PX);
        this.sounds.play('hit', this.me?.id === e.victim ? 0 : this.distance(e.x, e.y));
        const t = this.tanks.get(e.victim);
        if (t) t.hitAt = this.now;
        return;
      }
      case 'kill':
        this.bursts.setParticleTint(tint(e.victim));
        this.bursts.explode(36, e.x * PX, e.y * PX);
        this.sparks.explode(24, e.x * PX, e.y * PX);
        this.sounds.play('hit', this.distance(e.x, e.y));
        return;
      case 'spawn':
        this.muzzle.setParticleTint(SHIELD);
        this.muzzle.explode(8, e.x * PX, e.y * PX);
        return;
      case 'end':
        this.bursts.setParticleTint(tint(e.owner));
        this.bursts.explode(4, e.x * PX, e.y * PX);
        return;
      case 'fizzle':
        this.bursts.setParticleTint(0x8a8a8a);
        this.bursts.explode(3, e.x * PX, e.y * PX);
        return;
      case 'crate': {
        const spot = this.opts.arena.crates[e.spot];
        if (spot) this.sparks.explode(12, spot.x * PX, spot.y * PX);
        return;
      }
    }
  }

  create(): void {
    buildAtlas(this);
    const { arena } = this.opts;
    const side = arena.size * PX;
    this.world = this.add.layer();
    this.ui = this.add.layer();

    // The floor is the camera's clear colour; its grid, lines every 64 units — a handful of thin
    // quads where a tiled sprite would shade every pixel of the screen a second time.
    const grid = this.add.graphics();
    grid.fillStyle(GRID, 1);
    for (let v = 0; v <= side; v += 64) {
      grid.fillRect(v, 0, 1, side);
      grid.fillRect(0, v, side, 1);
    }
    this.world.add(grid);

    const walls = this.add.graphics();
    for (const w of arena.walls) {
      const x = w.x0 * PX;
      const y = w.y0 * PX;
      const width = (w.x1 - w.x0) * PX;
      const height = (w.y1 - w.y0) * PX;
      walls.fillStyle(WALL, 1).fillRect(x, y, width, height);
      walls.lineStyle(2, WALL_EDGE, 1).strokeRect(x + 1, y + 1, width - 2, height - 2);
    }
    this.world.add(walls);

    this.crates = arena.crates.map((p) =>
      this.add
        .image(p.x * PX, p.y * PX, ATLAS, 'crate')
        .setScale(1 / DETAIL)
        .setTint(CRATE)
        .setVisible(false),
    );
    this.world.add(this.crates);

    const burst = { lifespan: 260, emitting: false, blendMode: Phaser.BlendModes.ADD };
    this.muzzle = this.add.particles(0, 0, ATLAS, {
      ...burst,
      frame: 'glow',
      lifespan: 120,
      speed: { min: 10, max: 60 },
      scale: { start: 0.9, end: 0.2 },
      alpha: { start: 0.9, end: 0 },
      maxParticles: 60,
    });
    this.sparks = this.add.particles(0, 0, ATLAS, {
      ...burst,
      frame: 'spark',
      speed: { min: 120, max: 320 },
      scale: { start: 0.6, end: 0 },
      tint: SPARK,
      maxParticles: 160,
    });
    this.bursts = this.add.particles(0, 0, ATLAS, {
      ...burst,
      frame: 'glow',
      lifespan: 320,
      speed: { min: 20, max: 140 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.8, end: 0 },
      maxParticles: 200,
    });
    this.world.add([this.muzzle, this.sparks, this.bursts]);
    this.sounds = new Sounds(this);
    this.sounds.muted = this.silent;

    // The minimap: the walls drawn once, the own tank a dot — on a camera of its own that neither
    // scrolls nor zooms.
    this.minimap = this.add.graphics();
    this.dot = this.add.image(0, 0, ATLAS, 'dot').setTint(ME).setScale(0.7);
    this.ui.add([this.minimap, this.dot]);
    this.hud = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'hud');
    this.cameras.main.ignore(this.ui);
    this.hud.ignore(this.world);
    this.cameras.main.setBackgroundColor(FLOOR);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
  }

  /** The cameras and the minimap to the canvas's size. */
  private layout(): void {
    const { width, height } = this.scale;
    const dpr = 1 / this.scale.zoom;
    this.cameras.main.setSize(width, height).setZoom(zoomFor(width, height));
    this.hud.setSize(width, height);

    const side = MINIMAP * dpr;
    const x0 = MARGIN * dpr;
    const y0 = height - side - MARGIN * dpr;
    const size = this.opts.arena.size;
    const k = side / size;
    const g = this.minimap.clear();
    g.fillStyle(0x0e1114, 0.8).fillRoundedRect(x0 - 4, y0 - 4, side + 8, side + 8, 6);
    g.lineStyle(1, WALL_EDGE, 1).strokeRect(x0, y0, side, side);
    g.fillStyle(WALL_EDGE, 1);
    // Only what lies inside the arena: its edges are walls reaching far outside it.
    for (const w of this.opts.arena.walls) {
      const ax = Math.max(0, w.x0);
      const ay = Math.max(0, w.y0);
      const bx = Math.min(size, w.x1);
      const by = Math.min(size, w.y1);
      if (bx <= ax || by <= ay) continue;
      g.fillRect(x0 + ax * k, y0 + ay * k, Math.max(1, (bx - ax) * k), Math.max(1, (by - ay) * k));
    }
    this.minimapAt = { x0, y0, k };
  }

  override update(): void {
    const began = performance.now();
    const dt = this.last ? began - this.last : 0;
    this.last = began;
    const pic = this.opts.picture(began);
    const pass = ++this.pass;
    this.me = pic.me;
    this.now = began;

    if (pic.me) this.drawTank(pic.me, pass, true);
    for (const t of pic.others) this.drawTank(t, pass, false);
    for (const [id, s] of this.tanks) {
      if (s.pass === pass) continue;
      this.hideTank(s);
      this.tanks.delete(id);
      this.spareTanks.push(s);
    }

    for (const g of pic.ghosts) this.drawGhost(g, pass, g.id === pic.me?.id);
    for (const [id, g] of this.ghosts) {
      if (g.pass === pass) continue;
      g.hull.setVisible(false);
      g.turret.setVisible(false);
      this.ghosts.delete(id);
      this.spareGhosts.push(g);
    }

    for (const s of pic.shells) {
      let sprite = this.shells.get(s.id);
      if (!sprite) {
        sprite = this.spareShells.pop() ?? this.newShell();
        sprite.core.setTint(tint(s.owner)).setVisible(true);
        this.shells.set(s.id, sprite);
      }
      sprite.core.setPosition(s.x * PX, s.y * PX);
      sprite.pass = pass;
    }
    for (const [id, s] of this.shells) {
      if (s.pass === pass) continue;
      s.core.setVisible(false);
      this.shells.delete(id);
      this.spareShells.push(s);
    }

    for (let i = 0; i < this.crates.length; i++) {
      const crate = this.crates[i];
      if (!crate) continue;
      const shown = (pic.crates & (1 << i)) !== 0;
      crate.setVisible(shown);
      if (shown) crate.setRotation(Math.sin(began / 600 + i) * 0.12);
    }

    this.watch.update(pic.shells, pic.others, pic.me, this.on);
    for (const e of pic.effects) this.show(e);

    const cam = this.cameras.main;
    if (pic.me) {
      const c = this.rig.update(pic.me, pic.aim, dt);
      cam.centerOn(c.x, c.y);
      const m = this.minimapAt;
      this.dot.setVisible(true).setPosition(m.x0 + pic.me.x * m.k, m.y0 + pic.me.y * m.k);
    } else {
      cam.centerOn((this.opts.arena.size * PX) / 2, (this.opts.arena.size * PX) / 2);
      this.dot.setVisible(false);
    }
    this.frames++;
    this.workMs = performance.now() - began;
  }

  /** The pointer's offset from the own tank in the world, units; `null` with no own tank. */
  pointerFromMe(): { x: number; y: number } | null {
    const me = this.me;
    if (!me || !this.sys.isActive()) return null;
    const p = this.input.activePointer;
    this.cameras.main.getWorldPoint(p.x, p.y, this.pointer);
    return { x: this.pointer.x - me.x * PX, y: this.pointer.y - me.y * PX };
  }

  private drawTank(t: TankPicture, pass: number, mine: boolean): void {
    let s = this.tanks.get(t.id);
    if (!s) {
      s = this.spareTanks.pop() ?? this.newTank();
      s.id = t.id;
      s.firedAt = -1e9;
      s.hitAt = -1e9;
      this.tanks.set(t.id, s);
    }
    s.pass = pass;
    const x = t.x * PX;
    const y = t.y * PX;
    const a = radians(t.turret);
    const kick = RECOIL * Math.exp(-Math.max(0, this.now - s.firedAt) / RECOIL_MS);
    s.hull.setVisible(t.alive).setPosition(x, y).setRotation(radians(t.hull));
    s.turret
      .setVisible(t.alive)
      .setPosition(x - Math.cos(a) * kick, y - Math.sin(a) * kick)
      .setRotation(a);
    const flash = this.now - s.hitAt < FLASH_MS;
    const mode = flash ? Phaser.TintModes.FILL : Phaser.TintModes.MULTIPLY;
    const color = flash ? 0xffffff : tint(t.id);
    s.hull.setTint(color).setTintMode(mode);
    s.turret.setTint(color).setTintMode(mode);
    // The ring: the spawn shield's glow, or a faint mark on the own tank.
    const ring = t.alive && (t.shield || mine);
    s.ring.setVisible(ring);
    if (ring) {
      s.ring
        .setPosition(x, y)
        .setTint(t.shield ? SHIELD : ME)
        .setAlpha(t.shield ? 0.55 + 0.25 * Math.sin(performance.now() / 90) : 0.18);
    }
    // The own tank on top of everyone else's.
    const depth = mine ? 2 : 1;
    s.hull.setDepth(depth);
    s.turret.setDepth(depth + 0.1);
    s.ring.setDepth(depth + 0.2);
  }

  /** A tank where the server last said it was: its outline, over everything but the shells. */
  private drawGhost(t: TankPicture, pass: number, mine: boolean): void {
    let g = this.ghosts.get(t.id);
    if (!g) {
      g = this.spareGhosts.pop() ?? this.newGhost();
      this.ghosts.set(t.id, g);
    }
    g.pass = pass;
    const color = mine ? 0xffffff : tint(t.id);
    const x = t.x * PX;
    const y = t.y * PX;
    g.hull.setVisible(t.alive).setPosition(x, y).setRotation(radians(t.hull)).setTint(color);
    g.turret.setVisible(t.alive).setPosition(x, y).setRotation(radians(t.turret)).setTint(color);
  }

  private newGhost(): GhostSprites {
    const scale = 1 / DETAIL;
    const hull = this.add
      .image(0, 0, ATLAS, 'ghostHull')
      .setScale(scale)
      .setAlpha(0.8)
      .setDepth(2.5);
    const turret = this.add
      .image(0, 0, ATLAS, 'ghostTurret')
      .setScale(scale)
      .setAlpha(0.8)
      .setDepth(2.6);
    this.world.add([hull, turret]);
    return { hull, turret, pass: 0 };
  }

  private hideTank(s: TankSprites): void {
    s.hull.setVisible(false);
    s.turret.setVisible(false);
    s.ring.setVisible(false);
  }

  private newTank(): TankSprites {
    const scale = 1 / DETAIL;
    const hull = this.add.image(0, 0, ATLAS, 'hull').setScale(scale);
    const turret = this.add.image(0, 0, ATLAS, 'turret').setScale(scale);
    // The turret's pivot is its cell's centre; the frame is centred there already.
    turret.setOrigin(0.5, 0.5);
    const ring = this.add.image(0, 0, ATLAS, 'ring').setScale(scale);
    this.world.add([hull, turret, ring]);
    return { id: -1, hull, turret, ring, pass: 0, firedAt: -1e9, hitAt: -1e9 };
  }

  private newShell(): ShellSprite {
    const core = this.add
      .image(0, 0, ATLAS, 'shell')
      .setScale(1 / DETAIL)
      .setDepth(3);
    this.world.add(core);
    return { core, pass: 0 };
  }
}
