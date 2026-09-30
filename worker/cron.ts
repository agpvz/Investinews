// Optional Cloudflare Worker with a Cron Trigger that pokes the Pages API to run the poll job.
// Deploy from ./worker with: wrangler deploy  (set POLL_URL and JOB_TOKEN as vars/secrets)
export default {
  async scheduled(_event: unknown, env: { POLL_URL: string; JOB_TOKEN: string }, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(fetch(env.POLL_URL, { method: 'POST', headers: { 'X-Job-Token': env.JOB_TOKEN } }).then(async (r) => console.log('poll', r.status, (await r.text()).slice(0, 300))));
  },
};
