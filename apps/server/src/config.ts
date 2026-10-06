import { RULES } from '@ricochet/protocol';

/** The server's settings, from the environment, with every problem named at once. */
export interface Config {
  readonly env: 'production' | 'development';
  readonly host: string;
  readonly port: number;
  readonly maxRooms: number;
  readonly pingMs: number;
  /** Bots fill each room to this many tanks. */
  readonly bots: number;
  /** The network lab (`RICOCHET_LAB`): `lab` and `stall` heard, each on its sender's socket only. */
  readonly lab: boolean;
  /** The built page, served from `/` beside the socket (`RICOCHET_STATIC_DIR`) — one origin (ADR-0004);
   * `null` to serve none, as in development, where Vite serves it. */
  readonly staticDir: string | null;
  readonly logLevel: string;
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const problems: string[] = [];
  const int = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      problems.push(`${name}=${raw} is not an integer in [${min}, ${max}]`);
      return fallback;
    }
    return n;
  };
  const production = env.NODE_ENV === 'production';
  const lab = env.RICOCHET_LAB;
  if (lab !== undefined && lab !== '' && lab !== 'on' && lab !== 'off') {
    problems.push(`RICOCHET_LAB=${lab} is neither on nor off`);
  }
  const staticDir = env.RICOCHET_STATIC_DIR;
  if (staticDir === '') problems.push('RICOCHET_STATIC_DIR is empty');
  const config: Config = {
    env: production ? 'production' : 'development',
    host: env.HOST ?? '0.0.0.0',
    port: int('PORT', 8080, 0, 65535),
    maxRooms: int('RICOCHET_MAX_ROOMS', 50, 1, 1000),
    pingMs: int('RICOCHET_PING_MS', 1000, 50, 60_000),
    bots: int('RICOCHET_BOTS', RULES.botsFillTo, 0, RULES.roomSize),
    // On in development; opt-in in production, for the live demo — it breaks only its sender's link.
    lab: lab === 'on' || ((lab === undefined || lab === '') && !production),
    staticDir: staticDir === undefined || staticDir === '' ? null : staticDir,
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  if (problems.length > 0) throw new Error(`bad configuration:\n  ${problems.join('\n  ')}`);
  return config;
}
