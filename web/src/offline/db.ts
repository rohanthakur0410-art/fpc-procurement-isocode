import { openDB, type IDBPDatabase } from 'idb';
import type { Member, PriceRow, SyncEntry } from '@app/shared';

export interface OutboxEntry extends SyncEntry {
  state: 'pending' | 'error';
  error?: string;
}

export interface SentEntry extends SyncEntry {
  slipNo: string;
  status: string;
  flags: string[];
}

let dbp: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB('fpc-offline', 1, {
      upgrade(d) {
        d.createObjectStore('kv');
        d.createObjectStore('members', { keyPath: 'farmerId' });
        d.createObjectStore('prices', { keyPath: 'key' });
        d.createObjectStore('outbox', { keyPath: 'uuid' });
        d.createObjectStore('sent', { keyPath: 'uuid' });
      },
    });
  }
  return dbp;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get('kv', key);
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('kv', value, key);
}

export async function cacheMembers(members: Member[]): Promise<void> {
  const d = await getDb();
  const tx = d.transaction('members', 'readwrite');
  await tx.store.clear();
  for (const m of members) await tx.store.put(m);
  await tx.done;
}

export async function cachedMembers(): Promise<Member[]> {
  return (await getDb()).getAll('members');
}

export async function cachePrices(date: string, prices: PriceRow[]): Promise<void> {
  const d = await getDb();
  const tx = d.transaction('prices', 'readwrite');
  for (const p of prices) await tx.store.put({ ...p, key: `${date}|${p.crop}|${p.grade}` });
  await tx.done;
}

export async function cachedRate(date: string, crop: string, grade: string): Promise<number | null> {
  const row = await (await getDb()).get('prices', `${date}|${crop}|${grade}`);
  return row?.rateRupees ?? null;
}
