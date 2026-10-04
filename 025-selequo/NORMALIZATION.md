# NORMALIZATION — 属性の対応付けと値の正規化

原則: **値をでっち上げない。** 単位がない、単位系が違う、範囲で書かれている、といった場合は自動換算せず、`issue` を付けて人の確認に回す。**Unknown は 0 ではない。**

関連ファイル: `src/shared/attributes.ts`, `src/shared/units.ts`, `src/shared/normalize.ts`, `src/server/services/projects.ts`（`mapLabel`, `createAttribute`）

## 1. 属性カタログ（`CATALOG`）

| key | 表示名 | type | 次元 / 基準単位 | 除外語（excludes）の例 |
|---|---|---|---|---|
| `price` | 価格 | price | – | 送料, shipping, 初期費用, setup fee, 解約 |
| `shipping_fee` | 送料 | price | – | |
| `setup_fee` | 初期費用 | price | – | |
| `cpu` | CPU | text | – | gpu, graphics, グラフィック |
| `memory` | メモリ | number | data / GB | gpu, vram, graphics, video, cache, storage, ssd, rom, emmc, flash, card, slot, 最大搭載 … |
| `storage` | ストレージ | number | data / GB | cloud, クラウド, memory, ram, 上限, limit, per user … |
| `gpu` | GPU | text | – | memory, メモリ, vram |
| `display_size` | 画面サイズ | number | length / inch | resolution, 解像度, refresh, 輝度, port, 出力 … |
| `resolution` | 解像度 | text | – | |
| `weight` | 重量 | number | mass / kg | 耐荷重, max load, 積載, 梱包, package, shipping weight, 箱 |
| `battery_life` | バッテリー駆動時間 | number | duration / h | capacity, 容量, wh, mah, 充電時間, charging |
| `battery_capacity` | バッテリー容量 | number | energy / Wh | |
| `os`, `ports`, `warranty`, `availability`, `delivery`, `support`, `contract_term`, `certifications`, `integrations` | – | text | – | delivery は 送料, fee, 料金 を除外 |
| `seat_limit` | ユーザー数上限 | number | count（単位なし） | |
| `sla` | SLA | number | percent / % | |
| `sso` | SSO | bool | – | |

プロジェクト作成時は、カテゴリに応じた既定の属性を `catalog` 由来で作る（`DEFAULT_ATTRS`: `laptop` / `saas` / それ以外）。カタログにないキーはユーザー定義属性（`origin: 'user'`、キーは `slugKey(displayName)`）になる。

## 2. ラベルの対応付け（`matchLabel`）

1. `normalizeLabel`: 半角化、小文字化、括弧内の補足（`（目安）` など）の削除、区切り記号（`: | ・ - _ / [ ] 【】「」`）を空白にし、空白を詰める。
2. **プロジェクトルールを最優先する**: 有効な `normalization_rules` のうち、`normalizeLabel(pattern)` がラベルと完全一致するもの。
3. **カタログ照合**: 除外語を含む属性は候補から外す。残りの属性について、キーと別名（aliases）がラベルに含まれるかを調べる。ASCII の別名は単語境界を要求する（`ram` が `program` に一致しないように）。スコアは別名の長さ（ラベル全体と完全一致なら +100）。
4. 最高スコアの属性が 1 つなら採用する。**同点で複数あれば `key = null`, `ambiguous = [...]`**（曖昧なので人が判断する。Fact の `issue` は `ambiguous`）。何も一致しなければ `no_match`。

ユーザー定義属性（origin=user, active）は表示名と `aliases` を `extra` として `matchLabel` に渡すため、次回以降の取り込み（再処理を含む）で自動的に対応付けられる。既存の Fact を付け替える場合は §3 のルール（`mapLabel`）を使う。

### 誤った統合を防ぐ例（実装で確認済み）

| 生のラベル | 結果 | 理由 |
|---|---|---|
| `メモリ` | `memory` | 別名と完全一致 |
| `GPUメモリ` / `グラフィックスメモリ` | 未マップ | memory は `gpu` / `グラフィック` を除外し、gpu は `メモリ` を除外する |
| `最大搭載メモリ` | 未マップ | memory の除外語 `最大搭載` |
| `バッテリー容量` | `battery_capacity` | battery_life は `容量` を除外する |
| `バッテリー駆動時間（目安）` | `battery_life` | 括弧内は無視する |
| `梱包重量` | 未マップ | weight の除外語 `梱包` |
| `クラウドストレージ` | 未マップ | storage の除外語 `クラウド` |
| `送料` | `shipping_fee` | price は `送料` を除外する |
| `Program` | 未マップ | `ram` には単語境界が必要 |
| `メモリ/ストレージ` | 未マップ | 互いに除外し合う |

値の側でも防御がある: ラベルが `battery_life` に対応付けられても値が `50Wh` なら `unit_mismatch` になり、抽出器は対応付けを外す（FACT_EXTRACTION.md §2）。

## 3. プロジェクトルール（版管理）— `mapLabel`

`POST /projects/:pid/attributes/map-label {label, attributeKey}`（Editor 以上）:
1. 同じ `pattern` の既存ルールをすべて `active = false` にする（**削除しない**。履歴として残す）。
2. `version = 既存の最大値 + 1` で新しいルールを追加する（`kind = 'alias'`、`created_by` 付き）。
3. `raw_label` が完全一致するプロジェクト内の `kind = fact` の Fact を、新しい属性の形で再正規化する（`attribute_key`, `normalized_value`, `unit`, `issue` を更新）。
4. 監査ログに `normalization.rule`（label, attributeKey, version, 更新した Fact 数, issue 数）を記録する。

ルールは以後の抽出（パーサ、AI、CSV）に適用される。一覧は `GET /projects/:pid/rules`（版の新しい順）。
注意: `mapLabel` は既存 Fact のレビュー状態をリセットしない（`patchFact` は個々の Fact の再マップ時に `candidate` に戻す）。

## 4. 単位（`src/shared/units.ts`）

| 次元 | 基準単位 | 単位（別名の例） |
|---|---|---|
| data | GB | TB(=1024GB), GB, MB(=1/1024GB)。TiB/GiB/テラバイト/ギガ も受け付ける |
| mass | kg | kg, g, lb |
| duration | h | h(時間/hours/hrs), min(分) |
| length | inch | inch(インチ/型/"), cm, mm |
| frequency | GHz | GHz, MHz, Hz |
| power / energy / charge | W / Wh / mAh | |
| percent | % | |

- **データ容量は 2 進換算で、1TB = 1024GB**（製品仕様の慣習に合わせている）。
- `convert` は同じ次元の中でしか換算しない（次元が違えば例外）。値は小数 6 桁で丸める。
- `toHalfWidth` が全角の数字・英字・`．，：％` と全角空白を半角にする。`parseNumber` は桁区切りを許す。
- `count` / `currency` / `resolution` の次元は定義しているが、`count` 以外の単位表には登録していない（価格は `price.ts` で扱う）。

## 5. 値の正規化（`normalizeValue`）

| 属性の type | 規則 |
|---|---|
| `text` | 空白を詰めた文字列 |
| `bool` | 否定語（no, false, 非対応, なし, 無, 不可, ×, 未対応 …）を先に判定し、次に肯定語（yes, 対応, あり, 有, 可, ○, ✓, サポート …）。どちらでもなければ `unparseable` |
| `price` | `parsePrice` → `{number, unit: 'JPY/month/seat' など}` |
| `number`（count） | 最初の数値。`無制限` / `unlimited` は text `無制限` |
| `number`（単位あり） | 下表 |

| issue | 条件 | 例（実装で確認済み） |
|---|---|---|
| `unit_missing` | 数値はあるが単位がない | memory `16` → null |
| `unit_mismatch` | 単位はあるが属性の次元と違う | battery_life `50Wh` → null |
| `range_value` | `1.2〜1.4kg`、`1.2-1.4 kg`、`to` などの範囲表記（`最大` / `up to` / `max` を含む場合は除く） | weight `1.2〜1.4kg` → null |
| `multiple_values` | 同じ次元の異なる値が複数ある。**最初の値を採用し、要確認とする** | storage `512GB / 1TB` → 512 GB |
| `unparseable` | 読み取れない | |
| （なし） | 正常 | memory `1TB` → 1024 GB、weight `1,350g` → 1.35 kg、display_size `14型` → 14 inch、battery_life `最大 18時間` → 18 h |

`issue` は Fact に保存され、レビュー画面で表示される。`normalized_value = null` の Fact は比較表で生の値を表示し、スコアには使わない（「値を正規化できません（要確認）」）。

## 6. 等価判定（`valuesEqual`）— Conflict 検出に使う

- number: 単位文字列が同じで、値が一致するか相対差 0.5% 以内。
- bool: 一致。
- text: 区切り記号を除いた正規形が一致するか、**言い換えに寛容な比較**（`sameTextSignature`）で一致すること。言い換えの比較では、数値の並びが同じで、意味のある英単語の集合（`cores`, `years`, `gb` などの単位語を除く）が同じであれば同じ値とみなす。
  - `16コア` = `16 cores`、`2年間` = `2 years` → 同じ値
  - `Windows 11 Home` ≠ `Windows 11 Pro` → 別の値（Conflict になりうる）

## 7. Unknown ≠ 0

- 値がない、または正規化できないセルは `Unknown` として表示し、0 として計算しない（COMPARISON_ENGINE.md）。
- Must-have の Unknown は Fail ではない。
- 不足情報キュー（`GET /projects/:pid/missing`、MCP `get_missing_information`）は Unknown のセル、Must-have が Unknown の候補、未確認の値、未解決の質問の数を一覧にする。
