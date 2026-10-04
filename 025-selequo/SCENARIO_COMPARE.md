# SCENARIO_COMPARE — シナリオ別比較

Scenario は「同じ Fact と Criteria に対して、重視する条件（Weight・Must-have・価格の前提）だけを変えた見方」である。Fact も Criteria の定義も複製しない。目的は「条件によって、スコアが最も高い候補が変わるか」を示すことで、勝者を決めることではない。

関連ファイル: `src/shared/compare.ts`（`compare`, `compareScenarios`）, `src/server/services/projects.ts`（`ScenarioInput` と CRUD）, `src/server/services/comparison.ts`（`getScenarioMatrix`）, `src/web/pages/Criteria.tsx`, `src/server/scripts/seed-sample.ts`

## 1. データモデル（`scenarios` テーブル / `Scenario` 型）

| フィールド | 型 | 内容 |
|---|---|---|
| `name` | text（1–60 文字） | 例: Travel / Performance / Budget |
| `description` | text（≤1000） | 任意 |
| `weights` | `Record<criterionId, number>`（0–100） | Criteria の Weight を上書きする。キーがない Criteria は基本 Weight を使う |
| `mustHaves` | `Record<criterionId, boolean>` | Must-have の ON/OFF を上書きする。キーがなければ Criteria の設定を使う |
| `params.seats` | 正の整数 / null | 席単位の価格の換算に使う |
| `params.costBasis` | `as_listed` / `annual_total` / `monthly_equivalent` | 価格の比較基準（COMPARISON_ENGINE.md §5） |
| `params.includeShipping` | boolean | 送料（`price_snapshots.shipping`）を加算する |
| `sort_order` | int | 作成順に 10 ずつ増やす |

**検証**（`createScenario` / `updateScenario`、Editor 以上）: `weights` が空でなければ `validateWeights`（数値、0–100、合計 > 0）で検証する。監査ログには `scenario.create` / `scenario.update` / `scenario.delete` を記録する。
現行実装では、`weights` / `mustHaves` のキーが実在する Criteria の ID かどうか、Must-have を ON にした Criteria に目標値があるかどうかは、サーバ側で検証していない（UI 側で制限している。§4）。

## 2. 解決の順序（`compare()` 内）

```
有効Weight     = scenario.weights[c.id]   ?? criterion.weight      // 0 も有効な値（0 ならスコア対象外）
有効Must-have  = scenario.mustHaves[c.id] ?? criterion.mustHave
costBasis      = scenario.params.costBasis       ?? project.default_params.costBasis ?? 'annual_total'
seats          = scenario.params.seats           ?? project.default_params.seats     ?? null
includeShipping= scenario.params.includeShipping ?? project.default_params.includeShipping ?? false
```

`factPolicy` と通貨は Scenario では変えられない（プロジェクトの設定、またはリクエストのクエリで決まる）。
Statement には「この Scenario「名前」の Criteria 設定では…」と Scenario 名が入る。

## 3. 複数 Scenario の比較（`compareScenarios`）

```ts
compareScenarios(input, scenarios, options) → {
  scenarios: [{ id, name, topCandidateIds, scores, statement }],
  resultsDiffer: boolean
}
```

- Scenario ごとに `compare()` を実行する。`topCandidateIds` は順位が 1 の候補（同点なら複数）。
- `resultsDiffer` は、各 Scenario の `topCandidateIds`（並べ替えて連結したもの）が 2 種類以上あるとき true。スコアを計算できない Scenario（トップが空）も 1 種類として数える。
- `getScenarioMatrix`（`GET /projects/:pid/scenario-matrix`、MCP `compare_scenarios`）は、先頭に**基本 Weight の「既定（基本Weight）」**（`id: null`）を加え、その後に保存済みの全 Scenario を並べる。
- 比較表の画面（`src/web/pages/Compare.tsx`）では Scenario を 1 つ選び、その Scenario で表とスコアを表示できる（`GET /compare?scenarioId=`）。
- Decision Record に `scenarioId` を保存すると、Brief の本体（主な違い・Must-have・Statement）はその Scenario で計算される。Scenario 別の結果は Brief の「Scenario別の結果」に全件が載る（DECISION_BRIEF.md）。

## 4. UI（`src/web/pages/Criteria.tsx`）

- 画面上部に「Criteria と Weight はあなたが決めます。AI は候補を提案するだけで、重要度を決めたり勝者を決めたりしません。」と表示する。
- **Criteria 一覧**: Weight のスライダー（0–10）と正規化した割合（%）を表示する。direction が `none` の Criteria はスライダーを無効にする。「項目から候補を作成」（`suggestCriteria`）は数値・価格・真偽値の有効な属性から `suggested` 状態の Criteria（Weight 1）を作る。採用（`status: active`）か却下（削除）は人が行う。
- **Scenario エディタ**（モーダル）: 有効な Criteria ごとに Weight のスライダー（0–10）と「必須」チェックボックスを表示する（目標値がなく boolean でもない Criteria はチェックできない）。ほかに席数と価格の比較基準（年額合計 / 月額換算 / 表示価格のまま）を設定する。保存時は全 Criteria の Weight と Must-have を送る。
  - `includeShipping` は API でだけ設定でき、画面には**未実装**。
  - API の Weight の範囲は 0–100 だが、画面のスライダーは 0–10。10 を超える値はスライダー上では 10 として表示される。
- **Scenario マトリクス**: 行が Scenario、列が候補。各セルに `スコア/10`、カバー率、Must-have バッジを表示し、トップの候補は色付きで「このScenarioで最も高い」と表示する。`resultsDiffer` のときは「条件（Scenario）によって、スコアが最も高い候補が変わります。」と表示する。

## 5. サンプルの Scenario（`src/server/scripts/seed-sample.ts`、架空データ）

`SELEQUO_FETCH_FIXTURES=fixtures/sample npm run seed:sample` で、別のサンプル用ワークスペースに投入する（本番では実行できない。第三者のサイトにはアクセスしない）。

### ノート PC（category `laptop`）

基本の Criteria: 軽さ w3（lower_better, `weight`）／バッテリー w2（higher_better, `battery_life`, **Must-have ≥ 8h**）／メモリ w2（higher_better, `memory`）／価格 w2（lower_better, `price`）

| Scenario | 説明 | 軽さ | バッテリー | メモリ | 価格 | Must-have の上書き |
|---|---|---|---|---|---|---|
| Travel | 出張・持ち運び重視 | 10 | 8 | 2 | 2 | – |
| Performance | 開発・処理性能重視 | 1 | 2 | 10 | 1 | – |
| Budget | 価格重視 | 1 | 0 | 1 | 10 | バッテリー = false |

### チャットサポート SaaS（category `saas`、`default_params: {seats: 10, costBasis: 'annual_total'}`）

基本の Criteria: 年間コスト w5（lower_better, `price`）／SSO w3（boolean, `sso`, **Must-have**）／SLA w2（higher_better, `sla`）

| Scenario | 年間コスト | SSO | SLA | Must-have の上書き | params |
|---|---|---|---|---|---|
| Small Team | 10 | 0 | 2 | SSO = false | seats 5 |
| Enterprise Security | 2 | 10 | 6 | – | seats 40 |
| Lowest Cost | 10 | 0 | 0 | SSO = false | seats 10 |

### 参考: 現行コードとフィクスチャで実行した結果（2026-10-04 時点）

フィクスチャや計算式が変われば結果も変わる。これは動作確認の記録であり、製品の推奨ではない。

| プロジェクト | 既定 | Scenario 別のトップ | `resultsDiffer` |
|---|---|---|---|
| ノート PC | Lite 15（7.14、カバー率 78%、Must-have Unknown） | Travel: Lite 15 ／ Performance: Pro 16 ／ Budget: Lite 15 | true |
| SaaS | AlphaDesk（9.41） | Small Team: AlphaDesk ／ Enterprise Security: GammaSuite（10） ／ Lowest Cost: BetaFlow（10） | true |

例えば SaaS の既定では、BetaFlow は Must-have（SSO）が `fail` となり、スコアは表示されるが順位の対象外になる。SSO を必須にしない Lowest Cost ではスコアが最も高くなる。どの前提を採るかは人が決める。

## 6. 関連 API と MCP

| 操作 | REST | MCP |
|---|---|---|
| 一覧 / 作成 / 更新 / 削除 | `GET/POST /projects/:pid/scenarios`, `PATCH/DELETE /scenarios/:id` | なし（MCP から Scenario は作れない） |
| マトリクス | `GET /projects/:pid/scenario-matrix` | `compare_scenarios`（読み取り） |
| Scenario を指定した比較表 | `GET /projects/:pid/compare?scenarioId=` | `get_compare_table {scenarioId}` |
