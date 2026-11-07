import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtINR } from '@app/shared';
import { useApp, Shell } from '../App';
import { api } from '../api';
import { fmtDate } from '../i18n';

export default function PaymentRun() {
  const { t, lang } = useApp();
  const [approved, setApproved] = useState<any[]>([]);
  const [flagged, setFlagged] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [priceReview,setPriceReview]=useState<any>(null);
  const [reason,setReason]=useState('');
  const [busy, setBusy] = useState(false);
  const [fileFormat, setFileFormat] = useState('unionbank-neft');

  const load = useCallback(async () => {
    try {
      const [a, f, r] = await Promise.all([
        api.purchases('?status=approved&unassigned=1'),
        api.purchases('?status=flagged'),
        api.runs(),
      ]);
      setApproved(a.purchases);
      setFlagged(f.purchases);
      setRuns(r.runs);
    } catch { setErr(t('error')); }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const createRun = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api.createRun(approved.map((p) => p.id));
      setMsg(`✓ ${r.itemCount} · ₹${fmtINR(r.totalPaisa)}`);
      await load();
    } catch (e: any) {
      setErr(e.code === 'no_approved_purchases' ? t('noApproved') : t('error'));
    } finally { setBusy(false); }
  };

  const approve = async (id: number) => {
    try { await api.review(id); await load(); } catch { setErr(t('error')); }
  };

  const markPaid = async (id: number) => {
    try { await api.markPaid(id); await load(); } catch { setErr(t('error')); }
  };

  return (
    <Shell wide>
      <h1>{t('payments')}</h1>
      <div className="nav-tabs">
        <Link to="/office"><button className="btn">{t('dashboard')}</button></Link>
        <Link to="/office/prices"><button className="btn">{t('priceBoard')}</button></Link>
        <Link to="/office/sms"><button className="btn">{t('smsLog')}</button></Link>
      </div>
      {msg && <div className="callout green">{msg}</div>}
      {err && <div className="callout red">{err}</div>}

      {priceReview && <div className="card">
        <h2>{t('resolvePrice')} · {priceReview.slip}</h2>
        <p>{t('collectionDate')}: {priceReview.collectionDate}</p>
        <p>{t('originalRecord')}: ₹{priceReview.originalRate} / q · ₹{fmtINR(priceReview.originalAmount)}</p>
        <p>{t('proposedCorrection')}: {priceReview.proposedRate == null ? t('pricePending') : `₹${priceReview.proposedRate} / q · ₹${fmtINR(priceReview.proposedAmount)}`}</p>
        <p className="sub">{t('correctionNote')}</p>
        <div className="field"><label>{t('reasonLabel')}</label><input value={reason} onChange={e=>setReason(e.target.value)} /></div>
        <button className="btn primary" disabled={priceReview.proposedRate==null || reason.trim().length<5} onClick={async()=>{try{await api.resolvePrice(priceReview.id,priceReview.proposedRate,reason);setPriceReview(null);await load();}catch{setErr(t('error'));}}}>{t('confirmCorrection')}</button>
        <button className="btn" onClick={()=>setPriceReview(null)}>{t('back')}</button>
      </div>}
      <div className="card">
        <div className="kv" style={{ borderBottom: 'none' }}>
          <span className="k">{t('approved')}: {approved.length} · ₹{fmtINR(approved.reduce((s, p) => s + p.amountPaisa, 0))}</span>
          <button className="btn primary" onClick={createRun} disabled={busy || approved.length === 0}>{t('createRun')}</button>
        </div>
      </div>

      {flagged.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{t('flaggedCount')} ({flagged.length})</h3>
          {flagged.map((p) => (
            <div key={p.id} className="list-item payment-run" style={{ cursor: 'default' }}>
              <span>
                <span className="main">{lang === 'mr' ? p.farmerNameMr : p.farmerName} · {p.slipNo}</span>
                <span className="sub2" style={{ display: 'block' }}>
                  {(p.flags as string[]).map((f) => t(`flag_${f}`)).join(' · ')} · ₹{fmtINR(p.amountPaisa)}
                </span>
                {p.priceResolvedAt && <span className="sub2" style={{display:'block'}}>{t('priceResolutionAudit')}: ₹{p.originalRateRupees} → ₹{p.rateRupees} · {p.priceResolvedBy} · {fmtDate(p.priceResolvedAt,lang)} · {p.priceResolutionReason}</span>}
              </span>
              {p.flags.some((f: string) => f === 'price_unverified' || f === 'price_mismatch') && !p.priceResolvedAt ? <button className="btn small" onClick={async()=>{setPriceReview({...await api.priceResolution(p.id),id:p.id,slip:p.slipNo});setReason('');}}>{t('reviewDatedPrice')}</button> : <button className="btn small" onClick={() => approve(p.id)}>{t('approve')}</button>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t('runs')}</h3>
        <p className="sub2" style={{ marginTop: 0 }}>{t('bankFileDemoNote')}</p>
        {runs.length === 0 && <p className="sub">{t('empty')}</p>}
        {runs.map((r) => (
          <div key={r.id} className="list-item payment-run" style={{ cursor: 'default' }}>
            <span>
              <span className="main">#{r.id} · {r.runDate} · {r.itemCount} · ₹{fmtINR(r.totalPaisa)}</span>
              <span className="sub2" style={{ display: 'block' }}>{fmtDate(r.createdAt, lang)}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${r.status === 'paid' ? 'green' : 'amber'}`}>{r.status === 'paid' ? t('paid') : t('fileGenerated')}</span>
              <select className="input" style={{ width: 'auto', padding: '6px 8px', fontSize: 13 }} value={fileFormat} onChange={(e) => setFileFormat(e.target.value)} aria-label={t('bankFileFormat')}>
                <option value="unionbank-neft">Union Bank NEFT (.txt)</option>
                <option value="unionbank-salary">Union Bank salary (.csv)</option>
                <option value="generic">{t('genericCsv')}</option>
              </select>
              <a href={`/api/payment-runs/${r.id}/file?format=${fileFormat}`}><button className="btn small">{t('downloadFile')} ({fileFormat === 'unionbank-neft' ? '.txt' : '.csv'})</button></a>
              {r.status !== 'paid' && <button className="btn small" onClick={() => markPaid(r.id)}>{t('markPaid')}</button>}
            </span>
            <details className="run-items"><summary>{t('farmerPaymentStatus')}</summary>
              {(r.items || []).map((item: any)=><div className="kv" key={item.slipNo}>
                <span>{lang === 'mr' ? item.farmerNameMr : item.farmerName}<small style={{display:'block'}}>{item.slipNo}</small></span>
                <span>₹{fmtINR(item.amountPaisa)}<small style={{display:'block'}}>{r.status === 'paid' ? t('demoPaid') : t('fileGenerated')}</small></span>
              </div>)}
            </details>
          </div>
        ))}
      </div>
    </Shell>
  );
}
