import { useEffect, useState, type FormEvent } from 'react';
import { usePoll, useApi } from '../lib/api';
import { can } from '../lib/session';
import { ErrorBox, fmtDate, Icon, QUALITY_LABEL, QualityBadge, SOURCE_TYPE_LABEL, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';
import { CandidateManager } from './Overview';

const QUALITIES = Object.keys(QUALITY_LABEL);

export function ImportPage() {
  const { ws, pid, api, candidates, role, reload, project } = useProject();
  const sources = useApi<any[]>(`/api/w/${ws}/projects/${pid}/sources`, [pid]);
  const { run, busy } = useAction();
  const [mode, setMode] = useState<'url' | 'file' | 'text'>('url');
  const [candidateId, setCandidateId] = useState<string>(candidates[0]?.id ?? '');
  const [quality, setQuality] = useState('unknown');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  useEffect(() => {
    if (!candidateId && candidates.length) setCandidateId(candidates[0].id);
  }, [candidates, candidateId]);
  const processing = !!sources.data?.some((s) => s.status === 'pending' || s.status === 'processing');
  usePoll(processing, () => {
    void sources.reload();
    reload();
  });
  const editor = can(role, 'editor');

  async function addUrl(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api.post(`/projects/${pid}/sources/url`, { url, candidateId: candidateId || null, quality, aiEnabled }), 'URLを登録しました。取得と抽出を行っています…');
    if (r) {
      setUrl('');
      void sources.reload();
    }
  }
  async function addText(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api.post(`/projects/${pid}/sources/text`, { text, title: title || null, candidateId: candidateId || null, quality: quality === 'unknown' ? 'manual' : quality, aiEnabled }), 'テキストを登録しました');
    if (r) {
      setText('');
      setTitle('');
      void sources.reload();
    }
  }
  async function upload(file: File, kind: string) {
    const fd = new FormData();
    if (candidateId) fd.append('candidateId', candidateId);
    fd.append('kind', kind);
    fd.append('quality', quality);
    fd.append('aiEnabled', String(aiEnabled));
    if (kind === 'screenshot' || kind === 'image') fd.append('capturedAt', new Date(file.lastModified || Date.now()).toISOString());
    fd.append('file', file);
    const r = await run(() => api.post(`/projects/${pid}/sources/file`, fd), `${file.name} をアップロードしました`);
    if (r) void sources.reload();
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {candidates.length === 0 && <div className="callout">まず候補を登録してください。ソースは候補ごとに紐付けます。</div>}
      {editor && (
        <div className="card">
          <div className="card-head">
            <h2>情報を取り込む</h2>
            <div className="segmented" role="tablist">
              {(
                [
                  ['url', 'URL'],
                  ['file', 'PDF・スクショ・CSV'],
                  ['text', 'テキスト'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <label className="field">
              候補
              <select aria-label="候補" value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                <option value="">（あとで紐付ける）</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              出典の種類（Source Quality）
              <select aria-label="出典の種類（Source Quality）" value={quality} onChange={(e) => setQuality(e.target.value)}>
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABEL[q]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode === 'url' && (
            <form className="stack" onSubmit={addUrl}>
              <label className="field">
                公開ページのURL
                <span className="hint">robots.txt と利用規約を尊重して1ページだけ取得します。ログイン・課金・CAPTCHAが必要なページは取得しません（PDFやスクショで追加してください）。</span>
                <input type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
              <button className="btn primary" disabled={busy || !url}>
                <Icon name="link" /> URLを取り込む
              </button>
            </form>
          )}
          {mode === 'file' && (
            <div className="grid cols-3">
              <label className="card" style={{ cursor: 'pointer', textAlign: 'center' }}>
                <Icon name="brief" />
                <b>PDF</b>
                <small className="muted">ページ番号付きで引用します</small>
                <input className="sr-only" type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'pdf')} />
              </label>
              <label className="card" style={{ cursor: 'pointer', textAlign: 'center' }} data-testid="upload-screenshot">
                <Icon name="camera" />
                <b>スクリーンショット</b>
                <small className="muted">PC側で領域を指定して値を記録できます</small>
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'screenshot')} />
              </label>
              <label className="card" style={{ cursor: 'pointer', textAlign: 'center' }}>
                <Icon name="table" />
                <b>CSV</b>
                <small className="muted">candidate,label,value 形式 または 項目×候補名</small>
                <input className="sr-only" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'csv')} />
              </label>
            </div>
          )}
          {mode === 'text' && (
            <form className="stack" onSubmit={addText}>
              <label className="field">
                タイトル
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例: 営業担当からのメール回答" maxLength={300} />
              </label>
              <label className="field">
                テキスト <span className="hint">「項目: 値」の形式だと抽出精度が上がります</span>
                <textarea required value={text} onChange={(e) => setText(e.target.value)} rows={6} />
              </label>
              <button className="btn primary" disabled={busy || !text.trim()}>
                テキストを取り込む
              </button>
            </form>
          )}
          <label className="check" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} disabled={!project.aiEnabled} />
            このソースでAI抽出を許可する {!project.aiEnabled && <small className="muted">（プロジェクトでAI OFF）</small>}
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            AIがONの場合のみ、ソース本文（抽出用）と質問が設定されたAIプロバイダに送信されます。OFFの場合はローカルのルールベース抽出のみを行い、外部送信は行いません。
          </p>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>ソース一覧</h2>
          {processing && <span className="badge candidate">処理中…</span>}
        </div>
        <ErrorBox error={sources.error} />
        {sources.data?.length === 0 && <div className="empty">まだソースがありません</div>}
        <div className="list">
          {sources.data?.map((s) => (
            <div className="list-item" key={s.id} data-testid="source-row">
              <span className="badge">{SOURCE_TYPE_LABEL[s.type]}</span>
              <div className="grow">
                <div className="truncate">
                  <b>{s.title ?? s.url ?? s.fileName}</b>
                </div>
                <div className="row" style={{ fontSize: 12 }}>
                  <QualityBadge q={s.quality} />
                  <span className="muted">{candidates.find((c) => c.id === s.candidateId)?.name ?? '候補未設定'}</span>
                  <span className="muted">取得 {fmtDate(s.retrievedAt ?? s.capturedAt ?? s.createdAt, true)}</span>
                  <span className="muted">Fact {s.factCount}</span>
                  {!s.aiEnabled && <span className="badge">AI OFF</span>}
                  {s.injectionFlags?.length > 0 && <span className="badge warn" title={s.injectionFlags.join(', ')}>指示文を検出（無視）</span>}
                  {s.status === 'failed' && <span className="badge fail">失敗</span>}
                  {(s.status === 'pending' || s.status === 'processing') && <span className="badge candidate">処理中</span>}
                </div>
                {s.error && <div className="callout warn" style={{ marginTop: 6 }}>{s.error}</div>}
                {s.type === 'screenshot' && s.factCount === 0 && s.status === 'ready' && <small className="muted">スクショはOCR/AIなしでは文字を抽出しません。「根拠レビュー」で領域を選んで値を記録してください。</small>}
              </div>
              {editor && (
                <div className="row">
                  {!s.candidateId && (
                    <select
                      aria-label="候補を紐付け"
                      defaultValue=""
                      onChange={async (e) => {
                        await run(() => api.patch(`/sources/${s.id}`, { candidateId: e.target.value }));
                        void sources.reload();
                      }}
                      style={{ width: 150 }}
                    >
                      <option value="" disabled>
                        候補を紐付け
                      </option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {s.type !== 'manual' && (
                    <button className="btn ghost small" title="再取得・再抽出" aria-label="再処理" onClick={async () => { await run(() => api.post(`/sources/${s.id}/reprocess`)); void sources.reload(); }}>
                      <Icon name="refresh" />
                    </button>
                  )}
                  <button
                    className="btn ghost small"
                    aria-label="ソースを削除"
                    onClick={async () => {
                      if (!confirm('このソースと、そこから抽出したFact・ファイル・検索インデックスを削除しますか？')) return;
                      await run(() => api.del(`/sources/${s.id}`), '削除しました');
                      void sources.reload();
                      reload();
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <CandidateManager />
    </div>
  );
}
