# PLAN — Selequo #025 開発計画

商品: **Selequo — AI比較検討・Decision Brief作成ツール**
コンセプト: 「候補を集める。違いが見える。決めやすくなる。」 価格比較サイトでも、AIがWinnerを決めるアプリでもない。

## フロー
Project → Candidate → URL/PDF/Image/Text → Fact Extraction → Citation → Attribute Normalization → Criteria → Missing/Conflict → Compare Table → Evidence Review → Scenario Compare → Human Decision → Decision Brief → Decision Review

## アーキテクチャ
```
[React PWA] ──REST/JSON (cookie+CSRF)──┐
[MCP client] ──Streamable HTTP (Bearer)─┤──> Fastify API ──> services ──> PostgreSQL / PGlite
[stdio bridge] ─────────────────────────┘        │                     └─> Local Disk storage (signed URLs)
                                                  ├─ jobs (DB queue): fetch(SSRF-safe, robots) → parse(HTML/PDF/CSV) → extract(rule + optional AI) → facts(candidate)
                                                  ├─ shared/compare.ts (pure engine: table, Unknown/Conflict, scores, scenarios)
                                                  └─ shared/brief.ts (Decision Brief: MD/HTML/TXT/JSON, PDF via Chromium)
```

## フェーズと状態（2026-10-04 時点）

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 調査/PoC（SOURCE_NOTES.md、PGlite/pdfjs/MCP SDK検証） | 完了 |
| 1 | Auth / Workspace / Project / Candidate / Source / RBAC | 完了 |
| 2 | Import（URL/PDF/Screenshot/Image/Text/CSV/manual）/ Extraction / Citation / Review | 完了（OCRは同梱せずAI Vision or 手動領域転記） |
| 3 | Attribute / Normalization / Dynamic Schema / Missing / Conflict / Price Snapshot | 完了 |
| 4 | Criteria / Must-have / Weighted Compare / Scenario | 完了 |
| 5 | Evidence / Questions / AI Research Assistant（引用付き） | 完了 |
| 6 | Decision Brief / Decision Review / Collaboration（コメント・Factレビュー・Briefレビュー・共有） | 完了 |
| 7 | PWA / Search / Import-Export / MCP | 完了（Semantic検索は未実装・optional） |
| 8 | Privacy / Security / Audit / Backup-Restore | 完了（外部セキュリティ診断は未実施） |
| 9 | E2E / performance / accessibility / 実機 | E2E・エミュレーション完了。**実機確認・負荷試験は未実施** |
| 10 | Branding / Docs / Deploy / 販売前check | ブランド・ドキュメント・Dockerfile 完了。**本番デプロイ・商標/ストア確認は人の承認待ち** |

→ 「全体完成」ではない。未完了項目は PROGRESS.md / NEXT_STEPS.txt / RELEASE_CHECKLIST.md を参照。

## 今回広げない（プロンプト §24）
EC価格クローラー、アフィリエイト、投資銘柄推薦、医療/保険推薦、採用候補者の自動ランキング、住宅ローン推薦、法務判断、無制限スクレイピング、AI最終決定。

## Pro候補（§25・未着手）
Browser Extension、Drive/Dropbox、Team approval、定期価格更新、ベンダー質問票、API/Webhook、カスタムテンプレート、セルフホストAI、SSO。
