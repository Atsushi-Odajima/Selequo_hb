// Attribute catalog: canonical comparison attributes with aliases and *exclusions*.
// Exclusions prevent wrong merges such as "GPU memory 8GB" → Memory, or "バッテリー容量" → battery life.

import type { AttrType } from './types';
import { type Dimension, toHalfWidth } from './units';

export interface CatalogAttribute {
  key: string;
  displayName: string;
  displayNameEn: string;
  type: AttrType;
  dim?: Dimension;
  unit?: string; // base unit for numeric attributes
  category: 'price' | 'spec' | 'feature' | 'limit' | 'condition' | 'availability' | 'support' | 'contract' | 'delivery' | 'warranty' | 'integration' | 'security' | 'general';
  aliases: string[];
  excludes?: string[];
}

export const CATALOG: CatalogAttribute[] = [
  {
    key: 'price',
    displayName: '価格',
    displayNameEn: 'Price',
    type: 'price',
    category: 'price',
    aliases: ['price', 'pricing', 'list price', 'msrp', 'cost', '価格', '料金', '販売価格', '税込価格', '本体価格', '参考価格', '月額', '年額', '月額料金', '年額料金', 'プラン料金', '値段', '費用'],
    excludes: ['送料', 'shipping', '初期費用', 'setup fee', '解約'],
  },
  {
    key: 'shipping_fee',
    displayName: '送料',
    displayNameEn: 'Shipping fee',
    type: 'price',
    category: 'delivery',
    aliases: ['送料', 'shipping fee', 'shipping cost', 'delivery fee', '配送料'],
  },
  {
    key: 'setup_fee',
    displayName: '初期費用',
    displayNameEn: 'Setup fee',
    type: 'price',
    category: 'price',
    aliases: ['初期費用', 'setup fee', 'onboarding fee', '導入費用'],
  },
  {
    key: 'cpu',
    displayName: 'CPU',
    displayNameEn: 'CPU',
    type: 'text',
    category: 'spec',
    aliases: ['cpu', 'processor', 'プロセッサー', 'プロセッサ', 'チップ', 'chip', 'soc'],
    excludes: ['gpu', 'graphics', 'グラフィック'],
  },
  {
    key: 'memory',
    displayName: 'メモリ',
    displayNameEn: 'Memory (RAM)',
    type: 'number',
    dim: 'data',
    unit: 'GB',
    category: 'spec',
    aliases: ['memory', 'ram', 'メモリ', 'メインメモリ', 'システムメモリ', '搭載メモリ', 'メモリー', 'unified memory', 'ユニファイドメモリ'],
    excludes: ['gpu', 'vram', 'graphics', 'video', 'グラフィック', 'ビデオ', 'cache', 'キャッシュ', 'storage', 'ストレージ', 'ssd', 'rom', 'emmc', 'フラッシュ', 'flash', 'カード', 'card', 'スロット', 'slot', '最大搭載'],
  },
  {
    key: 'storage',
    displayName: 'ストレージ',
    displayNameEn: 'Storage',
    type: 'number',
    dim: 'data',
    unit: 'GB',
    category: 'spec',
    aliases: ['storage', 'ssd', 'hdd', 'ストレージ', '内蔵ストレージ', 'emmc', '記憶装置', 'ssd容量', 'disk', 'ディスク'],
    excludes: ['cloud', 'クラウド', 'memory', 'メモリ', 'ram', '上限', 'limit', 'per user', 'ユーザーあたり'],
  },
  {
    key: 'gpu',
    displayName: 'GPU',
    displayNameEn: 'GPU',
    type: 'text',
    category: 'spec',
    aliases: ['gpu', 'graphics', 'グラフィックス', 'グラフィック', 'グラフィックス機能'],
    excludes: ['memory', 'メモリ', 'vram'],
  },
  {
    key: 'display_size',
    displayName: '画面サイズ',
    displayNameEn: 'Display size',
    type: 'number',
    dim: 'length',
    unit: 'inch',
    category: 'spec',
    aliases: ['display', 'screen', 'display size', 'screen size', 'ディスプレイ', '画面サイズ', '液晶', '画面', '液晶サイズ'],
    excludes: ['resolution', '解像度', 'refresh', 'リフレッシュ', '輝度', 'brightness', 'ポート', 'port', '出力', 'output'],
  },
  {
    key: 'resolution',
    displayName: '解像度',
    displayNameEn: 'Resolution',
    type: 'text',
    category: 'spec',
    aliases: ['resolution', '解像度'],
  },
  {
    key: 'weight',
    displayName: '重量',
    displayNameEn: 'Weight',
    type: 'number',
    dim: 'mass',
    unit: 'kg',
    category: 'spec',
    aliases: ['weight', '重量', '重さ', '質量', '本体重量', '本体質量'],
    excludes: ['耐荷重', 'max load', 'load capacity', '積載', '梱包', 'package', 'shipping weight', '箱'],
  },
  {
    key: 'battery_life',
    displayName: 'バッテリー駆動時間',
    displayNameEn: 'Battery life',
    type: 'number',
    dim: 'duration',
    unit: 'h',
    category: 'spec',
    aliases: ['battery life', 'battery', 'バッテリー', 'バッテリー駆動時間', '駆動時間', 'バッテリー持続時間', 'バッテリ駆動時間', '電池持ち'],
    excludes: ['capacity', '容量', 'wh', 'mah', '充電時間', 'charging', 'charge time'],
  },
  {
    key: 'battery_capacity',
    displayName: 'バッテリー容量',
    displayNameEn: 'Battery capacity',
    type: 'number',
    dim: 'energy',
    unit: 'Wh',
    category: 'spec',
    aliases: ['battery capacity', 'バッテリー容量', '電池容量'],
  },
  {
    key: 'os',
    displayName: 'OS',
    displayNameEn: 'OS',
    type: 'text',
    category: 'spec',
    aliases: ['os', 'operating system', 'オペレーティングシステム', '搭載os'],
  },
  {
    key: 'ports',
    displayName: 'インターフェース',
    displayNameEn: 'Ports',
    type: 'text',
    category: 'spec',
    aliases: ['ports', 'interfaces', 'インターフェース', 'インタフェース', '端子', '接続端子', 'io'],
  },
  {
    key: 'warranty',
    displayName: '保証',
    displayNameEn: 'Warranty',
    type: 'text',
    category: 'warranty',
    aliases: ['warranty', '保証', '保証期間', 'メーカー保証'],
  },
  {
    key: 'availability',
    displayName: '在庫・提供状況',
    displayNameEn: 'Availability',
    type: 'text',
    category: 'availability',
    aliases: ['availability', 'in stock', 'stock', '在庫', '在庫状況', '提供状況', '販売状況'],
  },
  {
    key: 'delivery',
    displayName: '納期・配送',
    displayNameEn: 'Delivery',
    type: 'text',
    category: 'delivery',
    aliases: ['delivery', 'ships in', 'lead time', '納期', '配送', 'お届け', '発送', '出荷'],
    excludes: ['送料', 'fee', '料金'],
  },
  {
    key: 'support',
    displayName: 'サポート',
    displayNameEn: 'Support',
    type: 'text',
    category: 'support',
    aliases: ['support', 'サポート', 'サポート体制', '問い合わせ', 'customer support'],
  },
  {
    key: 'contract_term',
    displayName: '契約期間',
    displayNameEn: 'Contract term',
    type: 'text',
    category: 'contract',
    aliases: ['contract', 'contract term', 'minimum term', 'commitment', '契約', '契約期間', '最低利用期間', '最低契約期間'],
  },
  {
    key: 'seat_limit',
    displayName: 'ユーザー数上限',
    displayNameEn: 'Seat limit',
    type: 'number',
    dim: 'count',
    category: 'limit',
    aliases: ['max users', 'user limit', 'seat limit', 'seats', 'ユーザー数上限', '利用人数', '最大ユーザー数', 'ユーザー数'],
  },
  {
    key: 'sla',
    displayName: 'SLA',
    displayNameEn: 'SLA',
    type: 'number',
    dim: 'percent',
    unit: '%',
    category: 'condition',
    aliases: ['sla', 'uptime', '稼働率', 'uptime sla', '可用性'],
  },
  {
    key: 'sso',
    displayName: 'SSO',
    displayNameEn: 'SSO',
    type: 'bool',
    category: 'security',
    aliases: ['sso', 'single sign-on', 'saml', 'シングルサインオン'],
  },
  {
    key: 'certifications',
    displayName: 'セキュリティ認証',
    displayNameEn: 'Certifications',
    type: 'text',
    category: 'security',
    aliases: ['certifications', 'compliance', 'セキュリティ認証', '認証取得', '第三者認証', 'iso 27001', 'soc 2', 'soc2'],
  },
  {
    key: 'integrations',
    displayName: '連携',
    displayNameEn: 'Integrations',
    type: 'text',
    category: 'integration',
    aliases: ['integrations', 'integration', '連携', '外部連携', 'インテグレーション', 'api'],
  },
];

export const CATALOG_BY_KEY = new Map(CATALOG.map((a) => [a.key, a]));

/** Normalize a label for matching: half-width, lowercase, collapse separators. */
export function normalizeLabel(label: string): string {
  return toHalfWidth(label)
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, ' ') // drop parenthetical qualifiers such as (目安)
    .replace(/[:：|｜・\-_/／\[\]【】「」]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAlias(label: string, alias: string): boolean {
  const a = alias.toLowerCase();
  if (/^[a-z0-9 ]+$/.test(a)) {
    // ASCII alias: require word boundaries so "ram" does not match "program"
    return new RegExp(`(^|[^a-z0-9])${a.replace(/ /g, '\\s+')}($|[^a-z0-9])`).test(label);
  }
  return label.includes(a);
}

export interface LabelMatch {
  key: string | null;
  ambiguous: string[]; // populated when several attributes match equally well
  reason: string;
}

export interface AliasRule {
  pattern: string; // normalized label
  attributeKey: string;
}

/**
 * Map a raw label to an attribute key. Project rules (exact normalized match) take precedence.
 * Returns key=null when nothing matches or the match is ambiguous — a human then decides.
 */
export function matchLabel(rawLabel: string, rules: AliasRule[] = [], extra: CatalogAttribute[] = []): LabelMatch {
  const label = normalizeLabel(rawLabel);
  if (!label) return { key: null, ambiguous: [], reason: 'empty_label' };
  const rule = rules.find((r) => normalizeLabel(r.pattern) === label);
  if (rule) return { key: rule.attributeKey, ambiguous: [], reason: 'rule' };
  let best = 0;
  let keys: string[] = [];
  for (const attr of [...CATALOG, ...extra]) {
    if (attr.excludes?.some((x) => containsAlias(label, x))) continue;
    for (const alias of [attr.key, ...attr.aliases]) {
      if (!containsAlias(label, alias)) continue;
      const score = alias.length + (normalizeLabel(alias) === label ? 100 : 0);
      if (score > best) {
        best = score;
        keys = [attr.key];
      } else if (score === best && !keys.includes(attr.key)) keys.push(attr.key);
    }
  }
  if (keys.length === 1) return { key: keys[0], ambiguous: [], reason: 'catalog' };
  if (keys.length > 1) return { key: null, ambiguous: keys, reason: 'ambiguous' };
  return { key: null, ambiguous: [], reason: 'no_match' };
}

/** Slug for a user-defined attribute key. */
export function slugKey(label: string): string {
  const s = normalizeLabel(label)
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.slice(0, 48) || 'attr';
}
