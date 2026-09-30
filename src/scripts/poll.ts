// Trigger one poll job against a running server (local or deployed). Usage: POLL_URL=... JOB_TOKEN=... npm run poll
const url = process.env.POLL_URL || `http://localhost:${process.env.PORT || 8787}/api/jobs/poll`;
const headers: Record<string, string> = {};
if (process.env.JOB_TOKEN) headers['X-Job-Token'] = process.env.JOB_TOKEN;
if (process.env.APP_TOKEN) headers.Authorization = `Bearer ${process.env.APP_TOKEN}`;
const res = await fetch(url, { method: 'POST', headers });
console.log(res.status, await res.text());
export {};
