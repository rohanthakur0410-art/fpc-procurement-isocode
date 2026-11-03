import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtINR, entryNetTenths, entryAmountPaisa } from '@app/shared';
import { useApp, Shell } from '../App';
import { getDb } from '../offline/db';
import { trySync, refreshReferenceData, isOnlineNow, isForceOffline, setForceOffline } from '../offline/sync';

export default function OperatorHome() {
  const { t, user, lang } = useApp();
  const [pending, setPending] = useState(0);
  const [todaySlips, setTodaySlips] = useState<any[]>([]);
  const [online, setOnline] = useState(isOnlineNow());
  const [forced, setForced] = useState(isForceOffline());
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const d = await getDb();
    const out = await d.getAll('outbox');
    setPending(out.filter((e: any) => e.state === 'pending').length);
    const sent = await d.getAll('sent');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    setTodaySlips(sent.filter((e: any) => e.deviceTs.startsWith(today)).sort((a: any, b: any) => b.seq - a.seq));
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

  const firstName = (user?.name || '').split(' ')[0];

  return (
    <Shell>
      <p className="greet">
        {t('greeting')},
        <strong>{firstName} 🙏</strong>
      </p>
      <p className="sub" style={{ marginBottom: 4 }}>{user?.centreCode} · {new Date().toLocaleDateString(lang === 'mr' ? 'mr-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long' })}</p>

      <Link to="/operator/entry"><button className="big-btn">➕ {t('newEntry')}</button></Link>

      <div className="status-strip">
        <span className="net-status">
          <span className={`dot ${online ? 'on' : 'off'}`}></span>
          {online ? t('online') : t('offline')}
          {pending > 0 && <span className="badge amber">{pending} {t('pendingSync')}</span>}
        </span>
        <button className="btn small" onClick={doSync} disabled={!online || syncing || pending === 0}>
          {syncing ? t('syncing') : t('syncNow')}
        </button>
      </div>

      <div className="sect"><span className="n">✓</span><h2>{t('todayCollection')} ({todaySlips.length})</h2></div>
      {todaySlips.length === 0 && <div className="callout green">{t('empty')}</div>}
      {todaySlips.map((e: any) => (
        <div key={e.uuid} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
          <span className="avatar">{t(e.payload.crop).charAt(0)}</span>
          <span style={{ flex: 1 }}>
            <span className="main" style={{ fontWeight: 700, display: 'block' }}>{e.payload.farmerId} · {t(e.payload.crop)}</span>
            <span className="sub2">{fmtKg(entryNetTenths(e.payload))} kg · ₹{fmtINR(entryAmountPaisa(e.payload))}</span>
          </span>
          <span className={`badge ${e.status === 'flagged' ? 'amber' : 'green'}`}>{e.slipNo}</span>
        </div>
      ))}

      <div className="card" style={{ marginTop: 18 }}>
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
