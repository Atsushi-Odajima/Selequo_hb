// Polite, SSRF-safe URL fetcher. Respects robots.txt (RFC 9309), per-host pacing, size/time limits.
// Never bypasses CAPTCHA, logins or paywalls: such responses fail with an explanatory error.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Agent, request } from 'undici';
import { SsrfError, validateUrl, type Resolver } from './ssrf';

export const USER_AGENT = 'SelequoBot/0.1 (+https://selequo.invalid/bot; user-initiated single-page fetch)';

export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Uint8Array;
  retrievedAt: string;
}

export class FetchError extends Error {
  constructor(
    message: string,
    public code: 'ssrf' | 'robots' | 'blocked' | 'http' | 'size' | 'type' | 'timeout' | 'network',
  ) {
    super(message);
  }
}

export interface FetcherOptions {
  allowPorts: number[];
  maxBytes: number;
  timeoutMs?: number;
  fixturesDir?: string;
  resolver?: Resolver;
  minHostIntervalMs?: number;
}

const ACCEPTED = /^(text\/html|application\/xhtml\+xml|text\/plain|application\/pdf|image\/(png|jpeg|webp)|text\/csv)/i;
const CHALLENGE_MARKERS = /(g-recaptcha|h-captcha|hcaptcha\.com|cf-challenge|challenges\.cloudflare\.com|captcha-delivery|please enable cookies|paywall)/i;

export class Fetcher {
  private lastHit = new Map<string, number>();
  private robotsCache = new Map<string, { at: number; rules: RobotsRules }>();
  public fetchCount = 0;

  constructor(private opts: FetcherOptions) {}

  async fetch(rawUrl: string): Promise<FetchResult> {
    const fixture = await this.tryFixture(rawUrl);
    if (fixture) return fixture;
    let current = rawUrl;
    for (let hop = 0; hop < 4; hop++) {
      let target;
      try {
        target = await validateUrl(current, { allowPorts: this.opts.allowPorts, resolver: this.opts.resolver });
      } catch (e) {
        throw new FetchError((e as SsrfError).message, 'ssrf');
      }
      if (!(await this.robotsAllowed(target.url))) throw new FetchError('robots.txt により取得が許可されていません', 'robots');
      await this.pace(target.url.host);
      const res = await this.rawGet(target.url, target.address, target.family, this.opts.maxBytes);
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers['location'];
        if (!loc) throw new FetchError('リダイレクト先がありません', 'http');
        current = new URL(String(loc), target.url).toString();
        continue;
      }
      if ([401, 402, 403, 407, 429, 451].includes(res.status)) {
        throw new FetchError(`アクセスが制限されています（HTTP ${res.status}）。ログイン・課金・CAPTCHA等の回避は行いません。ページを保存してPDF/スクリーンショットで追加してください。`, 'blocked');
      }
      if (res.status >= 400) throw new FetchError(`HTTP ${res.status}`, 'http');
      const contentType = String(res.headers['content-type'] ?? 'application/octet-stream');
      if (!ACCEPTED.test(contentType)) throw new FetchError(`未対応のContent-Type: ${contentType}`, 'type');
      if (/html/i.test(contentType)) {
        const head = new TextDecoder().decode(res.body.slice(0, 200_000));
        if (CHALLENGE_MARKERS.test(head) && head.replace(/<[^>]+>/g, '').trim().length < 3000) {
          throw new FetchError('CAPTCHA/ペイウォール等の確認ページが返されました。回避は行いません。', 'blocked');
        }
      }
      this.fetchCount++;
      return { finalUrl: target.url.toString(), status: res.status, contentType, body: res.body, retrievedAt: new Date().toISOString() };
    }
    throw new FetchError('リダイレクトが多すぎます', 'http');
  }

  private async rawGet(url: URL, address: string, family: 4 | 6, maxBytes: number) {
    const dispatcher = new Agent({
      connect: {
        // pin the connection to the validated address (DNS-rebinding safe); TLS still uses SNI/hostname
        lookup: (_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          o && o.all ? cb(null, [{ address, family }]) : cb(null, address, family),
      } as never,
      headersTimeout: this.opts.timeoutMs ?? 10000,
      bodyTimeout: this.opts.timeoutMs ?? 10000,
    });
    try {
      const res = await request(url, {
        method: 'GET',
        dispatcher,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/pdf,image/*;q=0.8,*/*;q=0.5', 'accept-language': 'ja,en;q=0.8' },
        maxRedirections: 0,
      } as never);
      const len = Number(res.headers['content-length'] ?? 0);
      if (len > maxBytes) {
        res.body.destroy();
        throw new FetchError('ファイルサイズが上限を超えています', 'size');
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > maxBytes) {
          res.body.destroy();
          throw new FetchError('ファイルサイズが上限を超えています', 'size');
        }
        chunks.push(chunk);
      }
      return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) };
    } catch (e) {
      if (e instanceof FetchError) throw e;
      const msg = (e as Error).message ?? '';
      throw new FetchError(/timeout/i.test(msg) ? 'タイムアウトしました' : `取得に失敗しました: ${msg}`, /timeout/i.test(msg) ? 'timeout' : 'network');
    } finally {
      dispatcher.close().catch(() => {});
    }
  }

  private async pace(host: string) {
    const min = this.opts.minHostIntervalMs ?? 2000;
    const last = this.lastHit.get(host) ?? 0;
    const wait = last + min - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, min)));
    this.lastHit.set(host, Date.now());
  }

  async robotsAllowed(url: URL): Promise<boolean> {
    const origin = url.origin;
    const cached = this.robotsCache.get(origin);
    let rules: RobotsRules;
    if (cached && Date.now() - cached.at < 3600_000) rules = cached.rules;
    else {
      try {
        const t = await validateUrl(`${origin}/robots.txt`, { allowPorts: this.opts.allowPorts, resolver: this.opts.resolver });
        const res = await this.rawGet(t.url, t.address, t.family, 512 * 1024);
        if (res.status >= 500) rules = { disallowAll: true, rules: [] };
        else if (res.status >= 400) rules = { disallowAll: false, rules: [] };
        else rules = parseRobots(new TextDecoder().decode(res.body), 'selequobot');
      } catch {
        rules = { disallowAll: true, rules: [] }; // unreachable → assume complete disallow (RFC 9309 §2.3.1.4)
      }
      this.robotsCache.set(origin, { at: Date.now(), rules });
    }
    return robotsAllows(rules, url.pathname + url.search);
  }

  private async tryFixture(rawUrl: string): Promise<FetchResult | null> {
    if (!this.opts.fixturesDir) return null;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    if (!url.hostname.endsWith('.selequo.invalid')) return null;
    const sub = url.hostname.replace(/\.selequo\.invalid$/, '');
    const root = path.resolve(this.opts.fixturesDir);
    const file = path.resolve(root, sub, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep)) throw new FetchError('invalid fixture path', 'ssrf');
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      throw new FetchError('HTTP 404', 'http');
    }
    const ext = path.extname(file).toLowerCase();
    const contentType = { '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' }[ext] ?? 'application/octet-stream';
    this.fetchCount++;
    return { finalUrl: url.toString(), status: 200, contentType, body: new Uint8Array(body), retrievedAt: new Date().toISOString() };
  }
}

export interface RobotsRules {
  disallowAll: boolean;
  rules: { allow: boolean; path: string }[];
}

export function parseRobots(txt: string, agent: string): RobotsRules {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: { agents: string[]; rules: { allow: boolean; path: string }[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && cur) {
      if (value) cur.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.toLowerCase().startsWith(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return { disallowAll: false, rules: chosen.flatMap((g) => g.rules) };
}

export function robotsAllows(r: RobotsRules, pathAndQuery: string): boolean {
  if (r.disallowAll) return false;
  if (pathAndQuery === '/robots.txt') return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of r.rules) {
    const re = new RegExp('^' + rule.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathAndQuery)) {
      const len = rule.path.length;
      if (!best || len > best.len || (len === best.len && rule.allow)) best = { allow: rule.allow, len };
    }
  }
  return best ? best.allow : true;
}
