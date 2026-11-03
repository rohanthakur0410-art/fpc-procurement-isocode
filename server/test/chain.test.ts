import { describe, it, expect } from 'vitest';
import { buildEntry, verifyChain, GENESIS } from '@app/shared';

const payload = (n: number) => ({ centreCode: 'C07', farmerId: `F000${n}`, crop: 'soybean', grade: 'A', grossTenths: 12500, tareTenths: 180, moistureTenths: 115, rateRupees: 4850, photoName: null });

describe('tamper-evident chain', () => {
  it('builds and verifies a linked chain', async () => {
    const e1 = await buildEntry('u1', 1, GENESIS, '2026-11-03T04:10:00.000Z', payload(1));
    const e2 = await buildEntry('u2', 2, e1.hash, '2026-11-03T04:12:00.000Z', payload(2));
    const v = await verifyChain([e1, e2]);
    expect(v.ok).toBe(true);
  });
  it('detects an edited payload', async () => {
    const e1 = await buildEntry('u1', 1, GENESIS, '2026-11-03T04:10:00.000Z', payload(1));
    const tampered = { ...e1, payload: { ...e1.payload, grossTenths: 99990 } };
    const v = await verifyChain([tampered]);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe('u1');
  });
  it('detects a deleted middle entry', async () => {
    const e1 = await buildEntry('u1', 1, GENESIS, '2026-11-03T04:10:00.000Z', payload(1));
    const e2 = await buildEntry('u2', 2, e1.hash, '2026-11-03T04:12:00.000Z', payload(2));
    const e3 = await buildEntry('u3', 3, e2.hash, '2026-11-03T04:14:00.000Z', payload(3));
    const v = await verifyChain([e1, e3]); // e2 removed
    expect(v.ok).toBe(false);
  });
  it('rejects a chain that starts from the wrong anchor', async () => {
    const e1 = await buildEntry('u1', 1, GENESIS, '2026-11-03T04:10:00.000Z', payload(1));
    const v = await verifyChain([e1], 'SOME-OTHER-HASH');
    expect(v.ok).toBe(false);
  });
});
