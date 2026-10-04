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

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (n & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (lower === '::' || lower === '::1') return true;
    // IPv4-mapped / compatible / NAT64 forms → check embedded v4
    const mapped = lower.match(/^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA (incl. fd00:ec2::254 metadata)
    if ((first & 0xffc0) === 0xfe80) return true; // link-local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith('2001:db8')) return true; // documentation
    return false;
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
