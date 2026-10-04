# RELEASE_CHECKLIST — 販売前チェック

凡例: ✅ 完了（このリポジトリで確認済み） / ⬜ 未完了（人の作業・承認が必要） / ⚠️ 部分的

## A. 機能（完成条件 §30）
- ✅ PC / iPhone / Android / iPad の主要UX（**エミュレーション**で確認: Desktop Chrome, iPhone 13, Pixel 7, iPad Pro 11）
- ⬜ **実機**（iPhone Safari・Android Chrome・iPad）での確認とホーム画面追加（PWA インストール）確認
- ✅ PWA（manifest・maskable icon・Service Worker・オフラインメモ同期・Share Target）
- ✅ RBAC（Owner/Admin/Editor/Reviewer/Viewer）・テナント分離
- ✅ Project / Candidate / Source、URL / PDF / Image / Text / CSV / 手入力の取込
- ⚠️ スクショの文字読み取り: AI ON 時は Vision、OFF 時は手動領域転記（ローカルOCR未同梱）
- ✅ Fact / Citation（Web=URL+取得日時+文脈、PDF=ページ、スクショ=画像領域、手入力=入力者、CSV=行列）
- ✅ Normalization / Dynamic Schema（追加・削除・名前変更・グループ化・ルール履歴）
- ✅ Missing / Conflict、Price Snapshot（税・送料・周期・席・為替出典/時刻）
- ✅ Criteria / Must-have / Weighted Compare（計算式公開・Weight検証・Winner断定なし）
- ✅ Scenario 比較
- ✅ Compare / Evidence UI（PCワイドテーブル、モバイル2候補/カード）
- ✅ Question / AI Assistant（引用付き）
- ✅ Decision Brief（MD/HTML/TXT/JSON/PDF）/ Decision Review（90日後）
- ⚠️ Search（全文検索のみ。Semantic は未実装・optional）
- ✅ Import / Export、Backup / Restore（空環境復元・関連一致を自動テスト）
- ✅ MCP foundation（11ツール、choose_candidate なし、scope/ロール制御）
- ✅ AI OFF（送信0件をテスト）、Security / SSRF、Audit
- ✅ 必須テスト / E2E（TEST_REPORT.md）
- ✅ Brand / PWA assets、Docs、OPERATING_COSTS

## B. 法務・名称（人が実施）
- ⬜ 商標調査: J-PlatPat（「セレクオ」等の称呼含む、第9・42・35類）、USPTO、EUIPO/TMview、WIPO Global Brand DB
- ⬜ App Store / Google Play の同名・類似名確認
- ⬜ ドメイン取得可否（selequo.com / .app / .jp）、SNSハンドル
- ⬜ 類似SaaS（SOURCE_NOTES §2: SpecLens, Gentables 等）との差別化表現の確認
- ⬜ 利用規約・プライバシーポリシー・特定商取引法表記の作成（AI送信範囲、URL取得の規約順守、データ削除）
- ⬜ URL取得機能の法的確認（著作権法30条の4/47条の5 等の解釈、各サイト規約）— 本アプリは利用者の明示操作で1ページずつ取得、robots.txt 準拠、CAPTCHA/ペイウォール回避なし
- ⬜ フォント・依存ライブラリのライセンス表記ページ（Inter OFL、IPA フォント、pdfjs Apache-2.0、Playwright Apache-2.0 等）

## C. セキュリティ・運用
- ✅ 自己レビュー（TEST_REPORT.md「セキュリティレビュー」）
- ⬜ 第三者ペネトレーションテスト
- ⬜ 本番の秘密情報設定（`SELEQUO_SECRET` 64文字、DB 資格情報、AI キー）とローテーション手順
- ⬜ Postgres 自動バックアップ（PITR）とファイルボリュームのスナップショット設定、復元訓練
- ⬜ 監視・アラート（5xx、ジョブ失敗、ディスク、AI呼び出し数）
- ⬜ 複数台構成にする場合: S3互換ストレージ実装、共有レート制限ストア
- ⬜ 負荷試験（同時ユーザー・大きいPDF・1,000ソース規模）

## D. AI・コスト
- ⬜ AI プロバイダ契約（**有料契約は人の承認後**）、データ取り扱い条件（保持期間・学習利用なし）の確認
- ⬜ AI抽出の精度評価（日本語の実ページ・PDFでの評価セット）
- ⬜ 料金プランごとの上限（月間ソース数 / AI ON ソース数）設計（OPERATING_COSTS §4）
- ⬜ SOURCE_NOTES の [検索経由] 単価を公式ページで再確認

## E. デプロイ（人の承認後）
- ⬜ ホスティング選定・契約（Render / Fly / Cloud Run 等）
- ⬜ `docker build` と本番環境での起動確認（Dockerfile は作成済み・**このセッションではビルド未検証**）
- ⬜ Chromium（PDF出力）を本番イメージに入れるか `PDF_RENDERER=none` にするかの決定
- ⬜ 独自ドメイン・HTTPS・`PUBLIC_URL`
- ⬜ デモ環境（サンプルデータ）は本番と分離して用意
