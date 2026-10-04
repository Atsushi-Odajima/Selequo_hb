import { useState, type FormEvent } from 'react';
import { useApi } from '../lib/api';
import { can } from '../lib/session';
import { Icon, Modal, MustHaveBadge, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';

const DIR_LABEL: Record<string, string> = { higher_better: '大きいほど良い', lower_better: '小さいほど良い', target: '目標を満たす', boolean: 'あり/なし', none: '参考（スコア対象外）' };

function CriterionForm({ attrs, initial, onSubmit, busy }: { attrs: any[]; initial?: any; onSubmit: (v: any) => void; busy: boolean }) {
  const [f, setF] = useState({
    name: initial?.name ?? '',
    weight: initial?.weight ?? 5,
    direction: initial?.direction ?? 'higher_better',
    linked: initial?.linkedAttributes?.[0] ?? '',
    mustHave: initial?.mustHave ?? false,
    op: initial?.target?.op ?? '>=',
    value: initial?.target?.value ?? '',
    unit: initial?.target?.unit ?? '',
    description: initial?.description ?? '',
  });
  const attr = attrs.find((a) => a.key === f.linked);
  function submit(e: FormEvent) {
    e.preventDefault();
    const needsTarget = f.direction === 'target' || (f.mustHave && f.direction !== 'boolean');
    const val = typeof f.value === 'string' && f.value !== '' && !Number.isNaN(Number(f.value)) ? Number(f.value) : f.value;
    onSubmit({
      name: f.name || attr?.displayName,
      weight: Number(f.weight),
      direction: f.direction,
      linkedAttributes: f.linked ? [f.linked] : [],
      mustHave: f.mustHave,
      target: needsTarget && f.value !== '' ? { op: f.op, value: val, unit: f.unit || attr?.unit || null } : null,
      description: f.description || null,
    });
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field">
          比較項目
          <select value={f.linked} onChange={(e) => setF({ ...f, linked: e.target.value, name: f.name || attrs.find((a) => a.key === e.target.value)?.displayName || '' })} required>
            <option value="" disabled>
              選択
            </option>
            {attrs.map((a) => (
              <option key={a.key} value={a.key}>
                {a.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Criteria名
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={attr?.displayName} maxLength={80} />
        </label>
        <label className="field">
          評価の方向
          <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
            {Object.entries(DIR_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Weight（0〜100） <span className="hint">あなたが決める重要度</span>
          <input type="number" min={0} max={100} step={1} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value as never })} />
        </label>
        <label className="check full">
          <input type="checkbox" checked={f.mustHave} onChange={(e) => setF({ ...f, mustHave: e.target.checked })} /> Must-have（必須条件）にする
        </label>
        {(f.direction === 'target' || (f.mustHave && f.direction !== 'boolean')) && (
          <div className="full row">
            <span>目標：</span>
            <select value={f.op} onChange={(e) => setF({ ...f, op: e.target.value })} style={{ width: 90 }}>
              {['>=', '<=', '=', '>', '<', 'includes'].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder="値" style={{ width: 120 }} required />
            <input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder={attr?.unit ?? '単位'} style={{ width: 90 }} />
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Must-have の値が不明な候補は「Unknown」になり、不合格（Fail）にはなりません。</p>
      <button className="btn primary" disabled={busy}>
        保存
      </button>
    </form>
  );
}

function ScenarioEditor({ criteria, initial, onSubmit, busy }: { criteria: any[]; initial?: any; onSubmit: (v: any) => void; busy: boolean }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(criteria.map((c) => [c.id, initial?.weights?.[c.id] ?? Number(c.weight)])));
  const [must, setMust] = useState<Record<string, boolean>>(() => Object.fromEntries(criteria.map((c) => [c.id, initial?.mustHaves?.[c.id] ?? c.mustHave])));
  const [seats, setSeats] = useState<string>(initial?.params?.seats ? String(initial.params.seats) : '');
  const [basis, setBasis] = useState(initial?.params?.costBasis ?? 'annual_total');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, weights, mustHaves: must, params: { seats: seats ? Number(seats) : null, costBasis: basis } });
      }}
    >
      <label className="field">
        Scenario名
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="例: Travel / Performance / Budget / Small Team" maxLength={60} />
      </label>
      {criteria.map((c) => (
        <div key={c.id} className="row" style={{ flexWrap: 'nowrap' }}>
          <span style={{ width: 130 }} className="truncate">
            {c.name}
          </span>
          <input type="range" min={0} max={10} step={1} value={Math.min(10, weights[c.id] ?? 0)} onChange={(e) => setWeights({ ...weights, [c.id]: Number(e.target.value) })} aria-label={`${c.name}のWeight`} />
          <b style={{ width: 28, textAlign: 'right' }}>{weights[c.id]}</b>
          <label className="check" title="Must-have">
            <input type="checkbox" checked={!!must[c.id]} onChange={(e) => setMust({ ...must, [c.id]: e.target.checked })} disabled={!c.target && c.direction !== 'boolean'} /> 必須
          </label>
        </div>
      ))}
      <div className="form-grid">
        <label className="field">
          席数（SaaSなど） <span className="hint">1席あたり価格の換算に使用</span>
          <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} />
        </label>
        <label className="field">
          価格の比較基準
          <select value={basis} onChange={(e) => setBasis(e.target.value)}>
            <option value="annual_total">年額合計（月額×12を明示換算）</option>
            <option value="monthly_equivalent">月額換算</option>
            <option value="as_listed">表示価格のまま</option>
          </select>
        </label>
      </div>
      <button className="btn primary" disabled={busy}>
        保存
      </button>
    </form>
  );
}

export function CriteriaPage() {
  const { ws, pid, api, role, candidates } = useProject();
  const crit = useApi<any[]>(`/api/w/${ws}/projects/${pid}/criteria`, [pid]);
  const attrs = useApi<any[]>(`/api/w/${ws}/projects/${pid}/attributes`, [pid]);
  const scen = useApi<any[]>(`/api/w/${ws}/projects/${pid}/scenarios`, [pid]);
  const matrix = useApi<any>(`/api/w/${ws}/projects/${pid}/scenario-matrix`, [pid]);
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<any | null>(null);
  const [scEdit, setScEdit] = useState<any | null>(null);
  const editor = can(role, 'editor');
  const reload = () => {
    void crit.reload();
    void scen.reload();
    void matrix.reload();
  };
  const active = (crit.data ?? []).filter((c) => c.status === 'active');
  const suggested = (crit.data ?? []).filter((c) => c.status === 'suggested');
  const total = active.filter((c) => c.direction !== 'none').reduce((s, c) => s + Number(c.weight), 0);
  const activeAttrs = (attrs.data ?? []).filter((a) => a.status === 'active');
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="callout">Criteria と Weight はあなたが決めます。AIは候補を提案するだけで、重要度を決めたり勝者を決めたりしません。</div>
      <div className="card">
        <div className="card-head">
          <h2>Criteria</h2>
          {editor && (
            <div className="row">
              <button className="btn small" disabled={busy} onClick={async () => { await run(() => api.post(`/projects/${pid}/criteria/suggest`), '比較項目からCriteria候補を作成しました（未採用）'); reload(); }}>
                項目から候補を作成
              </button>
              <button className="btn primary small" onClick={() => setEdit({})}>
                <Icon name="plus" /> Criteriaを追加
              </button>
            </div>
          )}
        </div>
        {active.length === 0 && <div className="empty">Criteria はまだありません</div>}
        <div className="list">
          {active.map((c) => (
            <div className="list-item" key={c.id} data-testid="criterion">
              <div className="grow">
                <b>{c.name}</b> {c.mustHave && <span className="badge warn">Must-have</span>}
                <div className="muted" style={{ fontSize: 12 }}>
                  {DIR_LABEL[c.direction]}
                  {c.target ? `・目標 ${c.target.op} ${c.target.value}${c.target.unit ?? ''}` : ''}・項目 {c.linkedAttributes.map((k: string) => activeAttrs.find((a) => a.key === k)?.displayName ?? k).join(', ')}
                </div>
              </div>
              <div style={{ width: 200 }} className="hide-mobile">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    value={Math.min(10, Number(c.weight))}
                    disabled={!editor || c.direction === 'none'}
                    aria-label={`${c.name}のWeight`}
                    onChange={async (e) => {
                      await run(() => api.patch(`/criteria/${c.id}`, { weight: Number(e.target.value) }));
                      reload();
                    }}
                  />
                  <b style={{ width: 24 }}>{Number(c.weight)}</b>
                </div>
                <small className="muted">{total > 0 && c.direction !== 'none' ? `${Math.round((Number(c.weight) / total) * 100)}%` : '-'}</small>
              </div>
              {editor && (
                <div className="row">
                  <button className="btn ghost small" onClick={() => setEdit(c)}>
                    編集
                  </button>
                  <button className="btn ghost small" aria-label="削除" onClick={async () => { await run(() => api.del(`/criteria/${c.id}`)); reload(); }}>
                    <Icon name="trash" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        {suggested.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3>提案（未採用）</h3>
            <p className="muted" style={{ fontSize: 12 }}>比較項目から作成した候補です。採用するかどうか、Weightをいくつにするかはあなたが決めます。</p>
            {suggested.map((c) => (
              <div className="list-item" key={c.id}>
                <span className="grow">
                  {c.name} <small className="muted">{DIR_LABEL[c.direction]}</small>
                </span>
                {editor && (
                  <>
                    <button className="btn small" onClick={async () => { await run(() => api.patch(`/criteria/${c.id}`, { status: 'active' })); reload(); }}>
                      採用
                    </button>
                    <button className="btn ghost small" onClick={async () => { await run(() => api.del(`/criteria/${c.id}`)); reload(); }}>
                      却下
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Scenario 比較</h2>
          {editor && active.length > 0 && (
            <button className="btn primary small" onClick={() => setScEdit({})}>
              <Icon name="plus" /> Scenarioを追加
            </button>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>重視する条件（Travel / Performance / Budget、Small Team / Enterprise Security など）ごとにWeightとMust-haveを変えて、結果がどう変わるかを確認します。</p>
        <div className="row" style={{ marginBottom: 12 }}>
          {scen.data?.map((s) => (
            <span key={s.id} className="chip">
              {s.name}
              {editor && (
                <>
                  <button className="btn ghost small" style={{ height: 20 }} onClick={() => setScEdit(s)}>
                    編集
                  </button>
                  <button className="btn ghost small" style={{ height: 20 }} aria-label="削除" onClick={async () => { await run(() => api.del(`/scenarios/${s.id}`)); reload(); }}>
                    ×
                  </button>
                </>
              )}
            </span>
          ))}
        </div>
        {matrix.data && active.length > 0 && (
          <>
            {matrix.data.resultsDiffer && <div className="callout ok" style={{ marginBottom: 10 }}>条件（Scenario）によって、スコアが最も高い候補が変わります。</div>}
            <div className="table-wrap">
              <table className="data" data-testid="scenario-matrix">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    {candidates.map((c) => (
                      <th key={c.id}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.data.scenarios.map((s: any) => (
                    <tr key={s.id ?? 'default'}>
                      <th>{s.name}</th>
                      {candidates.map((c) => {
                        const sc = s.scores.find((x: any) => x.candidateId === c.id);
                        const top = s.topCandidateIds.includes(c.id);
                        return (
                          <td key={c.id} style={top ? { background: 'var(--ok-50)' } : undefined}>
                            <b>{sc?.score ?? 'N/A'}</b>
                            <small className="muted">/10・{Math.round((sc?.coverage ?? 0) * 100)}%</small> <MustHaveBadge s={sc?.mustHave.status} />
                            {top && <div><small>このScenarioで最も高い</small></div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Criteriaを編集' : 'Criteriaを追加'}>
        {edit && (
          <CriterionForm
            attrs={activeAttrs}
            initial={edit.id ? edit : undefined}
            busy={busy}
            onSubmit={async (v) => {
              const ok = await run(() => (edit.id ? api.patch(`/criteria/${edit.id}`, v) : api.post(`/projects/${pid}/criteria`, v)), '保存しました');
              if (ok) {
                setEdit(null);
                reload();
              }
            }}
          />
        )}
      </Modal>
      <Modal open={!!scEdit} onClose={() => setScEdit(null)} title={scEdit?.id ? 'Scenarioを編集' : 'Scenarioを追加'}>
        {scEdit && (
          <ScenarioEditor
            criteria={active}
            initial={scEdit.id ? scEdit : undefined}
            busy={busy}
            onSubmit={async (v) => {
              const ok = await run(() => (scEdit.id ? api.patch(`/scenarios/${scEdit.id}`, v) : api.post(`/projects/${pid}/scenarios`, v)), '保存しました');
              if (ok) {
                setScEdit(null);
                reload();
              }
            }}
          />
        )}
      </Modal>
    </div>
  );
}
