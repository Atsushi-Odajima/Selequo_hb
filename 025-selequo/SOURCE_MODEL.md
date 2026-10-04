# SOURCE_MODEL — ソース（出典）モデル

Selequo では「原本（Source）」と「そこから取り出した事実（Fact）」を分けて保存する。すべての Fact は `source_id` と `source_range`（引用位置）を必ず持つ。

関連ファイル: `src/server/services/sources.ts`, `src/server/import/fetcher.ts`, `src/server/import/ssrf.ts`, `src/server/import/parsers.ts`, `src/server/storage/index.ts`, `src/shared/types.ts`

## 1. ソースの種類（`sources.type`）

| type | 追加方法 | 本文の取り出し | 引用（`source_range`）の種類 |
|---|---|---|---|
| `web` | URL（`POST /projects/:pid/sources/url`、MCP `add_source`） | Fetcher で取得 → HTML は `parseHtml`、PDF は `parsePdf` | `text`（HTML）／ `pdf`（PDF） |
| `pdf` | ファイルアップロード | `parsePdf`（pdfjs-dist、ページごと、最大 200 ページ、30 秒で打ち切り） | `pdf`（ページ番号＋ページ内オフセット） |
| `screenshot` / `image` | 画像アップロード（PNG/JPEG/WebP）。`kind=image` 指定時のみ `image`、それ以外の画像は `screenshot` | AI の Vision 書き起こし（AI 有効時のみ）。それ以外は本文なし | `image`（正規化された矩形領域） |
| `text` | テキスト貼り付け（`/sources/text`）、またはテキストファイルのアップロード | 貼り付けた文字列 | `text` |
| `csv` | `kind=csv` または拡張子 `.csv` のテキストファイル | `importCsvFacts`（FACT_EXTRACTION.md） | `csv`（行・列） |
| `manual` | 手入力 Fact・手入力価格のために自動作成（`manualSource`、ユーザー×候補ごとに 1 つ） | なし（作成時から `ready`） | `manual`（入力者） |

ファイル種別はクライアントの MIME ではなくマジックバイトで判定する（`sniffType`: PDF / PNG / JPEG / WebP / NUL を含まない UTF-8 テキスト）。指定した `kind` と中身が食い違えば 400。

**既知の制限（現行コード）**
- アップロードしたテキストファイル（`type: 'text'`）はストレージから本文を読み込み（最大 500,000 文字）、貼り付けテキストと同じく抽出する。
- `web` で取得した画像・CSV は専用処理がなく、テキストとしてデコードされる。
- スキャン PDF（テキスト層なし）の OCR は**未実装**（tesseract.js は依存関係に含まれていない）。

## 2. 品質（`sources.quality`）

`SOURCE_QUALITIES`: `official` / `manufacturer` / `vendor` / `marketplace` / `editorial` / `user_review` / `manual` / `unknown`

- 既定値: URL・ファイルは `unknown`、貼り付けテキストと手入力は `manual`。ユーザーが `PATCH /sources/:id` で変更する。
- `official` / `manufacturer` のソースに支えられたセルは `Cell.officialSource = true`（`src/shared/compare.ts`）。Research Assistant の「公式出典がない値」プリセットに使う。
- `user_review` のソースから抽出した Fact は、すべて `kind: 'opinion'` になる（`forceOpinion`）。

## 3. ステータスの遷移（`sources.status`）

```
pending ──(job: process_source)──▶ processing ──▶ ready
   ▲                                    └────────▶ failed（error に理由）
   └──── reprocess（再処理） ◀── ready / failed
任意の状態 ──(deleteSource)──▶ deleted（論理削除、行は残る）
```

- `manual` ソースは作成時から `ready`。
- 失敗（取得エラー、パースエラー等）は `processSource` 内で捕捉され、`status='failed'` と `error` に記録される。ジョブ自体は成功扱いになるため、**自動リトライはされない**（再処理ボタン／`POST /sources/:id/reprocess` で再実行）。
- ジョブランナー（`src/server/jobs.ts`）: プロセス内で並列 3、1 ジョブ 120 秒でタイムアウト。ジョブを取り出すときは、実行中のジョブがないワークスペースを優先する。リトライ（最大 3 回、30 秒後）はハンドラが例外を投げたかタイムアウトした場合にのみ働く。`running` のまま 10 分を過ぎたジョブ（プロセスのクラッシュなど）は、起動時に `queued` に戻す。

## 4. 処理パイプライン（`processSource`）

1. ソースを読み、`deleted` なら何もしない。`status='processing'`。
2. 種類別に本文を取り出す（§1）。`web` は取得した本体をストレージに保存し、`file_key` / `mime` / `size_bytes` / `hash`(sha256) / `retrieved_at` / `captured_at` / 最終 URL を記録。HTML からは `og:title` / `og:site_name` / `article:published_time` 等も読む。
3. 画像は AI が使える場合だけ `transcribeImage` を呼び、`ai_calls` に記録（purpose `vision`）。
4. 本文がある場合:
   - プロジェクトの有効な正規化ルールを読み込む。
   - 決定的抽出器 `extractFacts`（`src/server/extract/heuristic.ts`）を実行。プロンプトインジェクションを検出した行は抽出しない（`injection_flags` に記録）。
   - AI が使える場合（ワークスペース・プロジェクト・ソースの 3 つの AI スイッチがすべて ON、かつプロバイダ設定あり）は AI 抽出を追加し、根拠確認（grounding）を通ったものだけを採用する（FACT_EXTRACTION.md）。
   - そのソースの**未レビュー（`candidate`）かつ手入力以外**の Fact を削除してから、新しい Fact を挿入する（レビュー済みの Fact は再処理で消えない）。
   - ソースが候補に紐づいていない場合、本文だけを保存し Fact は作らない。後から候補を割り当てると再処理ジョブが入る（`updateSource`）。
5. `status='ready'`、`extracted_text`（最大 500,000 文字）と `pages`（PDF のみ JSON 配列）を保存し、検索インデックスを更新する。

## 5. 引用位置（`SourceRange`）

| type | フィールド | 表示（`locatorOf`, `src/shared/brief.ts`） |
|---|---|---|
| `text` | `start`, `end`（`extracted_text` 内の文字オフセット）, `context`（行、最大 240 文字） | `本文 start–end` |
| `pdf` | `page`（1 始まり）, `start`, `end`（ページ内オフセット）, `context` | `p.N` |
| `image` | `region: {x,y,w,h}`（0–1 の相対座標）または `null`, `context` | `画像領域 (x%, y%, w%×h%)` |
| `csv` | `row`（ヘッダを 1 行目とした行番号。空行は詰めて数える）, `column`（ヘッダ名）, `context` | `行N 列「列名」` |
| `manual` | `by`（入力者名）, `context` | `手入力: 名前` |

Evidence 取得（`getEvidence`, `src/server/services/facts.ts`）は、`text`/`pdf` の場合に引用位置の前後約 400 文字を原文から切り出して返す。AI 抽出で原文の位置を特定できなかった場合は `start=end=0` となり、`context` のみを表示する。

## 6. URL 取得ポリシー（`src/server/import/fetcher.ts`, `ssrf.ts`）

| 項目 | 実装 |
|---|---|
| 対象 | ユーザーが指定した 1 ページだけを取得する。クロール（リンクをたどる）は行わない |
| User-Agent | `SelequoBot/0.1 (+https://selequo.invalid/bot; user-initiated single-page fetch)` |
| robots.txt | RFC 9309 準拠を意図した実装。`selequobot` 向けのグループ、なければ `*` を使う。最長一致、同じ長さなら Allow を優先、`*` と `$` に対応。オリジンごとに 1 時間キャッシュ。取得できない／5xx → 全面拒否、4xx → 全面許可。robots.txt 自体は 512KB まで |
| 間隔 | 同じホストへのアクセス間隔は最低 2 秒（プロセス内メモリで管理） |
| サイズ | `MAX_FETCH_MB`（既定 5MB）。`content-length` とストリーム中の累計の両方で打ち切る |
| 時間 | ヘッダ・ボディそれぞれ 10 秒でタイムアウト。加えて 1 リクエスト全体に 20 秒の期限（少しずつ送ってくる応答でワーカーを占有させない） |
| リダイレクト | 手動で最大 4 ホップ。ホップごとに SSRF 検査と robots.txt を再評価 |
| Content-Type | HTML / XHTML / text/plain / PDF / PNG / JPEG / WebP / CSV のみ |
| アクセス制限 | 401/402/403/407/429/451 は `blocked` エラーにする。HTML 本文に reCAPTCHA / hCaptcha / Cloudflare challenge / paywall 等のマーカーがあり本文が短い場合も `blocked`。**ログイン・課金・CAPTCHA の回避は行わない**（PDF やスクリーンショットで追加するよう案内する） |
| SSRF | http/https のみ、URL に認証情報があれば拒否、許可ポートのみ（`FETCH_ALLOW_PORTS`、既定 80,443）、localhost・`*.internal`・`*.local`・metadata 系のホスト名を拒否、数値形式のホスト名を拒否。解決した**全アドレス**を検査する。IPv4 はプライベート/予約済み（RFC1918、ループバック、リンクローカル 169.254/16、CGNAT 100.64/10、ドキュメント用、マルチキャスト等）を拒否。IPv6 はグローバルユニキャスト（2000::/3）だけを許可し、IPv4 埋め込み形式（互換・射影・SIIT）は IPv4 の規則で判定、NAT64・6to4・Teredo・ドキュメント用は拒否する。接続は検証済みアドレスに固定する（DNS リバインディング対策） |

**開発用フィクスチャモード**: `SELEQUO_FETCH_FIXTURES=<dir>` を設定すると、`https://<sub>.selequo.invalid/<path>` を `<dir>/<sub>/<path>` から返す（ネットワークに出ない。パストラバーサルは拒否）。サンプルデータ（`npm run seed:sample`）はこれを使う。`NODE_ENV=production` では設定すると起動に失敗する（`src/server/config.ts`）。

## 7. 削除の扱い（`deleteSource`）

ソースを削除すると、次の処理を順に行う。

1. ストレージ上のファイル（`file_key`）を削除する。
2. そのソースの Fact を検索インデックス・埋め込みから外し、それを参照する `questions.answer_fact_id` を NULL にしてから、Fact を**物理削除**する（レビュー済みのものも含む）。
3. そのソース由来の `price_snapshots` を削除する。
4. ソースの行は残し、`status='deleted'`, `deleted_at=now()` とし、`extracted_text` / `pages` / `file_key` を NULL にする（本文は残さない）。
5. ソースを検索インデックス・埋め込みから外し、キュー中のジョブを削除する。
6. 監査ログに `source.delete`（削除した Fact 数）を記録する。

比較エンジンは削除済みソースに紐づく Fact を除外し、レビューでは出典のない Fact を Confirm できない（`reviewFact`）。
注意: 既に保存済みの Brief の版（`briefs.content`）はスナップショットのため、削除前の Evidence の文字列（値、タイトル、URL）がそのまま残る。

## 8. 署名付きファイル URL

- `signFileUrl(secret, key, ttl=300s)` → `/api/files?key=…&exp=…&sig=…`。署名は HMAC-SHA256(`SELEQUO_SECRET`, `key|exp`)、検証は `timingSafeEqual`。
- 配信時の条件: 署名が有効で期限内であること、対応するソースが削除されていないこと、キーがそのソースのワークスペースの接頭辞 `ws/<workspace_id>/` で始まること。
- レスポンスヘッダ: 保存した HTML は `text/plain` で返す（HTML として描画しない）。`Content-Security-Policy: default-src 'none'; …; sandbox`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, max-age=300`。画像と PDF は `inline`、それ以外は `attachment`。
- URL は期限内であれば誰でも使える（セッション確認はしない）。5 分の短い有効期限で漏洩時の影響を抑えている。
- ストレージは `LocalDiskStorage`（`SELEQUO_DATA_DIR/files`）または `MemoryStorage`（テスト）。キーは `assertSafeKey` で検証する。S3 互換ストレージは同じインターフェースで実装できるが、**実装は含まれていない**。
