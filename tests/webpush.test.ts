import { describe, it, expect } from 'vitest';
import { encryptPayload, decryptPayload, generateVapidKeys, createVapidJwt, verifyVapidJwt, sendWebPush } from '../src/core/webpush.ts';
import { b64url } from '../src/core/ids.ts';

async function importPrivate(dB64: string, pubB64: string): Promise<CryptoKeyPair> {
  const pub = b64url.decode(pubB64);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', d: dB64, x: b64url.encode(pub.slice(1, 33)), y: b64url.encode(pub.slice(33)) };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  return { privateKey, publicKey };
}

describe('web push encryption (RFC 8291)', () => {
  it('reproduces the RFC 8291 Appendix A test vector', async () => {
    const uaPublic = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
    const auth = 'BTBZMqHH6r4Tts7J_aSIgg';
    const asPrivate = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
    const asPublic = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
    const salt = b64url.decode('DGv6ra1nlYgDCS1FRnbzlw');
    const body = await encryptPayload(new TextEncoder().encode('When I grow up, I want to be a watermelon'), uaPublic, auth, { salt, localKeyPair: await importPrivate(asPrivate, asPublic) });
    expect(b64url.encode(body)).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
  });
  it('round-trips with freshly generated UA keys', async () => {
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const uaJwk = await crypto.subtle.exportKey('jwk', ua.privateKey);
    const uaPub = b64url.encode(await crypto.subtle.exportKey('raw', ua.publicKey));
    const auth = b64url.encode(crypto.getRandomValues(new Uint8Array(16)));
    const msg = JSON.stringify({ title: 'hi', body: 'there' });
    const body = await encryptPayload(new TextEncoder().encode(msg), uaPub, auth);
    expect(new TextDecoder().decode(await decryptPayload(body, uaJwk, auth))).toBe(msg);
  });
  it('signs and verifies VAPID JWTs', async () => {
    const keys = await generateVapidKeys();
    const jwt = await createVapidJwt('https://push.example', 'mailto:a@b.c', keys);
    expect(await verifyVapidJwt(jwt, keys.publicKey)).toBe(true);
    const other = await generateVapidKeys();
    expect(await verifyVapidJwt(jwt, other.publicKey)).toBe(false);
  });
  it('sends with the right headers and reports gone subscriptions', async () => {
    const keys = await generateVapidKeys();
    const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: b64url.encode(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64url.encode(crypto.getRandomValues(new Uint8Array(16))) } };
    let seen: Request | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => { seen = new Request(url, init); return new Response('', { status: 410 }); }) as unknown as typeof fetch;
    const r = await sendWebPush(sub, '{"a":1}', keys, 'mailto:x@y.z', { fetchImpl, topic: 'e_1' });
    expect(r.gone).toBe(true);
    const req = seen as unknown as Request;
    expect(req.headers.get('content-encoding')).toBe('aes128gcm');
    expect(req.headers.get('authorization')).toMatch(/^vapid t=.+, k=.+$/);
    expect(req.headers.get('ttl')).toBe('86400');
  });
});
