import { NavLink, Outlet, Link } from 'react-router-dom';
import { useApp } from '../lib/session';
import { Icon, ThemeToggle } from './ui';

const links = [
  { to: '/', label: 'Home', icon: Icon.home, end: true },
  { to: '/settlement', label: 'Settlement', icon: Icon.scale, end: false },
  { to: '/settings', label: 'Settings', icon: Icon.settings, end: false },
];

export default function Layout() {
  const { household } = useApp();
  const nav = links.map((l) => (
    <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
      {l.icon}
      <span>{l.label}</span>
    </NavLink>
  ));
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">₹</span>
          <span className="brand-name">{household?.name ?? 'Household'}</span>
        </Link>
        <nav className="topnav" aria-label="Main">{nav}</nav>
        <div className="topbar-actions"><ThemeToggle /></div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <nav className="bottomnav" aria-label="Main">{nav}</nav>
    </div>
  );
}
