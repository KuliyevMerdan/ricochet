import Phaser from 'phaser';
import { FLOOR } from './palette.js';
import { ArenaScene } from './scene.js';
import type { SceneOptions } from './scene.js';

export interface MountOptions extends SceneOptions {
  /** The element the canvas fills. */
  readonly parent: HTMLElement;
}

/** The mounted arena: what the page asks of it. */
export interface ArenaView {
  readonly game: Phaser.Game;
  /** The pointer's offset from the own tank, world units — the aim; `null` with no own tank. */
  pointerFromMe(): { x: number; y: number } | null;
  /** Frames drawn so far, and the last one's work, ms. */
  stats(): { frames: number; workMs: number };
  /** Sound on or off. */
  setMuted(muted: boolean): void;
  destroy(): void;
}

/** Device pixels per CSS pixel, at most 2: a phone's third pixel costs half again the fill for
 * detail no one sees at arm's length. */
const dpr = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

/**
 * One Phaser game filling `parent`, drawing `picture` at the display's rate. The canvas is the
 * parent's size in device pixels and shown at the parent's CSS size, so it is sharp on a phone; it
 * follows the parent as the window resizes. The loop sleeps while the tab is hidden.
 */
export function mountArena(opts: MountOptions): ArenaView {
  const scene = new ArenaScene(opts);
  const size = () => {
    const r = dpr();
    return {
      width: Math.round(opts.parent.clientWidth * r),
      height: Math.round(opts.parent.clientHeight * r),
      zoom: 1 / r,
    };
  };
  const s = size();
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: opts.parent,
    backgroundColor: FLOOR,
    banner: false,
    autoFocus: false,
    scale: { mode: Phaser.Scale.NONE, width: s.width, height: s.height, zoom: s.zoom },
    input: { keyboard: false, gamepad: false },
    render: { antialias: true, powerPreference: 'high-performance' },
    scene,
  });
  // Phaser marks a hidden tab paused and leaves the stopping to the browser's frame timer. Asleep,
  // its loop requests no frames at all: a background tab draws nothing, whatever the browser does
  // with its timers (ROADMAP C1).
  game.events.on(Phaser.Core.Events.HIDDEN, () => game.loop.sleep());
  game.events.on(Phaser.Core.Events.VISIBLE, () => game.loop.wake());
  const resize = () => {
    const n = size();
    game.scale.setZoom(n.zoom);
    game.scale.resize(n.width, n.height);
  };
  window.addEventListener('resize', resize);
  return {
    game,
    pointerFromMe: () => scene.pointerFromMe(),
    stats: () => ({ frames: scene.frames, workMs: scene.workMs }),
    setMuted: (muted) => {
      scene.muted = muted;
    },
    destroy: () => {
      window.removeEventListener('resize', resize);
      game.destroy(true);
    },
  };
}
