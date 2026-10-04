# PROGRESS — 2026-10-04

## 状態サマリ
実装・自動テスト・ドキュメントは揃っているが、**全体完成ではない**（実機確認、本番デプロイ、商標/ストア確認、外部ペンテストなど人の承認・作業が必要な項目が残る）。

| Phase | 状態 | 備考 |
|---|---|---|
| 0 調査/PoC | ✅ | SOURCE_NOTES.md（一部ベンダーサイトはプロキシで遮断され [検索経由] 表記） |
| 1 Auth/Workspace/Project/Candidate/Source | ✅ | RBAC 5ロール、招待、APIトークン |
| 2 Import/Extraction/Citation/Review | ✅ | URL/PDF/スクショ/画像/テキスト/CSV/手入力。ローカルOCRは未同梱（AI Vision or 手動領域転記） |
| 3 Attribute/Normalization/Missing/Conflict | ✅ | 価格スナップショット含む |
| 4 Criteria/Must-have/Compare/Scenario | ✅ | Must-have Fail は順位対象外、Unknown は順位に残す |
| 5 Evidence/Questions/AI Assistant | ✅ | 引用必須・偽引用破棄 |
| 6 Decision Brief/Review/Collaboration | ✅ | 5形式出力、版・レビュー状態、コメント、共有（既定OFF） |
| 7 PWA/Search/ImportExport/MCP | ✅（Semantic検索なし） | MCP 12ツール、stdioブリッジ |
| 8 Privacy/Security/Audit/Backup | ✅ | 内部セキュリティレビュー実施・指摘修正済み |
| 9 E2E/performance/accessibility/実機 | ⚠️ | E2E・エミュレーション・a11y自動チェック済み。**実機・負荷試験は未実施** |
| 10 Branding/Docs/Deploy/販売前check | ⚠️ | ブランド資産・全ドキュメント・Dockerfile 済み。**デプロイ・商標確認は承認待ち、Dockerビルド未検証** |

## 成果物（`025-selequo/`）
- アプリ: `src/`（shared / server / mcp / web）、`public/`（PWA・アイコン）、`fixtures/sample`（架空データ）
- テスト: `tests/`（Vitest 56件）、`e2e/`（Playwright 12件）
- ドキュメント: PLAN / PROGRESS / DECISIONS / NEXT_STEPS.txt / DEVELOPMENT / DATA_MODEL / SOURCE_MODEL / FACT_EXTRACTION / NORMALIZATION / COMPARISON_ENGINE / SCENARIO_COMPARE / DECISION_BRIEF / MCP_PLUGIN / AI_SAFETY / SECURITY / OPERATIONS / OPERATING_COSTS / TEST_REPORT / RELEASE_CHECKLIST / SOURCE_NOTES / README
- 配備: `Dockerfile`, `.env.example`
- ブランチ: `025-selequo`（既存 #001〜#024 は変更していない）

## 主な技術とバージョン
Node 22 / TypeScript 5.9 / React 19.3 / React Router 7.18 / Vite 8.3 / Fastify 5.12 / Zod 4.6 / PGlite 0.5.8・node-postgres 8.23 / pdfjs-dist 6.4 / cheerio 1.2 / undici 8.11 / fflate 0.8 / @modelcontextprotocol/sdk 1.32 / @anthropic-ai/sdk 0.131 / playwright-core・@playwright/test 1.56.1 / Vitest 5.0 / Inter（@fontsource, OFL）
