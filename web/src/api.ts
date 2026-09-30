export class ApiError extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status; } }
export let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const text = await res.text();
  let data: any = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 200) }; }
  if (res.status === 401) { onUnauthorized?.(); throw new ApiError('unauthorized', 401); }
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
  return data as T;
}
const qs = (p: Record<string, string | number | boolean | undefined | null>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v)); const s = u.toString(); return s ? `?${s}` : ''; };

export const api = {
  bootstrap: () => req<any>('GET', '/api/bootstrap'),
  authStatus: () => req<{ required: boolean; authenticated: boolean }>('GET', '/api/auth/status'),
  login: (token: string) => req<any>('POST', '/api/auth/login', { token }),
  logout: () => req<any>('POST', '/api/auth/logout', {}),
  resolve: (q: string) => req<any>('POST', '/api/resolve', { q }),
  watches: () => req<any[]>('GET', '/api/watches'),
  createWatch: (body: any) => req<any>('POST', '/api/watches', body),
  updateWatch: (id: string, patch: any) => req<any>('PATCH', `/api/watches/${id}`, patch),
  deleteWatch: (id: string) => req<any>('DELETE', `/api/watches/${id}`),
  identities: (id: string) => req<any[]>('GET', `/api/watches/${id}/identities`),
  addIdentity: (id: string, kind: string, value: string) => req<any>('POST', `/api/watches/${id}/identities`, { kind, value }),
  deleteIdentity: (id: number) => req<any>('DELETE', `/api/identities/${id}`),
  sources: () => req<any[]>('GET', '/api/sources'),
  presets: () => req<any[]>('GET', '/api/sources/presets'),
  validateFeed: (url: string) => req<any>('POST', '/api/sources/validate', { url }),
  createSource: (body: any) => req<any>('POST', '/api/sources', body),
  updateSource: (id: string, patch: any) => req<any>('PATCH', `/api/sources/${id}`, patch),
  deleteSource: (id: string) => req<any>('DELETE', `/api/sources/${id}`),
  refreshSource: (id: string) => req<any>('POST', `/api/sources/${id}/refresh`, {}),
  feed: (p: Record<string, any>) => req<any[]>('GET', `/api/feed${qs(p)}`),
  event: (id: string) => req<any>('GET', `/api/events/${id}`),
  markRead: (ids: string[], read = true) => req<any>('POST', '/api/events/read', { ids, read }),
  markAllRead: (watch?: string) => req<any>('POST', '/api/events/read-all', { watch }),
  merge: (id: string, into: string) => req<any>('POST', `/api/events/${id}/merge`, { into }),
  split: (articleId: string) => req<any>('POST', `/api/articles/${articleId}/split`, {}),
  prefs: () => req<any>('GET', '/api/prefs'),
  updatePrefs: (p: any) => req<any>('PATCH', '/api/prefs', p),
  pushKey: () => req<{ configured: boolean; publicKey: string | null }>('GET', '/api/push/public-key'),
  pushSubscribe: (subscription: any, label: string) => req<any>('POST', '/api/push/subscribe', { subscription, label }),
  pushUnsubscribe: (endpoint: string) => req<any>('POST', '/api/push/unsubscribe', { endpoint }),
  pushTest: (endpoint?: string) => req<any>('POST', '/api/push/test', { endpoint }),
  refresh: (watch?: string) => req<any>('POST', '/api/refresh', { watch }),
  status: () => req<any>('GET', '/api/status'),
  deleteAll: () => req<any>('DELETE', '/api/data', { confirm: 'DELETE' }),
};
