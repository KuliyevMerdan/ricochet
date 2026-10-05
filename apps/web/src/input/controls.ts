import type { Intent } from '@ricochet/netcode';
import { KeyboardMouse } from './keyboard.js';
import { Pad } from './pad.js';
import { TouchSticks } from './touch.js';
import type { StickSize } from './touch.js';

export type Scheme = 'keys' | 'touch' | 'pad';

/**
 * The three input schemes behind one `intent()` (ROADMAP C2): keyboard and mouse, two touch sticks,
 * a gamepad. Whichever was touched last is the one that drives; the sticks show only once the screen
 * has been touched. `intent()` is the input a tick sends and consumes a latched press; `peek()` is
 * the same, between ticks, consuming nothing — what the own tank is drawn toward.
 */
export class Controls {
  private scheme: Scheme = 'keys';
  private readonly keys: KeyboardMouse;
  private readonly touch: TouchSticks;
  private readonly pad = new Pad();

  constructor(
    stage: HTMLElement,
    sticks: HTMLElement,
    aimFrom: () => { x: number; y: number } | null,
    private readonly onScheme: (s: Scheme) => void = () => {},
  ) {
    this.keys = new KeyboardMouse(stage, aimFrom, () => this.use('keys'));
    this.touch = new TouchSticks(sticks, () => this.use('touch'));
    this.touch.show(false);
  }

  get current(): Scheme {
    return this.scheme;
  }

  configure(size: StickSize, moveSide: 'left' | 'right'): void {
    this.touch.configure(size, moveSide);
  }

  intent(): Intent {
    return this.read(true);
  }

  peek(): Intent {
    return this.read(false);
  }

  private read(take: boolean): Intent {
    const pad = this.pad.read();
    if (pad?.touched) this.use('pad');
    if (this.scheme === 'pad' && pad) return pad.intent;
    if (this.scheme === 'touch') return this.touch.intent(take);
    return this.keys.intent(take);
  }

  private use(s: Scheme): void {
    if (s === this.scheme) return;
    this.scheme = s;
    this.touch.show(s === 'touch');
    this.onScheme(s);
  }
}
