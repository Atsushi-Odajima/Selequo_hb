# MCP_PLUGIN — MCP サーバと外部 AI クライアント連携

Selequo は MCP（Model Context Protocol）サーバを内蔵しており、Claude・Codex・ChatGPT などの MCP クライアントから、比較の閲覧と材料の追加ができる。**候補を選ぶ・判断を確定するツールは提供しない。**

関連ファイル: `src/mcp/tools.ts`（ツール定義）, `src/mcp/http.ts`（Streamable HTTP エンドポイント）, `src/mcp/stdio.ts`（stdio ブリッジ）, `src/server/services/accounts.ts`（API トークン）, `tests/mcp.test.ts`

## 1. 構成

```
MCP クライアント ──(Streamable HTTP, Authorization: Bearer slq_…)──▶  POST /mcp  (Selequo サーバ)
ローカル MCP クライアント ──(stdio)──▶ src/mcp/stdio.ts ──(Streamable HTTP)──▶ POST /mcp
```

- SDK: `@modelcontextprotocol/sdk` **^1.32.0**（v1 系。インストール済みは 1.32.0）。`McpServer.registerTool` と `StreamableHTTPServerTransport` を使っている。
- サーバ名は `selequo`、バージョンは `config.appVersion`。サーバの instructions: 「Selequo comparison tools. Facts carry citations; Unknown is not zero; tools never choose a candidate for the user.」

## 2. ツール一覧

すべてのツールは、トークンが属するワークスペースの中だけで動く。「必要ロール」はサービス層の `need()` による（DATA_MODEL.md §4）。

| ツール | 分類 | 入力 | 処理 | 必要ロール |
|---|---|---|---|---|
| `search_comparisons` | read | `query`(1–200), `projectId?` | プロジェクト・候補・ソース・Fact・質問・判断の全文検索 | メンバー |
| `create_comparison` | write | `title`, `purpose?`, `category?`（laptop, saas など）, `currency?`(ISO 3 文字) | プロジェクトを作成（カテゴリ別の既定属性も作る） | Editor |
| `add_candidate` | write | `projectId`, `name`, `provider?`, `url?` | 候補を追加。常に `considering` で作る | Editor |
| `add_source` | write（openWorld） | `projectId`, `candidateId`, `url?` または `text?`, `title?`, `quality?` | URL（サーバが robots.txt を守って取得）または貼り付けテキストを追加。抽出された Fact は**レビュー待ちの候補**になる | Editor |
| `get_compare_table` | read | `projectId`, `scenarioId?` | 候補 × 属性の表（status: value/unknown/conflict, verified, factIds, sourceAgeDays）、scores、statement、caveats | メンバー |
| `get_missing_information` | read | `projectId` | Unknown のセル、Must-have が Unknown の候補、Conflict、未確認の値、未解決の質問の数 | メンバー |
| `get_conflicts` | read | `projectId` | Conflict ごとに、各 Fact の値・ソース名・品質・取得日時 | メンバー |
| `set_criteria` | write | `projectId`, `name`, `weight`(0–100), `direction`, `linkedAttributes`(≤10), `mustHave?`, `target?` | Criteria を**新しく作る**（既存の Criteria の更新はしない）。Weight はユーザーが決めた値を記録するだけ | Editor |
| `compare_scenarios` | read | `projectId` | 既定と全 Scenario のスコア、`resultsDiffer` | メンバー |
| `get_evidence` | read | `factId` | Fact、ソース（`fileKey` は除く。署名付き `fileUrl` は相対パスで 5 分有効）、原文の前後、Conflict の有無、同じ属性の他の Fact | メンバー |
| `ask_research_assistant` | read | `projectId`, `preset?`(big_differences / missing / no_official_source / weaknesses_besides_price / conflicts), `question?` | 引用付きの回答。自由質問は AI が有効なときだけ AI を使い、引用は渡したコンテキスト内の ID に限る（無効な引用は捨てる）。AI が OFF なら関連する Fact を出典付きで並べる | メンバー |
| `generate_decision_brief` | write | `projectId` | Brief を新しい版として保存し、`{briefId, version, markdown}` を返す。人の判断があれば写すが、判断は作らない | Editor |

- 分類はツールの `write` フラグで、MCP の annotations に `readOnlyHint: !write`、`destructiveHint: false`、`add_source` だけ `openWorldHint: true` として出す。
- `ask_research_assistant` は read に分類しているが、監査ログ（`assistant.ask`）と AI 利用台帳（`ai_calls`）には書き込む。
- エラーは JSON-RPC のエラーではなく、`isError: true` と `Error: <メッセージ>` のテキストとして返す。結果は `JSON.stringify(result, null, 2)` のテキストとして返す。

### `choose_candidate` を意図的に提供しない
- 候補の選択・判断の確定・勝者の決定にあたるツールは存在しない。`FORBIDDEN_TOOL_PATTERNS = [/choose/i, /decide/i, /select_winner/i, /pick/i, /winner/i]` に一致するツール名がないこと、`choose_candidate` がないことを `tests/mcp.test.ts` で確認している。
- サービス層でも二重に防いでいる。トークン経由（`actor.type = 'token'`）では、候補を `chosen` にする変更と、Decision の `finalize` を拒否する（DECISION_BRIEF.md §6）。
- Fact の Confirm/Reject、Scenario の CRUD、Weight の一括変更、Decision の操作を行うツールもない（REST API にはある）。

## 3. 認証と認可（API トークン）

| 項目 | 実装 |
|---|---|
| 作成 | 画面の「ワークスペース設定 → APIトークン（MCP連携）」（`src/web/pages/WorkspaceSettings.tsx`）、または `POST /api/w/:ws/tokens {name, scopes}`。**ログインユーザーだけ**が作成できる（トークンでトークンは作れない） |
| 形式 | `slq_` + ランダム値。平文は作成時に 1 回だけ表示し、DB には sha256 を保存する |
| スコープ | `read` / `write`。Viewer は write スコープのトークンを作れない |
| ワークスペース | 作成したワークスペースに固定。他のワークスペースのデータは見えない（テストで確認している） |
| ロールの上限 | リクエストのたびに作成者の**現在の**ロールを `memberships` から引き直す。ロールが下がればトークンの権限も下がり、メンバーから外れればトークンは失効する |
| 書き込みの判定 | (1) MCP 層: `write` ツールは write スコープが必要、(2) サービス層: `need()` が Viewer より上の操作に write スコープとロールを要求する |
| 失効 | `DELETE /tokens/:id`（本人、または Admin 以上）。`last_used_at` を使うたびに更新する |
| OAuth 2.1 | **未実装**。静的な Bearer トークンのみ |

## 4. HTTP エンドポイント（`/mcp`）

- **Streamable HTTP、ステートレス**: リクエストごとに `McpServer` とトランスポートを作り直す（`sessionIdGenerator: undefined`、`Mcp-Session-Id` を発行しない）。`enableJsonResponse: true`（SSE ではなく JSON で応答）。
- 認証: `Authorization: Bearer <token>`。ない／無効なら 401 と `WWW-Authenticate: Bearer realm="selequo"`、JSON-RPC エラー `-32001`。
- 認証後、`POST` 以外（GET/DELETE）は 405（`Allow: POST`、ステートレスのため）。
- レート制限: `/mcp` は 1 分あたり 300 リクエスト。
- Cookie セッションと CSRF は使わない。

## 5. stdio ブリッジ（`src/mcp/stdio.ts`）

ローカルのサブプロセスとして起動し、stdio で受けた `tools/list` と `tools/call` を、リモートの `/mcp` に Streamable HTTP で中継する（resources / prompts は中継しない。サーバ側にもない）。

| 環境変数 | 内容 |
|---|---|
| `SELEQUO_URL` | Selequo のベース URL（既定 `http://localhost:8787`）。`/mcp` を付けて接続する |
| `SELEQUO_TOKEN` | API トークン（必須。なければ終了する） |

起動方法:
- 開発: `SELEQUO_URL=… SELEQUO_TOKEN=slq_… npm run mcp`（`tsx src/mcp/stdio.ts`）
- ビルド後: `npm run build` → `node dist/server/mcp/stdio.js`（esbuild の `--packages=external` でビルドするため、`node_modules` のあるリポジトリから実行する）

## 6. クライアントの設定例

以下は SOURCE_NOTES.md §7 と一般的な形式に基づく例である。**キー名やコマンドの正確な構文は、各クライアントの最新の公式ドキュメントで要確認。**

**Claude Desktop**（stdio ブリッジを使う。`claude_desktop_config.json`、要確認）
```json
{
  "mcpServers": {
    "selequo": {
      "command": "node",
      "args": ["/path/to/025-selequo/dist/server/mcp/stdio.js"],
      "env": { "SELEQUO_URL": "https://selequo.example.com", "SELEQUO_TOKEN": "slq_xxx" }
    }
  }
}
```

**Claude Code**（要確認）
```sh
# リモート（Streamable HTTP）
claude mcp add --transport http selequo https://selequo.example.com/mcp --header "Authorization: Bearer slq_xxx"
# stdio ブリッジ
claude mcp add selequo --env SELEQUO_URL=https://selequo.example.com --env SELEQUO_TOKEN=slq_xxx -- node /path/to/dist/server/mcp/stdio.js
```

**Codex**（`~/.codex/config.toml`、要確認。SOURCE_NOTES §7.4: `url` / `bearer_token_env_var`、stdio は `command` / `args` / `env`）
```toml
[mcp_servers.selequo]
url = "https://selequo.example.com/mcp"
bearer_token_env_var = "SELEQUO_TOKEN"

# stdio ブリッジを使う場合
# [mcp_servers.selequo]
# command = "node"
# args = ["/path/to/dist/server/mcp/stdio.js"]
# env = { SELEQUO_URL = "https://selequo.example.com", SELEQUO_TOKEN = "slq_xxx" }
```

**Claude のカスタムコネクタ（リモート MCP）**: 接続は Anthropic のクラウドから行うため、Selequo が**公開インターネットから到達できる**必要がある。認証は OAuth または固定のリクエストヘッダ（SOURCE_NOTES §7.5、検索経由の情報）。固定ヘッダで Bearer トークンを送れるかは要確認。

## 7. 監査

- write ツールはサービス層の `audit()` を通り、`audit_log` に `actor_type = 'token'`、`actor_id = トークン ID` で記録する（例 `candidate.create`, `source.add`, `criterion.create`, `brief.create`）。監査ログの一覧（`GET /audit`、Reviewer 以上）では、トークン名を actor 名として表示する。actor の表示名（手入力の引用 `by` などに使う）は、MCP 経由では `ユーザー名（MCP）`、REST の API トークン経由では `ユーザー名（APIトークン）` になる。
- AI の呼び出しは `ai_calls`（provider, purpose, 文字数）に記録する。
- 読み取りツール（`ask_research_assistant` 以外）は監査ログに記録しない。記録されるのはトークンの `last_used_at` だけ（将来、読み取りの監査を追加するか検討）。
- 取り込んだ文書の文字列（Evidence の原文の前後、値）はそのまま返す。クライアント側の LLM は、それを指示ではなく**信頼できないデータ**として扱う必要がある（ソースの `injectionFlags` も返している）。

## 8. 将来の作業

| 項目 | 内容 |
|---|---|
| SDK と仕様の移行 | SOURCE_NOTES §7.1/7.2: 最新の仕様は **2026-07-28**（`initialize` と `Mcp-Session-Id` の廃止、`server/discover` の必須化、Streamable HTTP での `Mcp-Method` / `Mcp-Name` ヘッダの必須化、list 結果の `ttlMs` / `cacheScope`、MRTR など）。これを実装しているのは **SDK v2**（`@modelcontextprotocol/server` / `client` 2.3.0、Apache-2.0、Fastify 用ミドルウェア `@modelcontextprotocol/fastify` あり）。現在の v1.32 がどの仕様版に対応しているかは**未確認**。v1 系は v2 リリース後少なくとも 6 か月は保守される。**v2 への移行と、対応する仕様版の決定は将来の作業**（SOURCE_NOTES §9.3） |
| OAuth 2.1 | リモートコネクタや ChatGPT 向けに、OAuth 2.1 のリソースサーバ化と Protected Resource Metadata（RFC 9728、HTTP で認可を行う場合は MUST）。**未実装** |
| ChatGPT | developer mode は MCP クライアントとして読み書きのツールに対応（SSE / streaming HTTP、認証は OAuth / なし / Mixed。検索経由の情報）。静的な Bearer トークンが使えない場合は OAuth が必要。Apps SDK / MCP Apps（UI リソース）での画面提供は**未実装** |
| 「Plugin」という用語 | 2026-07-09 に ChatGPT の App directory が「Plugin directory」に移行し、Plugin は skills・apps・app templates をまとめたもので ChatGPT と Codex で共通（検索経由）。**2023 年の旧 ChatGPT plugins（`ai-plugin.json`）は廃止済み**で、別の概念である。本書で「Plugin」と書くときは混同しないこと。Selequo 用の Plugin パッケージは**未作成** |
| ディレクトリへの掲載 | Claude のコネクタディレクトリ、OpenAI の Plugin directory への申請は未着手（要件は要確認） |
| ツールの拡充 | Scenario の作成、Weight の更新、Criteria の更新は現状 MCP にない。追加する場合も、判断・選択を行うツールは追加しない（`FORBIDDEN_TOOL_PATTERNS` のテストを維持する） |
