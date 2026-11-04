import type { SessionUser } from '@app/shared';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `http_${res.status}`) as Error & { code?: string };
    err.code = body.error || `http_${res.status}`;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    req<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  me: () => req<{ user: SessionUser }>('/api/auth/me'),
  members: () => req<{ members: any[] }>('/api/members'),
  centres: () => req<{ centres: any[] }>('/api/centres'),
  prices: (date?: string) => req<{ date: string; prices: any[] }>(`/api/prices${date ? `?date=${date}` : ''}`),
  setPrice: (b: { priceDate: string; crop: string; grade: string; rateRupees: number }) =>
    req('/api/prices', { method: 'POST', body: JSON.stringify(b) }),
  sync: (body: any) => req<{ results: any[]; chainOk: boolean }>('/api/sync', { method: 'POST', body: JSON.stringify(body) }),
  purchases: (q = '') => req<{ purchases: any[] }>(`/api/purchases${q}`),
  review: (id: number) => req(`/api/purchases/${id}/review`, { method: 'POST', body: JSON.stringify({ action: 'approve' }) }),
  priceResolution: (id:number) => req<any>(`/api/purchases/${id}/price-resolution`),
  resolvePrice: (id:number, expectedRate:number, reason:string) => req(`/api/purchases/${id}/price-resolution`,{method:'POST',body:JSON.stringify({expectedRate,reason})}),
  dashboard: () => req<any>('/api/dashboard'),
  createRun: (purchaseIds: number[]) =>
    req<{ runId: number; itemCount: number; totalPaisa: number }>('/api/payment-runs', { method: 'POST', body: JSON.stringify({ purchaseIds }) }),
  runs: () => req<{ runs: any[] }>('/api/payment-runs'),
  markPaid: (id: number) => req(`/api/payment-runs/${id}/mark-paid`, { method: 'POST' }),
  sms: () => req<{ sms: any[] }>('/api/sms'),
  readPhoto: (kind: 'scale' | 'moisture', imageBase64: string, mimeType: string) =>
    req<{ status: 'ok' | 'unsure' | 'unavailable'; valueTenths?: number; reason?: string }>(
      '/api/ai/read-photo', { method: 'POST', body: JSON.stringify({ kind, imageBase64, mimeType }) }
    ),
};
