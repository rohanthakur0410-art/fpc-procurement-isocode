import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApp, Shell } from '../App';
import { getDb } from '../offline/db';
import { trySync, refreshReferenceData, isOnlineNow, isForceOffline, setForceOffline } from '../offline/sync';

export default function OperatorHome() {
  const { t, user } = useApp();
  const [pending, setPending] = useState(0);
  const [sentToday, setSentToday] = useState(0);
  const [online, setOnline] = useState(isOnlineNow());
  const [forced, setForced] = useState(isForceOffline());
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const d = await getDb();
    const out = await d.getAll('outbox');
    setPending(out.filter((e: any) => e.state === 'pending').length);
    const sent = await d.getAll('sent');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    setSentToday(sent.filter((e: any) => e.deviceTs.startsWith(today)).length);
    setOnline(isOnlineNow());
  }, []);

  useEffect(() => {
    refresh();
    refreshReferenceData().then(refresh);
    const onChange = () => { setOnline(isOnlineNow()); if (isOnlineNow()) trySync().then(refresh); };
    window.addEventListener('online', onChange);
    window.addEventListener('offline', onChange);
    const iv = setInterval(() => { if (isOnlineNow()) trySync().then(refresh); }, 30000);
    return () => { window.removeEventListener('online', onChange); window.removeEventListener('offline', onChange); clearInterval(iv); };
  }, [refresh]);

  const doSync = async () => {
    setSyncing(true);
    await trySync();
    await refresh();
    setSyncing(false);
  };

  return (
    <Shell>
      <h1>{t('todayCollection')}</h1>
      <p className="sub">{user?.centreCode} · {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>

      <div className="card stat-grid">
        <div className="stat"><span className="num">{sentToday}</span><span className="lbl">{t('slipsToday')}</span></div>
        <div className="stat">
          <span className="num">{pending}</span>
          <span className="lbl">{pending === 0 ? t('allSynced') : t('pendingSync')}</span>
        </div>
      </div>

      <Link to="/operator/entry"><button className="big-btn">{t('newEntry')}</button></Link>
      <Link to="/operator/outbox"><button className="big-btn secondary">{t('outbox')} ({pending})</button></Link>

      <div className="card">
        <div className="kv">
          <span className="k net-status"><span className={`dot ${online ? 'on' : 'off'}`}></span>{online ? t('online') : t('offline')}</span>
          <button className="btn small" onClick={doSync} disabled={!online || syncing || pending === 0}>
            {syncing ? t('syncing') : t('syncNow')}
          </button>
        </div>
        <div className="kv">
          <span className="k">{t('demoOffline')}</span>
          <input
            type="checkbox"
            checked={forced}
            onChange={(e) => { setForceOffline(e.target.checked); setForced(e.target.checked); setOnline(isOnlineNow()); }}
          />
        </div>
      </div>
    </Shell>
  );
}
