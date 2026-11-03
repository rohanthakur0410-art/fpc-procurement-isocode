import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtINR } from '@app/shared';
import { useApp, Shell } from '../App';
import { getDb } from '../offline/db';
import { trySync, isOnlineNow } from '../offline/sync';

export default function Outbox() {
  const { t, lang } = useApp();
  const [pending, setPending] = useState<any[]>([]);
  const [sent, setSent] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const online = isOnlineNow();

  const refresh = useCallback(async () => {
    const d = await getDb();
    setPending((await d.getAll('outbox')).sort((a: any, b: any) => b.seq - a.seq));
    setSent((await d.getAll('sent')).sort((a: any, b: any) => b.seq - a.seq));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const doSync = async () => {
    setSyncing(true);
    await trySync();
    await refresh();
    setSyncing(false);
  };

  const nameOf = (e: any) => e.payload?.farmerId ?? '';

  return (
    <Shell>
      <h1>{t('outbox')}</h1>
      <p className="sub">{pending.length === 0 ? t('allSynced') : `${pending.length} ${t('pendingSync')}`}</p>
      <button className="big-btn" onClick={doSync} disabled={!online || syncing || pending.length === 0}>
        {syncing ? t('syncing') : t('syncNow')}
      </button>
      {!online && <div className="callout">{t('savedOffline')}</div>}

      {pending.map((e) => (
        <div key={e.uuid} className="card">
          <div className="kv"><span className="k">{nameOf(e)}</span><span className="badge amber">{t('pendingSync')}</span></div>
          <div className="kv"><span className="k">{t(e.payload.crop)}</span><span className="v">{fmtKg(e.payload.grossTenths)} kg</span></div>
          {e.state === 'error' && <div className="callout red">{e.error}</div>}
        </div>
      ))}

      {sent.map((e) => (
        <div key={e.uuid} className="card">
          <div className="kv">
            <span className="k">{nameOf(e)}</span>
            <span className={`badge ${e.status === 'flagged' ? 'amber' : 'green'}`}>{e.slipNo}</span>
          </div>
          <div className="kv"><span className="k">{t(e.payload.crop)}</span><span className="v">{fmtKg(e.payload.grossTenths)} kg · ₹{fmtINR(Math.round((e.payload.grossTenths * e.payload.rateRupees) / 10))}</span></div>
          {e.flags?.length > 0 && <div className="sub2">{e.flags.map((f: string) => t(`flag_${f}`)).join(' · ')}</div>}
        </div>
      ))}

      <Link to="/operator"><button className="big-btn secondary">{t('goHome')}</button></Link>
      <p className="sub" style={{ marginTop: 8 }}>{lang === 'mr' ? '' : ''}</p>
    </Shell>
  );
}
