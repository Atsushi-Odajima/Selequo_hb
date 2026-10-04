# COMPARISON_ENGINE — 比較エンジン

`src/shared/compare.ts` は**副作用のない決定的な関数**である（DB もネットワークも使わない）。サーバ（`src/server/services/comparison.ts`）がプロジェクトのデータを読み込んで渡す。Web と MCP も同じ結果を使う。

基本ルール: Evidence が先でスコアは補助。**Unknown ≠ 0**。食い違う Fact は並べて表示する。Must-have の Unknown は Fail ではない。結果は「この Criteria 設定では」と表現し、**勝者を宣言しない**。

## 1. 入力とオプション

`CompareInput` = candidates / attributes / facts / criteria / prices / sources（`loadCompareInput`）。

| オプション | 決め方（優先順） | 既定 |
|---|---|---|
| `factPolicy` | API のクエリ `?factPolicy=` → `projects.fact_policy` | `confirmed_only` |
| `costBasis` | Scenario の `params.costBasis` → `projects.default_params.costBasis` | `annual_total` |
| `seats` | Scenario の `params.seats` → `default_params.seats` | null |
| `includeShipping` | Scenario の `params.includeShipping` → `default_params.includeShipping` | false |
| `currency` | `projects.currency` | `JPY` |
| `now` | テスト用に注入できる（ソースの経過日数に使う） | `Date.now()` |

削除済みソースの Fact と価格は最初に除外する。

## 2. 比較表のセル（`buildCell`）

対象は `status = active` の属性（`sort_order`、次に key の順）。セルに使うのは `kind = fact` かつ `review_state ∈ {confirmed, candidate}` の Fact（意見、却下、置き換え済みは使わない）。

| `status` | 条件 | 表示 |
|---|---|---|
| `unknown` | 使える Fact がない | `Unknown` |
| `value` | 値が 1 種類（`valuesEqual` でまとめる）、または価格属性 | 値。価格が複数あれば ` · ` で並べる |
| `conflict` | 価格以外で、異なる値が 2 種類以上 | 値を ` / ` で並べる |

- **価格は Conflict にしない**: 販売元の違いや月額と年額の違いは「別のオファー」として、単位（通貨/周期/席）ごとに並べる。比較は Price Snapshot と明示した費用基準で行う（§5）。
- セルの付加情報: `verified`（Confirm 済みの Fact が 1 件以上ある）、`needsReview`（未レビューの Fact がある）、`sourceAgeDays`（最も新しい `retrieved_at` / `captured_at` からの日数）、`officialSource`（品質が official か manufacturer）、`factIds`。
- 比較表には `factPolicy` に関係なく未確認の値も「未確認」として表示する。`factPolicy` が効くのはスコアの入力（§3）と価格の採用（§5）である。
- 行の `differs`: 既知の値が候補間で異なるか、Conflict を含む行。Brief の「主な違い」に使う。
- 結果には `missing`（Unknown のセル）と `conflicts`（値と factIds）も含む。

## 3. Criteria の入力値

対象は `status = active` の Criteria（`suggested` は人が採用するまで使わない）。Weight は Scenario の上書き値 → Criteria の値の順で決まる。Must-have も同様。

候補ごとに `linkedAttributes` を順に見て、最初に使える値を入力にする。
1. **価格属性**: その候補の Price Snapshot（`fact_id` 付きのものは Fact が Confirm 済みであること。`include_unreviewed` の場合は不要。手入力のスナップショットは常に対象）から、`ソース × 課金周期 × 席単位` ごとに最新のものを取る。それぞれ `computeCost` で換算し、比較可能なものの**最安値**を入力にする。換算手順は `costSteps` に残す。
2. **それ以外**: セルが Unknown なら次の属性へ。Conflict なら「Conflict（未解決）のため評価対象外」として打ち切る。`confirmed_only` で未確認なら「未確認Factのみ（Confirmedが必要）」として次へ。正規化できない値、数値比較できないテキスト（目標が `includes` の場合を除く）も次へ。
3. 使える値がなければ Unknown（`known = false`、`reason` に理由）。

## 4. サブスコアとスコア

**サブスコア sᵢ（0–1、小数 4 桁で丸める）** — min/max は、その Criteria で値が既知の候補の中で取る。

| direction | 計算 |
|---|---|
| `higher_better` | (v − min) / (max − min)。max = min なら 1 |
| `lower_better` | (max − v) / (max − min)。max = min なら 1 |
| `target` | 目標を満たせば 1、満たさなければ 0。単位が違えば同じ次元のときだけ換算し、次元が違えば null |
| `boolean` | true = 1、false = 0 |
| `none` | 参考表示のみ（スコアに使わない） |

**Weight の検証（`validateWeights`）**: すべて有限の数値、0–100 の範囲、合計が 0 より大きいこと。Criteria の作成・更新、`PUT /weights`、Scenario の保存時に検証する。比較時にエラーがあれば**スコアを計算しない**（`weightErrors` と、その旨の statement を返す）。

**スコア**（`direction ≠ none` かつ weight > 0 の Criteria が対象）:

```
score    = 10 × Σ(wᵢ × sᵢ) / Σ(既知の wᵢ)            ※ sᵢ が null の Criteria は除外（0 点にしない）
coverage = Σ(既知の wᵢ) / Σ(全 wᵢ)
range    = [10 × Σ(wᵢsᵢ) / Σ全wᵢ ,  10 × (Σ(wᵢsᵢ) + Σ未知wᵢ) / Σ全wᵢ ]   ← Unknown が最悪(0)/最良(1)の場合
```

どれも小数 2 桁で丸める。`normalizedWeight = wᵢ / Σwᵢ` は表示用。

**Must-have**: 値が不明なら `unknown`、目標があれば目標を満たすかで `pass` / `fail`、boolean ならその値、それ以外で値があれば `pass`。候補ごとの集計は、Fail が 1 つでもあれば `fail`、なければ Unknown が 1 つでもあれば `unknown`、それ以外は `pass`。
**Must-have と順位**: Must-have が **Fail** の候補はスコアを表示したまま**順位の対象外**（rank=null、caveats に「Must-have未達（順位の対象外）」）。**Unknown は Fail ではない**ため順位に含め、caveats で「未確認」と注意を促す。全候補が Fail の場合は順位を付けない旨を statement に表示する。

**順位**: スコアの降順、同点なら名前順。同点は同じ順位（1, 1, 3 …）。スコアが null の候補には順位を付けない。

## 5. 価格の比較可能性（`src/shared/price.ts`）

`parsePrice`: `¥` / `円` / `JPY`、`$` / `USD` / `ドル`、`€` / `EUR` を読み取る。周期（`月額` / `/月` / `monthly` → monthly、`年額` / `/年` / `annual` → annual、それ以外は one_time）、席単位（`/user`, `/人`, `ユーザーあたり` …）、税区分（`税込` / `税別` / `税抜` …）、送料の有無も読む。

`computeCost(snapshot, {basis, seats, targetCurrency, includeShipping})`:

| ステップ | 規則 | 比較できない場合 |
|---|---|---|
| 席 | `perSeat` なら × seats | 席数が未設定 |
| `annual_total` | monthly は **× 12（手順に明記）**、annual はそのまま、one_time は買い切り価格として扱う（年額換算しない） | 周期が `unknown` |
| `monthly_equivalent` | annual は ÷ 12、monthly はそのまま | 月額換算できない形態（one_time など） |
| `as_listed` | 換算しない | – |
| 送料 | `includeShipping` かつ `shipping` に金額があれば加算 | – |
| 為替 | 通貨が違えば `fxRate` が必須で、`fxBase` が比較通貨と一致すること。手順に為替の出典と時点を表示する | 為替レートが未設定 |
| 税 | **換算しない**。`unknown` なら警告「税込/税別が不明」 | – |

- 為替レートを登録するときは、出典（`fxSource`）、時点（`fxAt`）、換算先（`fxBase`）が必須（`addPrice` / `PATCH /prices/:id/fx`）。自動の為替取得は**未実装**。
- `contract_months` は保存されるが、費用計算にはまだ使っていない。
- `as_listed` は買い切り（one_time）の価格だけを比較対象にし、月額・年額など周期付きの価格は「比較不可」として理由を表示する（周期の異なる価格を同じ物差しで比べない）。SaaS では `annual_total` か `monthly_equivalent` を使う。

## 6. Statement（文言）と formulaVersion

- 通常: 「この〈Scenario「X」の〉Criteria設定では「A」のスコアが最も高くなります（7/10、カバー率 56%）。」。同点なら「…「A」と「B」のスコアが同点で最も高くなります」。
- 「勝者」「おすすめ」「選ぶべき」とは書かない。`caveats` には常に「スコアは判断材料の一つです。最終判断は根拠（Evidence）を確認したうえで人が行います。」を含める。そのほか、Unknown の除外、Must-have の未達・未確認、未解決の Conflict の数を必要に応じて加える。
- `formula[]` は計算方法・Fact の採用方針・価格の基準を説明する文字列で、UI と Brief に表示する。
- `FORMULA_VERSION = 'v1'`。計算方法を変えたら版を上げる（結果と Brief に版が残る）。

**決定性**: 乱数を使わず、並べ替えの同点は名前で決まり、丸め桁も決まっている。同じ入力（と同じ `now`）なら同じ結果になる。サービス層は `now` を注入しないため、`sourceAgeDays` だけは実行日によって変わる（スコアには影響しない）。

## 7. 計算例（実際に `compare()` を実行して確認した値）

Criteria: 軽さ w=3（lower_better, weight）、メモリ w=2（higher_better, memory）、バッテリー w=2（higher_better, battery_life, **Must-have ≥ 8h**）、価格 w=2（lower_better, price, 買い切り・税込）。Σw = 9。すべて Confirm 済み。

| 候補 | 重量 | メモリ | バッテリー | 価格 |
|---|---|---|---|---|
| A | 1.2 kg | 16 GB | 10 h | ¥180,000 |
| B | 1.6 kg | 32 GB | 7 h | ¥220,000 |
| C | 1.4 kg | **Unknown** | **Unknown** | ¥150,000 |

サブスコア: 軽さ A=1, B=0, C=(1.6−1.4)/0.4=0.5 ／ メモリ A=0, B=1, C=null ／ バッテリー A=1, B=0, C=null ／ 価格 A=(220000−180000)/70000=0.5714, B=0, C=1

| 候補 | Σ wᵢsᵢ | 既知 w | score | coverage | range | Must-have | 順位 |
|---|---|---|---|---|---|---|---|
| A | 3+0+2+1.1428=6.1428 | 9 | **6.83** | 100% | [6.83, 6.83] | pass | 2 |
| B | 0+2+0+0=2 | 9 | **2.22** | 100% | [2.22, 2.22] | **fail**（7h < 8h） | 対象外 |
| C | 1.5+0+0+2=3.5 | 5 | **7.0** | 56% | [3.89, 8.33] | **unknown** | 1 |

Statement: 「このCriteria設定では「C」のスコアが最も高くなります（7/10、カバー率 56%）。」
Caveats: Unknown を 0 点にしていないこと（範囲を参照）／「Must-have未達（順位の対象外）：B」／「Must-have未確認（Unknown）：C — 不足情報であり不合格ではありません。」／最終判断は人が行うこと。
→ C は既知の範囲では最も高いが、カバー率が低く、範囲は 3.89–8.33 と広い。メモリとバッテリーを確認すれば順位が変わりうる、と読める。

価格の換算例: `¥1,200/月/ユーザー（税別）`、10 席、annual_total → `1,200 JPY (月額・1席あたり・税別)` → `× 10席 = 12,000` → `月額 × 12ヶ月 = 144,000（年額換算）`。
`$10/月/席`（fxRate 150, fxBase JPY）→ … → `× 為替 150（出典, 時点）= 180,000 JPY`（警告: 税込/税別が不明）。

## 8. 関連 API

`GET /projects/:pid/compare?scenarioId=&factPolicy=` ／ `GET /projects/:pid/scenario-matrix` ／ `GET /projects/:pid/missing` ／ `GET /projects/:pid/compare.csv`（Unknown・Conflict・未確認を明記し、スコアとカバー率を「このCriteria設定での参考値」として出力する。数式インジェクション対策済み、`csvCell`）。MCP: `get_compare_table`, `get_missing_information`, `get_conflicts`, `compare_scenarios`。
