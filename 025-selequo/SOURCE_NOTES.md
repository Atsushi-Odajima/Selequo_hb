# Selequo SOURCE_NOTES（デスクリサーチ記録）

- 作成日: 2026-10-04
- 対象: Selequo（AI 支援の比較 / Decision Brief ツール。URL・PDF・スクリーンショットから出典付きで事実を抽出して比較表にし、Unknown/Conflict 表示、シナリオ別の重み付け比較、人が作る Decision Brief、PWA + MCP サーバ基盤）
- 方針: 公式ソース（ベンダー文書、ライセンスファイル、料金ページ、仕様、RFC）を優先する。各記述に URL と確認日を付ける。確認できなかったものは「未確認」と明記する。
- **本書は法的助言ではない。** 商標・著作権・利用規約の判断は専門家の確認が必要。

### 確認方法の凡例（重要）

この調査環境では egress proxy により、多くのベンダーサイト（openai.com / developers.openai.com / modelcontextprotocol.io / ai.google.dev / aws.amazon.com / render.com / fly.io / neon.com / browserless.io / rfc-editor.org / developers.cloudflare.com / privacy.claude.com / moji.or.jp / postgresql.org / playwright.dev など）への直接アクセスが遮断されていた。そこで次の 3 区分で表記する。

| 表記 | 意味 |
|---|---|
| **[直接]** | 公式ページ・公式リポジトリのファイル・npm registry API を実際に取得して内容を確認した |
| **[検索経由]** | 公式ドメインに限定した WebSearch の結果要約でのみ確認した（本文は直接取得できていない）。**数値はリリース前に人間が公式ページで再確認すること** |
| **未確認** | 確認できなかった |

---

## 1. 名称確認 "Selequo"

> これは商標クリアランスではない。Web 上で同名のソフトウェア・企業・アプリが目立って存在するかを簡易に見ただけである。

### 1.1 実施した検索（確認日: 2026-10-04）

| 検索 | 結果 |
|---|---|
| WebSearch `"Selequo"`（完全一致） | 一致なし。上位は Seleucus（人名）、Sequoia、"seleque"（スペイン語の方言）など無関係のもの |
| WebSearch `"Selequo" app OR software OR company` | 一致なし。近い名前として **Serquo**（スペインのソフトウェアコンサル、https://x.com/Serquo_Software ）、**Sequar**（クラウド ERP）、**Sequoiasoft** が出た |
| WebSearch `"selequo" github OR "app store" OR "google play" OR trademark` | 一致なし |
| WebSearch `selequo.com` | selequo.com の情報はなし。近い綴りの **seleqo.com**（BrandBucket で売りに出ているドメイン、https://seleqo.com/ ）、**seleque.com**（アフィリエイトブログ、https://www.seleque.com/ ）、**selqio.com**（オンラインツール、https://selqio.com/ ）、**Selequa.com**（AboutUs に掲載、https://aboutus.com/Selequa.com ）が出た |
| WebSearch `"Selequa" OR "Selecuo"` / `"Selequa" company` | ソフトウェアとしての一致なし。"Selequa Ube Est"（米カリフォルニア州 Burbank の事業者情報、aboutus.com 経由、業種不明）が 1 件出た |
| npm registry 検索 API `text=selequo / selequa / selecuo` **[直接]** | 該当 0 件（https://registry.npmjs.org/-/v1/search?text=selequo ） |
| PyPI `https://pypi.org/pypi/{selequo,selequa,selecuo}/json` **[直接]** | すべて 404（未登録） |

**結論（暫定）:** 2026-10-04 時点で、Web 検索・npm・PyPI の範囲では「Selequo」という名前のソフトウェア・企業・アプリは見つからなかった。ただし類似の綴り（Seleqo / Seleque / Selqio / Selequa / Serquo）は存在する。特に **seleqo.com は「select / sell」を連想させるブランド用ドメインとして売りに出ており**、発音や見た目が近い。混同の可能性は人間が評価すること。

### 1.2 リリース前に人間が確認すべきこと（TODO）

- [ ] **J-PlatPat**（日本の商標）: https://www.j-platpat.inpit.go.jp/ ── 称呼検索で「セレクオ」「セレキュオ」なども調べる。第9類（ソフトウェア）・第42類（SaaS）・第35類を中心に
- [ ] **USPTO Trademark Search**（旧 TESS）: https://tmsearch.uspto.gov/
- [ ] **EUIPO eSearch / TMview**: https://euipo.europa.eu/eSearch/ , https://www.tmdn.org/tmview/
- [ ] **WIPO Global Brand Database**: https://branddb.wipo.int/
- [ ] **App Store / Google Play** の同名・類似名アプリ（端末やストアの Web 版で目視確認）
- [ ] **ドメイン**: selequo.com / selequo.app / selequo.jp の空き状況。RDAP（rdap.verisign.com など）がこの環境から遮断されていたため **未確認**。レジストラで確認すること
- [ ] GitHub の org/user 名 `selequo`、X / LinkedIn のハンドル名
- [ ] 外国語での意味の確認（"seleque" はスペイン語の方言で「痩せた」の意味。Wiktionary https://en.wiktionary.org/wiki/seleque 、確認日: 2026-10-04）

---

## 2. 市場 / 競合（簡易）

確認日: 2026-10-04。いずれも各社の公式ページ（[検索経由]）による。機能比較は表面的なものなので、詳しく調べる場合は試用が必要（本調査ではサインアップしていない）。

### 2.1 直接競合に近いもの（ドキュメント・URL から比較表を作る）

| 名称 | 概要（公式の記述） | URL |
|---|---|---|
| SpecLens | 競合ベンダーの文書をアップロードすると、比較マトリクス、ギャップ分析、価格表、AI の推奨を自動生成する。SaaS の比較やホスティングの比較が用途として挙げられている | https://www.speclens.ai/ |
| Gentables | 文書から差分を抽出し、根拠（source evidence）付きの意思決定用マトリクスを作る | https://www.gentables.com/tools/create-comparison-table |
| Elicit | 論文から表形式でデータを抽出し、文単位の引用を付ける。"AI for research & decision-making" をうたう（学術寄り） | https://elicit.com/ , https://elicit.com/solutions/systematic-review |

→ 「出典付きの比較表」というコア機能を持つツールは既にある。Selequo の差別化要素は、**Unknown/Conflict の明示、シナリオ別の重み付け、人が作る Decision Brief、MCP 連携** になりそう（仮説であり、未検証）。

### 2.2 代替手段（汎用 AI リサーチ）

| 名称 | 概要 | URL |
|---|---|---|
| ChatGPT deep research | 多数の Web ソースを調べて引用付きのレポートを作る。PDF でのエクスポートにも対応 | https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt |
| NotebookLM（検索結果では「Gemini Notebook」という表記もあり） | アップロードした PDF・Web サイトなどのソースに基づいて、インライン引用付きで回答する。Web URL はテキストだけを取り込み、ペイウォールのページには非対応 | https://support.google.com/notebooklm/answer/16215270 , https://notebooklm.google/ |
| Perplexity | 引用付きの AI 検索 | https://www.perplexity.ai/ （**詳細は未確認**） |
| Notion AI | ワークスペース内の AI | https://www.notion.com/product/ai （**詳細は未確認**） |

### 2.3 競合ではないもの

- G2（https://www.g2.com/ ）や Capterra（https://www.capterra.com/ ）は**ベンダーのディレクトリ / レビューサイト**であり、ユーザー自身の候補を比較するツールではない。Selequo にとっては入力ソース（候補 URL）になりうる。ただし、取り込むときは各サイトの利用規約・robots.txt に従うこと（§5）。
- 比較表を作るだけのツール（MyMap、Make-Charts など）は出典の抽出を行わないため、代替としては弱い。

---

## 3. 技術スタックのライセンス / バージョン

確認日: 2026-10-04。バージョン・ライセンスは **npm registry API（`https://registry.npmjs.org/<pkg>/latest`）で [直接] 確認**した。ライセンス本文は GitHub の LICENSE ファイルを [直接] 確認した。

### 3.1 npm パッケージ

| パッケージ | npm latest | License | 備考 / 出典 |
|---|---|---|---|
| react / react-dom | 19.3.0 | MIT | https://registry.npmjs.org/react |
| vite | 8.3.2 | MIT | https://registry.npmjs.org/vite |
| typescript | **7.0.2**（2026-07-08） | Apache-2.0 | 5.x 系の最終は 5.9.3。プロジェクトの package.json は `^5.9.3` を指定しているため、7.x へ移行するかは別途判断が必要 |
| fastify | 5.12.5 | MIT | https://registry.npmjs.org/fastify |
| @fastify/helmet | 13.1.1 | MIT | |
| @fastify/cookie | 11.1.2 | MIT | |
| @fastify/multipart | 10.1.2 | MIT | |
| @fastify/rate-limit | 11.2.0 | MIT | |
| @fastify/static | 10.1.5 | MIT | |
| zod | 4.6.5 | MIT | |
| @electric-sql/pglite | 0.5.8 | Apache-2.0（npm の表記） | README によると **Apache-2.0 と PostgreSQL License のデュアルライセンス（どちらかを選べる）**。Postgres ソースへの変更部分は PostgreSQL License。README のバッジは status: **Alpha**（https://github.com/electric-sql/pglite ） |
| pg（node-postgres） | 8.23.1 | MIT | https://github.com/brianc/node-postgres |
| pdfjs-dist | 6.4.299（2026-10-03） | Apache-2.0 | engines は `node >=22.13.0 \|\| >=24`。optionalDependencies に `@napi-rs/canvas` がある |
| tesseract.js | 7.0.0（2025-12-15） | Apache-2.0 | 現在の package.json には含まれていない |
| cheerio | 1.2.0 | MIT | |
| fflate | 0.8.3 | MIT | |
| playwright / playwright-core / @playwright/test | 1.63.0 | Apache-2.0 | プロジェクトは 1.56.1 に固定している |
| @modelcontextprotocol/sdk | **1.32.0**（2026-10-02） | MIT | v1 系。§7 で述べるとおり、2026-07-28 版の仕様に対応するのは **v2 の分割パッケージ** |
| @modelcontextprotocol/server / client / core | **2.3.0**（2026-10-02） | **Apache-2.0** | v2 系。v1（MIT）とはライセンスが違う点に注意 |
| @modelcontextprotocol/fastify / node | 2.0.1 / 2.1.1 | Apache-2.0 | v2 のミドルウェアパッケージ |
| vitest | 5.0.3 | MIT | |
| undici | 8.11.2 | MIT | |
| react-router | 8.4.0 | MIT | プロジェクトは `^7.18.4` を指定（メジャーバージョンが違う） |
| esbuild / tsx / concurrently | 0.28.2 / 4.23.15 / 10.0.5 | MIT | |

### 3.2 DB・拡張

- **PostgreSQL**: PostgreSQL License（BSD/MIT 系の寛容なライセンス）。COPYRIGHT ファイル "Portions Copyright (c) 1996-2026, PostgreSQL Global Development Group" **[直接]** https://github.com/postgres/postgres/blob/master/COPYRIGHT （公式ページ https://www.postgresql.org/about/licence/ は遮断されていたため未取得）
- **pg_trgm**: PostgreSQL の contrib に同梱（ライセンスは PostgreSQL 本体と同じ）。control ファイルは `default_version = '1.6'`、`trusted = true` **[直接]** https://github.com/postgres/postgres/blob/master/contrib/pg_trgm/pg_trgm.control
- **pgvector**: LICENSE の文面は PostgreSQL License（"Portions Copyright (c) 1996-2026, PostgreSQL Global Development Group"）**[直接]** https://github.com/pgvector/pgvector/blob/master/LICENSE
- PGlite で pg_trgm / pgvector が使えるかどうかは **未確認**（PGlite の extensions ドキュメントで要確認: https://pglite.dev/extensions/ ）

### 3.3 tesseract.js の traineddata（言語データ）

- 既定の取得元 **[直接]**: `langPath` を指定しない場合、jsDelivr CDN から取得する。コードは `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`（LSTM のみ・既定）または `.../4.0.0`（Legacy を併用する場合）。出典: https://github.com/naptha/tesseract.js/blob/master/src/worker-script/index.js 、https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md
- 既定データは「Tessdata Best」を整数化したもの（`4.0.0_best_int`）。出典: https://github.com/naptha/tessdata （README）
- ライセンス: 元データ tesseract-ocr/tessdata は **Apache-2.0** **[直接]**（https://github.com/tesseract-ocr/tessdata/blob/main/LICENSE ）。npm の `@tesseract.js-data/jpn@1.0.0` は package.json で `MIT` と表記されている **[直接]**。**表記が食い違っているため、元データの Apache-2.0 に従って NOTICE に記載するのが安全**（要確認）。
- **SaaS 運用上の推奨**: 実行時に CDN から取得すると外部依存とプライバシーの論点が生じる。jpn / eng の traineddata をセルフホストし、`langPath` を明示する（どのファイルを同梱するかは要決定）。

### 3.4 Playwright のブラウザバイナリ

- Playwright 本体は Apache-2.0。同梱される第三者ソフトウェアは `ThirdPartyNotices.txt` に記載されている **[直接]** https://github.com/microsoft/playwright/blob/main/packages/playwright-core/ThirdPartyNotices.txt
- `browsers.json` **[直接]**（main ブランチ）: chromium 156.0.8078.4（"Chrome for Testing"）、chromium-headless-shell、firefox 156.0、webkit 26.6、ffmpeg。https://github.com/microsoft/playwright/blob/main/packages/playwright-core/browsers.json
- 既定ではオープンソースの Chromium ビルドを使い、ブランド版の Google Chrome / Microsoft Edge は既定ではインストールしない **[直接]** https://github.com/microsoft/playwright/blob/main/docs/src/browsers.md
- **各ブラウザバイナリ（Chromium = BSD 系 + 多数の第三者ライセンス、Firefox = MPL-2.0、WebKit = LGPL/BSD）のライセンスを個別に確認するのは未完了（未確認）。** サーバー側で使うだけなら配布にはあたらないと考えられるが、Docker イメージとして配布する場合は NOTICE の扱いを人間が確認すること。

### 3.5 フォント

| フォント | ライセンス | 出典（確認日: 2026-10-04） |
|---|---|---|
| Inter | SIL Open Font License 1.1 | **[直接]** https://github.com/rsms/inter/blob/master/LICENSE.txt |
| Noto Sans JP | SIL OFL 1.1（Google Fonts 版の OFL.txt には "Copyright 2014-2021 Adobe ... with Reserved Font Name 'Source'" とある） | **[直接]** https://github.com/google/fonts/blob/main/ofl/notosansjp/OFL.txt , https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE |
| IPA フォント / IPAex フォント | IPA フォントライセンス v1.0。商用利用・再配布は可能。再配布時は名称を変えない・改変しない・ライセンスの写しを添付する、という条件がある。派生物には別の条件がある | **[検索経由]** https://moji.or.jp/ipafont/license/ , https://moji.or.jp/ipafont/faq/ |

→ Web フォントとして配信する場合も OFL の条件（Reserved Font Name を使わないこと、ライセンスを添付すること）を守る。ライセンスの扱いを簡単にしたいなら、IPA より **Noto Sans JP（OFL）を推奨**。

---

## 4. AI プロバイダ

### 4.1 Anthropic（Claude API）

**料金 [直接]** https://platform.claude.com/docs/en/about-claude/pricing （確認日: 2026-10-04。USD / 100 万トークン、標準・グローバルルーティング）

| モデル | Input | Output | キャッシュヒット | Batch（input/output） |
|---|---|---|---|---|
| Claude Opus 5.5（上位） | $4 | $20 | $0.20 | $2 / $10 |
| Claude Sonnet 5.5（主力） | $2 | $10 | $0.20 | $1 / $5 |
| Claude Sonnet 5 | $2 | $10 | $0.20 | $1 / $5（導入時価格がそのまま標準価格になった、と注記あり） |
| **Claude Haiku 4.5（小型）** | **$1** | **$5** | $0.10 | $0.50 / $2.50 |

- 補足: Claude 4.7 以降のモデルは新しいトークナイザを使い、同じテキストでも**約 30% 多くトークンを消費する**と明記されている。`inference_geo: "us"` を指定すると 1.1 倍になる。Batch は 50% 引き。Web search は 1,000 回あたり $10。
- **Embeddings**: Anthropic は埋め込みモデルを提供していない（料金ページに embeddings の項目がない [直接]）。必要なら他社（例: OpenAI / Google / Voyage AI）を使う。Voyage の料金は**未確認**。
- **画像入力 [直接]** https://platform.claude.com/docs/en/build-with-claude/vision : 28×28 px のパッチ単位で、トークン数 = `⌈幅/28⌉ × ⌈高さ/28⌉`。Claude 4.7 以降は長辺 2576px・最大 4784 トークン、それ以外のモデルは長辺 1568px・最大 1568 トークン。例: 1000×1000 の画像を Haiku 4.5 で処理すると約 $1.30 / 1000 枚。形式は JPEG/PNG/GIF/WebP。1 枚あたり最大 10MB（API 直接利用時）。
- **データ利用 / 保持 [直接]** https://platform.claude.com/docs/en/manage-claude/api-and-data-retention :
  - "Retained data is never used for model training without your express permission."（明示的な許可なく学習に使わない）
  - 同ページには「会話内容（プロンプトと出力）は既定では保持しない。例外は Covered Models で、30 日間の保持が必要」と記載がある。一方、検索で見つかった商用データの保持ポリシー（https://privacy.claude.com/en/articles/7996866 、[検索経由]、直接取得は遮断）には「30 日以内に削除」とある。**既定の保持期間の正確な扱いは要再確認**。
  - **ZDR**: 組織単位で、営業経由で申請する。Covered Models（Claude Fable 5 / 5.1、Mythos 5 / 5.1）は 30 日保持が必須なので ZDR の対象外。MCP connector（Messages API の機能）も `zdr: not-eligible`（https://platform.claude.com/docs/en/agents-and-tools/mcp-connector [直接]）。

### 4.2 OpenAI API

> **注意: developers.openai.com / openai.com / platform.openai.com はすべて遮断されていた。以下はすべて [検索経由]。数値は必ず https://developers.openai.com/api/docs/pricing で再確認すること。**（確認日: 2026-10-04）

| モデル | Input | Cached input | Output | 出典 |
|---|---|---|---|---|
| GPT-6.1 Sol（2026 年 9 月リリースとされる、主力） | $2.00 | $0.10 | $10.00 | https://openai.com/index/introducing-gpt-6-1-sol/ , https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| GPT-6 Sol | $2.00 | $0.20 | $10.00 | https://developers.openai.com/api/docs/models/gpt-6-sol |
| **GPT-6 Luna（小型）** | **$0.10** | $0.01 | **$0.50** | https://developers.openai.com/api/docs/models/gpt-6-luna |
| GPT-6 Astra（上位） | $10.00 | ? | $50.00 | 検索要約のみ（**未確認寄り**） |
| GPT-5 mini / nano（旧世代） | $0.25 / $0.05 | $0.025 / $0.005 | $2.00 / $0.40 | https://developers.openai.com/api/docs/models/gpt-5-nano |
| text-embedding-3-small | $0.02 | – | – | https://developers.openai.com/api/docs/models/text-embedding-3-small |
| text-embedding-3-large | **未確認** | | | |

- 価格帯（272K 入力トークン以下で標準価格）、Batch / Flex は 50%、Fast mode は 2 倍、地域処理は +10%（いずれも検索要約より）。
- **画像入力**: モデルによっては 32×32 px パッチで課金（パッチ数 × モデルごとの乗数）、1 画像あたり 30,000 パッチが上限。https://developers.openai.com/api/docs/guides/images-vision 、計算機: https://developers.openai.com/api/docs/guides/image-cost-calculator（[検索経由]）。各モデルの乗数は**未確認**。
- **データ利用 / 保持 [検索経由]**: API のデータ（2023-03-01 以降）は、オプトインしない限り学習に使わない。不正利用の監視のため最大 30 日保持する。ZDR は対象エンドポイントについて、適格なユースケースであれば申請できる。出典: https://openai.com/enterprise-privacy/ 。**ただし NYT 訴訟に関連したデータ保全命令について OpenAI が公表している（https://openai.com/index/response-to-nyt-data-demands/ ）。2026-10 時点の影響範囲は未確認。**

### 4.3 Google Gemini API（概要）

[検索経由]（ai.google.dev は遮断）。出典: https://ai.google.dev/gemini-api/docs/pricing 、確認日: 2026-10-04

- Gemini 3.8 Flash: Input $0.75 / Output $3.75（2026-12-31 までの価格）→ **2027-01-01 から $1.50 / $7.50 に値上がりする**と記載
- Gemini 3.1 Flash-Lite: 有料枠で Input $0.25 / Output $1.50。Gemini 2.5 Flash-Lite: $0.10 / $0.40
- **データ利用**: 無料枠（Unpaid Services、AI Studio を含む）では、入力と出力が製品改善に使われる。有料枠では使われない。出典: https://ai.google.dev/gemini-api/terms 、https://ai.google.dev/gemini-api/docs/pricing → **SaaS では必ず有料枠を使うこと**
- 埋め込みモデルの料金・ZDR 相当の制度は**未確認**

---

## 5. URL 取得 / ブラウザレンダリング

### 5.1 robots.txt（RFC 9309, Robots Exclusion Protocol, 2022 年 9 月, Proposed Standard）

出典: https://datatracker.ietf.org/doc/html/rfc9309 （[検索経由]、rfc-editor.org は遮断）、確認日: 2026-10-04

- キャッシュは**原則 24 時間を超えて使うべきでない（SHOULD NOT）**（robots.txt に到達できない場合を除く）
- パーサーは **少なくとも 500 KiB** までは解析しなければならない（MUST）
- 5xx やネットワークエラーで到達できない場合は「**完全に disallow されている**」とみなす（MUST）。4xx の場合はクローラーは制限なしとして扱ってよい（この点は RFC 本文を直接は確認できておらず、**要確認**）
- Allow と Disallow が競合したときは、最も長く一致するルールを優先する（**要確認**、本文未取得）
- RFC 自身が「robots.txt はアクセス許可・認可の仕組みではない」と述べている（**要確認**）

### 5.2 礼儀あるクロールの実装方針（設計メモ。出典付きの事実ではなく推奨）

- Selequo は「ユーザーが指定した URL を 1 回取得する」ものであり、クロールを広げない（リンクを辿らない）
- 識別できる User-Agent（例: `SelequoBot/0.1 (+https://<domain>/bot)`）と連絡先を明示する
- robots.txt を尊重し（上記の RFC 9309 準拠）、ホストごとにレート制限、タイムアウト、サイズ上限を設ける
- SSRF 対策（プライベート IP・メタデータ IP の遮断）、リダイレクト回数の上限
- **CAPTCHA の回避、ペイウォールの迂回、ログインが必要なページの自動取得、ボット対策の回避は行わない（禁止）。** 取得できない場合は Unknown として扱い、ユーザーに PDF やスクリーンショットのアップロードを促す
- 対象サイトの利用規約（スクレイピング禁止条項）を尊重する

### 5.3 マネージド・ブラウザレンダリングの料金

- **Cloudflare Browser Rendering（2026-04-15 に "Browser Run" へ改名）**: Cloudflare 公式ドキュメント検索で確認。https://developers.cloudflare.com/changelog/post/2025-07-28-br-pricing/ 、https://developers.cloudflare.com/changelog/post/2026-04-15-br-rename/ （確認日: 2026-10-04）
  - Workers Free: 1 日 10 分、同時 3 ブラウザ
  - Workers Paid: 月 10 時間と同時 10 ブラウザ（月平均）まで込み。超過分は **$0.09 / ブラウザ時間**、Workers Bindings の場合はさらに **$2.00 / 追加の同時ブラウザ**
  - 2026-04 に Paid の同時実行上限を 1 アカウント 120 に引き上げ
  - 現行の料金ページ https://developers.cloudflare.com/browser-run/pricing/ 本体は未取得。上記は changelog の記載
- **Browserless**: 公式 https://www.browserless.io/pricing （[検索経由]）。Free は月 1,000 units、Prototyping 20,000、Starter 180,000、Scale 500,000、Enterprise は個別見積もり。1 unit = 1 接続あたり最大 30 秒のブラウザ時間。**ドル建ての価格（Prototyping $25 / Starter $140 / Scale $350）は第三者サイト経由の情報のみで、公式では未確認。**

### 5.4 法的メモ（日本の著作権法、概要のみ。法的助言ではない）

出典: 文化庁「AI と著作権に関する考え方について」（令和 6 年 3 月 15 日、文化審議会著作権分科会法制度小委員会）https://www.bunka.go.jp/seisaku/bunkashingikai/chosakuken/pdf/94037901_01.pdf 、「AI と著作権に関するチェックリスト＆ガイダンス」（令和 6 年 7 月 31 日）https://www.bunka.go.jp/seisaku/chosakuken/pdf/94097701_01.pdf （[検索経由]）、確認日: 2026-10-04

- **第 30 条の 4（享受を目的としない利用）**: 情報解析などで、著作物に表現された思想や感情を享受することを目的としない利用は、原則として許諾なしに可能。ただし「著作権者の利益を不当に害する場合」は除かれる。
- **第 47 条の 5（電子計算機による情報処理とその結果の提供に付随する軽微利用）**: 検索・情報解析の結果を提供する際に、著作物を軽微な範囲で利用することを認める。
- Selequo への含意（要専門家確認）: 抽出した事実と短い引用（出典 URL 付き）を示すことは、上記や引用（第 32 条）の範囲で検討しうる。**取得したページ全文を他のユーザーに再配信・公開共有すること**や、**Decision Brief の共有リンクで原文を大量に転載すること**はリスクが高い。保存期間と共有範囲の設計を弁護士に確認すること。
- 海外のユーザー・サイトについては各国の法律（米国の fair use、EU の DSM 指令 TDM 例外とオプトアウトなど）が適用されうる。**未調査**。

---

## 6. PDF / OCR / Vision

### 6.1 pdfjs-dist（Node での利用）

- Node では `pdfjs-dist/legacy/build/pdf.mjs` から `getDocument` を import して、メタデータとテキスト（`getTextContent`）を取得する例が公式リポジトリにある **[直接]** https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs
- pdfjs-dist 6.4.299 は Node `>=22.13.0 || >=24` が必要で、ページを画像にレンダリングするには optional の `@napi-rs/canvas` を使う **[直接]**（npm registry）。プロジェクトの `engines.node: ">=22"` は 22.13 未満を許してしまうので、揃えることを推奨。
- テキストを持つ PDF は OCR せずに pdf.js でテキストを抽出し、テキストがない（スキャン）ページだけ画像化して OCR に回す。tesseract.js の FAQ も「PDF はサードパーティのライブラリで画像化してから認識する」と案内している **[直接]** https://github.com/naptha/tesseract.js/blob/master/docs/faq.md

### 6.2 tesseract.js の日本語精度

- 公式の日本語精度ベンチマークは**見つからなかった（未確認）**。
- 既知の注意点（tesseract-ocr の issue など、[検索経由]）:
  - 縦書きは `jpn_vert` が必要。`jpn` と `jpn_vert` を `+` で併用すると縦書きを横方向に読んで失敗する、という報告がある（https://github.com/tesseract-ocr/tesseract/issues/4128 、https://github.com/tesseract-ocr/tessdata/issues/76 ）
  - スクリーンショット（UI 文字、小さなフォント、背景色）は前処理（拡大・2 値化）しないと精度が落ちやすい（一般的な知見であり、Selequo のデータでは未検証）
- 推奨: tesseract.js はオフラインでも使える低コストのフォールバックと位置づける。精度が重要な日本語のスクリーンショットは、Vision LLM（§4）またはクラウド OCR と比較評価してから選ぶ。評価用のフィクスチャ（fixtures/）で CER を測ること。

### 6.3 クラウド OCR の料金（確認日: 2026-10-04）

| サービス | 単価 | 日本語 | 出典 |
|---|---|---|---|
| Google Cloud Vision（Text / Document Text Detection） | 毎月最初の 1,000 units は無料、1,001〜5,000,000 は **$1.50 / 1,000 units**、5,000,001 以上は $0.60 / 1,000 | 対応（言語一覧は未確認） | **[直接]** https://cloud.google.com/vision/pricing |
| AWS Textract（DetectDocumentText） | 最初の 100 万ページまで $0.0015/ページ（$1.50 / 1,000）、それ以降は $0.0006（US West, Oregon） | **非対応**（FAQ では英・仏・独・伊・葡・西のみ。縦書きも非対応） | [検索経由] https://aws.amazon.com/textract/pricing/ , https://aws.amazon.com/textract/faqs/ |
| Azure Document Intelligence（Read） | 0〜1M ページは $1.50 / 1,000 ページ、1M 超は $0.60 / 1,000。prebuilt 系（請求書など）は約 $10 / 1,000 | 対応（言語一覧は未確認） | [検索経由] https://azure.microsoft.com/en-us/pricing/details/document-intelligence/ （値は Microsoft Q&A の要約経由のため**要再確認**） |

→ 日本語が必要なので **AWS Textract は候補から外れる**。Google Vision または Azure Read と、LLM Vision（Claude の画像入力では 1000×1000 画像を Haiku 4.5 で約 $1.30 / 1000 枚）の比較になる。

---

## 7. OpenAI Plugin / MCP

### 7.1 Model Context Protocol 仕様

- **最新の仕様バージョン: `2026-07-28`**（2026 年 7 月 28 日リリース）。過去の版は `2024-11-05`、`2025-03-26`、`2025-06-18`、`2025-11-25`、ほかに `draft`。**[直接]** https://github.com/modelcontextprotocol/modelcontextprotocol （docs/docs.json、docs/specification/2026-07-28/）、告知: https://blog.modelcontextprotocol.io/posts/2026-07-28/ [直接]（確認日: 2026-10-04）
- **2026-07-28 版の主な変更（changelog [直接]）**:
  - **ステートレス化**: `initialize` ハンドシェイクと `Mcp-Session-Id` を廃止。各リクエストの `_meta` にプロトコルバージョンとクライアントの capabilities を入れる。`server/discover` RPC を追加（サーバーは実装が必須）
  - **Multi Round-Trip Requests（MRTR）**: サーバーから開始するリクエスト（sampling / elicitation / roots/list）を置き換え、`InputRequiredResult` で追加入力を要求する
  - `subscriptions/listen` で HTTP GET エンドポイントを置き換え。SSE の再開（Last-Event-ID）を廃止
  - list 系の結果に `ttlMs` / `cacheScope` が必須に。Streamable HTTP では `Mcp-Method` / `Mcp-Name` ヘッダが必須に
  - tasks は公式拡張（`io.modelcontextprotocol/tasks`）へ移動
  - **非推奨**: Roots / Sampling / Logging（少なくとも 12 か月は機能する）、旧 HTTP+SSE トランスポート（1 年の移行期間）
- **トランスポート [直接]**（basic/transports/index.mdx）: 標準は 2 つ。
  1. **stdio**: クライアントが起動したサブプロセスの標準入出力で、改行区切りのメッセージをやり取りする
  2. **Streamable HTTP**: 1 つの MCP エンドポイントへ各メッセージを POST し、応答は JSON または request 単位の SSE ストリームで返る
- **認可 [直接]**（basic/authorization/index.mdx）: 認可は **OPTIONAL**。HTTP 系では **OAuth 2.1**（draft-ietf-oauth-v2-1-13）に準拠し、MCP サーバーは OAuth 2.1 のリソースサーバーとして振る舞う。**Protected Resource Metadata（RFC 9728）は MUST**、Client ID Metadata Documents は SHOULD、**Dynamic Client Registration（RFC 7591）は MAY で、非推奨扱い**。RFC 8707（Resource Indicators）と RFC 9207（`iss` の検証）を参照する。stdio トランスポートではこの認可仕様に従うべきではない（SHOULD NOT。環境変数などから認証情報を取る）。

### 7.2 TypeScript SDK

- `@modelcontextprotocol/sdk` **1.32.0**（MIT、2026-10-02）= **v1 系**
- **v2 系（安定版）= `@modelcontextprotocol/server` / `@modelcontextprotocol/client` 2.3.0（Apache-2.0）。2026-07-28 版の仕様を実装している。** v1.x は v2 リリースから少なくとも 6 か月は、バグ修正とセキュリティ更新が続く。Fastify 用のミドルウェア `@modelcontextprotocol/fastify` もある。スキーマは Standard Schema（Zod v4 に対応）。**[直接]** https://github.com/modelcontextprotocol/typescript-sdk （README）
- → Selequo（現在 `@modelcontextprotocol/sdk ^1.32.0`）は、**v2 へ移行するか、どの仕様バージョンをサポートするかを決める必要がある**。v1.32 が 2026-07-28 版に対応しているかは**未確認**（v1 系はおそらく 2025-11-25 版までと推測されるが、未検証）。

### 7.3 ChatGPT（Apps SDK / developer mode / Plugins）

[検索経由]（OpenAI のドメインは遮断）、確認日: 2026-10-04

- **Apps SDK**: MCP の上に構築され、ChatGPT 内で動くアプリのロジックと UI を作れる。https://openai.com/index/introducing-apps-in-chatgpt/ 、https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt
- 2026-02-22 時点で、ChatGPT は **MCP Apps 仕様（MCP の公式拡張、UI リソース）に完全対応**したとされる
- **developer mode**: MCP クライアントとして、読み書き両方のツールを完全にサポートする。対応プロトコルは SSE と streaming HTTP。認証は OAuth / 認証なし / Mixed。Business / Enterprise / Edu は管理者が有効化する。Pro は read/fetch 権限に制限。https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt 、https://developers.openai.com/api/docs/guides/developer-mode
- **2026-07-09 に App directory が "Plugin directory" へ移行。** 新しい「Plugin」は skills・apps・app templates をまとめたもので、ChatGPT と Codex で共通に使われる（https://developers.openai.com/plugins/changelog 、https://developers.openai.com/plugins/quickstart ）。
- **旧 "ChatGPT plugins"（2023 年の ai-plugin.json 方式）は廃止済み**: 2024-03-19 に新規インストールと新規会話ができなくなり、2024-04-09 に既存の会話も継続不可になった（https://community.openai.com/t/plugin-store-and-new-chats-with-plugins-closed-march-19-2024/689877 、OpenAI Developer Community。公式ヘルプ記事は未確認）。**「Plugin」という名前が 2026 年に別の概念として再利用されている**ので、ドキュメントで用語を混同しないこと。

### 7.4 Codex の MCP 対応

[検索経由] https://developers.openai.com/codex/mcp 、https://developers.openai.com/codex/config-reference

- `~/.codex/config.toml`（またはプロジェクトの `.codex/config.toml`、信頼済みのプロジェクトのみ）に `[mcp_servers.<name>]` を書く
- stdio の場合は `command` / `args` / `env` / `cwd`、Streamable HTTP の場合は `url`、`bearer_token_env_var`、`auth`（既定は oauth）を指定する。`startup_timeout_sec`（既定 10 秒）、`tool_timeout_sec`（既定 60 秒）

### 7.5 Claude の MCP 対応

- **カスタムコネクタ（リモート MCP）**: Claude / Cowork / Claude Desktop で、Free・Pro・Max・Team・Enterprise のすべてのプランが対象。接続は Anthropic のクラウドから行うため、サーバーは**公開インターネットから到達できる必要がある**。認証は OAuth または固定のリクエストヘッダ（API キーなど）。[検索経由] https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp 、https://claude.com/docs/connectors/custom/remote-mcp
- **Messages API の MCP connector [直接]** https://platform.claude.com/docs/en/agents-and-tools/mcp-connector : beta、ヘッダは `mcp-client-2025-11-20`（旧 `mcp-client-2025-04-04` は非推奨）。MCP クライアントを実装せずにリモート MCP のツールを呼べる。OAuth Bearer トークンに対応。ZDR の対象外。Bedrock / Google Cloud では使えない。
- Claude Code の MCP: https://code.claude.com/docs/en/mcp （[検索経由]）
- ディレクトリへの掲載申請: https://claude.com/docs/connectors/building/submission （[検索経由]）

---

## 8. ホスティング / コスト参考（単価のみ）

確認日: 2026-10-04。Cloudflare 以外はすべて **[検索経由]**（公式ページへの直接取得は遮断）。契約前に必ず公式ページで再確認すること。

| 区分 | サービス | 主な単価 | 出典 |
|---|---|---|---|
| アプリ | Render | Web service: Starter $7/月、Standard $25/月（1 vCPU / 2 GB）。Postgres は 2024-10 以降、compute とストレージを分けて課金するプランに移行（旧 Starter $7 / Standard $20 はレガシー） | https://render.com/pricing , https://render.com/docs/postgresql-legacy-instance-types |
| アプリ | Fly.io | shared-cpu-1x 256MB = $2.19/月（$0.0030/時）、RAM は $6/GB/月相当、Volume $0.15/GB/月（プロビジョニング量で課金）、egress は北米・欧州 $0.02/GB、アジア太平洋 $0.04/GB | https://fly.io/docs/about/pricing/ |
| アプリ | Railway | Hobby $5/月（$5 分の利用を含む）、Pro $20/月。RAM $10/GB/月、CPU $20/vCPU/月（秒単位で課金） | https://docs.railway.com/pricing/plans |
| アプリ / ブラウザ | Cloudflare Workers Paid | 月 $5（Workers Paid プラン。Containers の説明文より）。Browser Run は §5.3 を参照 | **[直接・公式ドキュメント検索]** https://developers.cloudflare.com/workers/platform/pricing/ |
| Postgres | Neon（Launch） | compute $0.106 / CU 時、ストレージ $0.35 / GB 月、月額の最低料金なし | https://neon.com/pricing |
| Postgres | Supabase（Pro） | $25/月。Compute Credits $10 を含む（Micro 1 台分）。ディスクは 8GB/プロジェクト込みで超過は $0.125/GB。egress 250GB 込みで超過は $0.09/GB。File storage 100GB 込み | https://supabase.com/pricing , https://supabase.com/docs/guides/platform/billing-on-supabase |
| オブジェクトストレージ | Cloudflare R2 | Standard: $0.015 / GB 月、Class A $4.50 / 100 万、Class B $0.36 / 100 万、**egress 無料**。無料枠は 10GB 月、A 100 万、B 1,000 万（ページの最終更新 2026-10-01） | **[直接・公式ドキュメント検索]** https://developers.cloudflare.com/r2/pricing/ |
| オブジェクトストレージ | AWS S3 Standard | 最初の 50TB は $0.023 / GB 月、PUT 等は $0.005 / 1,000、GET は $0.0004 / 1,000、インターネットへの転送は月 100GB まで無料（全サービス合算） | https://aws.amazon.com/s3/pricing/ |

→ 初期構成の参考として、Render または Fly でアプリを動かし、Neon / Supabase、R2（egress 無料なので添付ファイルの配信に向く）を組み合わせる案がある。PGlite を単一インスタンスで使う構成なら、永続 Volume（Fly の Volume や Render の Disk）が必要になる。**Render の Disk の単価は未確認。**

---

## 9. 未確認事項 / リリース前に人間が確認すべきこと

### 9.1 名称・法務
- [ ] 商標（J-PlatPat / USPTO / EUIPO / WIPO）、App Store / Google Play、ドメイン（selequo.com / .app / .jp）、SNS ハンドル（§1.2）
- [ ] 類似名 seleqo.com（売却中のブランドドメイン）、Selequa、Serquo との混同の可能性
- [ ] URL 取得・抽出結果の保存と共有の、日本の著作権法（第 30 条の 4、第 47 条の 5、第 32 条）上の整理。海外法の適用（弁護士に確認）
- [ ] 利用規約、プライバシーポリシー、特商法表記。AI サブプロセッサ（OpenAI / Anthropic / Google）の開示

### 9.2 AI プロバイダ
- [ ] **OpenAI の料金（GPT-6.x Sol / Luna / Astra、text-embedding-3-large、画像の乗数）を公式ページで直接再確認**（今回は検索要約のみ）
- [ ] OpenAI API の保持（30 日）と、NYT 訴訟のデータ保全命令が 2026-10 時点で API データに影響するかどうか
- [ ] Anthropic API の既定の保持期間（docs の「既定では保持しない（Covered Models を除く）」と privacy center の「30 日」の関係）
- [ ] ZDR が必要か、申請手続き（Anthropic: 営業経由・組織単位、OpenAI: 適格ユースケース）
- [ ] Gemini の料金（3.8 Flash は 2027-01-01 に値上がり予定）と、有料枠で学習に使われないことの規約上の確認
- [ ] 埋め込みモデルの選定（Anthropic には提供なし）

### 9.3 技術・ライセンス
- [ ] MCP SDK の v1（MIT、`@modelcontextprotocol/sdk` 1.32.0）から v2（Apache-2.0、`@modelcontextprotocol/server` 2.3.0、仕様 2026-07-28）へ移行するかの判断。v1.32 が対応する仕様バージョンの確認
- [ ] TypeScript 5.9.3 → 7.x、react-router 7 → 8、Playwright 1.56.1 → 1.63.0 の更新方針
- [ ] `engines.node` を `>=22.13.0` に揃える（pdfjs-dist の要件）
- [ ] PGlite（Alpha 表記）を本番で使ってよいか。PGlite で pg_trgm / pgvector が使えるか
- [ ] tesseract.js の traineddata をセルフホストするか、ライセンス表記（Apache-2.0 と npm 上の MIT の食い違い）の扱い。日本語・スクリーンショットでの実測精度（CER）
- [ ] Playwright のブラウザバイナリ（Chromium / Firefox / WebKit）の第三者ライセンスと NOTICE（Docker で配布する場合）
- [ ] フォント: Noto Sans JP（OFL、Reserved Font Name "Source"）、IPA を使う場合は IPA フォントライセンス v1.0 の条件
- [ ] 全依存の THIRD_PARTY_NOTICES を自動生成する（例: `license-checker` 系。ツールは未選定）

### 9.4 取得・インフラ
- [ ] RFC 9309 本文の直接確認（4xx の扱い、最長一致、"not access authorization" の文言）
- [ ] Browserless のドル建て料金（公式）、Cloudflare Browser Run の現行料金ページ
- [ ] Azure Document Intelligence と Google Vision の日本語対応、最新の料金（Azure は Q&A 経由の数値）
- [ ] Render / Fly / Railway / Neon / Supabase / S3 の料金を公式ページで直接再確認（今回は検索要約のみ）。Render Disk の単価
- [ ] CAPTCHA の回避・ペイウォールの迂回をしないことを、実装とテストで担保する（ボット対策ページを検出したら Unknown にする）
