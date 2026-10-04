# DECISIONS — 設計判断の記録

| # | 判断 | 理由 | 代替案 |
|---|---|---|---|
| D1 | フロント React 19 + Vite + React Router 7、サーバ Fastify 5 + TypeScript の単一パッケージ | 指示の「React+TypeScript等」。型とドメインロジック（比較エンジン・Brief）をサーバ/Web/MCPで共有するため単一リポジトリ・単一パッケージにした | Next.js（SSRは不要、PWA中心のため見送り） |
| D2 | DB は PostgreSQL、開発/テストは PGlite | 本番と同じSQL方言を1つに保ちつつ、DBサーバなしで結合テストとE2Eを実行できる。pg_trgm も同梱 | SQLite（方言差で二重実装になる） |
| D3 | 全文検索は ILIKE + pg_trgm、Semantic は未実装 | 日本語は `to_tsvector` の分かち書きがなく、trigram の方が実用的。Semantic（ベクトル）は "optional" のため見送り（embeddings テーブルと削除連動のみ用意） | pgvector + Embedding API |
| D4 | 抽出はルールベースを常に実行し、AI は ON の時だけ上乗せ | AI OFF でも製品が成立（外部送信0）。AI結果は原文照合（grounding）を通ったものだけ候補化 | AI 必須 |
| D5 | 抽出Factはすべて `candidate`。スコアは既定で Confirmed のみ | 「SourceなしFactをConfirmedにしない」「Evidenceが主役」。UIでは未確認値も表示し、計算方針は切替可能 | 未確認も既定で計算 |
| D6 | Unknown はスコアから除外し、カバー率と悲観/楽観レンジを表示 | Missing≠0。0点扱いも暗黙の補完もしない。計算式を画面とBriefに公開 | Unknownを0点 / 平均補完 |
| D7 | 価格は Fact とは別に Price Snapshot（取得時刻・税・送料・周期・席・為替の出典/時刻）で保持。異なる販売店・周期の価格は Conflict ではなく「別のオファー」 | 月額/年額の単純比較を禁止し、換算（月額×12、席数×）は明示ステップとして表示 | 価格を単一値に正規化 |
| D8 | 1TB = 1024GB（二進） | プロンプトの例示に従う。表示単位は GB に統一 | 1TB=1000GB |
| D9 | 意味の誤merge防止は「除外語」と「単位の次元チェック」 | 例: GPUメモリ→メモリにしない、バッテリー容量（Wh）と駆動時間（h）を分離、単位の次元が違えば項目割当を外して人に戻す | 機械学習による分類 |
| D10 | 決定は人のみ。API/MCP トークンは決定・chosen設定不可、choose_candidate ツールなし | 「AIはWinnerを勝手に決めない」「choose_candidate自動tool禁止」 | — |
| D11 | MCP は公式 TypeScript SDK v1（1.32）、Streamable HTTP（ステートレス）＋ stdio ブリッジ | 安定版で Fastify に組み込みやすい。SOURCE_NOTES によれば最新仕様 2026-07-28 と SDK v2 が存在するため、移行は NEXT_STEPS | SDK v2 / 自前JSON-RPC |
| D12 | AI プロバイダは Anthropic（公式SDK）を実装、既定は none | 外部送信は明示設定時のみ。既定モデルは `claude-opus-5-5`、コスト優先なら運用者が変更可能 | OpenAI 等（インターフェースのみ） |
| D13 | スクショは OCR を同梱せず、AI ON 時は Vision、OFF 時は人が画像領域を選んで転記（領域が引用になる） | tesseract.js の日本語精度と言語データのCDN取得（外部通信）を避けた。領域付き引用で根拠性は担保 | tesseract.js 同梱 |
| D14 | ファイルは Local Disk 実装＋署名URL。S3互換は将来 | 単一インスタンスでの販売前検証を優先 | 最初からS3 |
| D15 | PDF 出力はサーバ側 Chromium（ページ内ネットワーク遮断）。日本語フォントは IPA ゴシック | pdfkit 等では日本語フォント同梱が必要。Chromium ならHTMLと同一レイアウト | クライアント印刷のみ |
| D16 | 共有リンクは既定 OFF、閲覧専用、期限付き | 「Private sharing OFF可」 | 既定 ON |
| D17 | バックアップは新規ワークスペースへ ID 再採番で復元 | 同一環境でも衝突せず、空環境でも同じ手順で復元可能 | ID 維持で上書き |
| D18 | フォントは Inter（SIL OFL 1.1、@fontsource）＋日本語はOS標準。ブランドボード画像のフォントは使わない | 指示「Fontは商用license確認。画像のfont fileを同梱しない」 | Noto Sans JP 同梱（容量増） |
| D19 | ロゴ・アイコンはブランドボードを基準に SVG で再作図し、PNG は SVG から生成 | 「画像をそのままUIへ貼らず実assetを実装」 | 画像の切り抜き |
| D20 | 外部サイトの実取得はテストで行わず、架空フィクスチャ（`*.selequo.invalid`）で検証 | 第三者サイトへの大量取得禁止・再現性 | 実サイトでのテスト |
