import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildEntry, GENESIS } from '@app/shared';
import { openDatabase, type DB } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedIfEmpty } from '../src/seed.js';

let db: DB;
let base: string;
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let operatorCookie = '';
let officeCookie = '';

async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') || '' };
}

async function makeEntry(uuid: string, seq: number, prevHash: string, overrides: Record<string, unknown> = {}) {
  const payload = {
    centreCode: 'C07', farmerId: 'F0004', crop: 'soybean', grade: 'A',
    grossTenths: 5000, tareTenths: 100, moistureTenths: 115, rateRupees: 4850, photoName: null,
    ...overrides,
  };
  return buildEntry(uuid, seq, prevHash, new Date().toISOString(), payload);
}

beforeAll(async () => {
  db = openDatabase(':memory:');
  await seedIfEmpty(db);
  const app = createApp(db);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const op = await call('/api/auth/login', { method: 'POST', body: { username: 'operator', password: 'demo1234' } });
  expect(op.status).toBe(200);
  operatorCookie = op.setCookie.split(';')[0];
  const off = await call('/api/auth/login', { method: 'POST', body: { username: 'office', password: 'demo1234' } });
  expect(off.status).toBe(200);
  officeCookie = off.setCookie.split(';')[0];
});

afterAll(() => server.close());

describe('auth and access control', () => {
  it('rejects wrong credentials', async () => {
    const r = await call('/api/auth/login', { method: 'POST', body: { username: 'operator', password: 'nope' } });
    expect(r.status).toBe(401);
  });
  it('blocks office routes for operators', async () => {
    const r = await call('/api/dashboard', { cookie: operatorCookie });
    expect(r.status).toBe(403);
  });
  it('blocks sync for office users', async () => {
    const r = await call('/api/sync', { method: 'POST', cookie: officeCookie, body: { deviceId: 'd', entries: [] } });
    expect(r.status).toBe(403);
  });
  it('rejects unauthenticated requests', async () => {
    const r = await call('/api/members');
    expect(r.status).toBe(401);
  });
});

describe('seed data matches the brief sample', () => {
  it('has the three sample slips with exact figures', async () => {
    const r = await call('/api/purchases', { cookie: officeCookie });
    const bySlip = Object.fromEntries(r.body.purchases.map((p: any) => [p.slipNo, p]));
    expect(bySlip['C07-24518'].netTenths).toBe(12320);
    expect(bySlip['C07-24518'].amountPaisa).toBe(5975200);
    expect(bySlip['C07-24519'].netTenths).toBe(8310);
    expect(bySlip['C07-24519'].amountPaisa).toBe(4030350);
    expect(bySlip['C12-08876'].netTenths).toBe(6300);
    expect(bySlip['C12-08876'].amountPaisa).toBe(4536000);
  });
});

describe('offline sync', () => {
  it('stores chained entries once, even when the same batch is retried', async () => {
    const e1 = await makeEntry('11111111-1111-4111-8111-111111111111', 1, GENESIS);
    const e2 = await makeEntry('22222222-2222-4222-8222-222222222222', 2, e1.hash);
    const body = { deviceId: 'test-device-1', entries: [e1, e2] };
    const r1 = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body });
    expect(r1.status).toBe(200);
    expect(r1.body.results.map((x: any) => x.result)).toEqual(['stored', 'stored']);
    expect(r1.body.results[0].slipNo).toBe('C07-24520');
    const r2 = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body });
    expect(r2.body.results.map((x: any) => x.result)).toEqual(['duplicate', 'duplicate']);
    const count = db.prepare('SELECT COUNT(*) c FROM purchases').get() as { c: number };
    expect(count.c).toBe(5); // 3 seeded + 2 new, never 7
  });

  it('queues a mock SMS for each stored slip', async () => {
    const r = await call('/api/sms', { cookie: officeCookie });
    expect(r.body.sms.length).toBe(5);
    expect(r.body.sms[0].body).toContain('शेतकरी सरल');
    expect(r.body.sms.map((x: any) => x.body).join('\n')).toContain('C07-24520');
  });

  it('flags the same farmer twice within an hour and holds payment', async () => {
    // chain must continue from the device's last accepted hash
    const chain = db.prepare('SELECT last_hash FROM device_chains WHERE device_id = ?').get('test-device-1') as any;
    const e = await makeEntry('33333333-3333-4333-8333-333333333333', 3, chain.last_hash, { farmerId: 'F0004' });
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'test-device-1', entries: [e] } });
    expect(r.body.results[0].status).toBe('flagged');
    expect(r.body.results[0].flags).toContain('same_farmer_within_hour');
  });

  it('flags weight far beyond land yield', async () => {
    const chain = db.prepare('SELECT last_hash FROM device_chains WHERE device_id = ?').get('test-device-1') as any;
    const e = await makeEntry('44444444-4444-4444-8444-444444444444', 4, chain.last_hash, { farmerId: 'F0010', grossTenths: 90000, tareTenths: 100 });
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'test-device-1', entries: [e] } });
    expect(r.body.results[0].status).toBe('flagged');
    expect(r.body.results[0].flags).toContain('weight_beyond_land_yield');
  });

  it('detects a broken chain and flags instead of silently approving', async () => {
    const chain = db.prepare('SELECT last_hash FROM device_chains WHERE device_id = ?').get('test-device-1') as any;
    const e = await makeEntry('55555555-5555-4555-8555-555555555555', 5, chain.last_hash, { farmerId: 'F0005' });
    const tampered = { ...e, prevHash: 'WRONG' };
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'test-device-1', entries: [tampered] } });
    expect(r.body.chainOk).toBe(false);
    expect(r.body.results[0].flags).toContain('chain_broken');
  });

  it('rejects invalid input', async () => {
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'x', entries: [{ uuid: 'bad' }] } });
    expect(r.status).toBe(400);
  });
});

describe('payment run', () => {
  it('groups approved purchases into a CSV bank file; flagged stay held', async () => {
    const approved = (db.prepare(`SELECT id FROM purchases WHERE status = 'approved'`).all() as any[]).map((r) => r.id);
    const flagged = (db.prepare(`SELECT COUNT(*) c FROM purchases WHERE status = 'flagged'`).get() as any).c;
    expect(flagged).toBeGreaterThan(0);
    const r = await call('/api/payment-runs', { method: 'POST', cookie: officeCookie, body: { purchaseIds: approved } });
    expect(r.status).toBe(200);
    const csv = await fetch(`${base}/api/payment-runs/${r.body.runId}/file`, { headers: { cookie: officeCookie } });
    const text = await csv.text();
    expect(text).toContain('Beneficiary Name');
    expect(text).toContain('59752.00');
    const mark = await call(`/api/payment-runs/${r.body.runId}/mark-paid`, { method: 'POST', cookie: officeCookie });
    expect(mark.status).toBe(200);
    const paid = db.prepare(`SELECT COUNT(*) c FROM purchases WHERE status = 'paid'`).get() as any;
    expect(paid.c).toBe(approved.length);
  });
});
