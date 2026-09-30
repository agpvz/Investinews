// Browser end-to-end test: add a watch through the UI, attach a local feed with two syndicated copies of one story,
// refresh, and verify the unified feed shows ONE grouped event with two article links.
// Requires: `npm run build` (dist/), the `playwright` package (local or global; override with PLAYWRIGHT_MODULE) and Chromium.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PORT = Number(process.env.E2E_PORT) || 8799;
const OUT = process.env.E2E_OUT || path.join(process.cwd(), 'test-results');
fs.mkdirSync(OUT, { recursive: true });

async function loadPlaywright(): Promise<any> {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(execSync('npm root -g').toString().trim(), 'playwright', 'index.mjs')].filter(Boolean) as string[];
  for (const c of candidates) { try { return await import(c); } catch { /* next */ } }
  throw new Error('playwright not found: npm i -D playwright && npx playwright install chromium');
}

const now = Date.now();
const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Local Alert</title>
<item><title>US tightens AI export controls on advanced chips</title><link>https://pub-one.example/story/1</link><pubDate>${new Date(now - 3600e3).toUTCString()}</pubDate><description>First publisher.</description></item>
<item><title>US Tightens AI Export Controls On Advanced Chips - Pub Two</title><link>https://pub-two.example/news/1?utm_source=rss</link><pubDate>${new Date(now - 3000e3).toUTCString()}</pubDate><description>Syndicated copy.</description></item>
<item><title>Weekly market wrap: stocks drift</title><link>https://pub-one.example/story/2</link><pubDate>${new Date(now - 600e3).toUTCString()}</pubDate></item>
</channel></rss>`;
const feedSrv = http.createServer((_q, r) => { r.setHeader('content-type', 'application/rss+xml'); r.end(rss); });
await new Promise<void>((r) => feedSrv.listen(0, '127.0.0.1', () => r()));
const feedUrl = `http://127.0.0.1:${(feedSrv.address() as { port: number }).port}/alert.xml`;

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inv-e2e-')), 'e2e.sqlite');
const server = spawn(process.execPath, ['--no-warnings', 'src/server/node.ts'], { env: { ...process.env, PORT: String(PORT), DATABASE_PATH: dbPath, ALLOW_PRIVATE_FEEDS: '1', POLL_INTERVAL_SEC: '3600', APP_TOKEN: '', JOB_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 200)); }

const results: string[] = [];
const check = (cond: boolean, msg: string) => { results.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
try {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(`${base}/#/feed`, { waitUntil: 'networkidle' });
  check((await page.locator('#watches').innerText()).includes('No watches yet'), 'empty state shown');
  // 1. add a watch through the command bar
  await page.fill('#cmdinput', 'watch AI export controls'); await page.keyboard.press('Enter');
  await page.waitForSelector('#watches .watch.topic', { timeout: 10000 });
  check((await page.locator('#watches .watch.topic .label').first().innerText()).includes('AI export controls'), 'topic watch created and listed');
  const watchId = await page.locator('#watches .watch.topic').first().getAttribute('data-watch');
  // 2. attach a feed via Sources UI
  await page.goto(`${base}/#/sources`); await page.waitForSelector('#feedurl');
  await page.fill('#feedurl', feedUrl); await page.click('[data-act="feed-validate"]');
  await page.waitForFunction(() => !(document.querySelector('#feedadd') as HTMLButtonElement).disabled, null, { timeout: 10000 });
  // leave the feed unmapped: items must match the topic by keyword (a feed mapped to a watch is trusted as relevant by construction)
  await page.click('#feedadd');
  await page.waitForSelector('.src .status-badge', { timeout: 10000 });
  // 3. refresh and view the grouped event
  await page.goto(`${base}/#/feed?watch=${watchId}`);
  await page.click('[data-act="refresh"]');
  await page.waitForSelector('.ev', { timeout: 15000 });
  await page.waitForTimeout(500);
  const rows = page.locator('.ev');
  check((await rows.count()) === 1, `watch feed shows exactly one event (got ${await rows.count()}); the unrelated story is excluded`);
  const rowText = await rows.first().innerText();
  check(/2\s*src/.test(rowText), 'event row shows 2 sources');
  check(rowText.includes('US tightens AI export controls'), 'lead headline is the earliest published copy');
  await rows.first().click();
  await page.waitForSelector('#detail .art', { timeout: 10000 });
  check((await page.locator('#detail .art').count()) === 2, 'detail lists both source articles');
  check((await page.locator('#detail .art a.ah').first().getAttribute('href'))!.startsWith('https://pub-'), 'article links point to original publishers');
  await page.waitForFunction(() => document.querySelector('#watches .watch.topic .unread')?.textContent === '0', null, { timeout: 5000 }).catch(() => {});
  check((await page.locator('#watches .watch.topic .unread').first().innerText()) === '0', 'unread count decremented after opening');
  await page.screenshot({ path: path.join(OUT, 'e2e-desktop.png') });
  // all-events feed shows unmatched only with the toggle
  await page.goto(`${base}/#/feed`); await page.waitForSelector('.ev');
  check((await page.locator('.ev').count()) === 1, 'unified feed hides unmatched events by default');
  await page.goto(`${base}/#/feed?all=1`); await page.waitForTimeout(400);
  check((await page.locator('.ev').count()) === 2, 'unmatched-too filter reveals the unrelated story');
  // keyboard: j selects, Enter opens
  await page.keyboard.press('j'); await page.keyboard.press('Enter'); await page.waitForSelector('#detail h2');
  check(!!(await page.locator('#detail h2').innerText()), 'keyboard navigation opens detail');
  // mobile layout
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(`${base}/#/feed`); await mobile.waitForSelector('.ev');
  check(await mobile.locator('.mobile-nav').isVisible(), 'mobile nav visible');
  await mobile.locator('.ev').first().click(); await mobile.waitForSelector('#detail.show .art');
  check(await mobile.locator('#detail .detail-close').isVisible(), 'mobile detail sheet with back button');
  await mobile.screenshot({ path: path.join(OUT, 'e2e-mobile.png') });
  const settings = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await settings.goto(`${base}/#/settings`); await settings.waitForSelector('.card');
  check((await settings.locator('#main').innerText()).includes('VAPID'), 'settings explains missing VAPID keys instead of pretending push works');
  await settings.screenshot({ path: path.join(OUT, 'e2e-settings.png') });
  check(errors.length === 0, `no page errors (${errors.join('; ')})`);
  await browser.close();
} catch (e) { results.push(`FAIL exception: ${(e as Error).stack}`); process.exitCode = 1; }
finally { server.kill(); feedSrv.close(); }
console.log(results.join('\n'));
if (process.exitCode) console.log('--- server log ---\n' + serverLog.slice(-3000));
