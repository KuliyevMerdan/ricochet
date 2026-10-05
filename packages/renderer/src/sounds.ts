import type Phaser from 'phaser';

/** At most this many sounds at once; past it a new one is not started. */
const BUDGET = 6;
/** Beyond this from the camera's centre, units, a sound is not heard. */
const HEARING = 900;

type Cue = 'shot' | 'ricochet' | 'hit';

/**
 * The arena's sounds, synthesised at boot into Phaser's audio cache — like the art, none ship — and
 * played through Phaser's sound manager, fainter with distance from the camera, at most `BUDGET` at
 * a time. Silent where the browser gives no Web Audio.
 */
export class Sounds {
  private playing = 0;
  private readonly ready: boolean;
  /** The player's setting: nothing plays while it is set. */
  muted = false;

  constructor(private readonly scene: Phaser.Scene) {
    const manager = scene.sound;
    const ctx = 'context' in manager ? manager.context : null;
    this.ready = ctx instanceof AudioContext;
    if (!(ctx instanceof AudioContext)) return;
    const make = (key: Cue, seconds: number, sample: (t: number, i: number) => number) => {
      if (scene.cache.audio.exists(key)) return;
      const n = Math.floor(ctx.sampleRate * seconds);
      const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = sample(i / ctx.sampleRate, i);
      scene.cache.audio.add(key, buffer);
    };
    let seed = 7;
    const noise = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };
    // A shot: a short crack of noise over a falling thump.
    make('shot', 0.16, (t) => {
      const env = Math.exp(-t * 38);
      const thump = Math.sin(2 * Math.PI * (140 - 300 * t) * t) * Math.exp(-t * 22);
      return 0.45 * (noise() * env + 0.8 * thump);
    });
    // A ricochet: a bright falling ping.
    make('ricochet', 0.18, (t) => {
      const f = 2200 - 5000 * t;
      return 0.3 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 24);
    });
    // A hit: low, dull, noisy.
    make('hit', 0.22, (t) => {
      const env = Math.exp(-t * 18);
      return 0.5 * env * (0.6 * noise() + Math.sin(2 * Math.PI * 90 * t));
    });
  }

  /** Play `cue` heard from `distance` units away, if within hearing and the budget. */
  play(cue: Cue, distance: number): void {
    if (!this.ready || this.muted || this.playing >= BUDGET || distance > HEARING) return;
    const volume = 0.6 * (1 - distance / HEARING);
    if (volume <= 0.02) return;
    const sound = this.scene.sound.add(cue, { volume, detune: Math.random() * 200 - 100 });
    this.playing++;
    sound.once('complete', () => {
      this.playing--;
      sound.destroy();
    });
    sound.play();
  }
}
