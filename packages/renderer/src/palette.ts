/**
 * The arena's colours, as 0xRRGGBB. Tanks are tinted from `TANKS` by id — twelve hues, as many as a
 * room holds, chosen apart in hue and all light enough to read on the dark floor; a shell takes its
 * owner's.
 */
export const TANKS: readonly number[] = [
  0x4fc3f7, // sky
  0xffb74d, // amber
  0x81c784, // green
  0xf06292, // pink
  0xba68c8, // violet
  0xfff176, // yellow
  0x4db6ac, // teal
  0xff8a65, // coral
  0x9fa8da, // periwinkle
  0xaed581, // lime
  0xe57373, // red
  0x90a4ae, // steel
];

export const FLOOR = 0x1b1f24;
/** The floor's grid lines, every 64 units. */
export const GRID = 0x262c33;
export const WALL = 0x3a4350;
export const WALL_EDGE = 0x56637a;
export const CRATE = 0xc8a165;
export const SHIELD = 0x80deea;
export const SPARK = 0xfff3c4;
/** The minimap's own tank. */
export const ME = 0xffffff;

/** A tank's colour by its id. */
export function tint(id: number): number {
  return TANKS[((id % TANKS.length) + TANKS.length) % TANKS.length] ?? 0xffffff;
}
