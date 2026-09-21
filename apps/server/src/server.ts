// Daemon entry: hono server + telegram bot polling + SPA + JSON API.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { config } from './config.ts';
import { sql } from './db/pool.ts';
import { startBot } from './bot.ts';
import { queueLiveness } from './queue.ts';
import { startCron } from './cron.ts';
import { api } from './api.ts';

const app = new Hono();
app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'endpoint not found' }, 404));

app.get('/', (c) => c.text('content-generator daemon v2 — OK'));
app.get('/health', async (c) => {
  await sql`select 1`;
  const live = queueLiveness();
  // running + no activity for 30min = stuck run (puppeteer/LLM hang)
  const stuck = live.running && live.lastActivityMs > 30 * 60_000;
  return c.json({ ok: !stuck, db: true, queue: live, stuck }, stuck ? 503 : 200);
});

// SPA build output (apps/web/dist) — static assets + index.html fallback for the client router.
const webDist = new URL('../../web/dist/', import.meta.url).pathname;
app.use('/*', serveStatic({ root: webDist }));
app.get('/*', (c) => {
  try {
    return c.html(readFileSync(`${webDist}index.html`, 'utf8'));
  } catch {
    return c.text('frontend not built yet — run the build in apps/web and restart', 503);
  }
});

serve({ fetch: app.fetch, port: config.port });
console.log(`[server] daemon v2 running on :${config.port}`);
await startCron();
await startBot();
