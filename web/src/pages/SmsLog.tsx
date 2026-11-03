import { useEffect, useState } from 'react';
import { useApp, Shell } from '../App';
import { api } from '../api';
import { fmtDate } from '../i18n';

export default function SmsLog() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sms()
      .then((r) => setRows(r.sms))
      .catch(() => setErr(t('error')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell wide>
      <h1>{t('smsLog')}</h1>
      <p className="sub">{t('slipReadableNote')}</p>
      {err && <div className="callout red">{err}</div>}
      {loading && !err && <div className="callout green">{t('loading')}</div>}
      {!loading && rows.length === 0 && !err && <div className="callout">{t('empty')}</div>}
      {rows.map((r) => (
        <div key={r.id} className="card">
          <div className="kv">
            <span className="k">{lang === 'mr' ? r.farmerNameMr : r.farmerName} · {r.slipNo} · {r.centreCode}</span>
            <span className="badge green">{r.status === 'sent' ? '✓' : '…'}</span>
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, marginTop: 8 }}>{r.body}</pre>
          <p className="sub" style={{ marginTop: 6 }}>{r.sentAt ? fmtDate(r.sentAt, lang) : ''}</p>
        </div>
      ))}
    </Shell>
  );
}
