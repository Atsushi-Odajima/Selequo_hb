import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import symbolUrl from '../assets/symbol.svg';

// ---------- icons (simple stroke icons, 24px grid)
const paths: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  import: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
  check: 'M5 12l5 5L20 7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.35-4.35',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-2.5-11.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01',
  brief: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 16h6',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m2 5a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  menu: 'M4 6h16M4 12h16M4 18h16',
  x: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 19h16',
  share: 'M4 12v7h16v-7M12 3v12M8 7l4-4 4 4',
  scale: 'M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0zM8 21h8',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  note: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
};

export function Icon({ name, title }: { name: keyof typeof paths | string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={paths[name] ?? paths.list} />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="Selequo">
      <img src={symbolUrl} alt="" />
      {!compact && <span>Selequo</span>}
    </span>
  );
}

// ---------- toast
type Toast = { id: number; text: string; kind: 'info' | 'error' };
const ToastCtx = createContext<(text: string, kind?: 'info' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Wrap an async action: shows errors as toasts, optional success message. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast((e as Error).message, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---------- overlays
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="btn ghost small close" onClick={onClose} aria-label="閉じる">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="閉じる">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- labels
export const QUALITY_LABEL: Record<string, string> = {
  official: '公式',
  manufacturer: 'メーカー',
  vendor: 'ベンダー',
  marketplace: '販売サイト',
  editorial: 'メディア',
  user_review: 'ユーザーレビュー',
  manual: '手入力',
  unknown: '不明',
};
export const SOURCE_TYPE_LABEL: Record<string, string> = { web: 'Web', pdf: 'PDF', screenshot: 'スクショ', image: '画像', manual: '手入力', csv: 'CSV', text: 'テキスト' };
export const STATE_LABEL: Record<string, string> = { candidate: '未確認', confirmed: 'Confirmed', rejected: 'Rejected', superseded: 'Superseded' };
export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', reviewer: 'Reviewer', viewer: 'Viewer' };

export function StateBadge({ state }: { state: string }) {
  return <span className={`badge ${state}`}>{STATE_LABEL[state] ?? state}</span>;
}
export function QualityBadge({ q }: { q: string }) {
  return <span className={`badge ${q === 'official' || q === 'manufacturer' ? 'official' : ''}`}>{QUALITY_LABEL[q] ?? q}</span>;
}
export function MustHaveBadge({ s }: { s: string | null }) {
  if (!s) return null;
  return <span className={`badge ${s}`}>{s === 'pass' ? 'Pass' : s === 'fail' ? 'Fail' : 'Unknown'}</span>;
}

export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime ? d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString('ja-JP');
}

export function ageLabel(days: number | null) {
  if (days === null) return null;
  if (days === 0) return '今日取得';
  if (days < 30) return `${days}日前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年以上前`;
}

export function Loading() {
  return <div className="muted" style={{ padding: 24 }}>読み込み中…</div>;
}

export function ErrorBox({ error }: { error: Error | null }) {
  if (!error) return null;
  return <div className="callout warn">{error.message}</div>;
}
