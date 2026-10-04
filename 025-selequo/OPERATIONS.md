# OPERATIONS — 運用手順

> 本番公開・有料契約は人間の承認後に行う。本書はその際の手順。

## 1. デプロイ構成（推奨）
- アプリ: Docker（`Dockerfile`）を Render / Fly.io / Cloud Run 等で1台以上。`HOST=0.0.0.0`、`PORT`。
- DB: マネージド PostgreSQL 15+（Neon / Supabase / RDS など）。`DATABASE_URL`。拡張 `pg_trgm` が必要（起動時に `CREATE EXTENSION IF NOT EXISTS`）。
- ファイル: 現状は Local Disk（`SELEQUO_DATA_DIR/files`）→ **永続ボリュームが必須**。複数台構成では S3 互換ストレージ実装が必要（未実装・NEXT_STEPS）。
- PDF 出力: Chromium が必要（`PDF_RENDERER=chromium`）。入れない場合は `PDF_RENDERER=none`（HTML をブラウザで印刷）。
- 必須環境変数: `NODE_ENV=production`、`SELEQUO_SECRET`（32文字以上）、`DATABASE_URL`、`PUBLIC_URL`。本番では `SELEQUO_FETCH_FIXTURES` を設定すると起動失敗（安全装置）。
- HTTPS 終端はプラットフォーム側。`trustProxy` は本番で有効。

## 2. 初回起動
1. `docker build -t selequo .` → 環境変数を設定して起動
2. `/api/health` が `{"ok":true}` を返すことを確認
3. 管理者アカウントを登録（`SIGNUP_ENABLED=true`）。運用方針によっては登録後に `SIGNUP_ENABLED=false`
4. サンプルデータは本番に投入しない（`seed:sample` は本番で実行拒否）。デモ用は別環境で。

## 3. ジョブ
- URL取得・抽出は `jobs` テーブルのキューを各アプリプロセスのワーカーが処理（Postgres では `FOR UPDATE SKIP LOCKED`）。失敗は最大3回リトライ（30秒間隔）。
- 監視: `SELECT status, count(*) FROM jobs GROUP BY status;` で滞留を確認。

## 4. バックアップ / リストア
- アプリ機能: 設定 → バックアップ（ZIP: manifest.json＋data.json＋files/、schemaVersion/appVersion/checksum）。Admin 以上。
- 復元: 設定 → 「バックアップから復元」→ 新しいワークスペースとして復元（ID振り直し・共有は OFF）。
- インフラ: マネージド Postgres の自動バックアップ（PITR）＋ファイルボリュームのスナップショットを日次で取得することを推奨。
- 復元訓練: 四半期に一度、空環境に ZIP を復元して比較結果が一致することを確認（自動テスト `tests/features.test.ts` と E2E 9 が同等の検証を実施）。

## 5. ログ・監視
- Fastify の JSON ログ（pino）。リクエストログにソース本文は含めない。
- 監視項目: 5xx 率、`jobs` の failed 件数、`sources.status='failed'` の増加、AI 呼び出し回数（`ai_calls`）、ディスク使用量。
- 監査ログ: アプリ内「設定 → 監査ログ」/ `audit_log` テーブル。

## 6. インシデント対応
- 秘密情報漏えいの疑い: `SELEQUO_SECRET` を再生成（全署名URLが失効）、API トークンを一括失効（`UPDATE api_tokens SET revoked_at = now()`）、セッション削除（`DELETE FROM sessions`）。
- 不正な共有: ワークスペース設定で共有を OFF（既存リンクは即時失効）。
- AI 送信を即時停止: 環境変数 `AI_PROVIDER=none` で再起動、または各ワークスペースで AI OFF。

## 7. データ削除依頼
- ソース単位: 画面から削除（ファイル・本文・Fact・索引も削除）。
- プロジェクト単位: プロジェクト設定 → 削除（Admin）。
- アカウント単位: 現状は運用者が DB で対応（ユーザー削除 → メンバーシップ・セッション・トークンが CASCADE）。セルフサービス化は NEXT_STEPS。

## 8. 招待
- 招待リンクを画面で発行（7日間有効）。**メール送信機能はない**ため、管理者が安全な経路で共有する。
