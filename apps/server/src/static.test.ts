import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RULES } from '@ricochet/protocol';
import { describe, expect, it } from 'vitest';
import { createServer } from './app.js';
import { readConfig } from './config.js';

/** One image, one origin (ADR-0004): the built page from `/`, beside the probes and the socket. */
const config = {
  env: 'production',
  host: '127.0.0.1',
  port: 0,
  maxRooms: 1,
  pingMs: 1000,
  bots: RULES.botsFillTo,
  lab: true,
  logLevel: 'silent',
} as const;

function built(withIndex = true): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ricochet-web-'));
  mkdirSync(path.join(dir, 'assets'));
  if (withIndex)
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Ricochet</title>');
  writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'export {};');
  return dir;
}

describe('the built page, served beside the socket', () => {
  it('serves index.html afresh every time and hashed assets for a year', async () => {
    const s = createServer({ config: { ...config, staticDir: built() }, logger: false });
    const page = await s.app.inject('/');
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>Ricochet</title>');
    expect(page.headers['cache-control']).toBe('no-cache');
    const asset = await s.app.inject('/assets/index-abc123.js');
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    // The probes are not files.
    expect((await s.app.inject('/health')).json()).toEqual({ ok: true });
    expect((await s.app.inject('/ready')).statusCode).toBe(503); // the tick has not started
    await s.close();
  });

  it('refuses to boot on a directory with no index.html', () => {
    expect(() =>
      createServer({ config: { ...config, staticDir: built(false) }, logger: false }),
    ).toThrow(/has no index\.html/);
  });

  it('reads the directory from RICOCHET_STATIC_DIR, none when unset, and names an empty one', () => {
    expect(readConfig({ RICOCHET_STATIC_DIR: '/app/web' }).staticDir).toBe('/app/web');
    expect(readConfig({}).staticDir).toBeNull();
    expect(() => readConfig({ RICOCHET_STATIC_DIR: '' })).toThrow(/RICOCHET_STATIC_DIR/);
  });

  it('turns the lab on in development and leaves it to the host in production', () => {
    expect(readConfig({}).lab).toBe(true);
    expect(readConfig({ NODE_ENV: 'production' }).lab).toBe(false);
    expect(readConfig({ NODE_ENV: 'production', RICOCHET_LAB: 'on' }).lab).toBe(true);
    expect(() => readConfig({ RICOCHET_LAB: 'yes' })).toThrow(/RICOCHET_LAB/);
  });
});
