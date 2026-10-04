import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, setCsrf } from '../lib/api';
import { useSession } from '../lib/session';
import { Logo, useToast } from '../components/ui';

function Art() {
  return (
    <div className="art">
      <Logo />
      <div>
        <h1>
          候補を集める。
          <br />
          違いが見える。
          <br />
          <span className="dot">・</span>決めやすくなる。
        </h1>
        <p style={{ marginTop: 16, color: 'var(--lav)', maxWidth: 440 }}>URL・PDF・スクショから比較表を作り、出典・不足情報まで整理します。決めるのは、あなたです。</p>
      </div>
      <div className="tag">COMPARE. CLARIFY. DECIDE.</div>
      <div className="slash" />
      <div className="slash2" />
    </div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ csrf: string }>('POST', '/api/auth/login', { email, password });
      setCsrf(r.csrf);
      await refresh();
      const next = sp.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <Art />
      <div className="panel">
        <form onSubmit={submit} aria-label="ログイン">
          <h1>ログイン</h1>
          <label className="field">
            メールアドレス
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            パスワード
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy} type="submit">
            ログイン
          </button>
          <p className="muted">
            アカウントがない場合は <Link to={`/signup${sp.get('next') ? `?next=${encodeURIComponent(sp.get('next')!)}` : ''}`}>新規登録</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export function SignupPage() {
  const [f, setF] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ csrf: string; workspaceId: string }>('POST', '/api/auth/signup', { ...f, workspaceName: f.workspaceName || undefined });
      setCsrf(r.csrf);
      await refresh();
      const next = sp.get('next');
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : `/w/${r.workspaceId}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <Art />
      <div className="panel">
        <form onSubmit={submit} aria-label="新規登録">
          <h1>新規登録</h1>
          <label className="field">
            お名前
            <input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label className="field">
            メールアドレス
            <input type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </label>
          <label className="field">
            パスワード <span className="hint">10文字以上</span>
            <input type="password" autoComplete="new-password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </label>
          <label className="field">
            ワークスペース名 <span className="hint">任意</span>
            <input maxLength={80} value={f.workspaceName} onChange={(e) => setF({ ...f, workspaceName: e.target.value })} />
          </label>
          <button className="btn primary" disabled={busy} type="submit">
            登録してはじめる
          </button>
          <p className="muted">
            登録済みの場合は <Link to="/login">ログイン</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export function InvitePage() {
  const { token } = useParams();
  const { refresh } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="content" style={{ maxWidth: 520, margin: '40px auto' }}>
      <div className="card stack">
        <Logo />
        <h1>ワークスペースへの招待</h1>
        <p>招待を受け入れると、招待されたロールでワークスペースに参加します。</p>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api<{ workspaceId: string }>('POST', `/api/invitations/${token}/accept`);
              await refresh();
              nav(`/w/${r.workspaceId}`);
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          参加する
        </button>
      </div>
    </div>
  );
}
