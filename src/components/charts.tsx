import { formatPaise } from '../lib/format';
import { Avatar, Icon } from './ui';

export interface Slice {
  label: string;
  paise: number;
  colour: string;
}

/** Donut chart of category spend, with a legend that carries the numbers (chart is decorative for screen readers). */
export function CategoryDonut({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((a, s) => a + s.paise, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="chart">
      <svg viewBox="0 0 140 140" width="140" height="140" aria-hidden="true">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
        {total > 0 && slices.map((s) => {
          const len = (s.paise / total) * c;
          const el = (
            <circle key={s.label} cx="70" cy="70" r={r} fill="none" stroke={s.colour} strokeWidth="18"
              strokeDasharray={`${Math.max(len - gap, 0.5)} ${c}`} strokeDashoffset={-offset}
              transform="rotate(-90 70 70)" />
          );
          offset += len;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" fontSize="11" fill="var(--muted)">Total</text>
        <text x="70" y="84" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text)">
          {formatPaise(total).replace(/\.00$/, '')}
        </text>
      </svg>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.colour }} aria-hidden="true" />
            <span className="lname">{s.label}</span>
            <span className="num lamount">{formatPaise(s.paise)}</span>
            <span className="tiny muted num lpct">{total ? Math.round((s.paise / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TransferLine({ from, to, paise, children }: { from: string; to: string; paise: number; children?: React.ReactNode }) {
  return (
    <div className="settle-line">
      <Avatar name={from} />
      <div className="grow" style={{ flex: 1, minWidth: 0 }}>
        <div><strong>{from}</strong> pays <strong>{to}</strong></div>
        {children}
      </div>
      <span className="settle-arrow" style={{ width: 18, height: 18, display: 'inline-flex' }} aria-hidden="true">{Icon.arrow}</span>
      <strong className="num">{formatPaise(paise)}</strong>
    </div>
  );
}
