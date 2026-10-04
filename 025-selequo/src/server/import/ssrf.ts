// SSRF protection for user-supplied URLs.
// - only http/https, no credentials, allowed ports only
// - every resolved address is checked (private, loopback, link-local, CGNAT, metadata, ULA, IPv4-mapped IPv6 ...)
// - the connection is pinned to the validated address (prevents DNS rebinding)
// - redirects are followed manually and re-validated

import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

/** Parse an IPv6 literal (incl. embedded dotted IPv4) into 8 16-bit words. */
export function ipv6Words(ip: string): number[] | null {
  let s = ip.split('%')[0];
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const o = m[2].split('.').map(Number);
    if (o.some((x) => x > 255)) return null;
    s = `${m[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const words = [...head, ...Array(fill).fill('0'), ...tail].map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return words.length === 8 && words.every((x) => Number.isFinite(x)) ? words : null;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const w = ipv6Words(ip.toLowerCase().replace(/^\[|\]$/g, ''));
    if (!w) return true;
    // Embedded-IPv4 forms are checked against the IPv4 rules:
    // ::/96 (compat), ::ffff:0:0/96 (mapped), ::ffff:0:0:0/96 (SIIT), 64:ff9b::/96 (NAT64)
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    if (w.slice(0, 6).every((x) => x === 0)) return w[6] === 0 && w[7] <= 1 ? true : isBlockedIp(v4(w[6], w[7]));
    if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return isBlockedIp(v4(w[6], w[7]));
    if (w.slice(0, 4).every((x) => x === 0) && w[4] === 0xffff && w[5] === 0) return isBlockedIp(v4(w[6], w[7]));
    if (w[0] === 0x64 && w[1] === 0xff9b) return true; // NAT64 (well-known and local-use 64:ff9b:1::/48) — never fetch through translators
    if (w[0] === 0x2002) return true; // 6to4 embeds IPv4
    if (w[0] === 0x2001 && w[1] === 0) return true; // Teredo
    if (w[0] === 0x2001 && w[1] === 0xdb8) return true; // documentation
    // only global unicast 2000::/3 is allowed
    return (w[0] & 0xe000) !== 0x2000;
  }
  return true; // not an IP → treat as blocked
}

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /^metadata(\.google\.internal)?$/i, /\.internal$/i, /\.local$/i, /^instance-data$/i];

export interface ValidatedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

export async function validateUrl(raw: string, opts: { allowPorts: number[]; resolver?: Resolver }): Promise<ValidatedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('URLの形式が正しくありません');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('http/https 以外のURLは取得できません');
  if (url.username || url.password) throw new SsrfError('認証情報を含むURLは取得できません');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!opts.allowPorts.includes(port)) throw new SsrfError(`ポート ${port} は許可されていません`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) throw new SsrfError('内部ホストへのアクセスは禁止されています');
  let addrs: { address: string; family: number }[];
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  else {
    // Reject numeric/obfuscated hosts like "2130706433" or "0x7f.1" that some resolvers accept
    if (/^[0-9.x]+$/i.test(host)) throw new SsrfError('数値形式のホスト名は許可されていません');
    try {
      addrs = await (opts.resolver ?? systemResolver)(host);
    } catch {
      throw new SsrfError('ホスト名を解決できません');
    }
  }
  if (!addrs.length) throw new SsrfError('ホスト名を解決できません');
  for (const a of addrs) if (isBlockedIp(a.address)) throw new SsrfError('プライベート/予約済みアドレスへのアクセスは禁止されています');
  return { url, address: addrs[0].address, family: addrs[0].family === 6 ? 6 : 4 };
}
