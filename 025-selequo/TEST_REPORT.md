# TEST_REPORT — Selequo #025

- 実施日: 2026-10-04 ／ 環境: Linux, Node v22.22.0, PGlite 0.5.8, Chromium 1194（Playwright 1.56.1）
- コマンド: `npm run typecheck`（エラー0）／ `npm test`（**56/56 passed**）／ `npm run test:e2e`（**12/12 passed**）
- 外部サイトへのアクセスは行っていない（URL取得は架空フィクスチャ `*.selequo.invalid` を使用）。AI は `MockProvider`（決定的）で検証し、実AI APIは呼んでいない。

## 1. 必須テスト（プロンプト §22）対応表

| 必須項目 | テスト（ファイル › テスト名） | 結果 |
|---|---|---|
| tenant分離 | security › isolates workspaces (projects, search, files, tokens)／regression-security › import/restore cannot reach other tenants（2件）／mcp › cannot reach another workspace | ✅ |
| SSRF | security › SSRF protection（4件: private/metadata/IPv4射影、スキーム/認証情報/ポート/数値ホスト、DNSリバインディング、ジョブ失敗）／IPv6 埋め込みIPv4形式 | ✅ |
| PDF page citation | features › cites PDF page numbers（p.2）／normalize › cites PDF page numbers | ✅ |
| Screenshot relation | features › relates a phone screenshot to a candidate and cites an image region | ✅ |
| AI Fact Candidate | features › AI facts are candidates, must be grounded… | ✅ |
| Confirm/Reject | features › confirm / reject with rules（Opinion・削除済みソースは Confirm 不可、監査記録） | ✅ |
| unit normalization | normalize › maps "16 GB" and "16GB RAM"…／converts 1TB to 1024GB／g→kg | ✅ |
| 誤merge防止 | normalize › does not merge different meanings（GPUメモリ、VRAM、バッテリー容量/駆動時間、単位次元違い、範囲値）／features › …keeps GPU memory separate | ✅ |
| Missing≠0 | normalize › keeps Unknown distinct from zero／features › shows Unknown (not 0) for missing battery life | ✅ |
| Must-have Unknown | features › criteria, must-have Unknown (not Fail)…／E2E 4 | ✅ |
| Conflict保持 | features › keeps conflicts with both sources／Superseded として保持／E2E 2 | ✅ |
| price timestamp | features › keeps price snapshots with timestamps (history) and separates tax mode | ✅ |
| monthly/annual区別 | normalize › distinguishes monthly / annual / per-seat / tax／never compares monthly vs annual…／features › SaaS…／E2E 3 | ✅ |
| Weight validation | features › criteria…（負値・全0・100超を 400）／Scenario の不正Weight | ✅ |
| Score再現 | features › scores are reproducible (same input → same output) | ✅ |
| Scenario別結果 | features › …scenarios change results（Travel→Air、Performance→Pro、Budget→Lite）／E2E 3 | ✅ |
| Evidence source | features › cites PDF page numbers（originalContext）／mcp › get_evidence | ✅ |
| Opinion/Fact分離 | features › separates opinions from facts… | ✅ |
| Question | features › questions are linked to candidates with status / answer / source | ✅ |
| AI citation | features › research assistant answers with citations／AI guard（偽引用を破棄） | ✅ |
| Winner自動確定禁止 | features › decision record: human decides…（トークンで確定・chosen 不可）／statement に winner/おすすめ なし／mcp › no automatic decision tool | ✅ |
| deleted index削除 | features › deleting a source removes file, facts and search index entries | ✅ |
| AI OFF | features › AI OFF → zero provider calls（Workspace/Project/Source）／E2E 6 | ✅ |
| prompt injection | normalize › treats prompt injection as data…／features › …flags prompt injection without obeying it | ✅ |
| mobile pair compare | E2E devices › pair compare, bottom nav…（iPhone 13 / Pixel 7 / iPad Pro 11 エミュレーション） | ✅（実機は未実施） |
| Export/import | features › export → import a project…／regression › 決定は取り込まない | ✅ |
| Backup/Restore | features › …backup → restore into an empty environment with identical relations／security › rejects path traversal and tampered checksums／E2E 9 | ✅ |
| MCP権限 | mcp › requires a bearer token／enforces scopes／cannot reach another workspace／audits MCP actions | ✅ |
| Audit | security › RBAC（member.role）／features › 各操作の監査（fact.*, criterion.*, scenario.create, conflict.resolve 等） | ✅ |

追加: RBAC 5ロール、CSRF、アップロードのマジックバイト検証、セキュリティヘッダ、XSS（Brief HTML）、CSV数式インジェクション、Brief 5形式出力（PDF含む）、ログインのレート制限（Cookie偽装でも回避不可）、性能（純粋エンジン 3,600 Fact で比較 約30〜70ms）。

## 2. E2E（プロンプト §23）

| # | シナリオ | 結果 |
|---|---|---|
| 1 | 3候補 URL/PDF/Screenshot → 抽出 → 正規化 → 比較 → 不足情報 → Brief（すべてUI操作、MDダウンロード検証） | ✅ |
| 2 | 公式/販売サイトの Conflict → Review → 出典保持（Superseded として残る） | ✅ |
| 3 | SaaS 月額/年額/席数 → Scenario 比較（UIでScenario作成、結果が変わる） | ✅ |
| 4 | Must-have Unknown → 追加ソース → Pass | ✅ |
| 5 | iPhone でスクショ追加 → PC で画像領域を選んで記録 → Confirm | ✅ |
| 6 | AI OFF → プロバイダ呼び出し 0 回（対照: ON で 1 回） | ✅ |
| 7 | MCP「不足情報」→ 引用付き回答（読み取りトークンは書き込み不可） | ✅ |
| 8 | 判断を記録 → 90日後の振り返り | ✅ |
| 9 | Export（バックアップZIP）→ Restore → 関連の一致 | ✅ |
| + | 端末（iPhone 13 / Pixel 7 / iPad Pro 11）でペア比較・カード・横スクロールなし | ✅ |
| + | PWA（manifest・アイコン・SW が API を キャッシュしない） | ✅ |
| + | アクセシビリティ基本（全入力にラベル、ランドマーク、キーボードでEvidence開閉） | ✅ |

## 3. 内部セキュリティレビュー（2026-10-04）と修正

独立したレビュー（敵対的視点・実際に攻撃を再現）で見つかった項目と対応:

| 重大度 | 指摘 | 対応 | 回帰テスト |
|---|---|---|---|
| Critical | プロジェクトインポート／バックアップ復元で他テナントの行・ファイルキーを参照するIDを埋め込み、本文の読み取り・ファイルのダウンロード/削除/上書きが可能 | テーブル別の列許可リスト、全参照列が同じファイル内の新規行を指すことを検証、ファイルキーは新WS配下に再採番、ユーザー参照は実行者に置換。加えて参照系クエリに workspace_id 条件、`/api/files` はキーのWS接頭辞と行のWSの一致を要求 | regression-security（2件） |
| High | インポートでの mass assignment（chosen・decided・Opinion の confirmed、他ユーザー名義） | インポートでは chosen→considering、Decision は draft、Opinion の confirmed は candidate に戻す。メール一致での他アカウント割当を廃止 | regression-security |
| Medium | 低速レスポンスで単一ジョブワーカーを占有（全テナントの取込停止） | リクエスト全体の締切、PDF解析30秒、ジョブ120秒、3並列＋ワークスペース間の公平化、停止ジョブの回復 | 既存テスト |
| Medium | 復元時の展開サイズ上限 1GiB（メモリ枯渇） | 200MB＋圧縮率上限 | security（zip） |
| Medium | IPv6 の IPv4 埋め込み形式（NAT64/6to4/Teredo 等）で SSRF 判定をすり抜け | IPv6 を16バイトに展開して判定、2000::/3 以外を拒否 | security（IPv6） |
| Low-Med | Admin が Admin を招待できる | Owner/Admin の招待は Owner のみ | regression |
| Low | 共有ビューが内部ID・社内メモを返す／`trustProxy` 無条件／`javascript:` URL／`/audit?limit=abc` が500／Webソースのファイルキー共有／コメント対象の未検証／検索の projectId 不整合 | 最小DTO化、`TRUST_PROXY` 明示設定制、http(s)のみ許可、limit検証、キーに乱数付与、対象をプロジェクト内に限定、索引の projectId 修正 | regression |

レビューで「正しい」と確認された点: パラメータ化SQL、通常APIの参照検証、CSRF（multipart含む）、トークンのロール再評価・失効、最後のOwner保護、署名URL（timingSafeEqual・期限）、保存HTMLの非実行化、ZIP slip対策、Brief HTML/PDFのエスケープとネットワーク遮断、CSV数式対策、リダイレクト毎の再検証、DNSリバインディング対策（undici の lookup 固定が有効）、AI引用・grounding 検証。

E2E 実行中に、グローバルレート制限（IP単位600/分）に到達する問題を検出し、セッション/トークン単位のキーに変更（ログイン・登録は常にIP単位）。

## 4. 未実施・制限
- **実機テスト**（iPhone/Android/iPad 実端末、PWAのホーム画面追加）— エミュレーションのみ
- **負荷試験**（同時アクセス、大容量PDF、1,000ソース規模のAPI）— 純粋エンジンの計測のみ
- **Docker イメージのビルド** — この環境に Docker デーモンがなく未検証
- **実AIプロバイダ**（Anthropic API）での抽出品質評価 — 未実施（APIキー・有料利用は人の承認事項）
- **第三者ペネトレーションテスト** — 未実施
- スクリーンリーダーでの実操作確認 — 未実施（自動チェックのみ）
