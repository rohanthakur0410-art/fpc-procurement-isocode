import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp, Shell } from '../App';
import { api } from '../api';
import { todayIST } from '../offline/sync';

export default function PriceBoard() {
  const { t } = useApp();
  const [prices, setPrices] = useState<any[]>([]);
  const [date] = useState(todayIST());
  const [crop, setCrop] = useState('soybean');
  const [grade, setGrade] = useState('A');
  const [rate, setRate] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api.prices(date).then((r) => setPrices(r.prices)).catch(() => setErr(t('error')));
  useEffect(() => { load(); }, []);

  const save = async () => {
    setMsg(''); setErr('');
    const n = parseInt(rate, 10);
    if (!Number.isFinite(n) || n <= 0) { setErr(t('error')); return; }
    try {
      await api.setPrice({ priceDate: date, crop, grade, rateRupees: n });
      setMsg('✓');
      setRate('');
      load();
    } catch { setErr(t('error')); }
  };

  return (
    <Shell>
      <h1>{t('priceBoard')}</h1>
      <p className="sub">{date} · {t('rateOfDay')}</p>
      <p className="sub2">{t('sampleRatesNote')}</p>
      <div className="card">
        <table className="simple">
          <thead><tr><th>{t('crop')}</th><th>{t('grade')}</th><th>₹ {t('perQuintal')}</th></tr></thead>
          <tbody>
            {prices.map((p) => (
              <tr key={`${p.crop}-${p.grade}`}><td>{t(p.crop)}</td><td>{p.grade}</td><td>{p.rateRupees.toLocaleString('en-IN')}</td></tr>
            ))}
            {prices.length === 0 && <tr><td colSpan={3}>{t('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="row">
          <div className="field">
            <label>{t('crop')}</label>
            <select value={crop} onChange={(e) => setCrop(e.target.value)}>
              <option value="soybean">{t('soybean')}</option>
              <option value="tur">{t('tur')}</option>
            </select>
          </div>
          <div className="field">
            <label>{t('grade')}</label>
            <select value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </div>
          <div className="field">
            <label>₹ {t('perQuintal')}</label>
            <input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="4850" />
          </div>
        </div>
        {msg && <div className="callout green">{msg}</div>}
        {err && <div className="callout red">{err}</div>}
        <button className="btn primary" onClick={save} disabled={!rate}>{t('setRate')}</button>
      </div>
      <Link to="/office"><button className="big-btn secondary">{t('dashboard')}</button></Link>
    </Shell>
  );
}
