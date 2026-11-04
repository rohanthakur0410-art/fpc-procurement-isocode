import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { Icon } from './icons';
import type { SessionUser } from '@app/shared';
import { api } from './api';
import { translate, type Lang } from './i18n';
import Login from './pages/Login';
import UpdateNotice from './UpdateNotice';
import OperatorHome from './pages/OperatorHome';
import EntryWizard from './pages/EntryWizard';
import Outbox from './pages/Outbox';
import OfficeDashboard from './pages/OfficeDashboard';
import PriceBoard from './pages/PriceBoard';
import PaymentRun from './pages/PaymentRun';
import SmsLog from './pages/SmsLog';
import Members from './pages/Members';

interface AppState {
  user: SessionUser | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  signOut: () => void;
}

const Ctx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(Ctx);

function BottomNav() {
  const { user, t } = useApp();
  const loc = useLocation();
  if (!user) return null;
  if (loc.pathname === '/operator/entry') return null;
  const items = user.role === 'office'
    ? [
        { to: '/office', ic: 'gauge', k: 'navDash' },
        { to: '/office/prices', ic: 'tag', k: 'navPrices' },
        { to: '/office/payments', ic: 'receipt', k: 'navPay' },
        { to: '/office/sms', ic: 'mail', k: 'navSms' },
      ]
    : [
        { to: '/operator', ic: 'home', k: 'navHome' },
        { to: '/operator/entry', ic: 'plus', k: 'navNew' },
        { to: '/operator/outbox', ic: 'tray', k: 'navQueue' },
      ];
  return (
    <nav className="bottomnav">
      <div className="inner">
        {items.map((it) => (
          <Link key={it.to} to={it.to} className={loc.pathname === it.to ? 'active' : ''}>
            <span className="ic"><Icon name={it.ic} size={21} /></span>
            {t(it.k)}
          </Link>
        ))}
      </div>
    </nav>
  );
}

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
      {user && !location.pathname.endsWith('/entry') && <div className="page" style={{paddingTop:0}}><Link to={user.role === 'office' ? '/office/members' : '/operator/members'}>{t('memberRegistry')}</Link></div>}
      <BottomNav />
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
      .catch((error: any) => {
        // A captive portal, timeout or 5xx is not evidence the session expired.
        // Server APIs still authenticate every later request.
        if (error.code === 'not_signed_in' || error.code === 'session_expired') {
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
      <UpdateNotice />
      <Routes>
        <Route path="/login" element={<Login onLogin={(u) => { setUser(u); localStorage.setItem('fpc_user', JSON.stringify(u)); navigate(u.role === 'office' ? '/office' : '/operator'); }} />} />
        <Route path="/operator" element={guard('operator', <OperatorHome />)} />
        <Route path="/operator/entry" element={guard('operator', <EntryWizard />)} />
        <Route path="/operator/outbox" element={guard('operator', <Outbox />)} />
        <Route path="/operator/sms" element={guard('operator', <SmsLog />)} />
        <Route path="/operator/members" element={guard('operator', <Members />)} />
        <Route path="/office/members" element={guard('office', <Members />)} />
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
