import { buildEntry, GENESIS, type PurchasePayload, type SyncEntry } from '@app/shared';
import { api } from '../api';
import { getDb, kvGet, kvSet, cacheMembers, cachePrices, type OutboxEntry, type SentEntry } from './db';

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function isForceOffline(): boolean {
  return localStorage.getItem('fpc_force_offline') === '1';
}
export function setForceOffline(v: boolean): void {
  localStorage.setItem('fpc_force_offline', v ? '1' : '0');
}

export function isOnlineNow(): boolean {
  return navigator.onLine && !isForceOffline();
}

export async function ensureDeviceId(): Promise<string> {
  let id = await kvGet<string>('deviceId');
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    await kvSet('deviceId', id);
  }
  return id;
}

// Every entry is written to the on-phone outbox first (works with zero network),
// chained to the previous entry from this device, then synced when possible.
export async function saveEntry(payload: PurchasePayload): Promise<OutboxEntry> {
  // Web Locks serializes sequence allocation across same-origin tabs.
  if (navigator.locks) return navigator.locks.request('fpc-entry-save', () => saveEntryLocked(payload));
  return saveEntryLocked(payload);
}

async function saveEntryLocked(payload: PurchasePayload): Promise<OutboxEntry> {
  const deviceId = await ensureDeviceId();
  const seq = ((await kvGet<number>('seq')) ?? 0) + 1;
  const prevHash = (await kvGet<string>('lastHash')) ?? GENESIS;
  const deviceTs = new Date().toISOString();
  const built = await buildEntry(crypto.randomUUID(), seq, prevHash, deviceTs, payload as unknown as Record<string, unknown>);
  const entry: OutboxEntry = { ...built, deviceId, payload, state: 'pending' };
  const d = await getDb();
  const tx = d.transaction(['outbox', 'kv'], 'readwrite');
  await tx.objectStore('outbox').put(entry);
  await tx.objectStore('kv').put(seq, 'seq');
  await tx.objectStore('kv').put(entry.hash, 'lastHash');
  await tx.done;
  return entry;
}

export interface SyncOutcome {
  attempted: number;
  stored: number;
  duplicates: number;
  rejected: number;
  online: boolean;
}

export async function trySync(): Promise<SyncOutcome> {
  const out: SyncOutcome = { attempted: 0, stored: 0, duplicates: 0, rejected: 0, online: isOnlineNow() };
  if (!out.online) return out;
  const d = await getDb();
  const pending = (await d.getAll('outbox')) as OutboxEntry[];
  const batch = pending.filter((e) => e.state === 'pending').sort((a, b) => a.seq - b.seq);
  if (batch.length === 0) return out;
  out.attempted = batch.length;
  try {
    const deviceId = await ensureDeviceId();
    const { results } = await api.sync({
      deviceId,
      entries: batch.map((e) => ({
        uuid: e.uuid, deviceId, seq: e.seq, prevHash: e.prevHash, hash: e.hash,
        deviceTs: e.deviceTs, payload: e.payload,
      })),
    });
    for (const r of results) {
      const entry = await d.get('outbox', r.uuid);
      if (!entry) continue;
      if (r.result === 'stored' || r.result === 'duplicate') {
        // Duplicate = the server already has this exact slip (retry after a
        // dropped connection). Stored once either way - never twice.
        const sent: SentEntry = { ...entry, slipNo: r.slipNo, status: r.status, flags: r.flags ?? [] };
        const tx = d.transaction(['sent', 'outbox'], 'readwrite');
        await tx.objectStore('sent').put(sent);
        await tx.objectStore('outbox').delete(r.uuid);
        await tx.done;
        if (r.result === 'stored') out.stored++;
        else out.duplicates++;
      } else {
        entry.state = 'error';
        entry.error = r.error || 'rejected';
        await d.put('outbox', entry);
        out.rejected++;
      }
    }
  } catch {
    // Network dropped mid-sync: entries stay in the outbox and retry later.
    // Server-side dedup by slip UUID means a retry never double-stores.
  }
  return out;
}

export async function refreshReferenceData(): Promise<void> {
  if (!isOnlineNow()) return;
  try {
    const [{ members }, { date, prices }] = await Promise.all([api.members(), api.prices()]);
    await cacheMembers(members);
    await cachePrices(date, prices);
  } catch {
    // stale cache is fine - the app keeps working on the last copy
  }
}
