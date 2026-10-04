import { useState, type FormEvent } from 'react';
import { useApi } from '../lib/api';
import { can, useSession } from '../lib/session';
import { EvidenceDrawer } from '../components/Evidence';
import { fmtDate, Icon, QualityBadge, useAction } from '../components/ui';
import { queueNote } from '../lib/offline';
import { useProject } from './ProjectLayout';

const PRESETS = [
  ['big_differences', 'A/Bの大きな違いは？'],
  ['missing', '不足している項目は？'],
  ['no_official_source', '公式の出典がない値は？'],
  ['weaknesses_besides_price', '価格以外の弱点は？'],
  ['conflicts', '情報が矛盾している箇所は？'],
] as const;

function Assistant() {
  const { pid, api, candidates, project } = useProject();
  const { me } = useSession();
  const { run, busy } = useAction();
  const [ans, setAns] = useState<any | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const ask = (body: any) => run(() => api.post(`/projects/${pid}/assistant`, body)).then((r) => r && setAns(r));
  const aiOn = project.aiEnabled && me?.ai.configured;
  return (
    <div className="card">
      <div className="card-head">
        <h2>AI Research Assistant</h2>
        <span className={`badge ${aiOn ? 'ai' : ''}`}>{aiOn ? `AI ON（${me?.ai.provider}）` : 'AI OFF・ルールベース'}</span>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        回答はこのプロジェクトのFactと出典だけを根拠にし、必ず引用を付けます。外部Web検索は行いません。{aiOn ? '自由質問では、関連するFact（最大40件）と質問文が設定されたAIプロバイダに送信されます。' : 'AIがOFFのため、外部への送信は行いません。'}
      </p>
      <div className="row" style={{ marginBottom: 10 }}>
        {PRESETS.map(([k, l]) => (
          <button key={k} className="chip" disabled={busy} onClick={() => ask({ preset: k, candidateIds: k === 'big_differences' ? candidates.slice(0, 2).map((c) => c.id) : undefined })}>
            {l}
          </button>
        ))}
      </div>
      <form
        className="row"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (q.trim()) void ask({ question: q });
        }}
      >
        <input placeholder="自由に質問（例: 重量はどれくらい違う？）" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} maxLength={1000} />
        <button className="btn primary" disabled={busy || !q.trim()}>
          質問
        </button>
      </form>
      {ans && (
        <div className="stack" style={{ marginTop: 14 }} data-testid="assistant-answer">
          <div className="quote" style={{ borderLeftColor: 'var(--chart-600)' }}>{ans.answer}</div>
          {ans.items?.length > 0 && (
            <div className="list">
              {ans.items.map((it: any, i: number) => (
                <div className="list-item" key={i}>
                  <div className="grow">
                    {it.text}
                    <div className="row" style={{ marginTop: 4 }}>
                      {it.citations.map((c: any, j: number) => (
                        <button key={j} className="chip" onClick={() => c.factId && setOpen(c.factId)} title={c.label}>
                          [{j + 1}] {c.sourceTitle?.slice(0, 24) ?? '出典'} <QualityBadge q={c.quality} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!ans.items?.length && ans.citations?.length > 0 && (
            <div className="row">
              {ans.citations.map((c: any, j: number) => (
                <button key={j} className="chip" onClick={() => c.factId && setOpen(c.factId)} title={c.label}>
                  [{j + 1}] {c.label.slice(0, 40)}
                </button>
              ))}
            </div>
          )}
          <small className="muted">{ans.note}</small>
        </div>
      )}
      <EvidenceDrawer factId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Notes() {
  const { ws, pid, api, candidates, role } = useProject();
  const notes = useApi<any[]>(`/api/w/${ws}/projects/${pid}/notes`, [pid]);
  const [body, setBody] = useState('');
  const [cid, setCid] = useState('');
  const { run, busy } = useAction();
  async function save(e: FormEvent) {
    e.preventDefault();
    const id = crypto.randomUUID();
    if (!navigator.onLine) {
      await queueNote({ id, ws, projectId: pid, candidateId: cid || null, body, createdAt: new Date().toISOString() });
      setBody('');
      alert('オフラインのためメモを端末に保存しました。オンラインになると自動で同期します。');
      return;
    }
    await run(() => api.post(`/projects/${pid}/notes`, { id, candidateId: cid || null, body }), 'メモを保存しました');
    setBody('');
    void notes.reload();
  }
  return (
    <div className="card">
      <h2>メモ（User Note）</h2>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>メモはFactとは別に保存され、比較表やスコアには使われません。オフラインでも書けます。</p>
      {can(role, 'reviewer') && (
        <form className="stack" onSubmit={save}>
          <select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="候補">
            <option value="">プロジェクト全体</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="店頭で触った感想、営業担当との会話など" rows={3} maxLength={5000} />
          <button className="btn" disabled={busy || !body.trim()}>
            <Icon name="note" /> メモを保存
          </button>
        </form>
      )}
      <div className="list" style={{ marginTop: 10 }}>
        {notes.data?.map((n) => (
          <div className="list-item" key={n.id}>
            <div className="grow">
              <small className="muted">
                {n.authorName}・{fmtDate(n.createdAt, true)}
                {n.candidateId && `・${candidates.find((c) => c.id === n.candidateId)?.name}`}
              </small>
              <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function QuestionsPage() {
  const { ws, pid, api, candidates, role, missing, reloadMissing } = useProject();
  const questions = useApi<any[]>(`/api/w/${ws}/projects/${pid}/questions`, [pid]);
  const attrs = useApi<any[]>(`/api/w/${ws}/projects/${pid}/attributes`, [pid]);
  const { run, busy } = useAction();
  const [text, setText] = useState('');
  const [cid, setCid] = useState('');
  const [answering, setAnswering] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const attrName = (k: string) => attrs.data?.find((a) => a.key === k)?.displayName ?? k;
  const reviewer = can(role, 'reviewer');
  const askFor = async (candidateId: string, attributeKey: string) => {
    await run(() => api.post(`/projects/${pid}/questions`, { text: `${candidates.find((c) => c.id === candidateId)?.name} の「${attrName(attributeKey)}」を確認する`, candidateId, attributeKey }), '調査キューに追加しました');
    void questions.reload();
  };
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="grid cols-2">
        <div className="card">
          <h2>不足情報（Unknown）</h2>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>情報がない項目は Unknown です。0点やおすすめ外として扱いません。</p>
          {missing?.missing.length === 0 && <small className="muted">ありません</small>}
          <div className="list">
            {missing?.missing.map((m: any) => (
              <div className="list-item" key={m.candidateId + m.attributeKey} data-testid="missing-item">
                <span className="badge unknown">Unknown</span>
                <span className="grow">
                  {m.candidate} / {m.attribute} {m.mustHave && <span className="badge warn">Must-have</span>}
                </span>
                {reviewer && (
                  <button className="btn small" onClick={() => askFor(m.candidateId, m.attributeKey)}>
                    調査する
                  </button>
                )}
              </div>
            ))}
          </div>
          {missing?.mustHaveUnknown.length > 0 && (
            <div className="callout warn" style={{ marginTop: 10 }}>
              Must-have が未確認の候補：{missing.mustHaveUnknown.map((x: any) => `${x.candidate}（${x.criterion}）`).join('、')}
            </div>
          )}
        </div>
        <div className="card">
          <h2>Conflict（食い違い）</h2>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>出典によって値が違う項目です。両方の値を保持しています。根拠を確認して採用する値を選んでください。</p>
          {missing?.conflicts.length === 0 && <small className="muted">ありません</small>}
          <div className="list">
            {missing?.conflicts.map((c: any) => (
              <div className="list-item" key={c.candidateId + c.attributeKey} data-testid="conflict-item">
                <span className="badge conflict">Conflict</span>
                <span className="grow">
                  {c.candidate} / {c.attribute}: {c.values.join(' vs ')}
                </span>
                <button className="btn small" onClick={() => setOpen(c.factIds[0])}>
                  根拠を確認
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card">
        <h2>質問・調査キュー</h2>
        {reviewer && (
          <form
            className="row"
            style={{ marginBottom: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              await run(() => api.post(`/projects/${pid}/questions`, { text, candidateId: cid || null }), '質問を追加しました');
              setText('');
              void questions.reload();
            }}
          >
            <select value={cid} onChange={(e) => setCid(e.target.value)} style={{ width: 180 }} aria-label="候補">
              <option value="">候補を指定しない</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input required placeholder="例: 法人向けの保守契約はある？" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 200 }} maxLength={1000} />
            <button className="btn primary" disabled={busy}>
              追加
            </button>
          </form>
        )}
        <div className="list">
          {questions.data?.map((q) => (
            <div className="list-item" key={q.id}>
              <span className={`badge ${q.status === 'answered' ? 'ok' : q.status === 'closed' ? '' : 'candidate'}`}>{q.status === 'open' ? '未解決' : q.status === 'answered' ? '回答済み' : 'クローズ'}</span>
              <div className="grow">
                <b>{q.text}</b>
                {q.candidateId && <small className="muted">（{candidates.find((c) => c.id === q.candidateId)?.name}）</small>}
                {q.answer && <p style={{ marginTop: 4 }}>→ {q.answer}</p>}
                {q.answerFactId && (
                  <button className="chip" style={{ marginTop: 4 }} onClick={() => setOpen(q.answerFactId)}>
                    根拠を表示
                  </button>
                )}
                {answering === q.id && (
                  <form
                    className="row"
                    style={{ marginTop: 6 }}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await run(() => api.patch(`/questions/${q.id}`, { answer }), '回答を記録しました');
                      setAnswering(null);
                      setAnswer('');
                      void questions.reload();
                    }}
                  >
                    <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="回答（出典はソースとして追加してください）" style={{ flex: 1 }} required />
                    <button className="btn small primary">保存</button>
                  </form>
                )}
              </div>
              {reviewer && q.status === 'open' && (
                <div className="row">
                  <button className="btn small" onClick={() => setAnswering(q.id)}>
                    回答
                  </button>
                  <button className="btn ghost small" onClick={async () => { await run(() => api.patch(`/questions/${q.id}`, { status: 'closed' })); void questions.reload(); }}>
                    クローズ
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <Assistant />
      <Notes />
      <EvidenceDrawer factId={open} onClose={() => setOpen(null)} onChanged={reloadMissing} />
    </div>
  );
}
