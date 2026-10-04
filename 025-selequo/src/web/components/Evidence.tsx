import { useState } from 'react';
import { useApi } from '../lib/api';
import { can } from '../lib/session';
import { useProject } from '../pages/ProjectLayout';
import { Drawer, ErrorBox, fmtDate, Loading, QualityBadge, SOURCE_TYPE_LABEL, StateBadge, useAction } from './ui';
import { formatValue } from '@shared/normalize';
import { locatorOf } from '@shared/brief';

function Highlight({ text, needle }: { text: string; needle: string }) {
  const i = needle ? text.indexOf(needle) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{needle}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export function Region({ src, region }: { src: string; region: { x: number; y: number; w: number; h: number } | null }) {
  return (
    <div className="shot">
      <img src={src} alt="スクリーンショット" />
      {region && <div className="region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }} />}
    </div>
  );
}

/** Fact evidence panel: value / source / captured date / original context / confidence / review state / conflict. */
export function EvidenceDrawer({ factId, onClose, onChanged }: { factId: string | null; onClose: () => void; onChanged?: () => void }) {
  const { ws, pid, role, api, candidates } = useProject();
  const ev = useApi(factId ? `/api/w/${ws}/facts/${factId}/evidence` : null, [factId]);
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const e = ev.data;
  const cand = (id: string) => candidates.find((c) => c.id === id)?.name ?? '';
  async function review(action: 'confirm' | 'reject' | 'reopen') {
    await run(() => api.post(`/facts/${factId}/review`, { action, note: note || null }), action === 'confirm' ? 'Confirmedにしました' : action === 'reject' ? 'Rejectedにしました' : '未確認に戻しました');
    setNote('');
    await ev.reload();
    onChanged?.();
  }
  async function resolve(keep: string, others: string[]) {
    await run(() => api.post(`/projects/${pid}/conflicts/resolve`, { keepFactId: keep, supersedeFactIds: others, note: note || null }), 'Conflictを解決しました（他の値はSupersededとして保持）');
    await ev.reload();
    onChanged?.();
  }
  const r = e?.fact.sourceRange;
  return (
    <Drawer open={!!factId} onClose={onClose} title="根拠（Evidence）">
      {ev.loading && !e ? <Loading /> : null}
      <ErrorBox error={ev.error} />
      {e && (
        <>
          <div className="card">
            <div className="row spread">
              <small className="muted">
                {cand(e.fact.candidateId)} / {e.fact.rawLabel}
              </small>
              <div className="row">
                <StateBadge state={e.fact.reviewState} />
                {e.fact.kind === 'opinion' && <span className="badge opinion">Opinion</span>}
                {e.fact.extractedBy.startsWith('ai:') && <span className="badge ai">AI抽出</span>}
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{e.fact.rawValue}</div>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>正規化値</dt>
              <dd>{e.fact.normalizedValue ? formatValue(e.fact.normalizedValue) : <span className="muted">なし{e.fact.issue ? `（${e.fact.issue}）` : ''}</span>}</dd>
              <dt>信頼度</dt>
              <dd>{Math.round(e.fact.confidence * 100)}%（{e.fact.extractedBy}）</dd>
              <dt>位置</dt>
              <dd>{locatorOf(e.fact.sourceRange)}</dd>
              {e.reviewedByName && (
                <>
                  <dt>レビュー</dt>
                  <dd>
                    {e.reviewedByName}・{fmtDate(e.fact.reviewedAt, true)}
                  </dd>
                </>
              )}
              {e.fact.note && (
                <>
                  <dt>メモ</dt>
                  <dd>{e.fact.note}</dd>
                </>
              )}
            </dl>
          </div>
          <div className="card">
            <h3>出典（Source）</h3>
            <dl className="kv">
              <dt>種類</dt>
              <dd>
                {SOURCE_TYPE_LABEL[e.source.type]} <QualityBadge q={e.source.quality} />
              </dd>
              <dt>タイトル</dt>
              <dd>{e.source.title ?? '-'}</dd>
              {e.source.url && /^https?:\/\//i.test(e.source.url) && (
                <>
                  <dt>URL</dt>
                  <dd>
                    <a href={e.source.url} target="_blank" rel="noopener noreferrer nofollow">
                      {e.source.url}
                    </a>
                  </dd>
                </>
              )}
              <dt>取得日時</dt>
              <dd>{fmtDate(e.source.retrievedAt ?? e.source.capturedAt, true)}</dd>
              {e.source.publishedAt && (
                <>
                  <dt>公開日</dt>
                  <dd>{fmtDate(e.source.publishedAt)}</dd>
                </>
              )}
              {e.source.type === 'manual' && (
                <>
                  <dt>入力者</dt>
                  <dd>{e.source.createdByName ?? '-'}</dd>
                </>
              )}
              {e.source.hash && (
                <>
                  <dt>ハッシュ</dt>
                  <dd>
                    <code>{String(e.source.hash).slice(0, 16)}…</code>
                  </dd>
                </>
              )}
            </dl>
            {e.source.injectionFlags?.length > 0 && <p className="callout warn" style={{ marginTop: 10 }}>このソースには指示文のようなテキスト（プロンプトインジェクションの可能性）が含まれていました。データとして扱い、指示には従っていません。</p>}
            {(e.source.type === 'screenshot' || e.source.type === 'image') && e.source.fileUrl && <div style={{ marginTop: 12 }}><Region src={e.source.fileUrl} region={r?.type === 'image' ? r.region : null} /></div>}
            {e.source.type === 'pdf' && e.source.fileUrl && (
              <p style={{ marginTop: 10 }}>
                <a className="btn small" href={`${e.source.fileUrl}#page=${r?.type === 'pdf' ? r.page : 1}`} target="_blank" rel="noopener noreferrer">
                  PDFを開く（p.{r?.type === 'pdf' ? r.page : 1}）
                </a>
              </p>
            )}
          </div>
          {e.originalContext && (
            <div>
              <h3 style={{ marginBottom: 6 }}>元の文脈</h3>
              <div className="quote">
                <Highlight text={e.originalContext} needle={e.fact.rawValue} />
              </div>
            </div>
          )}
          {e.siblings.length > 0 && (
            <div className="card">
              <h3>同じ項目の他のFact{e.conflict && <span className="badge conflict" style={{ marginLeft: 6 }}>Conflict</span>}</h3>
              <div className="list">
                {e.siblings.map((s: any) => (
                  <div className="list-item" key={s.id}>
                    <div className="grow">
                      <b>{s.rawValue}</b> <StateBadge state={s.reviewState} />
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.sourceTitle} <QualityBadge q={s.sourceQuality} />
                      </div>
                    </div>
                    {e.conflict && can(role, 'reviewer') && s.reviewState !== 'superseded' && (
                      <button className="btn small" disabled={busy} onClick={() => resolve(s.id, [e.fact.id, ...e.siblings.filter((x: any) => x.id !== s.id && x.reviewState !== 'superseded' && x.reviewState !== 'rejected').map((x: any) => x.id)])}>
                        この値を採用
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {e.conflict && can(role, 'reviewer') && (
                <button className="btn small" style={{ marginTop: 8 }} disabled={busy} onClick={() => resolve(e.fact.id, e.siblings.filter((x: any) => x.reviewState !== 'superseded' && x.reviewState !== 'rejected').map((x: any) => x.id))}>
                  表示中の値（{e.fact.rawValue}）を採用
                </button>
              )}
              {e.conflict && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>採用しなかった値は削除されず Superseded として残ります。</p>}
            </div>
          )}
          {can(role, 'reviewer') && (
            <div className="card stack">
              <h3>レビュー</h3>
              <input placeholder="メモ（任意）" value={note} onChange={(x) => setNote(x.target.value)} maxLength={2000} />
              <div className="row">
                <button className="btn primary" disabled={busy || e.fact.kind === 'opinion'} onClick={() => review('confirm')}>
                  Confirm
                </button>
                <button className="btn danger" disabled={busy} onClick={() => review('reject')}>
                  Reject
                </button>
                {e.fact.reviewState !== 'candidate' && (
                  <button className="btn ghost" disabled={busy} onClick={() => review('reopen')}>
                    未確認に戻す
                  </button>
                )}
              </div>
              {e.fact.kind === 'opinion' && <small className="muted">Opinion（意見）はFactとしてConfirmできません。</small>}
            </div>
          )}
          <div className="card stack">
            <h3>コメント</h3>
            {e.comments.length === 0 && <small className="muted">コメントはありません</small>}
            {e.comments.map((c: any) => (
              <div key={c.id}>
                <b>{c.authorName}</b> <small>{fmtDate(c.createdAt, true)}</small>
                <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            ))}
            {can(role, 'reviewer') && (
              <div className="row">
                <input placeholder="コメントを追加" value={comment} onChange={(x) => setComment(x.target.value)} style={{ flex: 1 }} />
                <button
                  className="btn"
                  disabled={!comment.trim() || busy}
                  onClick={async () => {
                    await run(() => api.post(`/projects/${pid}/comments`, { entityType: 'fact', entityId: factId, body: comment }));
                    setComment('');
                    void ev.reload();
                  }}
                >
                  送信
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
