import type Phaser from 'phaser';

/** The one texture every sprite draws from, generated at boot — the game ships no art. */
export const ATLAS = 'ricochet';

/**
 * Every frame is drawn at twice its world size and shown at half scale, so the arena stays crisp
 * up to a zoom of 2 — a desktop's 1920 pixels across show 1,280 units at 1.5.
 */
export const DETAIL = 2;

interface Cell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where each frame sits in the atlas, pixels. Sizes are world units × `DETAIL`. */
export const CELLS = {
  /** A tank's hull, facing +x: 24 units in radius, treads along both sides. */
  hull: { x: 0, y: 0, w: 104, h: 104 },
  /** The shield's ring, and the own tank's marker. */
  ring: { x: 112, y: 0, w: 128, h: 128 },
  crate: { x: 248, y: 0, w: 72, h: 72 },
  /** A soft round light: the muzzle flash, a shell's glow, a burst. */
  glow: { x: 328, y: 0, w: 64, h: 64 },
  /** The turret, its pivot at the centre of the cell: a round base and a barrel to the muzzle. */
  turret: { x: 0, y: 136, w: 152, h: 40 },
  shell: { x: 160, y: 136, w: 32, h: 32 },
  spark: { x: 200, y: 136, w: 12, h: 12 },
  dot: { x: 220, y: 136, w: 16, h: 16 },
} as const satisfies Record<string, Cell>;

export type FrameName = keyof typeof CELLS;

const SIZE = { w: 512, h: 192 };

/**
 * Draws every frame once with a Graphics, stamps it into one `DynamicTexture`, and cuts the frames
 * out — one texture, so a whole frame of the arena batches into as few draw calls as its blend modes
 * allow. Shapes are white or grey: a tank or shell takes its player's colour as a tint.
 */
export function buildAtlas(scene: Phaser.Scene): void {
  if (scene.textures.exists(ATLAS)) return;
  const g = scene.make.graphics({}, false);
  const c = CELLS;

  // Hull: treads, a body, a lighter glacis at the front (+x).
  {
    const { x, y, w, h } = c.hull;
    const cx = x + w / 2;
    const cy = y + h / 2;
    g.fillStyle(0x6b6b6b, 1);
    g.fillRoundedRect(cx - 46, cy - 46, 92, 22, 6);
    g.fillRoundedRect(cx - 46, cy + 24, 92, 22, 6);
    g.fillStyle(0x4a4a4a, 1);
    for (let i = -40; i <= 36; i += 12) {
      g.fillRect(cx + i, cy - 44, 4, 18);
      g.fillRect(cx + i, cy + 26, 4, 18);
    }
    g.fillStyle(0xe6e6e6, 1);
    g.fillRoundedRect(cx - 38, cy - 28, 76, 56, 10);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(cx + 18, cy - 24, 18, 48, 6);
    g.lineStyle(3, 0x9a9a9a, 1);
    g.strokeRoundedRect(cx - 38, cy - 28, 76, 56, 10);
  }
  // Turret: the pivot at the cell's centre, the barrel to the muzzle, 32 units on.
  {
    const { x, y, w, h } = c.turret;
    const cx = x + w / 2;
    const cy = y + h / 2;
    g.fillStyle(0xd0d0d0, 1);
    g.fillRoundedRect(cx, cy - 6, 64, 12, 4);
    g.lineStyle(2, 0x8a8a8a, 1);
    g.strokeRoundedRect(cx, cy - 6, 64, 12, 4);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx, cy, 18);
    g.lineStyle(3, 0x9a9a9a, 1);
    g.strokeCircle(cx, cy, 18);
  }
  // Ring: a thin circle a little outside the hull.
  {
    const { x, y, w, h } = c.ring;
    g.lineStyle(5, 0xffffff, 1);
    g.strokeCircle(x + w / 2, y + h / 2, 58);
  }
  // Crate: a box with a cross on it, 16 units in radius.
  {
    const { x, y } = c.crate;
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(x + 6, y + 6, 60, 60, 8);
    g.fillStyle(0xb0b0b0, 1);
    g.fillRect(x + 31, y + 16, 10, 40);
    g.fillRect(x + 16, y + 31, 40, 10);
  }
  // Glow: concentric discs, faint at the rim.
  {
    const { x, y, w, h } = c.glow;
    for (let r = 32; r > 0; r -= 2) {
      g.fillStyle(0xffffff, 0.06 + 0.5 * (1 - r / 32) ** 2);
      g.fillCircle(x + w / 2, y + h / 2, r);
    }
  }
  // Shell: 6 units in radius, a bright core.
  {
    const { x, y, w, h } = c.shell;
    g.fillStyle(0xffffff, 0.35);
    g.fillCircle(x + w / 2, y + h / 2, 15);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x + w / 2, y + h / 2, 11);
  }
  // Spark and minimap dot.
  g.fillStyle(0xffffff, 1);
  g.fillRect(c.spark.x + 2, c.spark.y + 2, 8, 8);
  g.fillCircle(c.dot.x + 8, c.dot.y + 8, 7);

  const atlas = scene.textures.addDynamicTexture(ATLAS, SIZE.w, SIZE.h);
  if (!atlas) throw new Error('could not make the atlas');
  atlas.draw(g, 0, 0);
  atlas.render();
  for (const [name, cell] of Object.entries(CELLS))
    atlas.add(name, 0, cell.x, cell.y, cell.w, cell.h);
  g.destroy();
}
