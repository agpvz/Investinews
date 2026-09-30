import { generateVapidKeys } from '../core/webpush.ts';
const k = await generateVapidKeys();
console.log('# Add these to .env (local) or `wrangler pages secret put` (Cloudflare). Keep the private key secret.');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
