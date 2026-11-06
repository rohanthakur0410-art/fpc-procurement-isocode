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
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({displayText:String(value),[key]:value})}]}}]})})));
    expect(await readMeterPhoto(kind,'fake','image/jpeg')).toEqual({status:'ok',valueTenths:want});
  });
  it.each(['{"unsure":true}','not json','{"weightKg":-1}','{"displayText":"88.8","weightKg":50}','{"weightKg":850}'])('handles unsure or bad result %s',async text=>{
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text}]}}]})})));
    expect((await readMeterPhoto('scale','fake','image/jpeg')).status).toBe('unsure');
  });
  it('rejects moisture readings outside the entry range', async () => {
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"displayText":"95","moisturePercent":95}'}]}}]})})));
    expect((await readMeterPhoto('moisture','fake','image/jpeg')).status).toBe('unsure');
  });
  it('handles provider errors without invented readings',async()=>{
    vi.stubEnv('GEMINI_API_KEY','unit-test-not-a-key');
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:429})));
    expect((await readMeterPhoto('scale','fake','image/jpeg')).status).toBe('unsure');
  });
});

describe('model chain failover (mock provider)', () => {
  it('fails over from a retired model (404) to the next model', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'unit-test-not-a-key');
    vi.stubEnv('GEMINI_MODELS', 'gemini-retired-x,gemini-working-y');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes('gemini-retired-x')) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"displayText":"850","weightKg":850}' }] } }] }) };
    }));
    expect(await readMeterPhoto('scale', 'fake', 'image/jpeg')).toEqual({ status: 'ok', valueTenths: 8500 });
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain('gemini-retired-x');
    expect(urls[1]).toContain('gemini-working-y');
  });
  it('retries a transient overload (503) once on the same model', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'unit-test-not-a-key');
    vi.stubEnv('GEMINI_MODELS', 'gemini-busy-z');
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"displayText":"13.5","moisturePercent":13.5}' }] } }] }) };
    }));
    expect(await readMeterPhoto('moisture', 'fake', 'image/jpeg')).toEqual({ status: 'ok', valueTenths: 135 });
    expect(calls).toBe(2);
  });
  it('returns unsure without inventing a reading when every model is overloaded', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'unit-test-not-a-key');
    vi.stubEnv('GEMINI_MODELS', 'gemini-a,gemini-b');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const r = await readMeterPhoto('scale', 'fake', 'image/jpeg');
    expect(r.status).toBe('unsure');
    expect(r.valueTenths).toBeUndefined();
  });
});
