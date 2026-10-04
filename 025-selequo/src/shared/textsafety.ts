// Opinion vs fact separation and prompt-injection detection for imported documents.
// Imported text is always treated as *data*. These detectors only flag; they never execute anything.

const OPINION_PATTERNS: RegExp[] = [
  /おすすめ|オススメ|お勧め|最高|最強|神(機|コスパ)|コスパが(良|よ)い|コスパ最強|買って(よかった|良かった)|満足|不満|がっかり|微妙|残念|感動|気に入/,
  /(と|って)(思う|思います|感じ|感じる|感じます)|個人的|私は|僕は|わたしは/,
  /★|☆|\b[1-5](\.\d)?\s*\/\s*5\b|5つ星|星[1-5１-５]つ|レビュー評価|口コミ/,
  /\b(i think|i feel|in my opinion|imo|i love|i hate|recommend(ed)?|best|worst|awesome|amazing|terrible|great value|must[- ]buy|disappointing)\b/i,
];

export function isOpinion(text: string): boolean {
  return OPINION_PATTERNS.some((re) => re.test(text));
}

const INJECTION_PATTERNS: [RegExp, string][] = [
  [/ignore (all |any )?(the )?(previous|prior|above) (instructions|prompts?|rules)/i, 'ignore-previous-instructions'],
  [/disregard (all |any )?(previous|prior|above|your) (instructions|rules|guidelines)/i, 'disregard-instructions'],
  [/(以前|前|上記|これまで)の(指示|命令|プロンプト|ルール)を(無視|忘れ)/, 'ignore-previous-instructions-ja'],
  [/\b(system prompt|system message|developer message)\b/i, 'system-prompt-reference'],
  [/システムプロンプト/, 'system-prompt-reference-ja'],
  [/\byou are now\b|\bact as (an? )?(assistant|ai|system)\b/i, 'role-override'],
  [/あなたは(今から|これから)/, 'role-override-ja'],
  [/\b(choose|select|pick|recommend) (candidate|this product|this one|us)\b.*\b(winner|best|always)\b/i, 'steer-decision'],
  [/(この|当社の?)(製品|候補|サービス)を(選べ|選んで|推薦|おすすめ(しろ|して))/, 'steer-decision-ja'],
  [/(mark|set) (this|candidate \w+) (as )?(chosen|winner|confirmed)/i, 'state-change-request'],
  [/^\s*(assistant|system|user)\s*:/im, 'chat-role-marker'],
  [/<\s*\/?\s*(script|iframe|object)\b/i, 'active-content'],
  [/\b(exfiltrate|send (the|all) (data|documents?) to|curl\s+https?:)/i, 'exfiltration'],
];

export function detectInjection(text: string): { flags: string[]; lines: Set<number> } {
  const flags = new Set<string>();
  const lines = new Set<number>();
  const split = text.split(/\r?\n/);
  split.forEach((line, i) => {
    for (const [re, flag] of INJECTION_PATTERNS) {
      if (re.test(line)) {
        flags.add(flag);
        lines.add(i);
      }
    }
  });
  return { flags: [...flags], lines };
}

/** Escape CSV cell and neutralize spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Minimal RFC4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
