import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { addMonths, compareMonths, currentMonth, monthKey, monthLabel, type YearMonth } from '../lib/format';

// ---------- Icons (inline, stroke-based) ----------
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const Icon = {
  home: svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  scale: svg(<><path d="M12 3v18" /><path d="M5 21h14" /><path d="m5 7 14-2" /><path d="M2 14l3-7 3 7a3 3 0 0 1-6 0Z" /><path d="M16 12l3-7 3 7a3 3 0 0 1-6 0Z" /></>),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  left: svg(<path d="m15 18-6-6 6-6" />),
  right: svg(<path d="m9 18 6-6-6-6" />),
  back: svg(<path d="M19 12H5m7-7-7 7 7 7" />),
  sun: svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: svg(<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />),
  monitor: svg(<><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>),
  arrow: svg(<path d="M5 12h14m-6-6 6 6-6 6" />),
  lock: svg(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>),
  up: svg(<path d="m18 15-6-6-6 6" />),
  down: svg(<path d="m6 9 6 6 6-6" />),
  close: svg(<path d="M18 6 6 18M6 6l12 12" />),
};

export const Spinner = () => <div className="spinner" role="status" aria-label="Loading" />;

export function EmptyState({ icon = '🧾', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <strong style={{ color: 'var(--text)' }}>{title}</strong>
      {children}
    </div>
  );
}

export const initials = (name: string) =>
  name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export const Avatar = ({ name }: { name: string }) => <span className="avatar" aria-hidden="true">{initials(name)}</span>;

// Category colours: distinguishable in both themes, assigned by category order.
export const CATEGORY_COLOURS = ['#0d9488', '#6366f1', '#f59e0b', '#ec4899', '#0ea5e9', '#84cc16', '#f97316', '#8b5cf6', '#64748b', '#14b8a6', '#e11d48', '#a16207'];
export const categoryColour = (index: number) => CATEGORY_COLOURS[((index % CATEGORY_COLOURS.length) + CATEGORY_COLOURS.length) % CATEGORY_COLOURS.length];

// ---------- Theme ----------
type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'het-theme';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || 'system');
  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(THEME_KEY);
    } else {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(THEME_KEY, theme);
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const label = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }[theme];
  return (
    <button className="icon-btn" onClick={() => setTheme(next[theme])} title={label} aria-label={`${label}. Click to change.`}>
      {theme === 'light' ? Icon.sun : theme === 'dark' ? Icon.moon : Icon.monitor}
    </button>
  );
}

// ---------- Month switcher ----------
export function MonthSwitcher({ value, basePath, badge }: { value: YearMonth; basePath: string; badge?: ReactNode }) {
  const now = currentMonth();
  const prev = addMonths(value, -1);
  const next = addMonths(value, 1);
  const canNext = compareMonths(next, now) <= 0;
  const href = (m: YearMonth) => (compareMonths(m, now) === 0 ? basePath : `${basePath}?m=${monthKey(m)}`);
  return (
    <div className="month-switcher">
      <Link className="icon-btn" to={href(prev)} aria-label={`Previous month, ${monthLabel(prev)}`}>{Icon.left}</Link>
      <div className="month-title">
        <strong>{monthLabel(value)}</strong>
        {badge}
      </div>
      {canNext ? (
        <Link className="icon-btn" to={href(next)} aria-label={`Next month, ${monthLabel(next)}`}>{Icon.right}</Link>
      ) : (
        <span className="icon-btn" aria-hidden="true" style={{ opacity: 0.25 }}>{Icon.right}</span>
      )}
    </div>
  );
}

export function StatusBadge({ status, isCurrent }: { status: 'open' | 'closed' | 'reopened'; isCurrent: boolean }) {
  if (status === 'closed') return <span className="badge closed"><span style={{ width: 12, height: 12, display: 'inline-flex' }}>{Icon.lock}</span>Month closed</span>;
  if (status === 'reopened') return <span className="badge warn">Reopened for corrections</span>;
  if (isCurrent) return <span className="badge accent">Month in progress</span>;
  return <span className="badge warn">Waiting for Owner to close</span>;
}

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => setMsg(m), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2800);
    return () => clearTimeout(t);
  }, [msg]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
