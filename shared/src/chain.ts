// Unsigned hash chain: detects changes relative to a retained server anchor.
// This is not a trusted timestamp or tamper-proof device record. A person who
// controls the device can rewrite and rehash an entirely unsynced suffix.
// Deleting the unsynced tail cannot be detected without an external witness.

export const GENESIS = 'GENESIS';

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Stable JSON: object keys sorted so the same payload always hashes identically
// in the browser (offline) and on the server (sync verification).
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(obj[k]))
      .join(',') +
    '}'
  );
}

export interface ChainInput {
  uuid: string;
  seq: number;
  prevHash: string;
  deviceTs: string;
  payload: Record<string, unknown>;
}

export interface ChainEntryRow extends ChainInput {
  hash: string;
}

export async function computeEntryHash(e: ChainInput): Promise<string> {
  return sha256Hex([e.prevHash, e.uuid, String(e.seq), e.deviceTs, canonical(e.payload)].join('|'));
}

export async function buildEntry(
  uuid: string,
  seq: number,
  prevHash: string,
  deviceTs: string,
  payload: Record<string, unknown>
): Promise<ChainEntryRow> {
  const hash = await computeEntryHash({ uuid, seq, prevHash, deviceTs, payload });
  return { uuid, seq, prevHash, deviceTs, payload, hash };
}

export async function verifyChain(
  entries: ChainEntryRow[],
  startHash: string = GENESIS
): Promise<{ ok: boolean; brokenAt?: string }> {
  let prev = startHash;
  for (const e of entries) {
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.uuid };
    const h = await computeEntryHash(e);
    if (h !== e.hash) return { ok: false, brokenAt: e.uuid };
    prev = e.hash;
  }
  return { ok: true };
}
