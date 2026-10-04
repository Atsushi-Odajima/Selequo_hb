# DEVELOPMENT — 開発ガイド

## 必要環境
- Node.js 22.13 以上（pdfjs-dist の要件）、npm 10
- PostgreSQL 15+（本番）。開発・テストは **PGlite**（WASM の組み込み Postgres）で DB サーバ不要
- Chromium（Decision Brief の PDF 出力と E2E 用。Playwright 1.56.1 / chromium-1194 を使用）

## セットアップ
```bash
cd 025-selequo
npm ci
cp .env.example .env   # 開発では編集不要（既定でPGlite・AI OFF）
```

## よく使うコマンド
| コマンド | 内容 |
|---|---|
| `npm run dev` | API（tsx watch, :8787）と Vite（:5173, /api をプロキシ）を同時起動 |
| `SELEQUO_FETCH_FIXTURES=fixtures/sample npm run seed:sample` | 架空サンプル（ノートPC3台＋SaaS3件）をデモアカウントに投入。ログイン: `demo@selequo.invalid` / `selequo-demo-2026` |
| `npm run typecheck` | TypeScript 型検査（server / web / tests） |
| `npm test` | Vitest（単体＋APIの結合テスト、PGlite in-memory） |
| `npm run test:e2e` | Playwright E2E（ビルド→一時DBでサーバ起動→9フロー＋端末/PWA/a11y） |
| `npm run build` | `dist/web`（Vite）と `dist/server`（esbuild）を生成 |
| `npm start` | 本番ビルドを起動（`dist/web` を静的配信） |
| `npm run assets` | ロゴ/PWAアイコンを SVG から再生成（`scripts/generate-icons.mjs`） |
| `node scripts/make-fixtures.mjs` | サンプルの PDF / スクショ PNG を HTML から再生成 |
| `npm run mcp` | stdio⇔HTTP の MCP ブリッジ（`SELEQUO_URL`, `SELEQUO_TOKEN`） |

## ディレクトリ
```
src/shared/     ドメインの純粋ロジック（型・単位・属性カタログ・正規化・価格・比較エンジン・Brief・CSV/安全性）
src/server/     Fastify API（app.ts）、db/（スキーマ・アダプタ）、services/（業務ロジック）、import/（SSRF・取得・パーサ）、
                extract/（ルールベース抽出）、ai/（プロバイダ・ガード）、storage/、jobs.ts、scripts/seed-sample.ts
src/mcp/        MCP ツール定義・Streamable HTTP・stdio ブリッジ
src/web/        React 19 + React Router 7 の PWA（pages/, components/, lib/）
tests/          Vitest（normalize / features / security / mcp）
e2e/            Playwright（flows / devices）
fixtures/sample 架空の公式ページ・販売ページ・SaaS料金ページ・PDF・スクショ（*.selequo.invalid で配信）
public/         manifest・Service Worker・アイコン
```

## 設計ルール
- **全クエリに workspace_id**。サービス関数は `Ctx` を受け取り、`need(ctx, role)` で権限確認、`getProjectRow` / `assertInProject` でテナント確認。
- 変更系は `audit()` を記録。
- 比較ロジックは `src/shared/compare.ts` に集約（純粋関数・決定的）。UI と MCP は同じ結果を使う。
- AI 呼び出しは必ず `aiFor()`（ON/OFF判定）と `recordAiCall()` を経由。
- 取り込み文書は未信頼データ。指示として解釈しない。
- 外部サイトへの大量取得は禁止。開発・テストは `fixtures/sample` を `https://<sub>.selequo.invalid/` として配信する（本番では起動拒否）。

## DB
- スキーマ: `src/server/db/schema.ts`（`CREATE TABLE IF NOT EXISTS` で冪等。`schema_meta.schemaVersion`）。
- 本番は `DATABASE_URL`（node-postgres）。開発は `PGLITE_DIR`（未指定時 `data/pglite`）。
- マイグレーションは現状 v1 の冪等スキーマのみ。v2 以降は番号付きマイグレーションを追加する（NEXT_STEPS）。

## テストの考え方
- `tests/helpers.ts` の `setup()` がアプリを PGlite in-memory・MemoryStorage・フィクスチャ取得で起動し、`app.inject` で API を叩く。
- `buildLaptopSample()` が公式ページ/販売ページ/PDF/スクショからなる架空サンプルを API 経由で構築。
- AI は `MockProvider`（`adversarial` モードで幻覚・偽引用を返し、ガードが落とすことを検証）。
