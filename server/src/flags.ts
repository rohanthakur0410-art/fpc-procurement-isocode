import type { DB } from './db.js';

// Anomaly flags from the brief's AI OR AUTOMATION section. These hold a
// purchase from the payment run for the office manager's review; they never
// cancel a purchase.
//
// Assumptions (labelled in the TDD): indicative yields used only to flag
// weight "far beyond what the farmer's land could yield" - soybean ~6 and
// tur ~5 quintals per acre, flagged beyond 1.5x the farmer's whole-land yield.
const YIELD_Q_PER_ACRE: Record<string, number> = { soybean: 6, tur: 5 };
const YIELD_FLAG_FACTOR = 1.5;
const UNIFORM_MOISTURE_RUN = 5; // this entry plus 4 prior identical readings

export function computeFlags(
  db: DB,
  p: { memberId: number; centreCode: string; crop: string; netTenths: number; moistureTenths: number; deviceTs: string }
): string[] {
  const flags: string[] = [];

  const since = new Date(new Date(p.deviceTs).getTime() - 3600_000).toISOString();
  const dup = db
    .prepare('SELECT COUNT(*) AS c FROM purchases WHERE member_id = ? AND device_ts >= ? AND device_ts <= ?')
    .get(p.memberId, since, p.deviceTs) as { c: number };
  if (dup.c > 0) flags.push('same_farmer_within_hour');

  const member = db.prepare('SELECT land_acres FROM members WHERE id = ?').get(p.memberId) as
    | { land_acres: number }
    | undefined;
  if (member) {
    const maxKg = member.land_acres * (YIELD_Q_PER_ACRE[p.crop] ?? 6) * 100 * YIELD_FLAG_FACTOR;
    if (p.netTenths / 10 > maxKg) flags.push('weight_beyond_land_yield');
  }

  const recent = db
    .prepare('SELECT moisture_tenths FROM purchases WHERE centre_code = ? ORDER BY device_ts DESC LIMIT ?')
    .all(p.centreCode, UNIFORM_MOISTURE_RUN - 1) as { moisture_tenths: number }[];
  if (
    recent.length === UNIFORM_MOISTURE_RUN - 1 &&
    recent.every((r) => r.moisture_tenths === p.moistureTenths)
  ) {
    flags.push('moisture_too_uniform');
  }

  return flags;
}
