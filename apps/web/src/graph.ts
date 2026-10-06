/** One tenth of a second of the link, as the overlay's graph plots it. */
export interface Sample {
  /** The round trip, ms; `null` before the clock has one. */
  readonly rttMs: number | null;
  /** How far behind the newest snapshot the others are drawn, ms. */
  readonly delayMs: number;
  /** How far the newest view held is ahead of the drawn time, ms. */
  readonly bufferMs: number;
  /** How far the corrections in this tenth moved the own tank, units. */
  readonly fixUnits: number;
}

/** Samples a second, and seconds kept. */
export const SAMPLE_HZ = 10;
export const SECONDS = 10;

/** The last ten seconds of samples, oldest first; the oldest drops as a new one comes. */
export class History {
  private readonly ring: Sample[] = [];

  constructor(private readonly size = SAMPLE_HZ * SECONDS) {}

  push(s: Sample): void {
    this.ring.push(s);
    if (this.ring.length > this.size) this.ring.shift();
  }

  get samples(): readonly Sample[] {
    return this.ring;
  }

  /** The graph's top, ms: the largest line plotted, rounded up to a hundred, at least 200. */
  scaleMs(): number {
    let top = 0;
    for (const s of this.ring) top = Math.max(top, s.rttMs ?? 0, s.delayMs, s.bufferMs);
    return Math.max(200, Math.ceil(top / 100) * 100);
  }

  /** The bars' top, units: the largest correction, at least 8. */
  scaleUnits(): number {
    let top = 0;
    for (const s of this.ring) top = Math.max(top, s.fixUnits);
    return Math.max(8, Math.ceil(top));
  }
}

export const LINES = {
  rtt: '#4fc3f7',
  delay: '#ffb74d',
  buffer: '#81c784',
  fix: '#ff8a80',
} as const;

/**
 * The last ten seconds on a canvas: the round trip, the interpolation delay and the buffer's depth
 * as lines on one scale of milliseconds, the corrections as bars from the bottom on a scale of
 * their own. Drawn in CSS pixels on a canvas sized for the device.
 */
export function drawGraph(canvas: HTMLCanvasElement, history: History): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const n = SAMPLE_HZ * SECONDS;
  const step = w / (n - 1);
  const samples = history.samples;
  const x0 = (n - samples.length) * step;
  const top = history.scaleMs();
  const units = history.scaleUnits();

  g.strokeStyle = 'rgb(255 255 255 / 10%)';
  g.lineWidth = 1;
  for (let ms = 100; ms < top; ms += 100) {
    const y = Math.round(h - (ms / top) * h) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }

  g.fillStyle = LINES.fix;
  samples.forEach((s, i) => {
    if (s.fixUnits <= 0) return;
    const bh = Math.max(2, (s.fixUnits / units) * h * 0.5);
    g.fillRect(x0 + i * step - 1, h - bh, 2, bh);
  });

  const line = (color: string, value: (s: Sample) => number | null) => {
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.beginPath();
    let open = false;
    samples.forEach((s, i) => {
      const v = value(s);
      if (v === null) {
        open = false;
        return;
      }
      const x = x0 + i * step;
      const y = h - (Math.min(v, top) / top) * h;
      if (open) g.lineTo(x, y);
      else g.moveTo(x, y);
      open = true;
    });
    g.stroke();
  };
  line(LINES.buffer, (s) => s.bufferMs);
  line(LINES.delay, (s) => s.delayMs);
  line(LINES.rtt, (s) => s.rttMs);

  g.fillStyle = 'rgb(255 255 255 / 45%)';
  g.font = '10px ui-monospace, Menlo, monospace';
  g.fillText(`${top} ms`, 2, 10);
}
