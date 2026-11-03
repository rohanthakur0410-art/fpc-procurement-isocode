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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const { user } = await api.login(username.trim(), password);
      onLogin(user);
    } catch (ex: any) {
      setErr(ex.code === 'wrong_credentials' ? t('wrongCreds') : t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <div className="login-cover">
        <div className="lc-band">
          <h1>{t('signIn')}</h1>
          <p className="sub">{t('tagline')}</p>
        </div>
      <form onSubmit={submit}>
        <div className="field">
          <label>{t('username')}</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label>{t('password')}</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {err && <div className="callout red">{err}</div>}
        <button className="big-btn" type="submit" disabled={busy || !username || !password}>
          {t('signIn')}
        </button>
      </form>
      </div>
    </Shell>
  );
}
