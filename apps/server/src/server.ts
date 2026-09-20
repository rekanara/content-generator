// Daemon entry: hono server + telegram bot polling + SPA + JSON API.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { config } from './config.ts';
import { sql } from './db.ts';
import { startBot } from './bot.ts';
import { queueStatus } from './queue.ts';
import { startCron, cronStatus } from './cron.ts';
import { api } from './api.ts';

const app = new Hono();
app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'endpoint tidak ada' }, 404));

app.get('/', (c) => c.text('content-generator daemon v2 — OK'));
app.get('/health', async (c) => {
  await sql`select 1`;
  return c.json({ ok: true, queue: queueStatus(), cron: cronStatus() });
});

// SPA build output (apps/web/dist) — asset statis + fallback index.html utk client router.
const webDist = new URL('../../web/dist/', import.meta.url).pathname;
app.use('/*', serveStatic({ root: webDist }));
app.get('/*', (c) => {
  try {
    return c.html(readFileSync(`${webDist}index.html`, 'utf8'));
  } catch {
    return c.text('FE belum dibuild — jalankan build di apps/web lalu restart', 503);
  }
});

serve({ fetch: app.fetch, port: config.port });
console.log(`[server] daemon v2 jalan di :${config.port}`);
await startCron();
await startBot();
