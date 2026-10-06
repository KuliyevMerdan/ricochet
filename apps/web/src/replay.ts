import { pointAt } from '@ricochet/netcode';
import type { Replay } from '@ricochet/netcode';
import { RULES } from '@ricochet/protocol';
import type { ArenaPicture } from '@ricochet/renderer';
import { tint } from '@ricochet/renderer';
import { HOLD_MS, MIN_HALF, SPEED, frameFor, replayTick } from './framing.js';
import type { Framing } from './framing.js';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The kill replay (ROADMAP C3) on a canvas of its own: the last three seconds before the own tank
 * died, from the views it was sent — `netcode`'s `Replay`, the server's truth — at half speed,
 * framed on the death, the killer and the shell's path, the shell traced as it flies, its bounce marked as it
 * passes, the hit where it reached the tank. Plain Canvas 2D: a picture-in-picture that outlives the
 * respawn needs nothing of the arena's scene.
 */
export class KillReplay {
  private replay: Replay | null = null;
  private view: Framing = { x: 0, y: 0, half: MIN_HALF };
  private started = 0;
  private frame = 0;

  constructor(
    private readonly box: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly caption: HTMLElement,
    private readonly arena: ArenaPicture,
    close: HTMLButtonElement,
  ) {
    close.onclick = () => this.stop();
  }

  get playing(): boolean {
    return this.replay !== null;
  }

  play(r: Replay, killer: string): void {
    this.replay = r;
    const shooter = r.at(r.from).tanks.find((t) => t.id === r.killer && r.killer !== r.you);
    this.view = frameFor([r.where, ...(r.fatal?.points ?? []), ...(shooter ? [shooter] : [])]);
    this.started = performance.now();
    this.box.hidden = false;
    this.caption.textContent =
      r.killer === r.you
        ? 'Your own ricochet · ½ speed · the server’s view'
        : `${killer} · ½ speed · the server’s view`;
    cancelAnimationFrame(this.frame);
    const tick = (now: number) => {
      if (!this.replay) return;
      this.draw(this.replay, replayTick(this.replay, now - this.started));
      const length = ((this.replay.to - this.replay.from) / RULES.tickHz / SPEED) * 1000;
      if (now - this.started < length + HOLD_MS) this.frame = requestAnimationFrame(tick);
      else this.frame = 0;
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Whether it has played through and held its last frame. */
  done(now: number): boolean {
    const r = this.replay;
    if (!r) return true;
    return now - this.started >= ((r.to - r.from) / RULES.tickHz / SPEED) * 1000 + HOLD_MS;
  }

  stop(): void {
    cancelAnimationFrame(this.frame);
    this.replay = null;
    this.box.hidden = true;
  }

  private draw(r: Replay, t: number): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(w * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    // Eighths to CSS pixels, the framing's square filling the canvas.
    const v = this.view;
    const k = w / (2 * v.half);
    g.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w / 2 - v.x * k), dpr * (w / 2 - v.y * k));
    g.fillStyle = '#11151a';
    g.fillRect(v.x - v.half, v.y - v.half, 2 * v.half, 2 * v.half);
    g.fillStyle = '#3a4350';
    for (const wall of this.arena.walls) {
      g.fillRect(wall.x0, wall.y0, wall.x1 - wall.x0, wall.y1 - wall.y0);
    }
    const px = 1 / k; // one CSS pixel, in eighths

    const pic = r.at(t);
    for (const tank of pic.tanks) {
      g.globalAlpha = tank.alive ? 1 : 0.35;
      g.fillStyle = hex(tint(tank.id));
      g.beginPath();
      g.arc(tank.x, tank.y, RULES.tankRadius, 0, 2 * Math.PI);
      g.fill();
      const a = (tank.turret / 1024) * 2 * Math.PI;
      g.strokeStyle = '#11151a';
      g.lineWidth = 4 * px;
      g.beginPath();
      g.moveTo(tank.x, tank.y);
      g.lineTo(tank.x + Math.cos(a) * RULES.muzzle, tank.y + Math.sin(a) * RULES.muzzle);
      g.stroke();
      if (tank.id === r.you) {
        g.strokeStyle = '#ffffff';
        g.lineWidth = 2 * px;
        g.beginPath();
        g.arc(tank.x, tank.y, RULES.tankRadius + 4 * px, 0, 2 * Math.PI);
        g.stroke();
      }
    }
    g.globalAlpha = 1;

    const f = r.fatal;
    if (f) {
      // The whole path, faint; the part flown so far, bright.
      g.lineWidth = 2 * px;
      g.strokeStyle = 'rgb(255 255 255 / 22%)';
      g.beginPath();
      f.points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
      g.stroke();
      const head = pointAt(f.points, Math.min(t, f.hit.tick));
      g.strokeStyle = '#ff8a80';
      g.lineWidth = 3 * px;
      g.beginPath();
      let begun = false;
      for (const p of f.points) {
        if (p.tick > t) break;
        if (begun) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
        begun = true;
      }
      if (begun && head) g.lineTo(head.x, head.y);
      g.stroke();
      if (f.bounce && t >= f.bounce.tick) {
        g.beginPath();
        g.arc(f.bounce.x, f.bounce.y, 7 * px, 0, 2 * Math.PI);
        g.stroke();
      }
      if (t >= f.hit.tick) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(f.hit.x, f.hit.y, 5 * px, 0, 2 * Math.PI);
        g.fill();
      }
    }
    for (const s of pic.shells) {
      g.fillStyle = s.id === f?.id ? '#ffffff' : hex(tint(s.owner));
      g.beginPath();
      g.arc(s.x, s.y, Math.max(RULES.shellRadius, 3 * px), 0, 2 * Math.PI);
      g.fill();
    }
  }
}
