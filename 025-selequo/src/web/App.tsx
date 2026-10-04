import { useEffect, useState } from 'react';
import { createBrowserRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useNavigate, useParams } from 'react-router';
import { SessionProvider, useSession } from './lib/session';
import { Icon, Loading, Logo, ToastProvider, useToast } from './components/ui';
import { startNoteSync } from './lib/offline';
import { LoginPage, SignupPage, InvitePage } from './pages/Auth';
import { ProjectsPage } from './pages/Projects';
import { ProjectLayout } from './pages/ProjectLayout';
import { OverviewPage } from './pages/Overview';
import { ImportPage } from './pages/Import';
import { ReviewPage } from './pages/Review';
import { ComparePage } from './pages/Compare';
import { AttributesPage } from './pages/Attributes';
import { CriteriaPage } from './pages/Criteria';
import { QuestionsPage } from './pages/Questions';
import { DecisionPage } from './pages/Decision';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettings';
import { ActivityPage, ProjectSettingsPage, SearchPage, SharedPage, ShareTargetPage } from './pages/Misc';

function RequireAuth() {
  const { me, loading } = useSession();
  if (loading) return <Loading />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

function Home() {
  const { me } = useSession();
  if (!me) return <Navigate to="/login" replace />;
  const ws = me.workspaces[0];
  return ws ? <Navigate to={`/w/${ws.id}`} replace /> : <div className="content">ワークスペースがありません</div>;
}

function Shell() {
  const { ws } = useParams();
  const { me, logout } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  useEffect(() => startNoteSync((n) => toast(`オフラインで書いたメモ ${n} 件を同期しました`)), [toast]);
  const current = me?.workspaces.find((w) => w.id === ws);
  if (me && !current) return <Navigate to="/" replace />;
  return (
    <div className="app">
      <nav className={`sidebar ${open ? 'open' : ''}`} aria-label="メインメニュー" onClick={() => setOpen(false)}>
        <NavLink to={`/w/${ws}`} className="brand-link" style={{ textDecoration: 'none' }}>
          <Logo />
        </NavLink>
        <NavLink end to={`/w/${ws}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="folder" /> マイプロジェクト
        </NavLink>
        <Link to={`/w/${ws}?new=1`} className="nav-item">
          <Icon name="plus" /> 新規比較
        </Link>
        <NavLink to={`/w/${ws}/search`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="search" /> 横断検索
        </NavLink>
        <NavLink to={`/w/${ws}/settings`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Icon name="settings" /> 設定
        </NavLink>
        <div className="spacer" />
        <div className="nav-section">ワークスペース</div>
        <select aria-label="ワークスペース切替" value={ws} onChange={(e) => nav(`/w/${e.target.value}`)} onClick={(e) => e.stopPropagation()}>
          {me?.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <div className="muted" style={{ fontSize: 12, padding: '8px 4px' }}>
          {me?.user.name}（{current?.role}）
        </div>
        <button
          className="btn ghost small"
          onClick={async () => {
            await logout();
            nav('/login');
          }}
        >
          <Icon name="logout" /> ログアウト
        </button>
      </nav>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost small" aria-label="メニュー" onClick={() => setOpen((o) => !o)}>
            <Icon name="menu" />
          </button>
          <NavLink to={`/w/${ws}`} style={{ textDecoration: 'none' }}>
            <Logo />
          </NavLink>
          <NavLink to={`/w/${ws}/search`} className="btn ghost small" aria-label="検索">
            <Icon name="search" />
          </NavLink>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> },
  { path: '/s/:token', element: <SharedPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/invite/:token', element: <InvitePage /> },
      { path: '/share-target', element: <ShareTargetPage /> },
      {
        path: '/w/:ws',
        element: <Shell />,
        children: [
          { index: true, element: <ProjectsPage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'settings', element: <WorkspaceSettingsPage /> },
          {
            path: 'p/:pid',
            element: <ProjectLayout />,
            children: [
              { index: true, element: <OverviewPage /> },
              { path: 'import', element: <ImportPage /> },
              { path: 'review', element: <ReviewPage /> },
              { path: 'compare', element: <ComparePage /> },
              { path: 'attributes', element: <AttributesPage /> },
              { path: 'criteria', element: <CriteriaPage /> },
              { path: 'questions', element: <QuestionsPage /> },
              { path: 'decision', element: <DecisionPage /> },
              { path: 'activity', element: <ActivityPage /> },
              { path: 'settings', element: <ProjectSettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ToastProvider>
  );
}
