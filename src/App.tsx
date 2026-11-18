import { Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { useApp } from './lib/session';
import { Spinner } from './components/ui';
import Layout from './components/Layout';
import SetupNotice from './pages/SetupNotice';
import Login from './pages/Login';
import Welcome from './pages/Welcome';
import Join from './pages/Join';
import Dashboard from './pages/Dashboard';
import ExpenseForm from './pages/ExpenseForm';
import Settlement from './pages/Settlement';
import Settings from './pages/settings/Settings';
import Access from './pages/settings/Access';
import Categories from './pages/settings/Categories';
import ProfileSettings from './pages/settings/Profile';

export default function App() {
  const { loading, session, household, error, refresh } = useApp();

  if (!isConfigured) return <SetupNotice />;
  if (loading) return <Spinner />;

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/join/:token" element={<Join />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="alert error">{error}</div>
          <button className="btn" onClick={() => void refresh()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!household) {
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/join/:token" element={<Join />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="expenses/new" element={<ExpenseForm />} />
        <Route path="expenses/:id" element={<ExpenseForm />} />
        <Route path="settlement" element={<Settlement />} />
        <Route path="settings" element={<Settings />}>
          <Route index element={<Navigate to="access" replace />} />
          <Route path="access" element={<Access />} />
          <Route path="categories" element={<Categories />} />
          <Route path="profile" element={<ProfileSettings />} />
        </Route>
      </Route>
      <Route path="/join/:token" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
