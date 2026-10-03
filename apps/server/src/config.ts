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
  const config: Config = {
    env: env.NODE_ENV === 'production' ? 'production' : 'development',
    host: env.HOST ?? '0.0.0.0',
    port: int('PORT', 8080, 0, 65535),
    maxRooms: int('RICOCHET_MAX_ROOMS', 50, 1, 1000),
    pingMs: int('RICOCHET_PING_MS', 1000, 50, 60_000),
    bots: int('RICOCHET_BOTS', RULES.botsFillTo, 0, RULES.roomSize),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  if (problems.length > 0) throw new Error(`bad configuration:\n  ${problems.join('\n  ')}`);
  return config;
}
