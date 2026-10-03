import { createServer } from './app.js';
import { readConfig } from './config.js';

const server = createServer({ config: readConfig(process.env) });
await server.listen();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
