// Web Push client: service worker registration, subscription lifecycle, platform hints.
import { api } from './api.ts';

export type PushState = { support: 'ok' | 'unsupported' | 'needs-homescreen' | 'insecure'; permission: NotificationPermission | 'unsupported'; subscribed: boolean; endpoint?: string; serverConfigured: boolean };

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export async function registerSw(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) { console.warn('sw register failed', e); return null; }
}

function urlB64ToU8(s: string): Uint8Array<ArrayBuffer> { const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4); const bin = atob(b); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

export async function pushState(serverConfigured: boolean): Promise<PushState> {
  if (!window.isSecureContext) return { support: 'insecure', permission: 'unsupported', subscribed: false, serverConfigured };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { support: isIOS() && !isStandalone() ? 'needs-homescreen' : 'unsupported', permission: 'unsupported', subscribed: false, serverConfigured };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { support: 'ok', permission: Notification.permission, subscribed: !!sub, endpoint: sub?.endpoint, serverConfigured };
}

/** Must be called from a user gesture (button tap). */
export async function enablePush(label: string): Promise<PushState> {
  const key = await api.pushKey();
  if (!key.configured || !key.publicKey) throw new Error('Server has no VAPID keys configured (run `npm run vapid`).');
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSw());
  if (!reg) throw new Error('Service worker unavailable.');
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notification permission denied in browser settings.' : 'Permission not granted.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key.publicKey) });
  await api.pushSubscribe(sub.toJSON(), label);
  return pushState(true);
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) { await api.pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
}

export const pushHints = { isIOS, isStandalone };
