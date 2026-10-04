// DB-backed job queue with an in-process worker (Postgres: FOR UPDATE SKIP LOCKED for multiple workers).

import { newId } from './auth/crypto';
import type { Db } from './db';

export type JobHandler = (job: { id: string; workspaceId: string; type: string; payload: any }) => Promise<void>;

export class JobRunner {
  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private kicked = false;
  constructor(
    private db: Db,
    private handlers: Record<string, JobHandler>,
    private opts: { pollMs?: number; maxAttempts?: number; concurrency?: number; jobTimeoutMs?: number } = {},
  ) {}

  async enqueue(db: Db, workspaceId: string, type: string, payload: unknown) {
    const id = newId();
    await db.query(`INSERT INTO jobs (id, workspace_id, type, payload) VALUES ($1,$2,$3,$4)`, [id, workspaceId, type, JSON.stringify(payload)]);
    return id;
  }

  start() {
    if (this.timer) return;
    // recover jobs left 'running' by a crashed process
    void this.db.query(`UPDATE jobs SET status = 'queued', updated_at = now() WHERE status = 'running' AND updated_at < now() - interval '10 minutes'`).catch(() => {});
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
        // fairness: prefer workspaces that currently have no running job
        `SELECT * FROM jobs j WHERE status = 'queued' AND run_after <= now()
          ORDER BY (SELECT count(*) FROM jobs r WHERE r.workspace_id = j.workspace_id AND r.status = 'running'), created_at LIMIT 1 ${lock}`,
      );
      if (!job) return null;
      await tx.query(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now() WHERE id = $1`, [job.id]);
      return job;
    });
  }

  async tick() {
    const max = this.opts.concurrency ?? 3;
    const workers: Promise<void>[] = [];
    while (this.active < max) {
      this.active++;
      workers.push(this.work().finally(() => this.active--));
    }
    await Promise.all(workers);
  }

  private async work() {
    for (;;) {
      const job = await this.claim();
      if (!job) return;
      const handler = this.handlers[job.type];
      try {
        if (!handler) throw new Error(`no handler for ${job.type}`);
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
          handler({ id: job.id, workspaceId: job.workspace_id, type: job.type, payload: job.payload }),
          new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('job timeout')), this.opts.jobTimeoutMs ?? 120_000))),
        ]).finally(() => clearTimeout(timer));
        await this.db.query(`UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1`, [job.id]);
      } catch (e) {
        const retry = job.attempts + 1 < (this.opts.maxAttempts ?? 3);
        await this.db.query(`UPDATE jobs SET status = $2, last_error = $3, run_after = now() + interval '30 seconds', updated_at = now() WHERE id = $1`, [job.id, retry ? 'queued' : 'failed', String((e as Error).message).slice(0, 500)]);
      }
    }
  }

  /** Test helper: process until the queue is empty. */
  async drain() {
    this.kicked = false;
    await this.tick();
    while (this.active > 0) await new Promise((r) => setTimeout(r, 10));
  }
}
