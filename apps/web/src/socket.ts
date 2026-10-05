import type { Clock, Connect, Timers } from '@ricochet/netcode';

/** `netcode`'s socket, from the browser's `WebSocket`: binary frames in and out, a text frame handed
 * on as `null` for the client to refuse. */
export function browserSocket(url: string): Connect {
  return (events) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => events.open();
    ws.onmessage = (e: MessageEvent<unknown>) =>
      events.message(e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : null);
    ws.onclose = () => events.close();
    return {
      send: (frame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      },
      close: () => ws.close(),
    };
  };
}

/** The game's socket on this page's own origin (protocol § 3): Vite proxies it in development, and
 * P1's server serves the page beside it. */
export function playUrl(loc: Location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/play`;
}

export const browserClock: Clock = { now: () => performance.now() };

export const browserTimers: Timers = {
  after(ms, fn) {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  },
};
