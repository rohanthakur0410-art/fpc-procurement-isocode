import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useApp } from './App';

// Updating must be a choice: collection forms and the outbox may contain work.
export default function UpdateNotice() {
  const { t } = useApp();
  const [ready, setReady] = useState(false);
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = Date.now();
    const update = registerSW({
      immediate: true,
      onNeedRefresh() { setReady(true); },
      onRegisteredSW(_url, reg) { registration = reg; },
    });
    setApply(() => () => { void update(true); });
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheck < 60000) return;
      lastCheck = Date.now();
      void registration?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, []);
  if (!ready) return null;
  return <aside className="update-notice" role="status">
    <strong>{t('updateReady')}</strong>
    <p>{t('updateAdvice')}</p>
    <button type="button" className="btn" onClick={() => apply?.()}>{t('updateAction')}</button>
  </aside>;
}
