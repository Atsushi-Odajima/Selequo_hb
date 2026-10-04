import { createContext, useContext } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';
import { useApi, wsApi } from '../lib/api';
import { useRole } from '../lib/session';
import { ErrorBox, Icon, Loading } from '../components/ui';
import type { Candidate, Role } from '@shared/types';

interface ProjectCtx {
  ws: string;
  pid: string;
  project: any;
  candidates: Candidate[];
  role: Role | null;
  api: ReturnType<typeof wsApi>;
  reload: () => void;
  missing: any | null;
  reloadMissing: () => void;
}
const Ctx = createContext<ProjectCtx>(null as never);
export const useProject = () => useContext(Ctx);

export function ProjectLayout() {
  const { ws, pid } = useParams() as { ws: string; pid: string };
  const role = useRole(ws);
  const project = useApi(`/api/w/${ws}/projects/${pid}`, [ws, pid]);
  const cands = useApi<Candidate[]>(`/api/w/${ws}/projects/${pid}/candidates`, [ws, pid]);
  const missing = useApi(`/api/w/${ws}/projects/${pid}/missing`, [ws, pid]);
  if (project.error) return <div className="content"><ErrorBox error={project.error} /></div>;
  if (!project.data || !cands.data) return <Loading />;
  const base = `/w/${ws}/p/${pid}`;
  const m = missing.data;
  const tab = (to: string, label: string, count?: number, alert = false) => (
    <NavLink end={to === ''} to={`${base}${to ? '/' + to : ''}`} className={({ isActive }) => (isActive ? 'active' : '')}>
      {label}
      {count !== undefined && count > 0 && <span className={`count ${alert ? 'alert' : ''}`}>{count}</span>}
    </NavLink>
  );
  const value: ProjectCtx = {
    ws,
    pid,
    project: project.data,
    candidates: cands.data,
    role,
    api: wsApi(ws),
    reload: () => {
      void project.reload();
      void cands.reload();
      void missing.reload();
    },
    missing: m,
    reloadMissing: () => void missing.reload(),
  };
  return (
    <Ctx.Provider value={value}>
      <div className="content">
        <div className="page-head">
          <div>
            <small className="muted">比較プロジェクト</small>
            <h1>{project.data.title}</h1>
            {project.data.purpose && <p className="sub">{project.data.purpose}</p>}
          </div>
          <div className="row">
            {!project.data.aiEnabled && <span className="badge">AI OFF</span>}
            {project.data.status === 'decided' && <span className="badge ok">判断済み</span>}
          </div>
        </div>
        <nav className="tabs project-tabs" aria-label="プロジェクト">
          {tab('', '概要')}
          {tab('import', '情報取込')}
          {tab('review', '根拠レビュー', undefined)}
          {tab('compare', '比較表')}
          {tab('attributes', '比較項目')}
          {tab('criteria', 'Criteria・Scenario')}
          {tab('questions', '不明点・質問', m ? m.missing.length + m.conflicts.length : undefined, !!m && m.conflicts.length > 0)}
          {tab('decision', 'Decision Brief')}
          {tab('activity', '履歴')}
          {tab('settings', '設定')}
        </nav>
        <Outlet />
      </div>
      <nav className="bottom-nav" aria-label="プロジェクト（モバイル）">
        <NavLink to={`${base}/compare`} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="table" />
          比較
        </NavLink>
        <NavLink to={`${base}/import`} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="camera" />
          追加
        </NavLink>
        <NavLink to={`${base}/questions`} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="alert" />
          不明点
        </NavLink>
        <NavLink to={`${base}/decision`} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="brief" />
          Brief
        </NavLink>
        <NavLink end to={base} className={({ isActive }) => (isActive ? 'active' : '')}>
          <Icon name="list" />
          その他
        </NavLink>
      </nav>
    </Ctx.Provider>
  );
}
