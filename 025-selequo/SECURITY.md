# SECURITY — Selequo セキュリティ設計

## 1. 認証・セッション
- メール＋パスワード（scrypt N=16384, r=8, p=1, 32byte, ソルト16byte）。`src/server/auth/crypto.ts`
- セッション: ランダム32byteトークンを HttpOnly / SameSite=Lax / 本番 Secure の Cookie に格納。DB には sha256 のみ保存。有効期限14日。
- CSRF: Cookie 認証の非GETリクエストはセッション固有の `x-csrf-token` ヘッダ必須（multipart の取込・リストア含む）。Bearer トークン認証は CSRF 対象外（Cookie を使わないため）。
- ログイン失敗時もダミー検証を実行し、ユーザー存在の推測を困難にする。認証系は 20 req/分/IP のレート制限。
- 未実装: MFA、SSO（Pro候補）、パスワードリセットのメール送信（現状は管理者対応）。

## 2. 認可（RBAC）とテナント分離
- ロール: Owner > Admin > Editor > Reviewer > Viewer（`need(ctx, role)`）。Owner/Admin の付与・剥奪は Owner のみ。最後の Owner は降格不可。
- 全テナントデータに `workspace_id` を持ち、サービス層の全クエリで `workspace_id` を条件に含める（`getProjectRow` / `assertInProject`）。他テナントの ID を指定しても 404（存在を開示しない）。
- 本文中で参照される ID（candidateId / sourceId / factId / scenarioId 等）は同一プロジェクトに属するか検証。
- API トークン: ワークスペースに束縛、scope（read/write）、所有ユーザーの**現在の**ロールを超えない。メンバー削除時に失効。
- 共有リンク（ゲスト閲覧）: ワークスペース設定で既定 OFF。OFF にすると既存リンクを即時失効。閲覧専用（viewer + read scope）、期限付き（最大90日）。

## 3. URL 取得（SSRF 対策）`src/server/import/ssrf.ts`, `fetcher.ts`
- http/https のみ、認証情報付き URL 拒否、許可ポートのみ（既定 80/443）。
- localhost / *.internal / *.local / metadata ホスト名を拒否。数値形式ホスト（10進/16進）を拒否。
- DNS 解決結果の**全アドレス**を検査（RFC1918、ループバック、リンクローカル 169.254/16＝メタデータ、CGNAT、予約、マルチキャスト、IPv6 ULA/リンクローカル、IPv4 射影/NAT64 形式）。
- 検証済みアドレスに接続を固定（undici `connect.lookup`）して DNS リバインディングを防止。リダイレクトは手動で最大3回、毎回再検証。
- サイズ上限（既定5MB）・タイムアウト10秒・ホスト単位の間隔制御・robots.txt（RFC 9309）準拠・CAPTCHA/ペイウォール/ログイン要求ページは取得失敗として扱い**回避しない**。
- 開発用フィクスチャ（`*.selequo.invalid`）は本番では起動時にエラーで拒否。

## 4. ファイル
- アップロードはマジックバイトで判定（PDF/PNG/JPEG/WebP/UTF-8テキスト）。クライアント申告の MIME は信用しない。上限 20MB。
- 保存キーはサーバ生成（ワークスペース/プロジェクト/ハッシュ）。キーの形式検証とパス正規化でトラバーサルを防止。
- ダウンロードは5分有効の HMAC 署名 URL。削除済みソースのファイルは 404。保存した HTML は `text/plain` として返し実行させない。`CSP: sandbox`、`nosniff` を付与。
- バックアップ ZIP: エントリ名を検証（`files/` 配下の安全なキーのみ、`..` 拒否）、エントリ数・展開サイズ上限（zip bomb 対策）、data.json の sha256 チェックサムと各ファイルの sha256 を検証。復元は新規ワークスペースへ ID を振り直して投入（既存データと衝突しない）。

## 5. インジェクション対策
- SQL: すべてパラメータ化クエリ。テーブル名・列名を組み立てる箇所（バックアップ/インポート）は固定リストと `[^a-z_]` 除去で制限。
- XSS: React の自動エスケープ。`dangerouslySetInnerHTML` 不使用。Decision Brief の HTML 出力は全値をエスケープし、http/https 以外の URL はリンク化しない。HTML 出力のダウンロードには `CSP: default-src 'none'; sandbox`。
- CSV 出力: `= + - @ \t \r` で始まるセルに `'` を付与（数式インジェクション対策）。
- プロンプトインジェクション: 取り込んだ文書は**データ**として扱う。指示文らしき行を検出してフラグ表示し、その行からは抽出しない。AI には区切りタグ内の未信頼データとして渡し、出力はスキーマ検証＋原文との照合（grounding）を通ったもののみ候補 Fact にする。AI は状態を変更する権限を持たない（候補の選択・Confirm は人のみ）。

## 6. HTTP セキュリティヘッダ
`@fastify/helmet`: CSP（`default-src 'self'`、`script-src 'self'`、`frame-ancestors 'none'`、`object-src 'none'`）、HSTS（本番）、nosniff、COOP/CORP。グローバルレート制限 600 req/分/IP。

## 7. シークレット
- `SELEQUO_SECRET`（32文字以上、本番必須）、`DATABASE_URL`、`ANTHROPIC_API_KEY` は環境変数のみ。リポジトリ・ログに含めない（`.env` は .gitignore 済み）。
- API トークン・招待トークン・共有トークン・セッションは DB にハッシュのみ保存。発行時に一度だけ表示。

## 8. プライバシー
- AI 送信範囲: Workspace / Project / Source の3段階で OFF にでき、OFF 時は送信0件（E2E/結合テストで検証）。送信対象はAIを許可したソース本文・スクショ画像・Assistant の質問と関連 Fact のみ。
- 分析（Analytics）にソース本文は使わない（本アプリは外部アナリティクスを組み込んでいない）。
- 削除: ソース削除で ファイル・抽出テキスト・Fact・価格スナップショット・検索インデックス・埋め込みを削除。プロジェクト削除で配下を全削除。

## 9. 監査ログ
Source追加/削除、Fact Confirm/Reject/Supersede、正規化ルール、Criteria/Weight/Must-have、Scenario、Decision/振り返り、Brief作成/出力、共有、ロール変更、トークン、バックアップ/リストア、AI設定変更、Assistant利用を `audit_log` に記録（実行者・API/MCPトークンを区別）。

## 10. 既知の制限・今後
- WAF / Bot 対策、MFA、SSO、監査ログの改ざん防止（追記専用ストレージ）は未実装。
- レート制限はプロセス内メモリ（複数台構成では Redis 等の共有ストアが必要）。
- 本番前に第三者によるペネトレーションテストを推奨（RELEASE_CHECKLIST）。
- セキュリティレビュー結果は TEST_REPORT.md に記載。
