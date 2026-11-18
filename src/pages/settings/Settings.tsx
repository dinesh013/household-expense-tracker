import { NavLink, Outlet } from 'react-router-dom';

const tabs = [
  { to: 'access', label: 'Access' },
  { to: 'categories', label: 'Categories' },
  { to: 'profile', label: 'Profile' },
];

export default function Settings() {
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <nav className="segmented" aria-label="Settings sections">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'on' : '')}>{t.label}</NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
