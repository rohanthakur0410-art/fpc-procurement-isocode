import { describe, it, expect } from 'vitest';
import { entryNetTenths, entryAmountPaisa, fmtKg, fmtINR } from '@app/shared';

// Regression: the outbox and synced-entry cards used to render gross weight
// and a gross-based amount (640.0 kg / Rs 46,080.00) while the farmer's slip
// and the server record said net 630.0 kg / Rs 45,360.00. These tests lock
// the card math to the shared calculation the server applies.
describe('outbox card display math', () => {
  const payload = { grossTenths: 6400, tareTenths: 100, moistureTenths: 100, rateRupees: 7200 };

  it('shows net weight, not gross', () => {
    expect(entryNetTenths(payload)).toBe(6300);
    expect(fmtKg(entryNetTenths(payload))).toBe('630.0');
  });

  it('shows the payable amount on net weight, to the paisa', () => {
    expect(entryAmountPaisa(payload)).toBe(4536000);
    expect(fmtINR(entryAmountPaisa(payload))).toBe('45,360.00');
  });

  it('never returns the gross-based amount that caused the mismatch', () => {
    const grossBased = Math.round((payload.grossTenths * payload.rateRupees) / 10);
    expect(entryAmountPaisa(payload)).not.toBe(grossBased);
  });

  it('applies the moisture deduction on the card too (brief sample row 2)', () => {
    const p2 = { grossTenths: 8600, tareTenths: 120, moistureTenths: 140, rateRupees: 4850 };
    expect(entryNetTenths(p2)).toBe(8310);
    expect(entryAmountPaisa(p2)).toBe(4030350);
  });
});
