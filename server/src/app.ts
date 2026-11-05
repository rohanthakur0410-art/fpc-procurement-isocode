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
import { isUniqueViolation, type Q } from './db.js';
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
      draftId: z.string().uuid().optional(),
      priceReviewedAt: isoDateString.optional(),
      photoName: z.string().max(200).nullable().optional(),
    }),
  })
  .refine((e) => e.payload.grossTenths > e.payload.tareTenths, 'gross must exceed tare')
  .refine((e) => !e.payload.draftId || !!e.payload.priceReviewedAt, 'draft conversion requires dated price review');

const syncBodySchema = z.object({
  deviceId: z.string().min(1).max(80),
  entries: z.array(syncEntrySchema).max(500),
});

export function createApp(q: Q) {
  // IST calendar date of a stored ISO timestamp, per dialect.
  const istDate = (col: string) =>
    q.dialect === 'pg'
      ? `to_char(${col}::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`
      : `date(${col}, '+5 hours', '+30 minutes')`;

  // Express 4 does not forward async handler rejections; wrap every async
  // route so a database error becomes a 500 response, never a process crash.
  const ah = (fn: (req: any, res: any, next: any) => Promise<unknown>) =>
    (req: any, res: any, next: any) => void Promise.resolve(fn(req, res, next)).catch(next);

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
  app.post('/api/auth/login', ah(async (req, res) => {
    const body = z.object({ username: z.string().min(1), password: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const row = await q.get<{
      username: string; password_hash: string; role: 'operator' | 'office'; name: string; centre_code: string | null;
    }>('SELECT username, password_hash, role, name, centre_code FROM users WHERE username = ?', [body.data.username]);
    if (!row || !bcrypt.compareSync(body.data.password, row.password_hash)) {
      res.status(401).json({ error: 'wrong_credentials' });
      return;
    }
    const user: SessionUser = { username: row.username, role: row.role, name: row.name, centreCode: row.centre_code };
    setSessionCookie(res, signSession(user));
    res.json({ user });
  }));

  app.post('/api/auth/logout', (_, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  });

  // ---------- reference data ----------
  app.get('/api/centres', requireAuth, ah(async (_, res) => {
    res.json({ centres: await q.all('SELECT code, name, name_mr AS "nameMr" FROM centres ORDER BY code') });
  }));

  app.get('/api/members', requireAuth, ah(async (_, res) => {
    const rows = await q.all(
      `SELECT id, farmer_id AS "farmerId", name, name_mr AS "nameMr", village, village_mr AS "villageMr",
              land_acres AS "landAcres", bank_account_masked AS "bankAccountMasked", ifsc, verified
       FROM members ORDER BY name`
    );
    res.json({ members: rows });
  }));

  app.get('/api/prices', requireAuth, ah(async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : todayIST();
    const rows = await q.all(
      'SELECT price_date AS "priceDate", crop, grade, rate_rupees AS "rateRupees", set_by AS "setBy" FROM prices WHERE price_date = ? ORDER BY crop, grade',
      [date]
    );
    res.json({ date, prices: rows });
  }));

  app.post('/api/prices', requireAuth, requireRole('office'), ah(async (req: AuthedRequest, res) => {
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
    await q.run(
      `INSERT INTO prices (price_date, crop, grade, rate_rupees, set_by, created_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(price_date, crop, grade) DO UPDATE SET rate_rupees = excluded.rate_rupees, set_by = excluded.set_by, created_at = excluded.created_at`,
      [b.priceDate, b.crop, b.grade, b.rateRupees, req.user!.username, new Date().toISOString()]
    );
    res.json({ ok: true });
  }));

  // ---------- offline sync (the hard part) ----------
  app.post('/api/sync', requireAuth, requireRole('operator'), ah(async (req: AuthedRequest, res) => {
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

    const chainRow = await q.get<{ last_seq: number; last_hash: string }>(
      'SELECT last_seq, last_hash FROM device_chains WHERE device_id = ?',
      [deviceId]
    );
    const startHash = chainRow?.last_hash ?? GENESIS;

    // Retries already stored on the server are not new links in the chain.
    const freshFlags = await Promise.all(sorted.map((e) => q.get('SELECT 1 FROM purchases WHERE client_uuid = ?', [e.uuid])));
    const fresh = sorted.filter((_, i) => !freshFlags[i]);
    const chainCheck = await verifyChain(
      fresh.map((e) => ({ uuid: e.uuid, seq: e.seq, prevHash: e.prevHash, deviceTs: e.deviceTs, payload: e.payload, hash: e.hash })),
      startHash
    );
    const seqStart = chainRow?.last_seq ?? 0;
    const seqOk = fresh.every((e, i) => e.seq === seqStart + i + 1);
    let chainBroken = !chainCheck.ok || !seqOk;

    const results: SyncResultItem[] = [];
    const now = new Date().toISOString();
    const [y, mo, d] = todayIST().split('-');
    const ddmmyyyy = `${d}/${mo}/${y}`;

    // A concurrent same-uuid batch can win the INSERT race on Postgres: its
    // commit is invisible to our existence check. Roll back and replay once
    // or twice; the replay sees every entry as duplicate/stored. Rolls back
    // slip-counter increments too, so no counter gaps.
    let syncAttempts = 0;
    for (;;) {
      try {
        await q.tx(async (t) => {
      // Hashing awaited above. Another request may have committed meanwhile.
      const latest = await t.get<{ last_hash: string }>('SELECT last_hash FROM device_chains WHERE device_id = ?', [deviceId]);
      if ((latest?.last_hash ?? GENESIS) !== startHash) chainBroken = true;
      for (const e of sorted) {
        const existing = await t.get<{
          slip_no: string; status: string; entry_hash: string; device_id: string; centre_code: string; flags: string;
        }>(
          'SELECT slip_no, status, entry_hash, device_id, centre_code, flags FROM purchases WHERE client_uuid = ?',
          [e.uuid]
        );
        if (existing) {
          if (existing.entry_hash !== e.hash || existing.device_id !== deviceId || existing.centre_code !== req.user!.centreCode) {
            results.push({ uuid: e.uuid, result: 'rejected', error: 'uuid_conflict' });
            continue;
          }
          results.push({ uuid: e.uuid, result: 'duplicate', slipNo: existing.slip_no, status: existing.status as any, flags: JSON.parse(existing.flags) });
          continue;
        }
        if (e.payload.draftId && (await t.get('SELECT 1 FROM purchases WHERE draft_id = ?', [e.payload.draftId]))) {
          results.push({ uuid: e.uuid, result: 'rejected', error: 'draft_already_converted' });
          continue;
        }
        const member = await t.get<{ id: number; name_mr: string }>('SELECT id, name_mr FROM members WHERE farmer_id = ?', [
          e.payload.farmerId,
        ]);
        if (!member) {
          results.push({ uuid: e.uuid, result: 'rejected', error: 'unknown_farmer' });
          continue;
        }
        const p = e.payload;
        const net = netTenths(p.grossTenths, p.tareTenths, p.moistureTenths);
        const amount = amountPaisa(net, p.rateRupees);
        const flags = await computeFlags(t, {
          memberId: member.id, centreCode: p.centreCode, crop: p.crop,
          netTenths: net, moistureTenths: p.moistureTenths, deviceTs: e.deviceTs,
        });
        if (chainBroken) flags.push('chain_broken');
        // Preserve what was collected offline; uncertain prices hold payment.
        // The device date is evidence, not a trusted timestamp.
        const purchaseDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(e.deviceTs));
        const officialPrice = await t.get<{ rate_rupees: number }>(
          'SELECT rate_rupees FROM prices WHERE price_date = ? AND crop = ? AND grade = ?',
          [purchaseDate, p.crop, p.grade]
        );
        if (!officialPrice) flags.push('price_unverified');
        else if (officialPrice.rate_rupees !== p.rateRupees) flags.push('price_mismatch');
        const status = flags.length > 0 ? 'flagged' : 'approved';

        await t.run('UPDATE centres SET slip_counter = slip_counter + 1 WHERE code = ?', [p.centreCode]);
        const counter = (await t.get<{ slip_counter: number }>('SELECT slip_counter FROM centres WHERE code = ?', [p.centreCode]))!.slip_counter;
        const slipNo = `${p.centreCode}-${String(counter).padStart(5, '0')}`;

        const inserted = await t.get<{ id: number }>(
          `INSERT INTO purchases (client_uuid, device_id, seq, prev_hash, entry_hash, centre_code, member_id,
             crop, grade, gross_tenths, tare_tenths, moisture_tenths, net_tenths, rate_rupees, amount_paisa,
             status, flags, photo_name, device_ts, synced_at, slip_no, draft_id, price_reviewed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
          [
            e.uuid, deviceId, e.seq, e.prevHash, e.hash, p.centreCode, member.id,
            p.crop, p.grade, p.grossTenths, p.tareTenths, p.moistureTenths, net, p.rateRupees, amount,
            status, JSON.stringify(flags), p.photoName ?? null, e.deviceTs, now, slipNo, p.draftId ?? null, p.priceReviewedAt ?? null,
          ]
        );
        // Mock SMS gateway: the slip is queued and "sent" immediately when there is
        // network (a real gateway plugs into this exact queue later).
        await t.run(
          'INSERT INTO sms_outbox (purchase_id, member_id, body, status, queued_at, sent_at) VALUES (?,?,?,?,?,?)',
          [
            inserted!.id, member.id,
            smsBody(slipNo, member.name_mr, { crop: p.crop, grade: p.grade, grossTenths: p.grossTenths, tareTenths: p.tareTenths, moistureTenths: p.moistureTenths, netTenths: net, rateRupees: p.rateRupees, amountPaisa: amount }, p.centreCode, ddmmyyyy),
            'sent', now, now,
          ]
        );
        results.push({ uuid: e.uuid, result: 'stored', slipNo, status, flags });
      }
      const last = fresh[fresh.length - 1];
      if (last && !chainBroken && !results.some((r) => r.result === 'rejected')) {
        await t.run(
          'INSERT INTO device_chains (device_id, last_seq, last_hash) VALUES (?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_seq = excluded.last_seq, last_hash = excluded.last_hash',
          [deviceId, last.seq, last.hash]
        );
      }
        });
        break;
      } catch (e) {
        if (isUniqueViolation(e) && ++syncAttempts < 3) {
          results.length = 0;
          chainBroken = !chainCheck.ok || !seqOk;
          continue;
        }
        throw e;
      }
    }

    res.json({ results, chainOk: !chainBroken });
  }));

  // ---------- purchases / review ----------
  app.get('/api/purchases', requireAuth, ah(async (req: AuthedRequest, res) => {
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
      clauses.push(`${istDate('p.device_ts')} = ?`);
      params.push(req.query.date);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = (
      await q.all<any>(
        `SELECT p.id, p.slip_no AS "slipNo", p.centre_code AS "centreCode", p.crop, p.grade,
                p.gross_tenths AS "grossTenths", p.tare_tenths AS "tareTenths", p.moisture_tenths AS "moistureTenths",
                p.net_tenths AS "netTenths", COALESCE(pr.resolved_rate,p.rate_rupees) AS "rateRupees", COALESCE(pr.resolved_amount,p.amount_paisa) AS "amountPaisa",
                p.rate_rupees AS "originalRateRupees", p.amount_paisa AS "originalAmountPaisa", pr.resolved_at AS "priceResolvedAt", pr.resolved_by AS "priceResolvedBy", pr.reason AS "priceResolutionReason",
                p.status, p.flags, p.device_ts AS "deviceTs", p.synced_at AS "syncedAt",
                m.farmer_id AS "farmerId", m.name AS "farmerName", m.name_mr AS "farmerNameMr", m.village, m.village_mr AS "villageMr"
         FROM purchases p JOIN members m ON m.id = p.member_id LEFT JOIN price_resolutions pr ON pr.purchase_id=p.id
         ${where} ORDER BY p.device_ts DESC LIMIT 500`,
        params
      )
    ).map((r: any) => ({ ...r, flags: JSON.parse(r.flags || '[]') }));
    res.json({ purchases: rows });
  }));

  app.post('/api/purchases/:id/review', requireAuth, requireRole('office'), ah(async (req: AuthedRequest, res) => {
    const body = z.object({ action: z.enum(['approve']) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const held = await q.get<{ flags: string }>('SELECT flags FROM purchases WHERE id = ?', [req.params.id]);
    const heldFlags: string[] = JSON.parse(held?.flags || '[]');
    if (
      heldFlags.some((f) => f === 'price_unverified' || f === 'price_mismatch') &&
      !(await q.get('SELECT 1 FROM price_resolutions WHERE purchase_id=?', [req.params.id]))
    ) {
      res.status(409).json({ error: 'price_correction_required', message: 'Explicit dated-price resolution is required before approval.' });
      return;
    }
    const info = await q.run(`UPDATE purchases SET status = 'approved' WHERE id = ? AND status = 'flagged'`, [req.params.id]);
    if (info.changes === 0) {
      res.status(404).json({ error: 'not_flagged' });
      return;
    }
    res.json({ ok: true });
  }));

  // An append-only correction never rewrites the original device payload/hash.
  app.get('/api/purchases/:id/price-resolution', requireAuth, requireRole('office'), ah(async (req, res) => {
    const p = await q.get<any>('SELECT * FROM purchases WHERE id=?', [req.params.id]);
    if (!p) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(p.device_ts));
    const official = await q.get<any>('SELECT rate_rupees FROM prices WHERE price_date=? AND crop=? AND grade=?', [date, p.crop, p.grade]);
    const resolution = await q.get('SELECT * FROM price_resolutions WHERE purchase_id=?', [p.id]);
    res.json({
      collectionDate: date, originalRate: p.rate_rupees, originalAmount: p.amount_paisa,
      proposedRate: official?.rate_rupees ?? null,
      proposedAmount: official ? amountPaisa(p.net_tenths, official.rate_rupees) : null,
      resolution: resolution ?? null,
    });
  }));
  app.post('/api/purchases/:id/price-resolution', requireAuth, requireRole('office'), ah(async (req: AuthedRequest, res) => {
    const parsed = z.object({ expectedRate: z.number().int().positive(), reason: z.string().trim().min(5).max(500) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    let outcome: string | null;
    try {
      outcome = await q.tx(async (t) => {
      const p = await t.get<any>(
        'SELECT p.*, m.name_mr FROM purchases p JOIN members m ON m.id=p.member_id WHERE p.id=?',
        [req.params.id]
      );
      if (!p || p.status !== 'flagged' || !JSON.parse(p.flags).some((f: string) => f === 'price_mismatch' || f === 'price_unverified'))
        return 'not_price_held';
      if (
        (await t.get('SELECT 1 FROM payment_items WHERE purchase_id=?', [p.id])) ||
        (await t.get('SELECT 1 FROM price_resolutions WHERE purchase_id=?', [p.id]))
      )
        return 'already_resolved_or_reserved';
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(p.device_ts));
      const official = await t.get<any>('SELECT rate_rupees FROM prices WHERE price_date=? AND crop=? AND grade=?', [date, p.crop, p.grade]);
      if (!official) return 'missing_dated_price';
      if (official.rate_rupees !== parsed.data.expectedRate) return 'price_changed_review_again';
      const amount = amountPaisa(p.net_tenths, official.rate_rupees);
      const now = new Date().toISOString();
      await t.run('INSERT INTO price_resolutions VALUES (?,?,?,?,?,?,?,?)', [
        p.id, p.rate_rupees, p.amount_paisa, official.rate_rupees, amount, req.user!.username, now, parsed.data.reason,
      ]);
      const [y, m, d] = date.split('-');
      const text =
        'दर दुरुस्ती - मूळ नोंद कायम\n' +
        smsBody(
          p.slip_no, p.name_mr,
          { crop: p.crop, grade: p.grade, grossTenths: p.gross_tenths, tareTenths: p.tare_tenths, moistureTenths: p.moisture_tenths, netTenths: p.net_tenths, rateRupees: official.rate_rupees, amountPaisa: amount },
          p.centre_code, `${d}/${m}/${y}`
        );
      await t.run('INSERT INTO sms_outbox(purchase_id,member_id,body,status,queued_at,sent_at) VALUES (?,?,?,?,?,?)', [
        p.id, p.member_id, text, 'sent', now, now,
      ]);
      return null;
      });
    } catch (e) {
      if (isUniqueViolation(e)) outcome = 'already_resolved_or_reserved';
      else throw e;
    }
    if (outcome) {
      res.status(409).json({ error: outcome });
      return;
    }
    res.json({ ok: true, stillHeldForReview: true });
  }));

  // ---------- office dashboard ----------
  app.get('/api/dashboard', requireAuth, requireRole('office'), ah(async (_, res) => {
    const today = todayIST();
    const dayExpr = istDate('device_ts');
    const todayRows = await q.all(
      `SELECT centre_code AS "centre", COUNT(*) AS "slips", COALESCE(SUM(net_tenths),0) AS "netTenths", COALESCE(SUM(COALESCE((SELECT resolved_amount FROM price_resolutions pr WHERE pr.purchase_id=purchases.id),amount_paisa)),0) AS "amountPaisa"
       FROM purchases WHERE ${dayExpr} = ? GROUP BY centre_code ORDER BY centre_code`,
      [today]
    );
    const byCrop = await q.all(
      `SELECT crop, COALESCE(SUM(net_tenths),0) AS "netTenths" FROM purchases
       WHERE ${dayExpr} = ? GROUP BY crop`,
      [today]
    );
    const pending = (await q.get<{ c: number; total: number }>(
      `SELECT COUNT(*) AS "c", COALESCE(SUM(COALESCE((SELECT resolved_amount FROM price_resolutions pr WHERE pr.purchase_id=purchases.id),amount_paisa)),0) AS "total" FROM purchases WHERE status = 'approved'`
    ))!;
    const flagged = (await q.get<{ c: number }>(`SELECT COUNT(*) AS "c" FROM purchases WHERE status = 'flagged'`))!;
    const stock = await q.all(
      `SELECT centre_code AS "centre", crop, COALESCE(SUM(net_tenths),0) AS "netTenths" FROM purchases GROUP BY centre_code, crop ORDER BY centre_code, crop`
    );
    res.json({ date: today, today: todayRows, todayByCrop: byCrop, pendingPayment: pending, flaggedCount: flagged.c, stock });
  }));

  // ---------- payment run ----------
  app.post('/api/payment-runs', requireAuth, requireRole('office'), ah(async (req: AuthedRequest, res) => {
    const body = z.object({ purchaseIds: z.array(z.number().int()).min(1).max(1000) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const now = new Date().toISOString();
    const placeholders = body.data.purchaseIds.map(() => '?').join(',');
    const rows = await q.all<{ id: number; member_id: number; amount_paisa: number }>(
      `SELECT id, member_id, COALESCE((SELECT resolved_amount FROM price_resolutions pr WHERE pr.purchase_id=purchases.id),amount_paisa) AS "amount_paisa" FROM purchases WHERE id IN (${placeholders}) AND status = 'approved' AND EXISTS (SELECT 1 FROM members m WHERE m.id = purchases.member_id AND m.verified = 1) AND NOT EXISTS (SELECT 1 FROM payment_items i WHERE i.purchase_id = purchases.id)`,
      body.data.purchaseIds
    );
    if (rows.length === 0) {
      res.status(400).json({ error: 'no_approved_purchases' });
      return;
    }
    const total = rows.reduce((s, r) => s + r.amount_paisa, 0);
    let runId: number;
    try {
      runId = await q.tx(async (t) => {
      const inserted = await t.get<{ id: number }>(
        'INSERT INTO payment_runs (run_date, item_count, total_paisa, created_by, created_at) VALUES (?,?,?,?,?) RETURNING id',
        [todayIST(), rows.length, total, req.user!.username, now]
      );
      const id = inserted!.id;
      for (const r of rows)
        await t.run('INSERT INTO payment_items (run_id, purchase_id, member_id, amount_paisa) VALUES (?,?,?,?)', [
          id, r.id, r.member_id, r.amount_paisa,
        ]);
      return id;
      });
    } catch (e) {
      // Lost a concurrent race for the same purchase (payment_items.purchase_id is UNIQUE).
      if (isUniqueViolation(e)) {
        res.status(400).json({ error: 'no_approved_purchases' });
        return;
      }
      throw e;
    }
    res.json({ runId, itemCount: rows.length, totalPaisa: total });
  }));

  app.get('/api/payment-runs', requireAuth, requireRole('office'), ah(async (_, res) => {
    const runs = await q.all<any>(
      'SELECT id, run_date AS "runDate", item_count AS "itemCount", total_paisa AS "totalPaisa", status, created_at AS "createdAt" FROM payment_runs ORDER BY id DESC'
    );
    const itemsSql = `SELECT p.slip_no AS "slipNo", m.name AS "farmerName", m.name_mr AS "farmerNameMr", i.amount_paisa AS "amountPaisa"
      FROM payment_items i JOIN purchases p ON p.id=i.purchase_id JOIN members m ON m.id=i.member_id WHERE i.run_id=? ORDER BY i.id`;
    res.json({
      runs: await Promise.all(runs.map(async (r: any) => ({ ...r, items: await q.all(itemsSql, [r.id]) }))),
    });
  }));

  app.post('/api/payment-runs/:id/mark-paid', requireAuth, requireRole('office'), ah(async (req, res) => {
    const done = await q.tx(async (t) => {
      const info = await t.run(`UPDATE payment_runs SET status = 'paid' WHERE id = ? AND status = 'file_generated'`, [req.params.id]);
      if (info.changes === 0) return false;
      await t.run(`UPDATE purchases SET status = 'paid' WHERE id IN (SELECT purchase_id FROM payment_items WHERE run_id = ?)`, [
        req.params.id,
      ]);
      return true;
    });
    if (!done) {
      res.status(404).json({ error: 'not_found_or_already_paid' });
      return;
    }
    res.json({ ok: true });
  }));

  app.get('/api/payment-runs/:id/file', requireAuth, requireRole('office'), ah(async (req, res) => {
    const run = await q.get<{ id: number; runDate: string }>('SELECT id, run_date AS "runDate" FROM payment_runs WHERE id = ?', [
      req.params.id,
    ]);
    if (!run) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    // Mock bank bulk-upload CSV. Assumption (labelled in the TDD): a generic
    // NEFT-style bulk file layout, since the brief does not name the bank.
    const items = await q.all<{ name: string; account: string; ifsc: string; amount: number; slip: string }>(
      `SELECT m.name, m.bank_account_masked AS "account", m.ifsc, i.amount_paisa AS "amount", p.slip_no AS "slip"
       FROM payment_items i JOIN members m ON m.id = i.member_id JOIN purchases p ON p.id = i.purchase_id
       WHERE i.run_id = ? ORDER BY i.id`,
      [req.params.id]
    );
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
  }));

  // ---------- SMS outbox (mock gateway) ----------
  app.get('/api/sms', requireAuth, ah(async (req: AuthedRequest, res) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (req.user!.role === 'operator') {
      clauses.push('p.centre_code = ?');
      params.push(req.user!.centreCode);
    }
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = await q.all(
      `SELECT s.id, s.body, s.status, s.queued_at AS "queuedAt", s.sent_at AS "sentAt",
              m.name AS "farmerName", m.name_mr AS "farmerNameMr", p.slip_no AS "slipNo", p.centre_code AS "centreCode"
       FROM sms_outbox s JOIN members m ON m.id = s.member_id JOIN purchases p ON p.id = s.purchase_id
       ${where} ORDER BY s.id DESC LIMIT 200`,
      params
    );
    res.json({ sms: rows });
  }));

  // ---------- AI photo reading ----------
  app.post('/api/ai/read-photo', requireAuth, requireRole('operator'), ah(async (req, res) => {
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
  }));

  app.get('/api/health', (_, res) => res.json({ ok: true }));

  app.use('/api', (_, res) => res.status(404).json({ error: 'not_found' }));

  // Last-resort error handler: no stack or database detail leaks to clients.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled route error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
  });

  const dist = path.resolve(process.cwd(), 'web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return app;
}
