import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtKg, fmtINR } from '@app/shared';
import { useApp, Shell } from '../App';
import { Icon } from '../icons';
import { api } from '../api';

export default function OfficeDashboard() {
  const { t, lang } = useApp();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => setErr(true));
  }, []);

  if (err) return <Shell wide><div className="callout red">{t('error')}</div></Shell>;
  if (!data) return <Shell wide><p className="sub">{t('loading')}</p></Shell>;

  const totalSlips = data.today.reduce((s: number, r: any) => s + r.slips, 0);
  const totalNet = data.today.reduce((s: number, r: any) => s + r.netTenths, 0);
  const dateStr = new Date().toLocaleDateString(lang === 'mr' ? 'mr-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <Shell wide>
      <header className="dayhead">
        <div className="dh-top">
          <span className="dh-date">{dateStr}</span>
        </div>
        <h1 className="dh-title">{t('officeDesk')}</h1>
      </header>

      {data.flaggedCount > 0 && (
        <Link to="/office/payments" style={{ textDecoration: 'none' }}>
          <div className="attention">
            <span className="bell"><Icon name="warn" size={24} /></span>
            <span className="txt">
              <span className="t1" style={{ display: 'block' }}>{t('needsAttention')}: {data.flaggedCount}</span>
              <span className="t2">{t('heldForReview')} → {t('payments')}</span>
            </span>
            <span style={{ fontSize: 20, color: 'var(--amber)' }}>→</span>
          </div>
        </Link>
      )}

      <section className="daybook">
        <div className="db-head">{t('daySummary')}</div>
        <div className="db-row">
          <span className="db-k">{t('slipsToday')}</span>
          <span className="db-v">{totalSlips}</span>
        </div>
        <div className="db-row">
          <span className="db-k">{t('netWeight')}</span>
          <span className="db-v">{fmtKg(totalNet)} kg</span>
        </div>
        <div className="db-row">
          <span className="db-k">{t('pendingPayment')}</span>
          <span className="db-v">₹{fmtINR(data.pendingPayment.total)} <small>({data.pendingPayment.c})</small></span>
        </div>
        <div className="db-row">
          <span className="db-k">{t('flaggedCount')}</span>
          <span className={`db-v ${data.flaggedCount > 0 ? 'flag' : ''}`}>{data.flaggedCount}</span>
        </div>
      </section>

      <section className="register">
        <div className="reg-head">
          <span>{t('stockByCentre')}</span>
        </div>
        <table className="reg-table">
          <thead>
            <tr>
              <th>{t('centre')}</th>
              <th>{t('crop')}</th>
              <th className="r">{t('netWeight')} (kg)</th>
            </tr>
          </thead>
          <tbody>
            {data.stock.map((r: any, i: number) => (
              <tr key={i}>
                <td className="mono-sm">{r.centre}</td>
                <td>{t(r.crop)}</td>
                <td className="r mono-sm">{fmtKg(r.netTenths)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </Shell>
  );
}
