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


describe('centre, price and payment integrity regressions', () => {
  it('rejects a cross-centre write without saving or advancing the chain', async () => {
    const e = await makeEntry('61111111-1111-4111-8111-111111111111', 1, GENESIS, { centreCode: 'C12' });
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'cross-centre', entries: [e] } });
    expect(r.status).toBe(403);
    expect(db.prepare('SELECT 1 FROM device_chains WHERE device_id = ?').get('cross-centre')).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM purchases WHERE client_uuid = ?').get(e.uuid)).toBeUndefined();
  });
  it('preserves a mismatched offline rate but holds it out of payment', async () => {
    const e = await makeEntry('62222222-2222-4222-8222-222222222222', 1, GENESIS, { rateRupees: 9999 });
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'bad-price', entries: [e] } });
    expect(r.body.results[0].result).toBe('stored');
    expect(r.body.results[0].status).toBe('flagged');
    expect(r.body.results[0].flags).toContain('price_mismatch');
    const p = db.prepare('SELECT id FROM purchases WHERE client_uuid = ?').get(e.uuid) as any;
    const run = await call('/api/payment-runs', { method: 'POST', cookie: officeCookie, body: { purchaseIds: [p.id] } });
    expect(run.status).toBe(400);
    const review = await call(`/api/purchases/${p.id}/review`, { method: 'POST', cookie: officeCookie, body: { action: 'approve' } });
    expect(review.status).toBe(409);
    expect((db.prepare('SELECT status FROM purchases WHERE id = ?').get(p.id) as any).status).toBe('flagged');
  });
  it('preserves an entry whose dated central price is absent, on hold', async () => {
    const e = await makeEntry('63333333-3333-4333-8333-333333333333', 1, GENESIS);
    const dated = await buildEntry(e.uuid, 1, GENESIS, '2020-01-01T12:00:00.000Z', e.payload);
    const r = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'old-price', entries: [dated] } });
    expect(r.body.results[0].flags).toContain('price_unverified');
    expect(r.body.results[0].result).toBe('stored');
  });
  it('does not move a trusted anchor after a broken chain', async () => {
    const before = db.prepare('SELECT last_hash FROM device_chains WHERE device_id = ?').get('test-device-1') as any;
    const e = await makeEntry('64444444-4444-4444-8444-444444444444', 6, 'WRONG');
    await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'test-device-1', entries: [e] } });
    expect((db.prepare('SELECT last_hash FROM device_chains WHERE device_id = ?').get('test-device-1') as any).last_hash).toBe(before.last_hash);
  });
  it('cannot generate a second file containing an already reserved slip', async () => {
    // A clean new member/date avoids anomaly rules used by earlier tests.
    const e = await makeEntry('65555555-5555-4555-8555-555555555555', 1, GENESIS, { farmerId: 'F0007', moistureTenths: 117 });
    const sync = await call('/api/sync', { method: 'POST', cookie: operatorCookie, body: { deviceId: 'payment-once', entries: [e] } });
    expect(sync.body.results[0].status).toBe('approved');
    const p = db.prepare('SELECT id FROM purchases WHERE client_uuid = ?').get(e.uuid) as any;
    const first = await call('/api/payment-runs', { method: 'POST', cookie: officeCookie, body: { purchaseIds: [p.id] } });
    const second = await call('/api/payment-runs', { method: 'POST', cookie: officeCookie, body: { purchaseIds: [p.id] } });
    expect(first.status).toBe(200); expect(second.status).toBe(400);
    const runs = await call('/api/payment-runs', {cookie:officeCookie});
    const made = runs.body.runs.find((r: any)=>r.id===first.body.runId);
    expect(made.items).toHaveLength(1);
    expect(made.items[0].amountPaisa).toBe(first.body.totalPaisa);
    expect((db.prepare('SELECT COUNT(*) c FROM payment_items WHERE purchase_id = ?').get(p.id) as any).c).toBe(1);
  });
});


describe('retry identity and bank safety', () => {
  it('rejects changed contents under a previously stored UUID', async () => {
    const e = await makeEntry('71111111-1111-4111-8111-111111111111',1,GENESIS);
    const original = {deviceId:'retry-identity',entries:[e]};
    await call('/api/sync',{method:'POST',cookie:operatorCookie,body:original});
    const changed = await buildEntry(e.uuid,1,GENESIS,e.deviceTs,{...e.payload,grossTenths:7777});
    const r = await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{...original,entries:[changed]}});
    expect(r.body.results[0].error).toBe('uuid_conflict');
    expect((db.prepare('SELECT gross_tenths FROM purchases WHERE client_uuid=?').get(e.uuid) as any).gross_tenths).toBe(5000);
  });
  it('does not disclose a stored slip to a different device retry',async()=>{
    const e=await makeEntry('72222222-2222-4222-8222-222222222222',1,GENESIS);
    await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'device-owner',entries:[e]}});
    const r=await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'other-device',entries:[e]}});
    expect(r.body.results[0].error).toBe('uuid_conflict');
    expect(r.body.results[0].slipNo).toBeUndefined();
  });
  it('returns existing hold flags on a legitimate retry',async()=>{
    const e=await makeEntry('73333333-3333-4333-8333-333333333333',1,GENESIS,{rateRupees:9999});
    const body={deviceId:'retry-flags',entries:[e]};
    await call('/api/sync',{method:'POST',cookie:operatorCookie,body});
    const r=await call('/api/sync',{method:'POST',cookie:operatorCookie,body});
    expect(r.body.results[0].flags).toContain('price_mismatch');
  });
  it('does not include an unverified beneficiary in a payment file',async()=>{
    const e=await makeEntry('74444444-4444-4444-8444-444444444444',1,GENESIS,{farmerId:'F0008',moistureTenths:119});
    await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'bank-hold',entries:[e]}});
    const p=db.prepare('SELECT id,member_id FROM purchases WHERE client_uuid=?').get(e.uuid) as any;
    db.prepare('UPDATE members SET verified=0 WHERE id=?').run(p.member_id);
    const r=await call('/api/payment-runs',{method:'POST',cookie:officeCookie,body:{purchaseIds:[p.id]}});
    expect(r.status).toBe(400);
    db.prepare('UPDATE members SET verified=1 WHERE id=?').run(p.member_id);
  });
});


describe('simultaneous and retried sync',()=>{
  it('holds distinct deliveries with the exact same farmer timestamp',async()=>{
    const e1=await makeEntry('81111111-1111-4111-8111-111111111111',1,GENESIS,{farmerId:'F0009',moistureTenths:113});
    const e2=await buildEntry('82222222-2222-4222-8222-222222222222',2,e1.hash,e1.deviceTs,e1.payload);
    const r=await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'equal-time',entries:[e1,e2]}});
    expect(r.body.results[1].flags).toContain('same_farmer_within_hour');
  });
  it('does not double-store or regress the anchor on simultaneous identical batches',async()=>{
    const e=await makeEntry('83333333-3333-4333-8333-333333333333',1,GENESIS,{moistureTenths:114});
    const body={deviceId:'parallel-retry',entries:[e]};
    const results=await Promise.all([call('/api/sync',{method:'POST',cookie:operatorCookie,body}),call('/api/sync',{method:'POST',cookie:operatorCookie,body})]);
    expect(results.flatMap(r=>r.body.results).map(r=>r.result).sort()).toEqual(['duplicate','stored']);
    expect((db.prepare('SELECT count(*) c FROM purchases WHERE client_uuid=?').get(e.uuid) as any).c).toBe(1);
    expect((db.prepare('SELECT last_hash FROM device_chains WHERE device_id=?').get(body.deviceId) as any).last_hash).toBe(e.hash);
  });
  it('blocks operator access to bank export and centrally set prices',async()=>{
    expect((await call('/api/payment-runs/1/file',{cookie:operatorCookie})).status).toBe(403);
    expect((await call('/api/prices',{method:'POST',cookie:operatorCookie,body:{priceDate:'2026-11-04',crop:'soybean',grade:'A',rateRupees:1}})).status).toBe(403);
  });
});


describe('unpriced draft conversion audit',()=>{
  it('keeps original collection time and explicit pricing-review metadata',async()=>{
    const reviewedAt=new Date().toISOString();
    const e=await makeEntry('91111111-1111-4111-8111-111111111111',1,GENESIS,{draftId:'92222222-2222-4222-8222-222222222222',priceReviewedAt:reviewedAt});
    const r=await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'draft-conversion',entries:[e]}});
    expect(r.body.results[0].result).toBe('stored');
    const row=db.prepare('SELECT device_ts,draft_id,price_reviewed_at FROM purchases WHERE client_uuid=?').get(e.uuid) as any;
    expect(row.device_ts).toBe(e.deviceTs);expect(row.price_reviewed_at).toBe(reviewedAt);expect(row.draft_id).toBe(e.payload.draftId);
    const again=await makeEntry('95555555-5555-4555-8555-555555555555',1,GENESIS,{draftId:e.payload.draftId,priceReviewedAt:reviewedAt});
    const repeat=await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'another-conversion',entries:[again]}});
    expect(repeat.body.results[0].error).toBe('draft_already_converted');
  });
  it('rejects a conversion missing its explicit price-review timestamp',async()=>{
    const e=await makeEntry('93333333-3333-4333-8333-333333333333',1,GENESIS,{draftId:'94444444-4444-4444-8444-444444444444'});
    const r=await call('/api/sync',{method:'POST',cookie:operatorCookie,body:{deviceId:'bad-draft-conversion',entries:[e]}});
    expect(r.status).toBe(400);
  });
});
