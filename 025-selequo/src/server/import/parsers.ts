// Document parsers: HTML → structured text lines, PDF → per-page text, file type sniffing.

import * as cheerio from 'cheerio';

export interface ParsedDoc {
  title: string | null;
  publisher: string | null;
  publishedAt: string | null;
  pages: string[];
  paged: boolean;
}

/** Detect file type by magic bytes (never trust the client-provided MIME type). */
export function sniffType(buf: Uint8Array): { mime: string; kind: 'pdf' | 'image' | 'text' } | null {
  const b = buf;
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: 'application/pdf', kind: 'pdf' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', kind: 'image' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', kind: 'image' };
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return { mime: 'image/webp', kind: 'image' };
  // text: valid UTF-8 without NUL bytes in the first 8KB
  const head = b.slice(0, 8192);
  if (head.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.length === b.length ? head : b.slice(0, Math.min(b.length, 65536)));
    return { mime: 'text/plain', kind: 'text' };
  } catch {
    return null;
  }
}

export function imageSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      const len = (buf[i + 2] << 8) + buf[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return { height: (buf[i + 5] << 8) + buf[i + 6], width: (buf[i + 7] << 8) + buf[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

export function parseHtml(html: string, url?: string): ParsedDoc {
  const $ = cheerio.load(html);
  $('script:not([type="application/ld+json"]), style, noscript, iframe, svg, template, nav, footer form').remove();
  const title = $('meta[property="og:title"]').attr('content')?.trim() || $('title').first().text().trim() || null;
  const publisher =
    $('meta[property="og:site_name"]').attr('content')?.trim() || $('meta[name="author"]').attr('content')?.trim() || (url ? new URL(url).hostname : null);
  const publishedAt =
    $('meta[property="article:published_time"]').attr('content') || $('meta[name="date"]').attr('content') || $('time[datetime]').first().attr('datetime') || null;

  const lines: string[] = [];
  // JSON-LD Product/Offer → explicit lines
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      for (const item of Array.isArray(data) ? data : [data]) {
        if (!item || typeof item !== 'object') continue;
        if (/Product/i.test(String(item['@type']))) {
          if (item.name) lines.push(`製品名: ${item.name}`);
          const offers = Array.isArray(item.offers) ? item.offers : item.offers ? [item.offers] : [];
          for (const o of offers) if (o.price) lines.push(`価格: ${o.priceCurrency === 'JPY' ? '¥' : (o.priceCurrency ?? '') + ' '}${Number(o.price).toLocaleString('en-US')}`);
          if (item.weight?.value) lines.push(`重量: ${item.weight.value} ${item.weight.unitText ?? item.weight.unitCode ?? ''}`.trim());
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  $('script').remove();
  // Tables: th/td pairs become "label: value" lines
  $('table tr').each((_, tr) => {
    const cells = $(tr).children('th,td').toArray().map((c) => $(c).text().replace(/\s+/g, ' ').trim());
    if (cells.length >= 2 && cells[0]) lines.push(`${cells[0]}: ${cells.slice(1).join(' / ')}`);
  });
  $('table').remove();
  $('dl').each((_, dl) => {
    const dts = $(dl).children('dt').toArray();
    for (const dt of dts) {
      const dd = $(dt).nextAll('dd').first();
      lines.push(`${$(dt).text().trim()}: ${dd.text().replace(/\s+/g, ' ').trim()}`);
    }
  });
  $('dl').remove();
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, h5, h6, div, section, article, header, tr').each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  const body = $('body').length ? $('body').text() : $.root().text();
  for (const l of body.split('\n')) {
    const t = l.replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  }
  return { title, publisher, publishedAt, pages: [dedupeLines(lines).join('\n')], paged: false };
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
}

export async function parsePdf(data: Uint8Array): Promise<ParsedDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      let lastY: number | null = null;
      for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
        text += item.str;
        if (item.hasEOL) text += '\n';
        lastY = y ?? lastY;
      }
      pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
    }
    let title: string | null = null;
    try {
      const meta = await doc.getMetadata();
      title = ((meta.info as Record<string, unknown>)?.Title as string) || null;
    } catch {
      /* no metadata */
    }
    return { title, publisher: null, publishedAt: null, pages, paged: true };
  } finally {
    await task.destroy();
  }
}
