import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api, useApi, wsApi } from '../lib/api';
import { can, useRole, useSession } from '../lib/session';
import { fmtDate, ROLE_LABEL, useAction } from '../components/ui';
import { AuditList } from './Misc';

export function WorkspaceSettingsPage() {
  const { ws } = useParams() as { ws: string };
  const role = useRole(ws);
  const { me, refresh } = useSession();
  const w = wsApi(ws);
  const info = useApi<any>(`/api/w/${ws}`, [ws]);
  const members = useApi<any[]>(`/api/w/${ws}/members`, [ws]);
  const tokens = useApi<any[]>(`/api/w/${ws}/tokens`, [ws]);
  const usage = useApi<any>(`/api/w/${ws}/ai-usage`, [ws]);
  const { run, busy } = useAction();
  const nav = useNavigate();
  const [invite, setInvite] = useState({ email: '', role: 'viewer' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [tok, setTok] = useState({ name: 'MCP', write: false });
  const [newToken, setNewToken] = useState<string | null>(null);
  const admin = can(role, 'admin');
  const d = info.data;
  const toggle = async (key: string, value: boolean, msg: string) => {
    await run(() => w.patch('', { [key]: value }), msg);
    void info.reload();
  };
  return (
    <div className="content stack" style={{ gap: 20 }}>
      <h1>設定</h1>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="stack">
          <div className="card stack">
            <h2>ワークスペース</h2>
            {d && (
              <>
                <label className="field">
                  名前
                  <input
                    defaultValue={d.name}
                    disabled={!admin}
                    onBlur={async (e) => {
                      if (e.target.value && e.target.value !== d.name) {
                        await run(() => w.patch('', { name: e.target.value }), '保存しました');
                        void refresh();
                      }
                    }}
                  />
                </label>
                <label className="check">
                  <input type="checkbox" checked={d.aiEnabled} disabled={!admin} onChange={(e) => toggle('aiEnabled', e.target.checked, e.target.checked ? 'AIをONにしました' : 'ワークスペース全体でAIをOFFにしました')} />
                  AI機能を使う（OFFにすると全プロジェクトで外部AIへの送信を停止）
                </label>
                <label className="check">
                  <input type="checkbox" checked={d.sharingEnabled} disabled={!admin} onChange={(e) => toggle('sharingEnabled', e.target.checked, e.target.checked ? '共有リンクを有効にしました' : '共有を無効にし、既存リンクを失効させました')} />
                  閲覧専用の共有リンクを許可する（既定OFF）
                </label>
                <p className="muted" style={{ fontSize: 12 }}>
                  AIプロバイダ: {me?.ai.configured ? me.ai.provider : '未設定（ルールベースのみ）'}・AI呼び出し合計: {usage.data?.usage.reduce((s: number, u: any) => s + u.calls, 0) ?? '–'} 回
                </p>
              </>
            )}
          </div>
          <div className="card stack">
            <h2>メンバーとロール</h2>
            <p className="muted" style={{ fontSize: 12 }}>Owner / Admin / Editor（編集）/ Reviewer（Factレビュー・コメント）/ Viewer（閲覧のみ）</p>
            <div className="list">
              {members.data?.map((m) => (
                <div className="list-item" key={m.id}>
                  <div className="grow">
                    <b>{m.name}</b> <small className="muted">{m.email}</small>
                  </div>
                  {admin && m.id !== me?.user.id ? (
                    <>
                      <select
                        aria-label={`${m.name}のロール`}
                        value={m.role}
                        style={{ width: 120 }}
                        onChange={async (e) => {
                          await run(() => w.patch(`/members/${m.id}`, { role: e.target.value }), 'ロールを変更しました');
                          void members.reload();
                        }}
                      >
                        {Object.entries(ROLE_LABEL).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn ghost small danger"
                        onClick={async () => {
                          if (!confirm(`${m.name} をワークスペースから外しますか？`)) return;
                          await run(() => w.del(`/members/${m.id}`));
                          void members.reload();
                        }}
                      >
                        外す
                      </button>
                    </>
                  ) : (
                    <span className="badge">{ROLE_LABEL[m.role]}</span>
                  )}
                </div>
              ))}
            </div>
            {admin && (
              <form
                className="row"
                onSubmit={async (e: FormEvent) => {
                  e.preventDefault();
                  const r = await run(() => w.post('/invitations', invite));
                  if (r) {
                    setInviteUrl((r as any).url);
                    setInvite({ email: '', role: 'viewer' });
                  }
                }}
              >
                <input type="email" required placeholder="招待するメールアドレス" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
                <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} style={{ width: 120 }} aria-label="ロール">
                  {Object.entries(ROLE_LABEL)
                    .filter(([k]) => k !== 'owner' || role === 'owner')
                    .map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                </select>
                <button className="btn" disabled={busy}>
                  招待リンクを作成
                </button>
              </form>
            )}
            {inviteUrl && (
              <div className="callout ok">
                招待リンク（7日間有効・メールは送信されません。相手に共有してください）:
                <br />
                <code style={{ wordBreak: 'break-all' }}>{inviteUrl}</code>
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <div className="card stack">
            <h2>APIトークン（MCP連携）</h2>
            <p className="muted" style={{ fontSize: 12 }}>
              ChatGPT / Codex / Claude などの MCP クライアントから Selequo のツールを使うためのトークンです。権限はあなたの現在のロールを超えません。「候補を選ぶ（決定する）」ツールは提供していません。
            </p>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await run(() => w.post('/tokens', { name: tok.name, scopes: tok.write ? ['read', 'write'] : ['read'] }));
                if (r) {
                  setNewToken((r as any).token);
                  void tokens.reload();
                }
              }}
            >
              <input value={tok.name} onChange={(e) => setTok({ ...tok, name: e.target.value })} style={{ flex: 1 }} aria-label="トークン名" maxLength={60} />
              <label className="check">
                <input type="checkbox" checked={tok.write} onChange={(e) => setTok({ ...tok, write: e.target.checked })} disabled={!can(role, 'reviewer')} /> 書き込み
              </label>
              <button className="btn" disabled={busy}>
                作成
              </button>
            </form>
            {newToken && (
              <div className="callout ok">
                トークン（この画面でのみ表示されます）:
                <br />
                <code style={{ wordBreak: 'break-all' }} data-testid="new-token">
                  {newToken}
                </code>
                <p style={{ marginTop: 6, fontSize: 12 }}>
                  MCPエンドポイント: <code>{location.origin}/mcp</code>（Streamable HTTP・Authorization: Bearer）
                </p>
              </div>
            )}
            <div className="list">
              {tokens.data?.map((t) => (
                <div className="list-item" key={t.id}>
                  <span className="grow">
                    <b>{t.name}</b> <small className="muted">{t.scopes.join(', ')}・作成 {fmtDate(t.createdAt)}・最終使用 {fmtDate(t.lastUsedAt)}</small>
                  </span>
                  {t.revokedAt ? (
                    <span className="badge">失効</span>
                  ) : (
                    <button className="btn small danger" onClick={async () => { await run(() => w.del(`/tokens/${t.id}`), '失効させました'); void tokens.reload(); }}>
                      失効
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          {admin && (
            <div className="card stack">
              <h2>バックアップ / リストア</h2>
              <p className="muted" style={{ fontSize: 12 }}>
                すべてのプロジェクト・候補・ソース（ファイル含む）・Fact・Criteria・Scenario・判断記録・監査ログを ZIP に書き出します（schemaVersion / appVersion / checksum 付き）。リストアは新しいワークスペースとして復元します。
              </p>
              <a className="btn" href={w.url('/backup')} download>
                バックアップをダウンロード
              </a>
              <label className="btn" style={{ cursor: 'pointer' }}>
                バックアップから復元…
                <input
                  className="sr-only"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const fd = new FormData();
                    fd.append('file', file);
                    const r = await run(() => api('POST', '/api/restore', fd), '復元しました');
                    if (r) {
                      await refresh();
                      nav(`/w/${(r as any).workspaceId}`);
                    }
                  }}
                />
              </label>
            </div>
          )}
          <div className="card stack">
            <h2>新しいワークスペース</h2>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = (e.currentTarget.elements.namedItem('wsname') as HTMLInputElement).value;
                const r = await run(() => api('POST', '/api/workspaces', { name }), '作成しました');
                if (r) {
                  await refresh();
                  nav(`/w/${(r as any).id}`);
                }
              }}
            >
              <input name="wsname" required placeholder="ワークスペース名" style={{ flex: 1 }} maxLength={80} />
              <button className="btn">作成</button>
            </form>
          </div>
        </div>
      </div>
      {can(role, 'reviewer') && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>監査ログ（ワークスペース全体）</h2>
          <AuditList />
        </div>
      )}
    </div>
  );
}
