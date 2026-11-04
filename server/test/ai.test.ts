import { afterEach, describe, expect, it, vi } from 'vitest';
import { readMeterPhoto } from '../src/ai.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('vision adapter contract (mock provider, not live vision verification)', () => {
  it('states unavailability when no key is configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect((await readMeterPhoto('scale','fake','image/jpeg')).status).toBe('unavailable');
  });
  it.each([['scale','weightKg',850,8500],['moisture','moisturePercent',13.5,135]] as const)
  ('parses %s reading in tenths', async (kind,key,value,want) => {
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({[key]:value})}]}}]})})));
    expect(await readMeterPhoto(kind,'fake','image/jpeg')).toEqual({status:'ok',valueTenths:want});
  });
  it.each(['{"unsure":true}','not json','{"weightKg":-1}'])('handles unsure or bad result %s',async text=>{
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text}]}}]})})));
    expect((await readMeterPhoto('scale','fake','image/jpeg')).status).toBe('unsure');
  });
  it('rejects moisture readings outside the entry range', async () => {
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"moisturePercent":95}'}]}}]})})));
    expect((await readMeterPhoto('moisture','fake','image/jpeg')).status).toBe('unsure');
  });
  it('handles provider errors without invented readings',async()=>{
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:429})));
    expect((await readMeterPhoto('scale','fake','image/jpeg')).status).toBe('unsure');
  });
});
