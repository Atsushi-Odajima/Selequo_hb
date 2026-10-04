// Activity (audit), project settings, search, shared (guest) view and PWA share target.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, useApi } from '../lib/api';
import { can, useSession } from '../lib/session';
import { BriefView } from '../components/BriefView';
import { ErrorBox, fmtDate, Loading, Logo, useAction } from '../components/ui';
import { useProject } from './ProjectLayout';

const ACTION_LABEL: Record<string, string> = {
  'project.create': 'プロジェクト作成',
  'project.update': 'プロジェクト更新',
  'project.ai_toggle': 'AI設定変更',
  'candidate.create': '候補追加',
  'candidate.status': '候補の状態変更',
  'source.add': 'ソース追加',
  'source.delete': 'ソース削除',
  'fact.confirm': 'Fact Confirm',
  'fact.reject': 'Fact Reject',
  'fact.reopen': 'Fact 未確認に戻す',
  'fact.supersede': 'Fact Superseded',
  'fact.create_manual': 'Fact手入力',
  'conflict.resolve': 'Conflict解決',
  'normalization.rule': '正規化ルール',
  'criterion.create': 'Criteria追加',
  'criterion.create_must_have': 'Must-have追加',
  'criterion.weight': 'Weight変更',
  'criterion.must_have': 'Must-have変更',
  'scenario.create': 'Scenario追加',
  'scenario.update': 'Scenario更新',
  'decision.decide': '判断を記録',
  'decision.review': '振り返り',
  'brief.create': 'Brief保存',
  'brief.export': 'Brief出力',
  'share.create': '共有リンク作成',
  'member.role': 'ロール変更',
  'backup.create': 'バックアップ',
  'assistant.ask': 'Assistantに質問',
};

export function AuditList({ projectId }: { projectId?: string }) {
  const { ws } = useParams();
  const audit = useApi<any[]>(`/api/w/${ws}/audit${projectId ? `?projectId=${projectId}` : ''}`, [ws, projectId]);
  if (audit.error) return <ErrorBox error={audit.error} />;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>日時</th>
            <th>操作</th>
            <th>実行者</th>
            <th>対象</th>
          </tr>
        </thead>
        <tbody>
          {audit.data?.map((a) => (
            <tr key={a.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.createdAt, true)}</td>
              <td>{ACTION_LABEL[a.action] ?? a.action}</td>
              <td>
                {a.actorName ?? a.actorType}
                {a.actorType === 'token' && <span className="badge" style={{ marginLeft: 4 }}>API/MCP</span>}
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                {a.entityType}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActivityPage() {
  const { pid, role } = useProject();
  if (!can(role, 'reviewer')) return <div className="callout">履歴の閲覧には Reviewer 以上の権限が必要です。</div>;
  return (
    <div className="card">
      <h2 style={{ marginBottom: 10 }}>変更履歴（Audit）</h2>
      <AuditList projectId={pid} />
    </div>
  );
}

export function ProjectSettingsPage() {
  const { ws, pid, api: p, project, role, reload } = useProject();
  const shares = useApi<any[]>(can(role, 'admin') ? `/api/w/${ws}/projects/${pid}/shares` : null, [pid]);
  const usage = useApi<any>(`/api/w/${ws}/ai-usage?projectId=${pid}`, [pid]);
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [link, setLink] = useState<string | null>(null);
  const editor = can(role, 'editor');
  const [f, setF] = useState({ title: project.title, purpose: project.purpose ?? '', deadline: project.deadline ?? '', seats: project.defaultParams?.seats ?? '', costBasis: project.defaultParams?.costBasis ?? 'annual_total' });
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <form
        className="card stack"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          await run(() => p.patch(`/projects/${pid}`, { title: f.title, purpose: f.purpose || null, deadline: f.deadline || null, defaultParams: { seats: f.seats ? Number(f.seats) : null, costBasis: f.costBasis } }), '保存しました');
          reload();
        }}
      >
        <h2>プロジェクト設定</h2>
        <label className="field">
          タイトル
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} disabled={!editor} />
        </label>
        <label className="field">
          目的
          <textarea value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} disabled={!editor} />
        </label>
        <div className="form-grid">
          <label className="field">
            期限
            <input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} disabled={!editor} />
          </label>
          <label className="field">
            既定の席数
            <input type="number" min={1} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} disabled={!editor} />
          </label>
        </div>
        {editor && (
          <button className="btn primary" disabled={busy}>
            保存
          </button>
        )}
      </form>
      <div className="stack">
        <div className="card stack">
          <h2>AI とプライバシー</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={project.aiEnabled}
              disabled={!editor}
              onChange={async (e) => {
                await run(() => p.patch(`/projects/${pid}`, { aiEnabled: e.target.checked }), e.target.checked ? 'このプロジェクトでAIをONにしました' : 'このプロジェクトでAIをOFFにしました');
                reload();
              }}
            />
            このプロジェクトでAI（抽出・Assistant・画像読み取り）を使う
          </label>
          <p className="muted" style={{ fontSize: 12 }}>
            OFFの場合、AIプロバイダへの送信は一切行いません（ローカルのルールベース抽出のみ）。ONの場合に送信されるのは、AIを許可したソースの本文（抽出時）、スクショ画像（読み取り時）、Assistantへの質問と関連Factです。分析・ログにソース本文は使いません。
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={project.factPolicy === 'include_unreviewed'}
              disabled={!editor}
              onChange={async (e) => {
                await run(() => p.patch(`/projects/${pid}`, { factPolicy: e.target.checked ? 'include_unreviewed' : 'confirmed_only' }));
                reload();
              }}
            />
            未確認のFactもスコア計算に含める（既定: Confirmedのみ）
          </label>
          <div>
            <small className="muted">AI呼び出し回数（このプロジェクト）: </small>
            <b data-testid="ai-calls">{usage.data ? usage.data.usage.reduce((s: number, u: any) => s + u.calls, 0) : '–'}</b>
          </div>
        </div>
        {can(role, 'admin') && (
          <div className="card stack">
            <h2>共有（閲覧専用リンク）</h2>
            <p className="muted" style={{ fontSize: 12 }}>ワークスペース設定で共有がONの場合のみ作成できます。ゲストは比較表とBriefを閲覧のみできます。</p>
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                const r = await run(() => p.post(`/projects/${pid}/shares`, { days: 14 }));
                if (r) {
                  setLink((r as any).url);
                  void shares.reload();
                }
              }}
            >
              14日間有効なリンクを作成
            </button>
            {link && (
              <div className="callout ok">
                リンク（この画面でのみ表示）: <code style={{ wordBreak: 'break-all' }}>{link}</code>
              </div>
            )}
            {shares.data?.map((s) => (
              <div className="list-item" key={s.id}>
                <span className="grow">
                  作成 {fmtDate(s.createdAt)}・期限 {fmtDate(s.expiresAt)}
                </span>
                {s.revokedAt ? (
                  <span className="badge">無効</span>
                ) : (
                  <button className="btn small danger" onClick={async () => { await run(() => p.del(`/shares/${s.id}`)); void shares.reload(); }}>
                    無効化
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="card stack">
          <h2>エクスポート</h2>
          <div className="row">
            <a className="btn small" href={p.url(`/projects/${pid}/export.json`)} download>
              プロジェクトJSON
            </a>
            <a className="btn small" href={p.url(`/projects/${pid}/compare.csv`)} download>
              比較表CSV
            </a>
          </div>
          {can(role, 'admin') && (
            <button
              className="btn danger"
              onClick={async () => {
                if (!confirm('このプロジェクトと、ソース・ファイル・Fact・判断記録をすべて削除します。元に戻せません。')) return;
                const ok = await run(() => p.del(`/projects/${pid}`), '削除しました');
                if (ok !== undefined) nav(`/w/${ws}`);
              }}
            >
              プロジェクトを削除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchPage() {
  const { ws } = useParams();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const [text, setText] = useState(q);
  const res = useApi<any[]>(q ? `/api/w/${ws}/search?q=${encodeURIComponent(q)}` : null, [ws, q]);
  const TYPE: Record<string, string> = { project: 'プロジェクト', candidate: '候補', source: 'ソース', fact: 'Fact', question: '質問', decision: '判断' };
  const link = (r: any) => {
    const base = `/w/${ws}/p/${r.projectId ?? r.id}`;
    return { project: base, candidate: base, source: `${base}/import`, fact: `${base}/review`, question: `${base}/questions`, decision: `${base}/decision` }[r.type as string] ?? base;
  };
  return (
    <div className="content">
      <h1 style={{ marginBottom: 14 }}>横断検索</h1>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setSp({ q: text });
        }}
      >
        <input type="search" placeholder="プロジェクト・候補・ソース本文・Fact・質問・判断を検索" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} aria-label="検索語" />
        <button className="btn primary">検索</button>
      </form>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>検索対象はあなたが所属するこのワークスペースのみです。削除したソースは検索結果に表示されません。</p>
      {res.loading && <Loading />}
      <div className="list" style={{ marginTop: 14 }}>
        {res.data?.length === 0 && <div className="empty">見つかりませんでした</div>}
        {res.data?.map((r) => (
          <Link key={r.type + r.id} to={link(r)} className="list-item" style={{ color: 'inherit' }}>
            <span className="badge">{TYPE[r.type] ?? r.type}</span>
            <div className="grow">
              <b>{r.title}</b>
              <div className="muted truncate" style={{ fontSize: 12 }}>
                {r.snippet}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SharedPage() {
  const { token } = useParams();
  const res = useApi<any>(`/api/share/${token}`, [token]);
  return (
    <div className="content" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="row spread" style={{ marginBottom: 16 }}>
        <Logo />
        <span className="badge">閲覧専用</span>
      </div>
      <ErrorBox error={res.error} />
      {res.data && (
        <div className="stack" style={{ gap: 20 }}>
          <div className="table-wrap">
            <table className="data compare">
              <thead>
                <tr>
                  <th className="attr">項目</th>
                  {res.data.compare.candidates.map((c: any) => (
                    <th key={c.id}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.data.compare.rows.map((r: any) => (
                  <tr key={r.attributeKey} className={r.differs ? 'differs' : ''}>
                    <th className="attr">{r.displayName}</th>
                    {r.cells.map((c: any) => (
                      <td key={c.candidateId} className={`cell ${c.status}`} style={{ cursor: 'default' }}>
                        <span className="val">{c.display}</span>
                        {c.status === 'conflict' && <span className="badge conflict" style={{ marginLeft: 4 }}>Conflict</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <BriefView b={res.data.brief} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ShareTargetPage() {
  const [sp] = useSearchParams();
  const { me } = useSession();
  const nav = useNavigate();
  const url = sp.get('url') || (sp.get('text') ?? '').match(/https?:\/\/\S+/)?.[0] || '';
  const [ws, setWs] = useState(me?.workspaces[0]?.id ?? '');
  const projects = useApi<any[]>(ws ? `/api/w/${ws}/projects` : null, [ws]);
  const [pid, setPid] = useState('');
  const cands = useApi<any[]>(pid ? `/api/w/${ws}/projects/${pid}/candidates` : null, [pid]);
  const [cid, setCid] = useState('');
  const { run, busy } = useAction();
  return (
    <div className="content" style={{ maxWidth: 520, margin: '0 auto' }}>
      <Logo />
      <div className="card stack" style={{ marginTop: 14 }}>
        <h2>共有されたURLを追加</h2>
        <code style={{ wordBreak: 'break-all' }}>{url || '（URLがありません）'}</code>
        <select value={ws} onChange={(e) => setWs(e.target.value)} aria-label="ワークスペース">
          {me?.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="プロジェクト">
          <option value="">プロジェクトを選択</option>
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="候補" disabled={!pid}>
          <option value="">候補を選択</option>
          {cands.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={busy || !url || !pid}
          onClick={async () => {
            const ok = await run(() => api('POST', `/api/w/${ws}/projects/${pid}/sources/url`, { url, candidateId: cid || null }), '追加しました');
            if (ok) nav(`/w/${ws}/p/${pid}/import`);
          }}
        >
          追加する
        </button>
      </div>
    </div>
  );
}
