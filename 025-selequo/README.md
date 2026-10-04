# Selequo（#025）

<img src="public/icons/logo-horizontal.png" alt="Selequo" width="420">

**候補を集める。違いが見える。決めやすくなる。**
URL・PDF・スクリーンショット・メモから候補ごとの情報を取り込み、価格・仕様・条件を同じ比較表に揃え、出典・不足（Unknown）・矛盾（Conflict）を見える化し、根拠付きの Decision Brief を作るツールです。決定するのは人であり、AI は判断材料を整理するだけです。

## 主な機能
- 情報取込: URL（robots.txt準拠・SSRF対策）/ PDF（ページ引用）/ スクショ（画像領域引用）/ テキスト / CSV / 手入力
- 比較表: 表記揺れ・単位の正規化（16 GB = 16GB RAM、1TB = 1024GB）、誤merge防止、PCはワイドテーブル、スマホは2候補比較/カード
- 出典・根拠: すべての値から Evidence（値・出典・取得日時・元の文脈・信頼度・レビュー状態・Conflict）へ
- 不明点Check: Unknown ≠ 0、Conflict は両方保持、調査キュー（質問）
- 条件別比較: Criteria / Weight / Must-have（Pass/Fail/Unknown）/ Scenario（Travel・Performance・Budget など）
- Decision Brief: MD / HTML / TXT / JSON / PDF、判断記録と90日後の振り返り
- AI Research Assistant: 引用付き回答（AI OFF でもルールベースで動作）
- PWA（オフラインメモ）、横断検索、エクスポート/インポート、バックアップ/リストア、MCP（11ツール）、RBAC、監査ログ

## クイックスタート
```bash
npm ci
SELEQUO_FETCH_FIXTURES=fixtures/sample npm run seed:sample   # 架空サンプルを投入
npm run dev                                                   # http://localhost:5173
# ログイン: demo@selequo.invalid / selequo-demo-2026
```
テスト: `npm test`（Vitest）/ `npm run test:e2e`（Playwright）

## ドキュメント
| 文書 | 内容 |
|---|---|
| [PLAN.md](PLAN.md) / [PROGRESS.md](PROGRESS.md) / [NEXT_STEPS.txt](NEXT_STEPS.txt) | 計画・進捗・次の作業 |
| [DECISIONS.md](DECISIONS.md) | 設計判断 |
| [DEVELOPMENT.md](DEVELOPMENT.md) / [OPERATIONS.md](OPERATIONS.md) | 開発・運用 |
| [DATA_MODEL.md](DATA_MODEL.md) / [SOURCE_MODEL.md](SOURCE_MODEL.md) / [FACT_EXTRACTION.md](FACT_EXTRACTION.md) / [NORMALIZATION.md](NORMALIZATION.md) | データ・取込・抽出・正規化 |
| [COMPARISON_ENGINE.md](COMPARISON_ENGINE.md) / [SCENARIO_COMPARE.md](SCENARIO_COMPARE.md) / [DECISION_BRIEF.md](DECISION_BRIEF.md) | 比較・シナリオ・Brief |
| [MCP_PLUGIN.md](MCP_PLUGIN.md) / [AI_SAFETY.md](AI_SAFETY.md) / [SECURITY.md](SECURITY.md) | MCP・AI安全・セキュリティ |
| [OPERATING_COSTS.md](OPERATING_COSTS.md) / [TEST_REPORT.md](TEST_REPORT.md) / [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) | 運用費・テスト結果・販売前チェック |
| [SOURCE_NOTES.md](SOURCE_NOTES.md) | 名称・市場・技術・ライセンス・料金の調査記録（公式ソース中心） |

## ライセンス・注意
- 同梱サンプルの製品・店舗・SaaSはすべて架空です（`*.selequo.invalid`）。
- 「Selequo」の名称は正式な商標調査を経ていません（SOURCE_NOTES §1、RELEASE_CHECKLIST）。
- フォント: Inter（SIL OFL 1.1）。サーバPDFの日本語は IPA フォント（IPA Font License）を想定。
