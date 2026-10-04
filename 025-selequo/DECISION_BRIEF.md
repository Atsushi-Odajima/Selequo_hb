# DECISION_BRIEF — Decision Brief と Decision Record

- **Decision Brief**: 比較の材料（違い・Unknown・Conflict・価格・Scenario 別の結果・出典）を、引用付きで構造化した資料。作るのはシステムだが、判断は含まない。
- **Decision Record**: 人が下した判断の記録（何を選んだか、理由、前提、期待する結果、振り返り）。

**原則: AI は決めない。** Brief は「AI が候補を決定した」とは書かない。判断の欄は、人の Decision Record をそのまま写す。

関連ファイル: `src/shared/brief.ts`, `src/server/services/decisions.ts`, `src/web/pages/Decision.tsx`, `src/web/components/BriefView.tsx`

## 1. コンテンツのスキーマ（`BRIEF_SCHEMA = 'selequo.brief/v1'`）

`buildBrief()` は純粋関数で、`buildProjectBrief()`（サービス層）が比較結果、Scenario マトリクス、質問、ソース、価格、Decision を集めて渡す。

| フィールド | 内容 |
|---|---|
| `schema`, `generatedAt` | `selequo.brief/v1`、生成日時 |
| `project` | title, purpose, category, deadline, currency |
| `candidates` | id, name, provider |
| `criteria` | name, weight, normalizedWeight, direction, mustHave, target（文字列、例 `>= 8 h`） |
| `mustHaves` | Criteria ごとの候補別 Pass/Fail/Unknown と入力値、引用番号 |
| `keyDifferences` | `differs` の行だけ。候補ごとの表示値、確認済みかどうか、状態（value/unknown/conflict）、引用番号 |
| `unknowns` | Unknown のセル（候補 × 属性） |
| `conflicts` | 食い違う値の並び、引用番号 |
| `prices` | 候補 × ソース × 周期 × 席単位ごとの最新の Price Snapshot（通貨、周期、席単位、税区分、送料、取得日時） |
| `scenarioResults`, `scenarioResultsDiffer` | 既定と全 Scenario の Statement と、候補別のスコア・カバー率・順位・Must-have |
| `tradeoffs` | higher/lower_better の Criteria ごとに「X が有利、Y が不利（各値）」という説明文（推薦ではない） |
| `openQuestions` | 未解決（open）の質問 |
| `evidence` | 番号付きの出典一覧（§2） |
| `statement`, `caveats`, `formula` | 比較エンジンの出力（COMPARISON_ENGINE.md §6） |
| `decision` | Decision Record の写し（status, chosen（候補名）, reason, assumptions, expectedOutcome, reviewDate, decidedBy（名前）, decidedAt, actualResult, lessons）。記録がなければ null |
| `disclaimer` | 「…スコアは設定したCriteria/Weightでの参考値であり、AIが候補を決定したものではありません。最終判断は人が行います。」 |

Brief の本体（主な違い、Must-have、Statement）は、Decision に `scenarioId` があればその Scenario で、なければ既定の設定で計算する。Fact の採用方針はプロジェクトの `fact_policy` に従う。

## 2. 引用と Evidence の番号付け

- `cite(factIds, …)` が Fact ごとに通し番号 `n`（1 から）を割り当てる。同じ Fact は 2 回目以降も同じ番号を使う（`factId` で重複を除く）。
- 番号は、主な違い → Conflict → Must-have → 価格 の順に、初めて出てきた順で振られる。
- Evidence の各項目: `n`, `factId`, 候補, 属性, 値, `verified`, `source{title, url, type, quality, retrievedAt（なければ capturedAt）, locator}`。`locator` は `locatorOf(sourceRange)` で作る（`p.3`、`画像領域 (…)`、`行5 列「…」`、`手入力: 名前`、`本文 120–134`）。
- 削除済みソースの Fact は引用しない（ソースの一覧が削除済みを除いているため）。
- 注意（現行実装）: Must-have と価格の経路で初めて引用された Evidence は `verified: true` として記録される。主な違いの経路で先に引用されていれば、そちらの値が使われる。

## 3. レンダラ

| 形式 | 関数 | 備考 |
|---|---|---|
| Markdown | `briefToMarkdown` | 表のセル内の `|` と改行をエスケープする。引用は `[n]`。URL は http/https のものだけを出力する |
| TXT | `briefToText` | Markdown から見出し記号・強調・表の区切り行を取り除く。引用ブロックは `※` にする |
| HTML | `briefToHtml` | 自己完結した 1 ファイル（インライン CSS、JavaScript なし）。値はすべて HTML エスケープし、引用は `#ev-n` へのアンカーにする。エクスポート時のレスポンスに `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox` を付ける |
| JSON | `JSON.stringify(content)` | `selequo.brief/v1` そのもの |
| PDF | `htmlToPdf(briefToHtml(content))` | 下記 |

**PDF 出力**（`htmlToPdf`、`src/server/services/decisions.ts`）:
- `playwright-core` でヘッドレス Chromium を起動する（`CHROMIUM_PATH` で実行ファイルを上書きできる）。ページは `javaScriptEnabled: false` で開き、**`data:` 以外のすべてのリクエストを中止する**（外部への通信を遮断）。A4、背景を印刷、余白は上下 14mm・左右 12mm。
- `PDF_RENDERER=none` の場合は 400 を返し、「HTML 出力をブラウザで印刷して PDF 保存してください」と案内する。
- 日本語のグリフは実行環境のフォント（CSS の指定: Inter, Hiragino Sans, Noto Sans JP, IPAGothic, system-ui）に依存する。フォントの同梱は**未実装**。

エンドポイント: `GET /projects/:pid/brief/export?format=md|html|txt|json|pdf[&briefId=]`。`briefId` を指定すると保存済みの版を、指定しなければ現在の内容をその場で生成して出力する。出力のたびに監査ログ `brief.export`（形式）を記録する。プレビューは `GET /projects/:pid/brief/preview`。

## 4. Brief の版とレビュー状態

- `POST /projects/:pid/briefs`（Editor 以上）または MCP `generate_decision_brief` で、その時点の内容を `briefs` に保存する。`version` はプロジェクトごとに 1, 2, 3 … と増える。内容はスナップショットで、あとから変わらない（ソースを削除しても過去の版の Evidence の文字列は残る）。
- `review_state`: `draft` → `in_review` → `approved`（`PATCH /briefs/:id`、Reviewer 以上、監査ログ `brief.review`）。状態の遷移順は強制しておらず、どの状態にも変更できる。`approved` にしても他のデータはロックされない。
- 一覧: `GET /projects/:pid/briefs`（版、状態、作成者、作成日時）。

## 5. Decision Record

| フィールド | 内容 |
|---|---|
| `chosen_candidate_id` | 選んだ候補 |
| `scenario_id` | 判断の前提にした Scenario（任意） |
| `reason` | 判断理由（確定時は必須） |
| `assumptions` / `expected_outcome` | 前提と、期待する結果 |
| `review_date` | 振り返りの予定日。`reviewDate`（YYYY-MM-DD）か `reviewInDays`（1–3650）で指定する |
| `status` | `draft` / `decided` / `reviewed` |
| `decided_by` / `decided_at` | 確定した人と日時 |
| `actual_result` / `lessons` / `reviewed_at` | 振り返りの内容 |

プロジェクトごとに 1 件の Decision を更新していく（`getDecision` は最新の 1 件を返す）。

### ライフサイクル

```
(なし) ──PUT decision (finalize=false)──▶ draft ──PUT decision (finalize=true, 人の操作のみ)──▶ decided ──POST decision/review──▶ reviewed（以後は変更不可）
```

- **draft**: `PUT /projects/:pid/decision`（Editor 以上）。どのフィールドも空のまま保存できる。
- **decided**（`finalize: true`）: 条件は、①**actor が `user` であること（API/MCP トークンでは不可）**、②`chosenCandidateId` があること、③`reason` が空でないこと。確定すると、`decided_by` / `decided_at` を記録し、選んだ候補の `status` を `chosen` にし（それまで `chosen` だった候補は `considering` に戻す）、プロジェクトの `status` を `decided` にする。監査ログには `decision.decide` を記録する。画面では確定の前に「判断したのはあなたです（AI ではありません）」という確認ダイアログを出す。
- `decided` の後も、`finalize: false` で理由などを書き直せる（状態は `decided` のまま）。もう一度 `finalize: true` で確定し直すこともできる。
- **reviewed**: `POST /projects/:pid/decision/review {actualResult(必須), lessons}`（Editor 以上）。`decided` でない場合は拒否する。`reviewed` になった Decision は `saveDecision` で変更できない。

### 90 日後の振り返り

- 画面（`Decision.tsx`）は `reviewInDays` の初期値を **90** にしている。サーバ側には既定値がなく、指定しなければ `review_date` は null になる。
- `GET /api/w/:ws/reviews/due` は、`status = decided` かつ `review_date <= 今日` の Decision を一覧にする。メールやプッシュでの通知は**未実装**で、アプリ内の一覧で確認する。

## 6. 「AI は決めない」をどう担保しているか

| 層 | 仕組み |
|---|---|
| Decision | `saveDecision` は `finalize` を `ctx.actor.type === 'user'` のときだけ許可する（「判断の確定は画面から人が行います（API/MCPからは確定できません）」） |
| 候補 | `updateCandidate` は、`chosen` にする変更と `chosen` から外す変更を、actor が `user` 以外なら拒否する。`createCandidate` は常に `considering` で作る |
| MCP | 決定・選択のツールは存在しない（`choose_candidate` などはない）。`FORBIDDEN_TOOL_PATTERNS`（choose / decide / select_winner / pick / winner）に一致するツール名がないことをテスト（`tests/mcp.test.ts`）で確認している |
| AI プロバイダ | システムプロンプトで「勝者を選ばない」「判断をユーザーの代わりに行わない」と指示し、引用は渡したコンテキスト内の ID に限定する（`validateCitations`） |
| 文言 | Statement は「この Criteria 設定では…スコアが最も高くなります」とし、Brief の免責文は常に付ける |
| Criteria | AI や自動処理による提案は `suggested` 状態で、Weight は中立の 1。人が採用するまで使わない |
| 取り込み | 「この製品を選べ」のような文書内の誘導文は `steer-decision` などとして検出し、その行は抽出しない |

補足: API トークン（Editor 以上、write スコープ）は REST の `PUT /decision` で、`chosenCandidateId` を含む**下書き**を保存でき、`POST /decision/review` も実行できる。確定（`decided`）と候補の `chosen` 設定はできない。MCP には Decision を扱うツールはない。
