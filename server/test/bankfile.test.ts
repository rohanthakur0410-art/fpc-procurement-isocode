import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { openDatabase, SqliteQ, type DB, type Q } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedIfEmpty } from '../src/seed.js';
import { buildPaymentFile, type PaymentFileInput } from '../src/bankfile.js';

const sample: PaymentFileInput = {
  runId: 7,
  runDate: '2026-11-07',
  items: [
    { name: 'Kamal Shinde', account: 'XXXXXX1234', ifsc: 'SBIN0001234', amountPaisa: 5975200, slip: 'C07-24518' },
    { name: 'Ravi Pawar, Patil', account: 'XXXXXX9876', ifsc: 'HDFC0000456', amountPaisa: 4030350, slip: 'C07-24519' },
  ],
};

describe('bank file builders', () => {
  it('builds a Union Bank NEFT text file with header, one record per farmer and documented field order', () => {
    const f = buildPaymentFile('unionbank-neft', sample)!;
    const lines = f.body.split('\r\n');
    expect(f.filename).toBe('payment-run-7-unionbank-neft.txt');
    expect(lines[0]).toBe('FILEHDR,FPCDEMO,7,N,FPC payment run 2026-11-07');
    expect(lines).toHaveLength(3);
    const rec = lines[1].split(',');
    expect(rec[0]).toBe('NEFT');
    expect(rec[1]).toBe('UBIN0DEMO01'); // synthetic demo remitter branch IFSC
    expect(rec[3]).toBe('SBIN0001234'); // receiver (beneficiary) IFSC
    expect(rec[4]).toBe('XXXXXX1234');
    expect(rec[5]).toBe('INR');
    expect(rec[6]).toBe('59752.00');
    expect(rec[8]).toBe('Kamal Shinde');
    expect(rec[10]).toBe('C07-24518');
  });

  it('strips commas from fields, as Union Bank format doc requires', () => {
    const f = buildPaymentFile('unionbank-neft', sample)!;
    const rec = f.body.split('\r\n')[2].split(',');
    expect(rec[8]).toBe('Ravi Pawar Patil');
  });

  it('builds a Union Bank salary CSV whose debit total equals the sum of credits', () => {
    const f = buildPaymentFile('unionbank-salary', sample)!;
    const lines = f.body.split('\r\n');
    expect(lines[0]).toBe('FILEHDR,FPCDEMO,7');
    const debit = lines[1].split(',');
    expect(debit[3]).toBe('DR');
    const credits = lines.slice(2).map((l) => l.split(','));
    expect(credits.every((c) => c[3] === 'CR')).toBe(true);
    const sum = credits.reduce((s, c) => s + Number(c[4]), 0);
    expect(Number(debit[4])).toBeCloseTo(sum, 2);
    expect(debit[4]).toBe('100055.50');
  });

  it('keeps the generic layout unchanged and rejects unknown formats', () => {
    const f = buildPaymentFile('generic', sample)!;
    expect(f.body.split('\r\n')[0]).toBe('Sr No,Beneficiary Name,Account Number,IFSC,Amount (Rs),Payment Ref,Value Date');
    expect(f.body).toContain('59752.00');
    expect(buildPaymentFile('hdfc', sample)).toBeNull();
  });
});

describe('payment file endpoint formats', () => {
  let db: DB;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let base: string;
  let officeCookie = '';

  beforeAll(async () => {
    db = openDatabase(':memory:');
    const q: Q = new SqliteQ(db);
    await seedIfEmpty(q);
    const app = createApp(q);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const off = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'office', password: 'demo1234' }),
    });
    officeCookie = (off.headers.get('set-cookie') || '').split(';')[0];
  });

  afterAll(() => server.close());

  it('serves the Union Bank NEFT layout via ?format= and rejects an unknown format', async () => {
    const approved = (db.prepare(`SELECT id FROM purchases WHERE status = 'approved'`).all() as any[]).map((r) => r.id);
    const r = await fetch(`${base}/api/payment-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: officeCookie },
      body: JSON.stringify({ purchaseIds: approved }),
    });
    const { runId } = (await r.json()) as any;
    const neft = await fetch(`${base}/api/payment-runs/${runId}/file?format=unionbank-neft`, { headers: { cookie: officeCookie } });
    expect(neft.status).toBe(200);
    expect(neft.headers.get('content-disposition')).toContain('unionbank-neft.txt');
    const text = await neft.text();
    expect(text.split('\r\n')[0]).toMatch(/^FILEHDR,FPCDEMO,/);
    expect(text).toContain('NEFT,UBIN0DEMO01,');
    const bad = await fetch(`${base}/api/payment-runs/${runId}/file?format=nope`, { headers: { cookie: officeCookie } });
    expect(bad.status).toBe(400);
    const def = await fetch(`${base}/api/payment-runs/${runId}/file`, { headers: { cookie: officeCookie } });
    expect(await def.text()).toContain('Beneficiary Name');
  });
});
