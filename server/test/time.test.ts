import { describe,it,expect } from 'vitest';
import { istIso } from '../src/seed.js';
describe('collection timestamps',()=>{
  it('converts the stated IST time without depending on host timezone',()=>{
    const before=process.env.TZ;
    try { for(const tz of ['UTC','Asia/Kolkata','America/New_York']) {
      process.env.TZ=tz;
      expect(istIso('09:40','2026-11-04')).toBe('2026-11-04T04:10:00.000Z');
    }} finally { process.env.TZ=before; }
  });
});
