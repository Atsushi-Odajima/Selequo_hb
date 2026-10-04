import { useState, type FormEvent } from 'react';
import { useApi } from '../lib/api';
import { can } from '../lib/session';
import { fmtDate, Icon, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';

export function AttributesPage() {
  const { ws, pid, api, role } = useProject();
  const attrs = useApi<any[]>(`/api/w/${ws}/projects/${pid}/attributes`, [pid]);
  const sug = useApi<any>(`/api/w/${ws}/projects/${pid}/attributes/suggestions`, [pid]);
  const rules = useApi<any[]>(`/api/w/${ws}/projects/${pid}/rules`, [pid]);
  const { run, busy } = useAction();
  const [name, setName] = useState('');
  const [type, setType] = useState('text');
  const [unit, setUnit] = useState('');
  const [catalogKey, setCatalogKey] = useState('');
  const editor = can(role, 'editor');
  const reload = () => {
    void attrs.reload();
    void sug.reload();
    void rules.reload();
  };
  async function add(e: FormEvent) {
    e.preventDefault();
    const cat = sug.data?.catalog.find((c: any) => c.key === catalogKey);
    await run(() => api.post(`/projects/${pid}/attributes`, cat ? { key: cat.key, displayName: cat.displayName } : { displayName: name, type, unit: unit || null }), '比較項目を追加しました');
    setName('');
    setUnit('');
    setCatalogKey('');
    reload();
  }
  const active = (attrs.data ?? []).filter((a) => a.status === 'active');
  const removed = (attrs.data ?? []).filter((a) => a.status !== 'active');
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="callout">比較項目（Dynamic Schema）は人が決めます。抽出された未対応のラベルは候補として表示されますが、追加・名前変更・グループ化・削除はあなたが行います。AIが重要度を決めることはありません。</div>
      <div className="grid cols-2">
        <div className="card">
          <h2>比較項目</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>表示名</th>
                  <th>型・単位</th>
                  <th>グループ</th>
                  {editor && <th />}
                </tr>
              </thead>
              <tbody>
                {active.map((a, i) => (
                  <tr key={a.id}>
                    <td>
                      {editor ? (
                        <input
                          aria-label={`${a.displayName}の表示名`}
                          defaultValue={a.displayName}
                          onBlur={async (e) => {
                            if (e.target.value && e.target.value !== a.displayName) {
                              await run(() => api.patch(`/attributes/${a.id}`, { displayName: e.target.value }), '名前を変更しました');
                              reload();
                            }
                          }}
                        />
                      ) : (
                        a.displayName
                      )}
                      <small className="muted">
                        <code>{a.key}</code>
                      </small>
                    </td>
                    <td>
                      {a.type}
                      {a.unit ? ` (${a.unit})` : ''}
                    </td>
                    <td>
                      {editor ? (
                        <input
                          aria-label={`${a.displayName}のグループ`}
                          defaultValue={a.groupName ?? ''}
                          placeholder="例: 仕様"
                          onBlur={async (e) => {
                            if ((e.target.value || null) !== a.groupName) {
                              await run(() => api.patch(`/attributes/${a.id}`, { groupName: e.target.value || null }));
                              reload();
                            }
                          }}
                        />
                      ) : (
                        a.groupName
                      )}
                    </td>
                    {editor && (
                      <td>
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <button className="btn ghost small" aria-label="上へ" disabled={i === 0} onClick={async () => { await run(() => api.patch(`/attributes/${a.id}`, { sortOrder: active[i - 1].sortOrder - 1 })); reload(); }}>
                            ↑
                          </button>
                          <button className="btn ghost small" aria-label="削除" onClick={async () => { await run(() => api.patch(`/attributes/${a.id}`, { status: 'removed' }), '比較表から外しました'); reload(); }}>
                            <Icon name="trash" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {removed.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <small className="muted">外した項目：</small>
              {removed.map((a) => (
                <button key={a.id} className="chip" style={{ margin: 3 }} disabled={!editor} onClick={async () => { await run(() => api.patch(`/attributes/${a.id}`, { status: 'active' })); reload(); }}>
                  + {a.displayName}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="stack">
          {editor && (
            <form className="card stack" onSubmit={add}>
              <h3>項目を追加</h3>
              <label className="field">
                標準項目から
                <select value={catalogKey} onChange={(e) => setCatalogKey(e.target.value)}>
                  <option value="">（独自の項目を作成）</option>
                  {sug.data?.catalog.filter((c: any) => !active.some((a) => a.key === c.key)).map((c: any) => (
                    <option key={c.key} value={c.key}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              </label>
              {!catalogKey && (
                <div className="form-grid">
                  <label className="field full">
                    表示名
                    <input value={name} onChange={(e) => setName(e.target.value)} required={!catalogKey} maxLength={60} />
                  </label>
                  <label className="field">
                    型
                    <select value={type} onChange={(e) => setType(e.target.value)}>
                      <option value="text">テキスト</option>
                      <option value="number">数値</option>
                      <option value="bool">あり/なし</option>
                    </select>
                  </label>
                  <label className="field">
                    単位
                    <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="例: kg, h, GB" maxLength={20} />
                  </label>
                </div>
              )}
              <button className="btn primary" disabled={busy || (!catalogKey && !name)}>
                追加
              </button>
            </form>
          )}
          <div className="card">
            <h3>抽出された未対応のラベル</h3>
            <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              表記が違っても同じ意味なら既存の項目に割り当てます（ルールとして履歴が残ります）。意味が違うもの（例: GPUメモリとメモリ）は割り当てないでください。
            </p>
            {sug.data?.catalogCandidates.map((c: any) => (
              <div className="list-item" key={c.key}>
                <span className="grow">
                  {c.displayName} <small className="muted">（{c.count}件のFact）</small>
                </span>
                {editor && (
                  <button className="btn small" onClick={async () => { await run(() => api.post(`/projects/${pid}/attributes`, { key: c.key, displayName: c.displayName })); reload(); }}>
                    比較表に追加
                  </button>
                )}
              </div>
            ))}
            {sug.data?.unmappedLabels.length === 0 && sug.data?.catalogCandidates.length === 0 && <small className="muted">ありません</small>}
            {sug.data?.unmappedLabels.map((u: any) => (
              <div className="list-item" key={u.label}>
                <span className="grow">
                  「{u.label}」 <small className="muted">{u.count}件</small>
                </span>
                {editor && (
                  <select
                    aria-label={`${u.label}を割り当て`}
                    defaultValue=""
                    style={{ width: 170 }}
                    onChange={async (e) => {
                      if (e.target.value === '__new') await run(() => api.post(`/projects/${pid}/attributes`, { displayName: u.label }).then((a: any) => api.post(`/projects/${pid}/attributes/map-label`, { label: u.label, attributeKey: a.key })), '新しい項目として追加しました');
                      else await run(() => api.post(`/projects/${pid}/attributes/map-label`, { label: u.label, attributeKey: e.target.value }), '割り当てました');
                      reload();
                    }}
                  >
                    <option value="" disabled>
                      割り当て…
                    </option>
                    <option value="__new">＋ 新しい項目にする</option>
                    {active.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
          <div className="card">
            <h3>正規化ルールの履歴</h3>
            {rules.data?.length === 0 && <small className="muted">ルールはまだありません</small>}
            {rules.data?.map((r) => (
              <div key={r.id} className="list-item" style={{ fontSize: 13 }}>
                <span className="grow">
                  「{r.pattern}」→ <code>{r.attributeKey}</code> v{r.version}
                </span>
                <span className={`badge ${r.active ? 'ok' : ''}`}>{r.active ? '有効' : '旧版'}</span>
                <small className="muted">{fmtDate(r.createdAt)}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
