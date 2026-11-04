import { useEffect, useState } from 'react';
import type { Member } from '@app/shared';
import { Shell, useApp } from '../App';
import { cachedMembers } from '../offline/db';
import { refreshReferenceData } from '../offline/sync';

export default function Members() {
  const {t,lang}=useApp();
  const [members,setMembers]=useState<Member[]>([]);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{cachedMembers().then(setMembers);refreshReferenceData().then(()=>cachedMembers()).then(setMembers).finally(()=>setLoading(false));},[]);
  const filtered=members.filter(m=>[m.name,m.nameMr,m.village,m.villageMr,m.farmerId].some(v=>v.toLowerCase().includes(q.toLowerCase())));
  return <Shell><h1>{t('memberRegistry')}</h1><p className="sub">{t('registryDemo')}</p>
    <div className="field"><label>{t('searchPlaceholder')}</label><input value={q} onChange={e=>setQ(e.target.value)} /></div>
    {loading && !members.length && <p>{t('loading')}</p>}
    {!loading && !filtered.length && <p>{t('empty')}</p>}
    {filtered.map(m=><div className="card" key={m.farmerId}>
      <h3>{lang==='mr'?m.nameMr:m.name}</h3>
      <div className="kv"><span>{m.farmerId}</span><span>{lang==='mr'?m.villageMr:m.village}</span></div>
      <div className="kv"><span>{t('land')}</span><strong>{m.landAcres} {t('acre')}</strong></div>
      <div className="kv"><span>{t('bankDemo')}</span><strong>{m.bankAccountMasked}</strong></div>
      <div className="kv"><span>IFSC</span><strong>{m.ifsc}</strong></div>
      <p className="sub2">{m.verified?t('demoVerified'):t('unverifiedBank')}</p>
    </div>)}
  </Shell>;
}
