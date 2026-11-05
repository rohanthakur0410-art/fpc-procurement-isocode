import bcrypt from 'bcryptjs';
import { buildEntry, netTenths, amountPaisa, GENESIS, fmtKg, fmtINR, fmtMoisture } from '@app/shared';
import type { Q } from './db.js';

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function istIso(hhmm: string, date = todayIST()): string {
  // Explicit offset is independent of the server process timezone.
  return new Date(`${date}T${hhmm}:00+05:30`).toISOString();
}

export const CROP_MR: Record<string, string> = { soybean: 'सोयाबीन', tur: 'तूर' };

export function smsBody(
  slipNo: string,
  memberNameMr: string,
  p: { crop: string; grade: string; grossTenths: number; tareTenths: number; moistureTenths: number; netTenths: number; rateRupees: number; amountPaisa: number },
  centreCode: string,
  dateDdMmYyyy: string
): string {
  const rate = p.rateRupees.toLocaleString('en-IN');
  return [
    'शेतकरी सरल - डिजिटल पावती',
    `पावती क्र.: ${slipNo}`,
    `शेतकरी: ${memberNameMr}`,
    `पीक: ${CROP_MR[p.crop] ?? p.crop} (ग्रेड ${p.grade})`,
    `एकूण वजन: ${fmtKg(p.grossTenths)} कि.ग्रॅ.`,
    `तारा वजन: ${fmtKg(p.tareTenths)} कि.ग्रॅ.`,
    `आर्द्रता: ${fmtMoisture(p.moistureTenths)}%`,
    `निव्वळ वजन: ${fmtKg(p.netTenths)} कि.ग्रॅ.`,
    `दर: ₹${rate} / क्विंटल`,
    `रक्कम: ₹${fmtINR(p.amountPaisa)}`,
    `केंद्र: ${centreCode} | दिनांक: ${dateDdMmYyyy}`,
    'काही चूक दिसल्यास लगेच केंद्राशी संपर्क साधा.',
  ].join('\n');
}

export async function seedIfEmpty(q: Q): Promise<void> {
  const has = (await q.get<{ c: number }>('SELECT COUNT(*) AS c FROM users'))!;
  if (has.c > 0) return;

  const insCentre = (code: string, name: string, nameMr: string, counter: number) =>
    q.run('INSERT INTO centres (code, name, name_mr, slip_counter) VALUES (?,?,?,?)', [code, name, nameMr, counter]);
  await insCentre('C03', 'Chakur Centre', 'चाकूर केंद्र', 10240);
  await insCentre('C07', 'Harngul Centre', 'हरंगुळ केंद्र', 24519);
  await insCentre('C12', 'Aurad Centre', 'औराद केंद्र', 8876);

  const hash = bcrypt.hashSync('demo1234', 10);
  const insUser = (username: string, role: string, name: string, centreCode: string | null) =>
    q.run('INSERT INTO users (username, password_hash, role, name, centre_code) VALUES (?,?,?,?,?)', [
      username, hash, role, name, centreCode,
    ]);
  await insUser('operator', 'operator', 'Santosh Patil', 'C07');
  await insUser('office', 'office', 'Priya Deshmukh', null);

  const insMember = (m: Array<string | number>, i: number) =>
    q.run(
      'INSERT INTO members (farmer_id, name, name_mr, village, village_mr, land_acres, bank_account_masked, ifsc, verified) VALUES (?,?,?,?,?,?,?,?,1)',
      [m[0], m[1], m[2], m[3], m[4], m[5], `XXXXXX${String(4521 + i * 137).slice(-4)}`, `DEMO0${String(10000 + i * 111).slice(-5)}`]
    );
  const members: Array<[string, string, string, string, string, number]> = [
    ['F0001', 'Sunil Jadhav', 'सुनील जाधव', 'Harngul', 'हरंगुळ', 4.5],
    ['F0002', 'Kamal Shinde', 'कमल शिंदे', 'Harngul', 'हरंगुळ', 3.0],
    ['F0003', 'Mohan Biradar', 'मोहन बिरादार', 'Aurad', 'औराद', 6.0],
    ['F0004', 'Anita Pawar', 'अनिता पवार', 'Aurad', 'औराद', 2.5],
    ['F0005', 'Vitthal Bhosale', 'विठ्ठल भोसले', 'Chakur', 'चाकूर', 5.0],
    ['F0006', 'Sachin Chavan', 'सचिन चव्हाण', 'Chakur', 'चाकूर', 3.5],
    ['F0007', 'Lata Shinde', 'लता शिंदे', 'Renapur', 'रेन्नापूर', 2.0],
    ['F0008', 'Rama Kadam', 'रामा कदम', 'Renapur', 'रेन्नापूर', 4.0],
    ['F0009', 'Balu Salunke', 'बाळू साळुंखे', 'Harngul', 'हरंगुळ', 7.5],
    ['F0010', 'Dagdu More', 'दगडू मोरे', 'Aurad', 'औराद', 1.5],
  ];
  for (let i = 0; i < members.length; i++) await insMember(members[i], i);

  const insPrice = (date: string, crop: string, grade: string, rate: number, setBy: string, createdAt: string) =>
    q.run('INSERT INTO prices (price_date, crop, grade, rate_rupees, set_by, created_at) VALUES (?,?,?,?,?,?)', [
      date, crop, grade, rate, setBy, createdAt,
    ]);
  const today = todayIST();
  const now = new Date().toISOString();
  // Grade B rates are an assumption (the brief names grades but lists no B rates).
  await insPrice(today, 'soybean', 'A', 4850, 'office', now);
  await insPrice(today, 'soybean', 'B', 4650, 'office', now);
  await insPrice(today, 'tur', 'A', 7200, 'office', now);
  await insPrice(today, 'tur', 'B', 6900, 'office', now);

  // The three sample slips from the brief, as already-synced history from this morning.
  const memberIdByFarmer = async (fid: string) =>
    ((await q.get<{ id: number }>('SELECT id FROM members WHERE farmer_id = ?', [fid]))!).id;

  const samples: Array<{
    slip: string; farmer: string; centre: string; crop: 'soybean' | 'tur';
    gross: number; tare: number; moisture: number; rate: number; time: string;
  }> = [
    { slip: 'C07-24518', farmer: 'F0001', centre: 'C07', crop: 'soybean', gross: 12500, tare: 180, moisture: 115, rate: 4850, time: '09:40' },
    { slip: 'C07-24519', farmer: 'F0002', centre: 'C07', crop: 'soybean', gross: 8600, tare: 120, moisture: 140, rate: 4850, time: '10:05' },
    { slip: 'C12-08876', farmer: 'F0003', centre: 'C12', crop: 'tur', gross: 6400, tare: 100, moisture: 100, rate: 7200, time: '10:20' },
  ];

  let prevHash = GENESIS;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const net = netTenths(s.gross, s.tare, s.moisture);
    const amount = amountPaisa(net, s.rate);
    const payload = {
      centreCode: s.centre, farmerId: s.farmer, crop: s.crop, grade: 'A',
      grossTenths: s.gross, tareTenths: s.tare, moistureTenths: s.moisture,
      rateRupees: s.rate, photoName: null,
    };
    const deviceTs = istIso(s.time);
    const entry = await buildEntry(`seed-${i + 1}`, i + 1, prevHash, deviceTs, payload);
    prevHash = entry.hash;
    const memberId = await memberIdByFarmer(s.farmer);
    const inserted = (await q.get<{ id: number }>(
      `INSERT INTO purchases (client_uuid, device_id, seq, prev_hash, entry_hash, centre_code, member_id,
        crop, grade, gross_tenths, tare_tenths, moisture_tenths, net_tenths, rate_rupees, amount_paisa,
        status, flags, photo_name, device_ts, synced_at, slip_no)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [
        entry.uuid, 'seed-device', entry.seq, entry.prevHash, entry.hash, s.centre, memberId,
        s.crop, 'A', s.gross, s.tare, s.moisture, net, s.rate, amount,
        'approved', '[]', null, deviceTs, deviceTs, s.slip,
      ]
    ))!;
    const member = (await q.get<{ name_mr: string }>('SELECT name_mr FROM members WHERE id = ?', [memberId]))!;
    const [y, mo, d] = today.split('-');
    await q.run(
      'INSERT INTO sms_outbox (purchase_id, member_id, body, status, queued_at, sent_at) VALUES (?,?,?,?,?,?)',
      [
        inserted.id, memberId,
        smsBody(s.slip, member.name_mr, { crop: s.crop, grade: 'A', grossTenths: s.gross, tareTenths: s.tare, moistureTenths: s.moisture, netTenths: net, rateRupees: s.rate, amountPaisa: amount }, s.centre, `${d}/${mo}/${y}`),
        'sent', deviceTs, deviceTs,
      ]
    );
  }
  await q.run('INSERT INTO device_chains (device_id, last_seq, last_hash) VALUES (?,?,?)', ['seed-device', samples.length, prevHash]);
}
