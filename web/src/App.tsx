import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, Link } from 'react-router-dom';
import type { SessionUser } from '@app/shared';
import { api } from './api';
import { translate, type Lang } from './i18n';
import Login from './pages/Login';
import OperatorHome from './pages/OperatorHome';
import EntryWizard from './pages/EntryWizard';
import Outbox from './pages/Outbox';
import OfficeDashboard from './pages/OfficeDashboard';
import PriceBoard from './pages/PriceBoard';
import PaymentRun from './pages/PaymentRun';
import SmsLog from './pages/SmsLog';

interface AppState {
  user: SessionUser | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  signOut: () => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user, lang, setLang, t, signOut } = useApp();
  return (
    <div>
      <div className="topbar">
        <div className="brand">
          {t('appName')}
          <small>{user ? `${user.name}${user.centreCode ? ' · ' + user.centreCode : ''}` : t('tagline')}</small>
        </div>
        <div className="topbar-actions">
          <button className="lang-toggle" onClick={() => setLang(lang === 'mr' ? 'en' : 'mr')}>
            {lang === 'mr' ? 'English' : 'मराठी'}
          </button>
          {user && (
            <button className="btn small" onClick={signOut}>{t('logout')}</button>
          )}
        </div>
      </div>
      <div className={wide ? 'page wide' : 'page'}>{children}</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(() => {
    const raw = localStorage.getItem('fpc_user');
    return raw ? JSON.parse(raw) : null;
  });
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('fpc_lang') as Lang) || 'mr');
  const navigate = useNavigate();

  useEffect(() => {
    api.me()
      .then(({ user }) => {
        setUser(user);
        localStorage.setItem('fpc_user', JSON.stringify(user));
      })
      .catch(() => {
        // Offline shell: keep the cached profile so the app still opens.
        if (navigator.onLine) {
          setUser(null);
          localStorage.removeItem('fpc_user');
        }
      });
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('fpc_lang', l);
  };
  const signOut = () => {
    api.logout().catch(() => {});
    localStorage.removeItem('fpc_user');
    setUser(null);
    navigate('/login');
  };

  const state: AppState = { user, lang, setLang, t: (k) => translate(lang, k), signOut };

  const guard = (role: 'operator' | 'office', el: ReactNode) => {
    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== role) return <Navigate to={user.role === 'office' ? '/office' : '/operator'} replace />;
    return el;
  };

  return (
    <Ctx.Provider value={state}>
      <Routes>
        <Route path="/login" element={<Login onLogin={(u) => { setUser(u); localStorage.setItem('fpc_user', JSON.stringify(u)); navigate(u.role === 'office' ? '/office' : '/operator'); }} />} />
        <Route path="/operator" element={guard('operator', <OperatorHome />)} />
        <Route path="/operator/entry" element={guard('operator', <EntryWizard />)} />
        <Route path="/operator/outbox" element={guard('operator', <Outbox />)} />
        <Route path="/operator/sms" element={guard('operator', <SmsLog />)} />
        <Route path="/office" element={guard('office', <OfficeDashboard />)} />
        <Route path="/office/prices" element={guard('office', <PriceBoard />)} />
        <Route path="/office/payments" element={guard('office', <PaymentRun />)} />
        <Route path="/office/sms" element={guard('office', <SmsLog />)} />
        <Route path="*" element={<Navigate to={user ? (user.role === 'office' ? '/office' : '/operator') : '/login'} replace />} />
      </Routes>
    </Ctx.Provider>
  );
}

export { Link };
