import type { Db } from './db.ts';

export interface Config {
  appToken: string | null;
  jobToken: string | null;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string;
  secUserAgent: string;
  tz: string;
  retentionDays: number;
  pollIntervalSec: number;
  baseUrl: string | null;
  /** Dev/test only: allow feeds on localhost / private networks. Never enable on a public deployment. */
  allowPrivateFeeds: boolean;
}
export interface AppCtx { db: Db; cfg: Config; resolveHost?: (host: string) => Promise<string[]>; log: (event: string, data?: Record<string, unknown>) => void }

type EnvLike = Record<string, string | undefined>;

export function configFromEnv(env: EnvLike): Config {
  const s = (k: string) => (env[k] && String(env[k]).trim()) || null;
  return {
    appToken: s('APP_TOKEN'), jobToken: s('JOB_TOKEN'),
    vapidPublicKey: s('VAPID_PUBLIC_KEY'), vapidPrivateKey: s('VAPID_PRIVATE_KEY'), vapidSubject: s('VAPID_SUBJECT') || 'mailto:admin@example.com',
    secUserAgent: s('SEC_USER_AGENT') || 'investinews personal news terminal (no contact configured)',
    tz: s('APP_TZ') || 'Africa/Johannesburg',
    retentionDays: Math.max(7, Number(s('RETENTION_DAYS')) || 90),
    pollIntervalSec: Math.max(60, Number(s('POLL_INTERVAL_SEC')) || 300),
    baseUrl: s('BASE_URL'),
    allowPrivateFeeds: /^(1|true|yes)$/i.test(s('ALLOW_PRIVATE_FEEDS') || ''),
  };
}

export function makeLogger(): AppCtx['log'] {
  return (event, data = {}) => {
    const line = JSON.stringify({ t: new Date().toISOString(), event, ...redact(data) });
    console.log(line);
  };
}
const SECRET_KEY = /token|secret|auth|p256dh|endpoint|private/i;
function redact(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : v;
  return out;
}
