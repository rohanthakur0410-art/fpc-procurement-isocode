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
        <div key={r.id} className="sms-preview">
          <div className="sms-head">
            <span className="sms-title">{lang === 'mr' ? r.farmerNameMr : r.farmerName} · {r.slipNo}</span>
            <span className="badge amber">{t('simulated')}</span>
          </div>
          <div className="sms-bubble">
            <pre>{r.body}</pre>
          </div>
          <p className="sms-note">{r.centreCode}{r.sentAt ? ` · ${fmtDate(r.sentAt, lang)}` : ''} · {t('smsDemoNote')}</p>
        </div>
      ))}
    </Shell>
  );
}
