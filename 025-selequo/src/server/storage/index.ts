// Object storage abstraction. LocalDiskStorage for dev/self-hosting; any S3-compatible
// implementation can satisfy the same interface. Downloads go through short-lived HMAC-signed URLs.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface Storage {
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,250}$/;

export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error('invalid storage key');
}

export class LocalDiskStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    assertSafeKey(key);
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, data: Uint8Array) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.file(key)));
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
  async deletePrefix(prefix: string) {
    await rm(this.file(prefix.replace(/\/$/, '')), { recursive: true, force: true });
  }
}

export class MemoryStorage implements Storage {
  files = new Map<string, Uint8Array>();
  async put(key: string, data: Uint8Array) {
    assertSafeKey(key);
    this.files.set(key, data);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
  async deletePrefix(prefix: string) {
    for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k);
  }
}

export function signFileUrl(secret: string, key: string, ttlSeconds = 300, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = createHmac('sha256', secret).update(`${key}|${exp}`).digest('base64url');
  return `/api/files?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`;
}

export function verifyFileSignature(secret: string, key: string, exp: string, sig: string, now = Date.now()): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e * 1000 < now) return false;
  const expected = createHmac('sha256', secret).update(`${key}|${e}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, 'base64url');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
