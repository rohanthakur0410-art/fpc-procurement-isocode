import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtINR, entryNetTenths, entryAmountPaisa } from '@app/shared';
import { useApp, Shell } from '../App';
import { Icon } from '../icons';
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
    setTodaySlips(sent.filter((e: any) => e.deviceTs.startsWith(today)).sort((a: any, b: any) => a.seq - b.seq));
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

  const totalNet = todaySlips.reduce((s, e) => s + entryNetTenths(e.payload), 0);
  const totalAmt = todaySlips.reduce((s, e) => s + entryAmountPaisa(e.payload), 0);
  const dateStr = new Date().toLocaleDateString(lang === 'mr' ? 'mr-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <Shell>
      <details className="demo-guide" open={todaySlips.length === 0 ? true : undefined}>
        <summary>{t('demoGuideTitle')}</summary>
        <div className="demo-guide-body">
          <p>{t('demoGuideIntro')}</p>
          <ol>
            <li>{t('demoGuideFarmer')}</li>
            <li>{t('demoGuideWeights')}</li>
            <li>{t('demoGuideResult')}</li>
          </ol>
          <p className="sub2">{t('demoGuideLimits')}</p>
        </div>
      </details>
      <header className="dayhead">
        <div className="dh-top">
          <span className="dh-date">{dateStr}</span>
          <span className="dh-centre">{user?.centreCode}</span>
        </div>
        <h1 className="dh-title">{t('todaysRegister')}</h1>
        <div className="daytotals">
          <div className="dt-cell">
            <span className="dt-num">{todaySlips.length}</span>
            <span className="dt-lbl">{t('slipsToday')}</span>
          </div>
          <div className="dt-cell">
            <span className="dt-num">{fmtKg(totalNet)}</span>
            <span className="dt-lbl">{t('netWeight')} (kg)</span>
          </div>
          <div className="dt-cell">
            <span className="dt-num">₹{fmtINR(totalAmt)}</span>
            <span className="dt-lbl">{t('amount')}</span>
          </div>
        </div>
      </header>

      <Link to="/operator/entry" className="ticket-cta">
        <span className="tc-ic"><Icon name="plus" size={26} /></span>
        <span className="tc-txt">
          <strong>{t('newEntry')}</strong>
          <small>{t('startNewEntry')}</small>
        </span>
        <span className="tc-arrow">→</span>
      </Link>

      <section className="register">
        <div className="reg-head">
          <span>{t('todayCollection')}</span>
          <span className="reg-note">{t('registerNote')}</span>
        </div>
        <table className="reg-table">
          <thead>
            <tr>
              <th>{t('colNo')}</th>
              <th>{t('farmer')}</th>
              <th className="r">{t('netWeight')}</th>
              <th className="r">{t('colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {todaySlips.map((e: any, i: number) => (
              <tr key={e.uuid}>
                <td className="mono-sm">{e.slipNo}</td>
                <td>{e.payload.farmerId} · {t(e.payload.crop)}</td>
                <td className="r mono-sm">{fmtKg(entryNetTenths(e.payload))}</td>
                <td className="r mono-sm">₹{fmtINR(entryAmountPaisa(e.payload))}</td>
              </tr>
            ))}
            {todaySlips.length === 0 && (
              <>
                {[0, 1, 2].map((i) => (
                  <tr key={i} className="empty-row"><td colSpan={4}>&nbsp;</td></tr>
                ))}
                <tr className="watermark-row">
                  <td colSpan={4}><span className="watermark">{t('noEntryYet')}</span></td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </section>

      <footer className="sync-line">
        <span className="net-status">
          <span className={`dot ${online ? 'on' : 'off'}`}></span>
          {online ? t('online') : t('offline')}
          {pending > 0
            ? <span className="badge amber">{pending} {t('pendingSync')}</span>
            : <span className="sub2">· {t('allSynced')}</span>}
        </span>
        {pending > 0 && online && (
          <button className="btn small" onClick={doSync} disabled={syncing}>
            <Icon name="sync" size={15} /> {syncing ? t('syncing') : t('syncNow')}
          </button>
        )}
      </footer>

      <label className="demo-toggle">
        <input
          type="checkbox"
          checked={forced}
          onChange={(e) => { setForceOffline(e.target.checked); setForced(e.target.checked); setOnline(isOnlineNow()); }}
        />
        <span>{t('demoOffline')}</span>
      </label>
    </Shell>
  );
}
