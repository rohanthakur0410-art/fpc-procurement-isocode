import { useState } from 'react';
import type { SessionUser } from '@app/shared';
import { api } from '../api';
import { useApp, Shell } from '../App';

export default function Login({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const { t } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async (name: string, pass: string) => {
    setBusy(true);
    setErr('');
    try {
      const { user } = await api.login(name.trim(), pass);
      onLogin(user);
    } catch (ex: any) {
      setErr(ex.code === 'wrong_credentials' ? t('wrongCreds') : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void signIn(username, password);
  };

  return (
    <Shell>
      <div className="login-cover">
        <div className="lc-band">
          <h1>{t('signIn')}</h1>
          <p className="sub">{t('tagline')}</p>
        </div>
      <section className="demo-access" aria-label={t('tryDemo')}>
        <h2>{t('tryDemo')}</h2>
        <p className="sub">{t('demoAccessNote')}</p>
        <button className="demo-role" type="button" disabled={busy} onClick={() => void signIn('operator', 'demo1234')}>
          <strong>{t('demoCollection')}</strong><span>{t('demoCollectionNote')}</span>
        </button>
        <button className="demo-role" type="button" disabled={busy} onClick={() => void signIn('office', 'demo1234')}>
          <strong>{t('demoOffice')}</strong><span>{t('demoOfficeNote')}</span>
        </button>
        {busy && <p role="status">{t('loading')}</p>}
        {err && <div className="callout red" role="alert">{err}</div>}
      </section>
      <details className="manual-access">
      <summary>{t('manualSignIn')}</summary>
      <form onSubmit={submit}>
        <div className="field">
          <label>{t('username')}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label>{t('password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <button className="big-btn" type="submit" disabled={busy || !username || !password}>
          {t('signIn')}
        </button>
      </form>
      </details>
      </div>
    </Shell>
  );
}
