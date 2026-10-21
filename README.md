# Selequo — 出典を確認しながら候補を比べる

URL・PDF・スクリーンショット・メモから候補情報を整理し、出典・不明点・矛盾を残した比較表とDecision Briefを作るツールです。

実装ブランチ：`025-selequo`。アプリ本体は `025-selequo/`。

## できること

- 情報取込とEvidence管理、単位・表記の正規化
- 条件・重み・Must-have・シナリオ別の比較
- Unknown / Conflictの保持、出典付きBrief、MCP・サンプルデータ

## 現在の範囲・制限

- AIは判断材料を整理する補助です。不明値を0や確定値に置き換えず、最終判断は利用者が行います。
- 実サイト取込・AI接続には利用条件と送信設定の確認が必要です。実機・PWAインストールの確認は残項目です。

## 実装の見どころ

**構成：** React / TypeScript / Vite、Node.js、PGlite / PostgreSQL、PWA、MCP。

- [025-selequo/src/server](./025-selequo/src/server)
- [025-selequo/src](./025-selequo/src)
- [025-selequo/tests](./025-selequo/tests)

## ローカルで試す

Node.js 22.13以上。環境変数指定はBash形式です。PowerShellでは $env:SELEQUO_FETCH_FIXTURES="fixtures/sample" を設定してから npm run seed:sample を実行します。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch 025-selequo https://github.com/Atsushi-Odajima/Selequo_hb.git
cd Selequo_hb/025-selequo
npm ci
SELEQUO_FETCH_FIXTURES=fixtures/sample npm run seed:sample
npm run dev
```

環境設定・初期化の詳細：[セットアップ手順](./025-selequo/DEVELOPMENT.md)。

## 検証方法

`025-selequo/` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run build:web
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [025-selequo/DEVELOPMENT.md](./025-selequo/DEVELOPMENT.md)
- [025-selequo/README.md](./025-selequo/README.md)
- [025-selequo/TEST_REPORT.md](./025-selequo/TEST_REPORT.md)
- [025-selequo/RELEASE_CHECKLIST.md](./025-selequo/RELEASE_CHECKLIST.md)
- [025-selequo/DATA_MODEL.md](./025-selequo/DATA_MODEL.md)
- [025-selequo/DECISIONS.md](./025-selequo/DECISIONS.md)
- [025-selequo/SECURITY.md](./025-selequo/SECURITY.md)
- [025-selequo/OPERATIONS.md](./025-selequo/OPERATIONS.md)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
