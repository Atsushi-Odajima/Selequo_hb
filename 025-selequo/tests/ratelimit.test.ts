import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config';
import { openDb } from '../src/server/db';
import { buildApp } from '../src/server/app';

describe('rate limiting', () => {
  it('login is limited per IP even when the session cookie is rotated', async () => {
    const config = loadConfig({ env: 'development', secret: 'x'.repeat(64) });
    const db = await openDb({});
    const { app } = await buildApp({ config, db, startJobs: false, aiProvider: null });
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { cookie: `slq_session=fake${i}` }, payload: { email: 'a@example.com', password: 'wrong-password' } });
      codes.push(r.statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    await app.close();
    await db.close();
  });
});
