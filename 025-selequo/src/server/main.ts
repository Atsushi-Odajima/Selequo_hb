import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadConfig } from './config';
import { openDb } from './db';
import { buildApp } from './app';

const config = loadConfig();
mkdirSync(path.resolve(config.dataDir), { recursive: true });
const db = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir ?? (config.databaseUrl ? undefined : path.resolve(config.dataDir, 'pglite')) });
const { app, runner } = await buildApp({ config, db, logger: config.env !== 'test' });
await app.listen({ port: config.port, host: config.host });
const shutdown = async () => {
  runner.stop();
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
