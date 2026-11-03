import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtINR } from '@app/shared';
import { useApp, Shell } from '../App';
import { api } from '../api';

export default function OfficeDashboard() {
  const { t } = useApp();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => setErr(true));
  }, []);

  if (err) return <Shell wide><div className="callout red">{t('error')}</div></Shell>;
  if (!data) return <Shell wide><p className="sub">{t('loading')}</p></Shell>;

  const totalSlips = data.today.reduce((s: number, r: any) => s + r.slips, 0);
  const totalNet = data.today.reduce((s: number, r: any) => s + r.netTenths, 0);

  return (
    <Shell wide>
      <h1>{t('dashboard')}</h1>
      <p className="sub">{data.date}</p>
      <div className="nav-tabs">
        <Link to="/office/prices"><button className="btn">{t('priceBoard')}</button></Link>
        <Link to="/office/payments"><button className="btn">{t('payments')}</button></Link>
        <Link to="/office/sms"><button className="btn">{t('smsLog')}</button></Link>
      </div>

      <div className="card stat-grid">
        <div className="stat"><span className="num">{totalSlips}</span><span className="lbl">{t('slipsToday')}</span></div>
        <div className="stat"><span className="num">{fmtKg(totalNet)}</span><span className="lbl">{t('netWeight')} (kg)</span></div>
        <div className="stat"><span className="num">₹{fmtINR(data.pendingPayment.total)}</span><span className="lbl">{t('pendingPayment')} ({data.pendingPayment.c})</span></div>
        <div className="stat"><span className="num">{data.flaggedCount}</span><span className="lbl">{t('flaggedCount')}</span></div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t('stockByCentre')}</h3>
        <table className="simple">
          <thead><tr><th>{t('centre')}</th><th>{t('crop')}</th><th>{t('netWeight')} (kg)</th></tr></thead>
          <tbody>
            {data.stock.map((r: any, i: number) => (
              <tr key={i}><td>{r.centre}</td><td>{t(r.crop)}</td><td>{fmtKg(r.netTenths)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
