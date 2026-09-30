// Web Push (RFC 8030 / 8291 / 8292) using only WebCrypto so it runs on Node 22 and Cloudflare Workers.
import { b64url } from './ids.ts';

type Bytes = Uint8Array<ArrayBuffer>;

export interface VapidKeys { publicKey: string; privateKey: string } // base64url: 65-byte uncompressed point, 32-byte scalar
export interface PushSubscriptionLike { endpoint: string; keys: { p256dh: string; auth: string } }

const te = new TextEncoder();
const concat = (...parts: Bytes[]): Bytes => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const u8 = (b: ArrayBuffer): Bytes => new Uint8Array(b);

export async function generateVapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = concat(new Uint8Array([4]), b64url.decode(jwk.x!), b64url.decode(jwk.y!));
  return { publicKey: b64url.encode(pub), privateKey: jwk.d! };
}

function jwkFromKeys(keys: VapidKeys, withPrivate: boolean): JsonWebKey {
  const pub = b64url.decode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key must be a 65-byte uncompressed P-256 point');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64url.encode(pub.slice(1, 33)), y: b64url.encode(pub.slice(33, 65)) };
  if (withPrivate) jwk.d = keys.privateKey;
  return jwk;
}

export async function createVapidJwt(audience: string, subject: string, keys: VapidKeys, expiresInSec = 12 * 3600): Promise<string> {
  const header = b64url.encode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url.encode(te.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + expiresInSec, sub: subject })));
  const signing = `${header}.${body}`;
  const key = await crypto.subtle.importKey('jwk', jwkFromKeys(keys, true), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(signing));
  return `${signing}.${b64url.encode(sig)}`;
}

export async function verifyVapidJwt(jwt: string, publicKey: string): Promise<boolean> {
  const [h, b, s] = jwt.split('.');
  const key = await crypto.subtle.importKey('jwk', jwkFromKeys({ publicKey, privateKey: '' }, false), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url.decode(s), te.encode(`${h}.${b}`));
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return u8(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

export interface EncryptOptions { salt?: Bytes; localKeyPair?: CryptoKeyPair; recordSize?: number }

/** RFC 8291 aes128gcm encryption of a payload for a subscription (single record). */
export async function encryptPayload(plaintext: Bytes, p256dhB64: string, authB64: string, opts: EncryptOptions = {}): Promise<Bytes> {
  const uaPublic = b64url.decode(p256dhB64);
  const authSecret = b64url.decode(authB64);
  if (uaPublic.length !== 65) throw new Error('invalid p256dh key');
  if (authSecret.length !== 16) throw new Error('invalid auth secret');
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const local = opts.localKeyPair ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = u8(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = u8(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const rs = opts.recordSize ?? 4096;
  const padded = concat(plaintext, new Uint8Array([2])); // last record delimiter
  if (padded.length > rs - 16) throw new Error('payload too large for a single record');
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = u8(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, padded));
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]), new Uint8Array([asPublic.length]), asPublic);
  return concat(header, cipher);
}

/** Decrypt helper (used by tests to prove round-trip correctness against a UA key pair). */
export async function decryptPayload(body: Bytes, uaPrivateJwk: JsonWebKey, authB64: string): Promise<Bytes> {
  const salt = body.slice(0, 16); const idlen = body[20]; const asPublic = body.slice(21, 21 + idlen); const cipher = body.slice(21 + idlen);
  const uaPriv = await crypto.subtle.importKey('jwk', uaPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const uaPublic = concat(new Uint8Array([4]), b64url.decode(uaPrivateJwk.x!), b64url.decode(uaPrivateJwk.y!));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = u8(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256));
  const ikm = await hkdf(b64url.decode(authB64), ecdh, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = u8(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, cipher));
  let end = plain.length - 1; while (end >= 0 && plain[end] === 0) end--; // strip padding after delimiter
  return plain.slice(0, end);
}

export interface SendOptions { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string; fetchImpl?: typeof fetch }
export interface SendResult { ok: boolean; status: number; gone: boolean; retryAfterSec?: number; body?: string }

export async function sendWebPush(sub: PushSubscriptionLike, payload: string, keys: VapidKeys, subject: string, opts: SendOptions = {}): Promise<SendResult> {
  const endpoint = new URL(sub.endpoint);
  const audience = `${endpoint.protocol}//${endpoint.host}`;
  const jwt = await createVapidJwt(audience, subject, keys);
  const body = await encryptPayload(te.encode(payload), sub.keys.p256dh, sub.keys.auth);
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': String(body.length),
    TTL: String(opts.ttl ?? 86400), Urgency: opts.urgency ?? 'normal', Authorization: `vapid t=${jwt}, k=${keys.publicKey}`,
  };
  if (opts.topic) headers.Topic = opts.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const f = opts.fetchImpl ?? fetch;
  const res = await f(sub.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
  const retry = Number(res.headers.get('Retry-After'));
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, retryAfterSec: Number.isFinite(retry) ? retry : undefined, body: res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 300) };
}
