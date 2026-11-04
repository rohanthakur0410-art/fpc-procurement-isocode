import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtINR, entryNetTenths, entryAmountPaisa } from '@app/shared';
import { useApp, Shell } from '../App';
import { Icon } from '../icons';
import { getDb } from '../offline/db';
import { trySync, isOnlineNow } from '../offline/sync';

export default function Outbox() {
  const { t, lang } = useApp();
  const [pending, setPending] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [sent, setSent] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const online = isOnlineNow();

  const refresh = useCallback(async () => {
    const d = await getDb();
    setDrafts(await d.getAll('drafts'));
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
  // Show net weight and the real payable amount (same calc the server applies).
  const netOf = (e: any) => entryNetTenths(e.payload);
  const amountOf = (e: any) => entryAmountPaisa(e.payload);

  return (
    <Shell>
      <header className="dayhead">
        <h1 className="dh-title">{t('outbox')}</h1>
      </header>

      {drafts.map(d=><div className="card" key={d.id}><strong>{t('unpricedDraft')} · {d.farmerId}</strong><p>{t(d.crop)} · {fmtKg(entryNetTenths(d))} kg</p><p style={{fontSize:14,lineHeight:1.5,margin:'10px 0'}}>{t('unpricedNotice')}</p><Link className="btn" to={`/operator/entry?draft=${d.id}`}>{t('reviewDatedPrice')}</Link></div>)}
      {drafts.length === 0 && pending.length === 0 && sent.length === 0 && (
        <div className="queue-empty">
          <span className="qe-ic"><Icon name="tray" size={30} /></span>
          <strong>{t('allSynced')}</strong>
          <span className="sub2">{t('queueEmptyNote')}</span>
        </div>
      )}

      {pending.length > 0 && (
        <button className="big-btn" onClick={doSync} disabled={!online || syncing}>
          {syncing ? t('syncing') : `${t('syncNow')} (${pending.length})`}
        </button>
      )}
      {!online && pending.length > 0 && <div className="callout">{t('savedOffline')}</div>}

      {pending.length > 0 && <div className="queue-label">{t('pendingSync')} · {pending.length}</div>}
      {pending.map((e) => (
        <div key={e.uuid} className="card queued">
          <div className="kv"><span className="k">{nameOf(e)}</span><span className="badge amber">{t('pendingSync')}</span></div>
          <div className="kv"><span className="k">{t(e.payload.crop)}</span><span className="v">{fmtKg(netOf(e))} kg · ₹{fmtINR(amountOf(e))}</span></div>
          {e.state === 'error' && <div className="callout red">{e.error}</div>}
        </div>
      ))}

      {sent.length > 0 && <div className="queue-label">{t('allSynced')} · {sent.length}</div>}
      {sent.map((e) => (
        <div key={e.uuid} className="card done">
          <div className="kv">
            <span className="k">{nameOf(e)}</span>
            <span className={`badge ${e.status === 'flagged' ? 'amber' : 'green'}`}>{e.slipNo}</span>
          </div>
          <div className="kv"><span className="k">{t(e.payload.crop)}</span><span className="v">{fmtKg(netOf(e))} kg · ₹{fmtINR(amountOf(e))}</span></div>
          {e.flags?.length > 0 && <div className="sub2">{e.flags.map((f: string) => t(`flag_${f}`)).join(' · ')}</div>}
        </div>
      ))}
    </Shell>
  );
}
