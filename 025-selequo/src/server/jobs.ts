// DB-backed job queue with an in-process worker (Postgres: FOR UPDATE SKIP LOCKED for multiple workers).

import { newId } from './auth/crypto';
import type { Db } from './db';

export type JobHandler = (job: { id: string; workspaceId: string; type: string; payload: any }) => Promise<void>;

export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private kicked = false;
  constructor(
    private db: Db,
    private handlers: Record<string, JobHandler>,
    private opts: { pollMs?: number; maxAttempts?: number } = {},
  ) {}

  async enqueue(db: Db, workspaceId: string, type: string, payload: unknown) {
    const id = newId();
    await db.query(`INSERT INTO jobs (id, workspace_id, type, payload) VALUES ($1,$2,$3,$4)`, [id, workspaceId, type, JSON.stringify(payload)]);
    return id;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs ?? 1000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  kick() {
    if (this.timer) setImmediate(() => void this.tick());
    else this.kicked = true;
  }

  private async claim() {
    const lock = this.db.kind === 'postgres' ? 'FOR UPDATE SKIP LOCKED' : '';
    return this.db.tx(async (tx) => {
      const job = await tx.one<{ id: string; workspace_id: string; type: string; payload: any; attempts: number }>(
        `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY created_at LIMIT 1 ${lock}`,
      );
      if (!job) return null;
      await tx.query(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now() WHERE id = $1`, [job.id]);
      return job;
    });
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = await this.claim();
        if (!job) break;
        const handler = this.handlers[job.type];
        try {
          if (!handler) throw new Error(`no handler for ${job.type}`);
          await handler({ id: job.id, workspaceId: job.workspace_id, type: job.type, payload: job.payload });
          await this.db.query(`UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1`, [job.id]);
        } catch (e) {
          const retry = job.attempts + 1 < (this.opts.maxAttempts ?? 3);
          await this.db.query(`UPDATE jobs SET status = $2, last_error = $3, run_after = now() + interval '30 seconds', updated_at = now() WHERE id = $1`, [job.id, retry ? 'queued' : 'failed', String((e as Error).message).slice(0, 500)]);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Test helper: process until the queue is empty. */
  async drain() {
    this.kicked = false;
    await this.tick();
  }
}
