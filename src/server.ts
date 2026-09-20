// Daemon entry: hono server + telegram bot polling. Cron menyusul (step 5).
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.ts';
import { sql } from './db.ts';
import { startBot } from './bot.ts';
import { queueStatus, enqueue } from './queue.ts';
import { startCron, cronStatus } from './cron.ts';
import { admin } from './admin.ts';

const app = new Hono();
app.route('/admin', admin);

app.get('/', (c) => c.text('content-generator daemon v1 — OK'));
app.get('/health', async (c) => {
  await sql`select 1`;
  return c.json({ ok: true, queue: queueStatus(), cron: cronStatus() });
});

// Manual generate via HTTP — fondasi FE (step 7). Body: {platform?, format?}
app.post('/gen', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const platform = body.platform as string | undefined;
  const format = body.format as string | undefined;
  if (platform && platform !== 'instagram' && platform !== 'linkedin') {
    return c.json({ error: 'platform harus instagram|linkedin' }, 400);
  }
  if (format && !['carousel', 'reels', 'pdf', 'text'].includes(format)) {
    return c.json({ error: 'format harus carousel|reels|pdf|text' }, 400);
  }
  enqueue({
    kind: 'generate',
    forced: platform
      ? { platform: platform as 'instagram' | 'linkedin', format: format as 'carousel' | 'reels' | 'pdf' | 'text' | undefined }
      : undefined,
    notifyChat: true,
    source: 'web',
  });
  return c.json({ ok: true, queued: queueStatus() });
});

serve({ fetch: app.fetch, port: config.port });
console.log(`[server] daemon v2 jalan di :${config.port}`);
await startCron();
await startBot();
