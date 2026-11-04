import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  netTenths, amountPaisa, fmtKg, fmtINR, fmtMoisture, parseTenths,
  type Member, type Crop, type Grade,
} from '@app/shared';
import { useApp, Shell } from '../App';
import { cachedMembers, cachedRate } from '../offline/db';
import { saveEntry, trySync, refreshReferenceData, todayIST, isOnlineNow } from '../offline/sync';
import { api } from '../api';

interface AiState {
  photoName: string | null;
  photoDataUrl: string | null;
  valueTenths: number | null; // AI-proposed value, awaiting operator confirmation
  status: 'none' | 'reading' | 'ok' | 'unsure' | 'unavailable';
  reason?: string;
}

const emptyAi: AiState = { photoName: null, photoDataUrl: null, valueTenths: null, status: 'none' };

function toBase64Resized(file: File): Promise<{ base64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      URL.revokeObjectURL(img.src);
      resolve({ base64: dataUrl.split(',')[1], dataUrl });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function PhotoReader({
  kind, ai, setAi, onAccept, t,
}: {
  kind: 'scale' | 'moisture';
  ai: AiState;
  setAi: (a: AiState) => void;
  onAccept: (v: number) => void;
  t: (k: string) => string;
}) {
  const pick = async (file: File | null) => {
    if (!file) return;
    const { base64, dataUrl } = await toBase64Resized(file);
    setAi({ photoName: file.name, photoDataUrl: dataUrl, valueTenths: null, status: 'none' });
    if (!isOnlineNow()) {
      setAi({ photoName: file.name, photoDataUrl: dataUrl, valueTenths: null, status: 'unavailable', reason: 'offline' });
      return;
    }
    setAi({ photoName: file.name, photoDataUrl: dataUrl, valueTenths: null, status: 'reading' });
    try {
      const r = await api.readPhoto(kind, base64, 'image/jpeg');
      if (r.status === 'ok' && r.valueTenths != null) {
        setAi({ photoName: file.name, photoDataUrl: dataUrl, valueTenths: r.valueTenths, status: 'ok' });
      } else {
        setAi({ photoName: file.name, photoDataUrl: dataUrl, valueTenths: null, status: r.status === 'unavailable' ? 'unavailable' : 'unsure', reason: r.reason });
      }
    } catch {
      setAi({ photoName: file.name, photoDataUrl: dataUrl, valueTenths: null, status: 'unavailable' });
    }
  };

  const fmtVal = (v: number) => (kind === 'scale' ? fmtKg(v) : fmtMoisture(v));

  return (
    <div className="photo-box">
      <div className="kv" style={{ borderBottom: 'none' }}>
        <span className="k">{kind === 'scale' ? t('photoScale') : t('photoMoisture')}</span>
        {!ai.photoName ? (
          <label className="btn small">
            {t('addPhoto')}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <button className="btn small" onClick={() => setAi(emptyAi)}>{t('removePhoto')}</button>
        )}
      </div>
      {ai.photoDataUrl && <img src={ai.photoDataUrl} alt="" />}
      {ai.status === 'reading' && <div className="callout">{t('loading')}</div>}
      {ai.status === 'ok' && ai.valueTenths != null && (
        <div className="callout green">
          {t('aiReading')}: <strong className="num-lg">{fmtVal(ai.valueTenths)}</strong>
          <button className="btn small" style={{ marginLeft: 10 }} onClick={() => onAccept(ai.valueTenths!)}>{t('confirmAi')}</button>
        </div>
      )}
      {ai.status === 'unsure' && <div className="callout">{t('aiUnsure')}</div>}
      {ai.status === 'unavailable' && <div className="callout">{t('aiUnavailable')}</div>}
    </div>
  );
}

export default function EntryWizard() {
  const { t, user, lang } = useApp();
  const navigate = useNavigate();
  const [done, setDone] = useState(false);
  const [step, setStep] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState('');
  const [member, setMember] = useState<Member | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [grade, setGrade] = useState<Grade>('A');
  const [priceRevision, setPriceRevision] = useState(0);
  const [rate, setRate] = useState<number | null>(null);
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [moisture, setMoisture] = useState('');
  const [scaleAi, setScaleAi] = useState<AiState>(emptyAi);
  const [moistAi, setMoistAi] = useState<AiState>(emptyAi);
  const [saveErr, setSaveErr] = useState('');
  const [saved, setSaved] = useState<{ synced: boolean; slipNo?: string; slipText: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    refreshReferenceData().then(() => { cachedMembers().then(setMembers); setPriceRevision((n) => n + 1); });
    cachedMembers().then(setMembers);
  }, []);

  useEffect(() => {
    if (crop) cachedRate(todayIST(), crop, grade).then(setRate);
  }, [crop, grade, priceRevision]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return members;
    return members.filter(
      (m) => m.name.toLowerCase().includes(s) || m.nameMr.includes(s) || m.village.toLowerCase().includes(s) || m.villageMr.includes(s) || m.farmerId.toLowerCase().includes(s)
    );
  }, [members, q]);

  const grossT = parseTenths(gross);
  const tareT = parseTenths(tare);
  const moistT = parseTenths(moisture);
  const net = grossT != null && tareT != null && moistT != null ? netTenths(grossT, tareT, moistT) : null;
  const amount = net != null && rate != null ? amountPaisa(net, rate) : null;

  // Brief rule: a typed value that differs from the AI photo reading blocks saving.
  const mismatches: string[] = [];
  if (scaleAi.status === 'ok' && scaleAi.valueTenths != null && grossT != null && grossT !== scaleAi.valueTenths) mismatches.push(t('grossKg'));
  if (moistAi.status === 'ok' && moistAi.valueTenths != null && moistT != null && moistT !== moistAi.valueTenths) mismatches.push(t('moisture'));

  const weightsValid = grossT != null && tareT != null && moistT != null && moistT <= 400 && grossT > tareT && grossT <= 100_000_000 && rate != null;
  const canSave = !!member && !!crop && weightsValid && mismatches.length === 0 && !busy && scaleAi.status !== 'reading' && moistAi.status !== 'reading';

  const doSave = async () => {
    if (!canSave || !member || !crop || net == null || amount == null || !user?.centreCode) return;
    setBusy(true);
    setSaveErr('');
    setShowReview(false);
    try {
      const currentRate = await cachedRate(todayIST(), crop, grade);
      if (currentRate == null || currentRate !== rate) {
        setRate(currentRate); setStep(1); setSaveErr(t('dateRateChanged')); return;
      }
      const photoName = scaleAi.photoName || moistAi.photoName || null;
      await saveEntry({
        centreCode: user.centreCode, farmerId: member.farmerId, crop, grade,
        grossTenths: grossT!, tareTenths: tareT!, moistureTenths: moistT!,
        rateRupees: rate!, photoName,
      });
      const outcome = await trySync();
      let slipNo: string | undefined;
      if (outcome.stored > 0 || outcome.duplicates > 0) {
        const { getDb } = await import('../offline/db');
        const sent = await (await getDb()).getAll('sent');
        const mine = sent.sort((a: any, b: any) => b.seq - a.seq)[0] as any;
        slipNo = mine?.slipNo;
      }
      const slipText = [
        `${t('slip')}${slipNo ? ` - ${slipNo}` : ''}`,
        `${t('farmer')}: ${lang === 'mr' ? member.nameMr : member.name} (${member.farmerId})`,
        `${t('crop')}: ${t(crop)} · ${t('grade')} ${grade}`,
        `${t('grossKg')}: ${fmtKg(grossT!)}`,
        `${t('tareKg')}: ${fmtKg(tareT!)}`,
        `${t('moisture')}: ${fmtMoisture(moistT!)}`,
        `${t('netWeight')}: ${fmtKg(net)} ${lang === 'mr' ? 'कि.ग्रॅ.' : 'kg'}`,
        `${t('rateOfDay')}: ₹${rate!.toLocaleString('en-IN')} ${t('perQuintal')}`,
        `${t('amount')}: ₹${fmtINR(amount)}`,
      ].join('\n');
      setSaved({ synced: !!slipNo, slipNo, slipText });
      setDone(true);
      window.scrollTo(0, 0);
    } catch {
      setSaveErr(t('error'));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep(0); setDone(false); setMember(null); setCrop(null); setGrade('A'); setRate(null);
    setGross(''); setTare(''); setMoisture(''); setScaleAi(emptyAi); setMoistAi(emptyAi);
    setSaved(null); setQ('');
  };

  if (done && saved) {
    return (
      <Shell>
        <h1 style={{ marginTop: 18 }}>{t('slip')}</h1>
        <div className="slip">
          <div className="head">
            <div className="title">{t('appName')}</div>
            <div className="no">{saved.synced ? `${t('officialSlip')} ${saved.slipNo}` : t('savedOffline')}</div>
          </div>
          <div className="body"><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 16, margin: 0 }}>{saved.slipText}</pre></div>
        </div>
        <div className={`callout ${saved.synced ? 'green' : ''}`}>
          {saved.synced ? t('smsSentMock') : t('savedOffline')}
        </div>
        <p className="sub" style={{ textAlign: 'center' }}>{t('slipReadableNote')}</p>
        <button className="big-btn" onClick={reset}>{t('anotherEntry')}</button>
        <button className="big-btn secondary" onClick={() => navigate('/operator')}>{t('goHome')}</button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 style={{ marginTop: 18 }}>{t('navNew')}</h1>

      <p className="sub" aria-live="polite">{t('stepLabel')} {step + 1} / 3</p>
      {step > 0 && <button className="btn small" onClick={() => setStep(step - 1)}>{t('back')}</button>}
      {step === 0 && <>
      <div className="sect"><span className="n">1</span><h2>{t('selectFarmer')}</h2></div>
      {member ? (
        <div className="sel-farmer">
          <span className="avatar">{(lang === 'mr' ? member.nameMr : member.name).charAt(0)}</span>
          <span className="meta">
            <span className="nm">{lang === 'mr' ? member.nameMr : member.name}</span>
            <span className="dt" style={{ display: 'block' }}>{lang === 'mr' ? member.villageMr : member.village} · {member.farmerId}</span>
          </span>
          {member.verified && <span className="badge green">✓</span>}
          <button className="btn small" onClick={() => setMember(null)}>{t('change')}</button>
        </div>
      ) : (
        <>
          <div className="field">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} autoFocus />
          </div>
          {filtered.length === 0 && <div className="callout">{t('empty')}</div>}
          {filtered.slice(0, 6).map((m) => (
            <button key={m.farmerId} className="list-item" onClick={() => setMember(m)}>
              <span className="avatar">{(lang === 'mr' ? m.nameMr : m.name).charAt(0)}</span>
              <span style={{ flex: 1 }}>
                <span className="main">{lang === 'mr' ? m.nameMr : m.name}</span>
                <span className="sub2" style={{ display: 'block' }}>{lang === 'mr' ? m.villageMr : m.village} · {m.farmerId} · {m.landAcres} {t('acre')}</span>
              </span>
              {m.verified && <span className="badge green">✓</span>}
            </button>
          ))}
        </>
      )}

      <button className="big-btn" disabled={!member} onClick={() => {setStep(1); window.scrollTo(0,0);}}>{t('next')} →</button>
      </>}
      {step === 1 && <>
      <div className="sect"><span className="n">2</span><h2>{t('selectCrop')}</h2></div>
      <div className="choice-grid">
        {(['soybean', 'tur'] as Crop[]).map((c) => (
          <button key={c} className={`choice ${crop === c ? 'sel' : ''}`} onClick={() => setCrop(c)}>{t(c)}</button>
        ))}
      </div>
      <div className="seg" style={{ marginTop: 8 }}>
        {(['A', 'B'] as Grade[]).map((g) => (
          <button key={g} className={grade === g ? 'sel' : ''} onClick={() => setGrade(g)}>{t('grade')} {g}</button>
        ))}
      </div>
      {crop && (
        <div className="callout green" style={{ marginTop: 10 }}>
          {t('rateOfDay')}: <strong>{rate != null ? `₹${rate.toLocaleString('en-IN')} ${t('perQuintal')}` : '—'}</strong>
        </div>
      )}

      <button className="big-btn" disabled={!crop || rate == null} onClick={() => {setStep(2); window.scrollTo(0,0);}}>{t('next')} →</button>
      </>}
      {step === 2 && <>
      <div className="sect"><span className="n">3</span><h2>{t('weightsTitle')}</h2></div>
      <div className="field">
        <label>{t('grossKg')}</label>
        <input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="1250.0" />
      </div>
      <PhotoReader kind="scale" ai={scaleAi} setAi={setScaleAi} onAccept={(v) => setGross(fmtKg(v))} t={t} />
      <div className="row">
        <div className="field">
          <label>{t('tareKg')}</label>
          <input inputMode="decimal" value={tare} onChange={(e) => setTare(e.target.value)} placeholder="18.0" />
        </div>
        <div className="field">
          <label>{t('moisture')}</label>
          <input inputMode="decimal" value={moisture} onChange={(e) => setMoisture(e.target.value)} placeholder="11.5" />
        </div>
      </div>
      <PhotoReader kind="moisture" ai={moistAi} setAi={setMoistAi} onAccept={(v) => setMoisture(fmtMoisture(v))} t={t} />
      {mismatches.length > 0 && <div className="callout red">{t('aiMismatch')} ({mismatches.join(', ')})</div>}
      {saveErr && <div className="callout red">{saveErr}</div>}

      <div style={{ height: 130 }} />
      <div className="actionbar">
        <div className="inner">
          <div className="live">
            <span>{t('netWeight')}: <strong>{net != null ? `${fmtKg(net)} ${lang === 'mr' ? 'कि.ग्रॅ.' : 'kg'}` : '—'}</strong></span>
            <span className="amt">{amount != null ? `₹${fmtINR(amount)}` : '₹ —'}</span>
          </div>
          <button className="big-btn" disabled={!canSave} onClick={() => setShowReview(true)}>{t('review')} →</button>
        </div>
      </div>

      </>}
      {showReview && member && crop && net != null && amount != null && rate != null && (
        <div className="sheet-backdrop" onClick={() => setShowReview(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grab" />
            <h2 style={{ marginBottom: 10 }}>{t('review')} · {t('slip')}</h2>
            <div className="slip">
              <div className="head"><div className="title">{t('slip')}</div></div>
              <div className="body">
                <div className="kv"><span className="k">{t('farmer')}</span><span className="v">{lang === 'mr' ? member.nameMr : member.name} ({member.farmerId})</span></div>
                <div className="kv"><span className="k">{t('village')}</span><span className="v">{lang === 'mr' ? member.villageMr : member.village}</span></div>
                <div className="kv"><span className="k">{t('crop')}</span><span className="v">{t(crop)} · {t('grade')} {grade}</span></div>
                <div className="kv"><span className="k">{t('grossKg')}</span><span className="v">{fmtKg(grossT!)}</span></div>
                <div className="kv"><span className="k">{t('tareKg')}</span><span className="v">{fmtKg(tareT!)}</span></div>
                <div className="kv"><span className="k">{t('moisture')}</span><span className="v">{fmtMoisture(moistT!)}%</span></div>
                <div className="kv"><span className="k">{t('netWeight')}</span><span className="v num-lg">{fmtKg(net)}</span></div>
                <div className="kv"><span className="k">{t('rateOfDay')}</span><span className="v">₹{rate.toLocaleString('en-IN')} {t('perQuintal')}</span></div>
              </div>
              <div className="amount"><div className="num-xl">₹{fmtINR(amount)}</div></div>
            </div>
            {mismatches.length > 0 && <div className="callout red">{t('aiMismatch')} ({mismatches.join(', ')})</div>}
            {saveErr && <div className="callout red">{saveErr}</div>}
            <div className="row">
              <button className="btn" onClick={() => setShowReview(false)}>{t('change')}</button>
              <button className="btn primary" disabled={busy} onClick={doSave}>{busy ? t('loading') : t('saveEntry')}</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
