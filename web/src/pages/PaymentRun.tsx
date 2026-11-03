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
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, f, r] = await Promise.all([
        api.purchases('?status=approved'),
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
      const inRun = approved.filter((p) => !runs.some(() => false));
      const r = await api.createRun(inRun.map((p) => p.id));
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
            <div key={p.id} className="list-item" style={{ cursor: 'default' }}>
              <span>
                <span className="main">{lang === 'mr' ? p.farmerNameMr : p.farmerName} · {p.slipNo}</span>
                <span className="sub2" style={{ display: 'block' }}>
                  {(p.flags as string[]).map((f) => t(`flag_${f}`)).join(' · ')} · ₹{fmtINR(p.amountPaisa)}
                </span>
              </span>
              <button className="btn small" onClick={() => approve(p.id)}>{t('approve')}</button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t('runs')}</h3>
        {runs.length === 0 && <p className="sub">{t('empty')}</p>}
        {runs.map((r) => (
          <div key={r.id} className="list-item" style={{ cursor: 'default' }}>
            <span>
              <span className="main">#{r.id} · {r.runDate} · {r.itemCount} · ₹{fmtINR(r.totalPaisa)}</span>
              <span className="sub2" style={{ display: 'block' }}>{fmtDate(r.createdAt, lang)}</span>
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={`badge ${r.status === 'paid' ? 'green' : 'amber'}`}>{r.status === 'paid' ? t('paid') : t('fileGenerated')}</span>
              <a href={`/api/payment-runs/${r.id}/file`}><button className="btn small">{t('downloadCsv')}</button></a>
              {r.status !== 'paid' && <button className="btn small" onClick={() => markPaid(r.id)}>{t('markPaid')}</button>}
            </span>
          </div>
        ))}
      </div>
    </Shell>
  );
}
