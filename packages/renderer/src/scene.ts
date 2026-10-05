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
}

interface ShellSprite {
  readonly core: Phaser.GameObjects.Image;
  pass: number;
}

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

  constructor(private readonly opts: SceneOptions) {
    super({ key: 'arena' });
    const listen = (x: number, y: number) => {
      const cam = this.cameras.main;
      return Math.hypot(x * PX - cam.midPoint.x, y * PX - cam.midPoint.y);
    };
    this.on = {
      fired: (x, y, dir, owner) => {
        const a = radians(dir);
        const mx = x * PX + Math.cos(a) * 34;
        const my = y * PX + Math.sin(a) * 34;
        this.muzzle.setParticleTint(tint(owner));
        this.muzzle.explode(3, mx, my);
        this.sounds.play('shot', listen(x, y));
      },
      bounced: (x, y) => {
        this.sparks.explode(6, x * PX, y * PX);
        this.sounds.play('ricochet', listen(x, y));
      },
      gone: (x, y, hit, owner) => {
        this.bursts.setParticleTint(hit ? 0xffffff : tint(owner));
        this.bursts.explode(hit ? 10 : 4, x * PX, y * PX);
        if (hit) this.sounds.play('hit', listen(x, y));
      },
    };
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

    if (pic.me) this.drawTank(pic.me, pass, true);
    for (const t of pic.others) this.drawTank(t, pass, false);
    for (const [id, s] of this.tanks) {
      if (s.pass === pass) continue;
      this.hideTank(s);
      this.tanks.delete(id);
      this.spareTanks.push(s);
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
      const color = tint(t.id);
      s.hull.setTint(color);
      s.turret.setTint(color);
      this.tanks.set(t.id, s);
    }
    s.pass = pass;
    const x = t.x * PX;
    const y = t.y * PX;
    s.hull.setVisible(t.alive).setPosition(x, y).setRotation(radians(t.hull));
    s.turret.setVisible(t.alive).setPosition(x, y).setRotation(radians(t.turret));
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
    return { id: -1, hull, turret, ring, pass: 0 };
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
