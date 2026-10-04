import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useApi } from '../lib/api';
import { EvidenceDrawer } from '../components/Evidence';
import { ageLabel, ErrorBox, Loading, MustHaveBadge } from '../components/ui';
import { useProject } from './ProjectLayout';
import type { CompareResult, Cell } from '@shared/compare';

export function useMedia(query: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return m;
}

function CellView({ cell, onOpen }: { cell: Cell; onOpen: (id: string) => void }) {
  const cls = cell.status === 'unknown' ? 'unknown' : cell.status === 'conflict' ? 'conflict' : !cell.verified ? 'unverified' : '';
  return (
    <td className={`cell ${cls}`} onClick={() => cell.factIds[0] && onOpen(cell.factIds[0])} tabIndex={cell.factIds.length ? 0 : -1} onKeyDown={(e) => e.key === 'Enter' && cell.factIds[0] && onOpen(cell.factIds[0])} data-testid={`cell-${cell.attributeKey}`}>
      {cell.status === 'conflict' ? (
        <div className="stack" style={{ gap: 2 }}>
          {cell.values.map((v, i) => (
            <div key={i} className="val">
              {v.display}
            </div>
          ))}
        </div>
      ) : (
        <div className="val">{cell.display}</div>
      )}
      <div className="meta">
        {cell.status === 'unknown' && <span className="badge unknown">Unknown</span>}
        {cell.status === 'conflict' && <span className="badge conflict">Conflict</span>}
        {cell.status === 'value' && !cell.verified && <span className="badge candidate">未確認</span>}
        {cell.status !== 'unknown' && !cell.officialSource && <span className="badge">公式出典なし</span>}
        {cell.sourceAgeDays !== null && cell.sourceAgeDays > 90 && <span className="badge warn">{ageLabel(cell.sourceAgeDays)}</span>}
      </div>
    </td>
  );
}

function ScoreSummary({ r }: { r: CompareResult & { candidates: any[] } }) {
  const [showFormula, setShowFormula] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <h3>このCriteria設定での参考スコア</h3>
        <button className="btn ghost small" onClick={() => setShowFormula((s) => !s)}>
          {showFormula ? '計算式を閉じる' : '計算式を表示'}
        </button>
      </div>
      <p style={{ fontWeight: 600 }} data-testid="statement">
        {r.statement}
      </p>
      {r.caveats.map((c, i) => (
        <p key={i} className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          ※ {c}
        </p>
      ))}
      {showFormula && (
        <ul style={{ fontSize: 12, marginTop: 10 }}>
          {r.formula.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {r.weightErrors.length > 0 && <div className="callout warn">{r.weightErrors.join(' / ')}</div>}
    </div>
  );
}

export function ComparePage() {
  const { ws, pid, candidates, reloadMissing, project } = useProject();
  const [scenarioId, setScenarioId] = useState('');
  const [policy, setPolicy] = useState<'confirmed_only' | 'include_unreviewed'>(project.factPolicy === 'include_unreviewed' ? 'include_unreviewed' : 'confirmed_only');
  const [diffOnly, setDiffOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const mobile = useMedia('(max-width: 820px)');
  const [mView, setMView] = useState<'pair' | 'cards'>('pair');
  const q = new URLSearchParams({ factPolicy: policy, ...(scenarioId ? { scenarioId } : {}) });
  const cmp = useApi<CompareResult & { candidates: any[]; scenarios: { id: string; name: string }[] }>(`/api/w/${ws}/projects/${pid}/compare?${q}`, [pid, scenarioId, policy]);
  const r = cmp.data;
  const [a, setA] = useState<string>('');
  const [b, setB] = useState<string>('');
  useEffect(() => {
    if (!a && candidates[0]) setA(candidates[0].id);
    if (!b && candidates[1]) setB(candidates[1].id);
  }, [candidates, a, b]);
  const rows = useMemo(() => (r ? r.rows.filter((row) => !diffOnly || row.differs) : []), [r, diffOnly]);
  if (cmp.error) return <ErrorBox error={cmp.error} />;
  if (!r) return <Loading />;
  if (!r.candidates.length) return <div className="empty">候補を登録すると比較表が表示されます。</div>;
  const scoreOf = (id: string) => r.scores.find((s) => s.candidateId === id);
  const mhOf = (id: string) => scoreOf(id)?.mustHave.status;
  const hasScores = r.scores.some((s) => s.score !== null);
  const reload = () => {
    void cmp.reload();
    reloadMissing();
  };

  const controls = (
    <div className="row spread no-print" style={{ marginBottom: 12 }}>
      <div className="row">
        <select aria-label="Scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} style={{ width: 200 }}>
          <option value="">既定のWeight</option>
          {r.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              Scenario: {s.name}
            </option>
          ))}
        </select>
        <div className="segmented" aria-label="表示するFact">
          <button className={policy === 'include_unreviewed' ? 'on' : ''} onClick={() => setPolicy('include_unreviewed')}>
            未確認も含めて計算
          </button>
          <button className={policy === 'confirmed_only' ? 'on' : ''} onClick={() => setPolicy('confirmed_only')}>
            Confirmedのみで計算
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} /> 違いのある項目だけ
        </label>
      </div>
      <a className="btn small hide-mobile" href={`/api/w/${ws}/projects/${pid}/compare.csv`}>
        CSV出力
      </a>
    </div>
  );

  if (mobile) {
    const ca = r.candidates.find((c) => c.id === a);
    const cb = r.candidates.find((c) => c.id === b);
    return (
      <div className="stack">
        {controls}
        <div className="segmented" style={{ alignSelf: 'flex-start' }}>
          <button className={mView === 'pair' ? 'on' : ''} onClick={() => setMView('pair')}>
            2候補で比較
          </button>
          <button className={mView === 'cards' ? 'on' : ''} onClick={() => setMView('cards')}>
            カード
          </button>
        </div>
        {mView === 'pair' ? (
          <>
            <div className="pair-picker" data-testid="pair-picker">
              <select aria-label="候補A" value={a} onChange={(e) => setA(e.target.value)}>
                {r.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <b>vs</b>
              <select aria-label="候補B" value={b} onChange={(e) => setB(e.target.value)}>
                {r.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {hasScores && (
              <div className="pair-row">
                <div className="label">参考スコア</div>
                {[ca, cb].map((c) => (
                  <div key={c?.id} style={{ padding: '4px 12px 10px' }}>
                    <b>{scoreOf(c?.id)?.score ?? 'N/A'}</b>
                    <small className="muted">/10</small> <MustHaveBadge s={mhOf(c?.id) ?? null} />
                  </div>
                ))}
              </div>
            )}
            <div className="pair-list" data-testid="pair-list">
              {rows.map((row) => {
                const x = row.cells.find((c) => c.candidateId === a)!;
                const y = row.cells.find((c) => c.candidateId === b)!;
                const differs = x.status !== y.status || x.display !== y.display;
                return (
                  <div className={`pair-row ${differs ? 'differs' : ''}`} key={row.attributeKey}>
                    <div className="label">
                      {row.displayName}
                      {(x.status === 'conflict' || y.status === 'conflict') && <span className="badge conflict">Conflict</span>}
                    </div>
                    {[x, y].map((c) => (
                      <button key={c.candidateId} className={c.status} onClick={() => c.factIds[0] && setOpen(c.factIds[0])}>
                        {c.status === 'conflict' ? c.values.map((v) => v.display).join(' / ') : c.display}
                        {c.status === 'value' && !c.verified && <small className="muted"> ・未確認</small>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="stack">
            {r.candidates.map((c) => (
              <div className="card" key={c.id}>
                <div className="row spread">
                  <h3>{c.name}</h3>
                  {hasScores && (
                    <span>
                      <b>{scoreOf(c.id)?.score ?? 'N/A'}</b>
                      <small className="muted">/10</small>
                    </span>
                  )}
                </div>
                <dl className="kv" style={{ marginTop: 8 }}>
                  {rows.map((row) => {
                    const cell = row.cells.find((x) => x.candidateId === c.id)!;
                    return [
                      <dt key={row.attributeKey + 'k'}>{row.displayName}</dt>,
                      <dd key={row.attributeKey + 'v'} onClick={() => cell.factIds[0] && setOpen(cell.factIds[0])} className={cell.status === 'unknown' ? 'muted' : ''}>
                        {cell.status === 'conflict' ? <span className="badge conflict">Conflict</span> : cell.display}
                      </dd>,
                    ];
                  })}
                </dl>
              </div>
            ))}
          </div>
        )}
        {hasScores && <ScoreSummary r={r} />}
        <EvidenceDrawer factId={open} onClose={() => setOpen(null)} onChanged={reload} />
      </div>
    );
  }

  let lastGroup: string | null | undefined = undefined;
  return (
    <div className="stack">
      {controls}
      <div className="table-wrap" style={{ maxHeight: '70vh' }}>
        <table className="data compare" data-testid="compare-table">
          <thead>
            <tr>
              <th className="attr">項目</th>
              {r.candidates.map((c) => (
                <th key={c.id}>
                  {c.name}
                  {c.status === 'chosen' && <span className="badge ok" style={{ marginLeft: 6 }}>選択</span>}
                  {c.provider && <div className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{c.provider}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasScores && (
              <tr className="score-row">
                <th className="attr">参考スコア</th>
                {r.candidates.map((c) => {
                  const s = scoreOf(c.id)!;
                  return (
                    <td key={c.id}>
                      <b style={{ fontSize: 18 }}>{s.score ?? 'N/A'}</b>
                      <small className="muted">/10</small> <MustHaveBadge s={s.mustHave.status} />
                      <div className={`scorebar ${s.rank === 1 ? 'top' : ''}`}>
                        <i style={{ width: `${(s.score ?? 0) * 10}%` }} />
                      </div>
                      <small className="muted">
                        カバー率 {Math.round(s.coverage * 100)}%{s.range && s.coverage < 1 ? `・範囲 ${s.range[0]}〜${s.range[1]}` : ''}
                      </small>
                    </td>
                  );
                })}
              </tr>
            )}
            {rows.map((row) => {
              const groupHeader =
                row.groupName !== lastGroup && row.groupName ? (
                  <tr className="group-row" key={`g-${row.groupName}`}>
                    <th colSpan={r.candidates.length + 1}>{row.groupName}</th>
                  </tr>
                ) : null;
              lastGroup = row.groupName;
              return [
                groupHeader,
                <tr key={row.attributeKey} className={row.differs ? 'differs' : ''}>
                  <th className="attr">{row.displayName}</th>
                  {row.cells.map((c) => (
                    <CellView key={c.candidateId} cell={c} onOpen={setOpen} />
                  ))}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        セルをクリックすると値・出典・取得日時・元の文脈・信頼度・レビュー状態を確認できます。左端の緑線は候補間で値が異なる項目です。Unknown は「情報なし」であり 0 ではありません。
      </p>
      {hasScores ? (
        <ScoreSummary r={r} />
      ) : (
        <div className="callout">
          スコアを表示するには <Link to={`/w/${ws}/p/${pid}/criteria`}>Criteria と Weight</Link> を設定してください。Weight は AI ではなくあなたが決めます。
        </div>
      )}
      <EvidenceDrawer factId={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
