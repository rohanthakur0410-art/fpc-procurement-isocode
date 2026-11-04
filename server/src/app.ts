import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  netTenths, amountPaisa, verifyChain, GENESIS, fmtKg, fmtINR,
  type SyncEntry, type SyncResultItem, type SessionUser,
} from '@app/shared';
import type { DB } from './db.js';
import { signSession, setSessionCookie, clearSessionCookie, requireAuth, requireRole, type AuthedRequest } from './auth.js';
import { computeFlags } from './flags.js';
import { readMeterPhoto } from './ai.js';
import { seedIfEmpty, todayIST, smsBody } from './seed.js';

const isoDateString = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid timestamp');

const syncEntrySchema = z
  .object({
    uuid: z.string().uuid(),
    seq: z.number().int().positive(),
    prevHash: z.string().min(1).max(80),
    hash: z.string().min(1).max(80),
    deviceTs: isoDateString,
    payload: z.object({
      centreCode: z.string().min(1).max(10),
      farmerId: z.string().min(1).max(20),
      crop: z.enum(['soybean', 'tur']),
      grade: z.enum(['A', 'B']),
      grossTenths: z.number().int().positive().max(100_000_000),
      tareTenths: z.number().int().nonnegative().max(100_000_000),
      moistureTenths: z.number().int().min(0).max(400),
      rateRupees: z.number().int().positive().max(1_000_000),
      photoName: z.string().max(200).nullable().optional(),
    }),
  })
  .refine((e) => e.payload.grossTenths > e.payload.tareTenths, 'gross must exceed tare');

const syncBodySchema = z.object({
  deviceId: z.string().min(1).max(80),
  entries: z.array(syncEntrySchema).max(500),
});

export function createApp(db: DB) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use((_, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ---------- auth ----------
  app.post('/api/auth/login', (req, res) => {
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const row = db
      .prepare('SELECT username, password_hash, role, name, centre_code FROM users WHERE username = ?')
      .get(body.data.username) as
      | { username: string; password_hash: string; role: 'operator' | 'office'; name: string; centre_code: string | null }
      | undefined;
    if (!row || !bcrypt.compareSync(body.data.password, row.password_hash)) {
      res.status(401).json({ error: 'wrong_credentials' });
      return;
    }
    const user: SessionUser = { username: row.username, role: row.role, name: row.name, centreCode: row.centre_code };
    setSessionCookie(res, signSession(user));
    res.json({ user });
  });

  app.post('/api/auth/logout', (_, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // ---------- reference data ----------
  app.get('/api/centres', requireAuth, (_, res) => {
    res.json({ centres: db.prepare('SELECT code, name, name_mr AS nameMr FROM centres ORDER BY code').all() });
  });

  app.get('/api/members', requireAuth, (_, res) => {
    const rows = db
      .prepare(
        `SELECT id, farmer_id AS farmerId, name, name_mr AS nameMr, village, village_mr AS villageMr,
                land_acres AS landAcres, bank_account_masked AS bankAccountMasked, ifsc, verified
         FROM members ORDER BY name`
      )
      .all();
    res.json({ members: rows });
  });

  app.get('/api/prices', requireAuth, (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : todayIST();
    const rows = db
      .prepare('SELECT price_date AS priceDate, crop, grade, rate_rupees AS rateRupees, set_by AS setBy FROM prices WHERE price_date = ? ORDER BY crop, grade')
      .all(date);
    res.json({ date, prices: rows });
  });

  app.post('/api/prices', requireAuth, requireRole('office'), (req: AuthedRequest, res) => {
    const body = z
      .object({
        priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        crop: z.enum(['soybean', 'tur']),
        grade: z.enum(['A', 'B']),
        rateRupees: z.number().int().positive().max(1_000_000),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const b = body.data;
    db.prepare(
      `INSERT INTO prices (price_date, crop, grade, rate_rupees, set_by, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(price_date, crop, grade) DO UPDATE SET rate_rupees = excluded.rate_rupees, set_by = excluded.set_by, created_at = excluded.created_at`
    ).run(b.priceDate, b.crop, b.grade, b.rateRupees, req.user!.username, new Date().toISOString());
    res.json({ ok: true });
  });

  // ---------- offline sync (the hard part) ----------
  app.post('/api/sync', requireAuth, requireRole('operator'), async (req: AuthedRequest, res) => {
    const parsed = syncBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', detail: parsed.error.issues[0]?.message });
      return;
    }
    const { deviceId, entries } = parsed.data;
    // Reject a cross-centre batch atomically. Do not advance its chain anchor.
    if (entries.some((e) => e.payload.centreCode !== req.user!.centreCode)) {
      res.status(403).json({ error: 'wrong_centre' });
      return;
    }
    const sorted = [...entries].sort((a, b) => a.seq - b.seq);

    const chainRow = db.prepare('SELECT last_seq, last_hash FROM device_chains WHERE device_id = ?').get(deviceId) as
      | { last_seq: number; last_hash: string }
      | undefined;
    const startHash = chainRow?.last_hash ?? GENESIS;

    // Retries already stored on the server are not new links in the chain.
    const fresh = sorted.filter((e) => !db.prepare('SELECT 1 FROM purchases WHERE client_uuid = ?').get(e.uuid));
    const chainCheck = await verifyChain(
      fresh.map((e) => ({ uuid: e.uuid, seq: e.seq, prevHash: e.prevHash, deviceTs: e.deviceTs, payload: e.payload, hash: e.hash })),
      startHash
    );
    const seqStart = chainRow?.last_seq ?? 0;
    const seqOk = fresh.every((e, i) => e.seq === seqStart + i + 1);
    const chainBroken = !chainCheck.ok || !seqOk;

    const results: SyncResultItem[] = [];
    const now = new Date().toISOString();
    const [y, mo, d] = todayIST().split('-');
    const ddmmyyyy = `${d}/${mo}/${y}`;

    const tx = db.transaction(() => {
      for (const e of sorted) {
        const existing = db.prepare('SELECT slip_no, status FROM purchases WHERE client_uuid = ?').get(e.uuid) as
          | { slip_no: string; status: string }
          | undefined;
        if (existing) {
          results.push({ uuid: e.uuid, result: 'duplicate', slipNo: existing.slip_no, status: existing.status as any });
          continue;
        }
        const member = db.prepare('SELECT id, name_mr FROM members WHERE farmer_id = ?').get(e.payload.farmerId) as
          | { id: number; name_mr: string }
          | undefined;
        if (!member) {
          results.push({ uuid: e.uuid, result: 'rejected', error: 'unknown_farmer' });
          continue;
        }
        const p = e.payload;
        const net = netTenths(p.grossTenths, p.tareTenths, p.moistureTenths);
        const amount = amountPaisa(net, p.rateRupees);
        const flags = computeFlags(db, {
          memberId: member.id, centreCode: p.centreCode, crop: p.crop,
          netTenths: net, moistureTenths: p.moistureTenths, deviceTs: e.deviceTs,
        });
        if (chainBroken) flags.push('chain_broken');
        // Preserve what was collected offline; uncertain prices hold payment.
        // The device date is evidence, not a trusted timestamp.
        const purchaseDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(e.deviceTs));
        const officialPrice = db.prepare('SELECT rate_rupees FROM prices WHERE price_date = ? AND crop = ? AND grade = ?')
          .get(purchaseDate, p.crop, p.grade) as { rate_rupees: number } | undefined;
        if (!officialPrice) flags.push('price_unverified');
        else if (officialPrice.rate_rupees !== p.rateRupees) flags.push('price_mismatch');
        const status = flags.length > 0 ? 'flagged' : 'approved';

        db.prepare('UPDATE centres SET slip_counter = slip_counter + 1 WHERE code = ?').run(p.centreCode);
        const counter = (db.prepare('SELECT slip_counter FROM centres WHERE code = ?').get(p.centreCode) as { slip_counter: number }).slip_counter;
        const slipNo = `${p.centreCode}-${String(counter).padStart(5, '0')}`;

        const info = db
          .prepare(
            `INSERT INTO purchases (client_uuid, device_id, seq, prev_hash, entry_hash, centre_code, member_id,
               crop, grade, gross_tenths, tare_tenths, moisture_tenths, net_tenths, rate_rupees, amount_paisa,
               status, flags, photo_name, device_ts, synced_at, slip_no)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            e.uuid, deviceId, e.seq, e.prevHash, e.hash, p.centreCode, member.id,
            p.crop, p.grade, p.grossTenths, p.tareTenths, p.moistureTenths, net, p.rateRupees, amount,
            status, JSON.stringify(flags), p.photoName ?? null, e.deviceTs, now, slipNo
          );
        // Mock SMS gateway: the slip is queued and "sent" immediately when there is
        // network (a real gateway plugs into this exact queue later).
        db.prepare('INSERT INTO sms_outbox (purchase_id, member_id, body, status, queued_at, sent_at) VALUES (?,?,?,?,?,?)').run(
          info.lastInsertRowid, member.id,
          smsBody(slipNo, member.name_mr, { crop: p.crop, grade: p.grade, grossTenths: p.grossTenths, tareTenths: p.tareTenths, moistureTenths: p.moistureTenths, netTenths: net, rateRupees: p.rateRupees, amountPaisa: amount }, p.centreCode, ddmmyyyy),
          'sent', now, now
        );
        results.push({ uuid: e.uuid, result: 'stored', slipNo, status, flags });
      }
      const last = fresh[fresh.length - 1];
      if (last && !chainBroken && !results.some((r) => r.result === 'rejected')) {
        db.prepare(
          'INSERT INTO device_chains (device_id, last_seq, last_hash) VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_seq = excluded.last_seq, last_hash = excluded.last_hash'
        ).run(deviceId, last.seq, last.hash);
      }
    });
    tx();

    res.json({ results, chainOk: !chainBroken });
  });

  // ---------- purchases / review ----------
  app.get('/api/purchases', requireAuth, (req: AuthedRequest, res) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (req.user!.role === 'operator') {
      clauses.push('p.centre_code = ?');
      params.push(req.user!.centreCode);
    } else if (typeof req.query.centre === 'string' && req.query.centre) {
      clauses.push('p.centre_code = ?');
      params.push(req.query.centre);
    }
    if (typeof req.query.status === 'string' && ['approved', 'flagged', 'paid'].includes(req.query.status)) {
      clauses.push('p.status = ?');
      params.push(req.query.status);
    }
    if (req.query.unassigned === '1') {
      clauses.push('NOT EXISTS (SELECT 1 FROM payment_items pi WHERE pi.purchase_id = p.id)');
    }
    if (typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) {
      clauses.push(`date(p.device_ts, '+5 hours', '+30 minutes') = ?`);
      params.push(req.query.date);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = db
      .prepare(
        `SELECT p.id, p.slip_no AS slipNo, p.centre_code AS centreCode, p.crop, p.grade,
                p.gross_tenths AS grossTenths, p.tare_tenths AS tareTenths, p.moisture_tenths AS moistureTenths,
                p.net_tenths AS netTenths, p.rate_rupees AS rateRupees, p.amount_paisa AS amountPaisa,
                p.status, p.flags, p.device_ts AS deviceTs, p.synced_at AS syncedAt,
                m.farmer_id AS farmerId, m.name AS farmerName, m.name_mr AS farmerNameMr, m.village, m.village_mr AS villageMr
         FROM purchases p JOIN members m ON m.id = p.member_id
         ${where} ORDER BY p.device_ts DESC LIMIT 500`
      )
      .all(...params)
      .map((r: any) => ({ ...r, flags: JSON.parse(r.flags || '[]') }));
    res.json({ purchases: rows });
  });

  app.post('/api/purchases/:id/review', requireAuth, requireRole('office'), (req: AuthedRequest, res) => {
    const body = z.object({ action: z.enum(['approve']) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const held = db.prepare('SELECT flags FROM purchases WHERE id = ?').get(req.params.id) as { flags: string } | undefined;
    const heldFlags: string[] = JSON.parse(held?.flags || '[]');
    if (heldFlags.some((f) => f === 'price_unverified' || f === 'price_mismatch')) {
      res.status(409).json({ error: 'price_correction_required', message: 'Rate correction/reversal is not implemented. This price-held purchase cannot be approved.' });
      return;
    }
    const info = db.prepare(`UPDATE purchases SET status = 'approved' WHERE id = ? AND status = 'flagged'`).run(req.params.id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'not_flagged' });
      return;
    }
    res.json({ ok: true });
  });

  // ---------- office dashboard ----------
  app.get('/api/dashboard', requireAuth, requireRole('office'), (_, res) => {
    const today = todayIST();
    const todayRows = db
      .prepare(
        `SELECT centre_code AS centre, COUNT(*) AS slips, COALESCE(SUM(net_tenths),0) AS netTenths, COALESCE(SUM(amount_paisa),0) AS amountPaisa
         FROM purchases WHERE date(device_ts, '+5 hours', '+30 minutes') = ? GROUP BY centre_code ORDER BY centre_code`
      )
      .all(today);
    const byCrop = db
      .prepare(
        `SELECT crop, COALESCE(SUM(net_tenths),0) AS netTenths FROM purchases
         WHERE date(device_ts, '+5 hours', '+30 minutes') = ? GROUP BY crop`
      )
      .all(today);
    const pending = db
      .prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(amount_paisa),0) AS total FROM purchases WHERE status = 'approved'`)
      .get() as { c: number; total: number };
    const flagged = db.prepare(`SELECT COUNT(*) AS c FROM purchases WHERE status = 'flagged'`).get() as { c: number };
    const stock = db
      .prepare(
        `SELECT centre_code AS centre, crop, COALESCE(SUM(net_tenths),0) AS netTenths FROM purchases GROUP BY centre_code, crop ORDER BY centre_code, crop`
      )
      .all();
    res.json({ date: today, today: todayRows, todayByCrop: byCrop, pendingPayment: pending, flaggedCount: flagged.c, stock });
  });

  // ---------- payment run ----------
  app.post('/api/payment-runs', requireAuth, requireRole('office'), (req: AuthedRequest, res) => {
    const body = z.object({ purchaseIds: z.array(z.number().int()).min(1).max(1000) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const now = new Date().toISOString();
    const placeholders = body.data.purchaseIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, member_id, amount_paisa FROM purchases WHERE id IN (${placeholders}) AND status = 'approved' AND NOT EXISTS (SELECT 1 FROM payment_items i WHERE i.purchase_id = purchases.id)`)
      .all(...body.data.purchaseIds) as { id: number; member_id: number; amount_paisa: number }[];
    if (rows.length === 0) {
      res.status(400).json({ error: 'no_approved_purchases' });
      return;
    }
    const total = rows.reduce((s, r) => s + r.amount_paisa, 0);
    const tx = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO payment_runs (run_date, item_count, total_paisa, created_by, created_at) VALUES (?,?,?,?,?)')
        .run(todayIST(), rows.length, total, req.user!.username, now);
      const runId = info.lastInsertRowid as number;
      const ins = db.prepare('INSERT INTO payment_items (run_id, purchase_id, member_id, amount_paisa) VALUES (?,?,?,?)');
      for (const r of rows) ins.run(runId, r.id, r.member_id, r.amount_paisa);
      return runId;
    });
    const runId = tx();
    res.json({ runId, itemCount: rows.length, totalPaisa: total });
  });

  app.get('/api/payment-runs', requireAuth, requireRole('office'), (_, res) => {
    const runs = db
      .prepare('SELECT id, run_date AS runDate, item_count AS itemCount, total_paisa AS totalPaisa, status, created_at AS createdAt FROM payment_runs ORDER BY id DESC')
      .all();
    res.json({ runs });
  });

  app.post('/api/payment-runs/:id/mark-paid', requireAuth, requireRole('office'), (req, res) => {
    const tx = db.transaction(() => {
      const info = db.prepare(`UPDATE payment_runs SET status = 'paid' WHERE id = ? AND status = 'file_generated'`).run(req.params.id);
      if (info.changes === 0) return false;
      db.prepare(
        `UPDATE purchases SET status = 'paid' WHERE id IN (SELECT purchase_id FROM payment_items WHERE run_id = ?)`
      ).run(req.params.id);
      return true;
    });
    if (!tx()) {
      res.status(404).json({ error: 'not_found_or_already_paid' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/payment-runs/:id/file', requireAuth, requireRole('office'), (req, res) => {
    const run = db.prepare('SELECT id, run_date AS runDate FROM payment_runs WHERE id = ?').get(req.params.id) as
      | { id: number; runDate: string }
      | undefined;
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Mock bank bulk-upload CSV. Assumption (labelled in the TDD): a generic
    // NEFT-style bulk file layout, since the brief does not name the bank.
    const items = db
      .prepare(
        `SELECT m.name, m.bank_account_masked AS account, m.ifsc, i.amount_paisa AS amount, p.slip_no AS slip
         FROM payment_items i JOIN members m ON m.id = i.member_id JOIN purchases p ON p.id = i.purchase_id
         WHERE i.run_id = ? ORDER BY i.id`
      )
      .all(req.params.id) as { name: string; account: string; ifsc: string; amount: number; slip: string }[];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ['Sr No,Beneficiary Name,Account Number,IFSC,Amount (Rs),Payment Ref,Value Date'];
    items.forEach((it, i) => {
      lines.push(
        [i + 1, esc(it.name), esc(it.account), esc(it.ifsc), (it.amount / 100).toFixed(2), esc(`FPC-${run.runDate}-${it.slip}`), run.runDate].join(',')
      );
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payment-run-${run.id}.csv"`);
    res.send(lines.join('\r\n'));
  });

  // ---------- SMS outbox (mock gateway) ----------
  app.get('/api/sms', requireAuth, (req: AuthedRequest, res) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (req.user!.role === 'operator') {
      clauses.push('p.centre_code = ?');
      params.push(req.user!.centreCode);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = db
      .prepare(
        `SELECT s.id, s.body, s.status, s.queued_at AS queuedAt, s.sent_at AS sentAt,
                m.name AS farmerName, m.name_mr AS farmerNameMr, p.slip_no AS slipNo, p.centre_code AS centreCode
         FROM sms_outbox s JOIN members m ON m.id = s.member_id JOIN purchases p ON p.id = s.purchase_id
         ${where} ORDER BY s.id DESC LIMIT 200`
      )
      .all(...params);
    res.json({ sms: rows });
  });

  // ---------- AI photo reading ----------
  app.post('/api/ai/read-photo', requireAuth, requireRole('operator'), async (req, res) => {
    const body = z
      .object({
        kind: z.enum(['scale', 'moisture']),
        imageBase64: z.string().min(100).max(7_000_000),
        mimeType: z.string().max(60).optional(),
      })
      .safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const result = await readMeterPhoto(body.data.kind, body.data.imageBase64, body.data.mimeType || 'image/jpeg');
    res.json(result);
  });

  app.get('/api/health', (_, res) => res.json({ ok: true }));

  app.use('/api', (_, res) => res.status(404).json({ error: 'not_found' }));

  const dist = path.resolve(process.cwd(), 'web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}
