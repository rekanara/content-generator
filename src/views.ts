// FE admin — SSR hono html`` + HTMX. Auto-escape semua konten user via html``.
// Spec step 7: pilar, cron, posts+preview+resend, generate manual, style samples, template upload+preview.
import { html, raw } from 'hono/html';
import type { Platform, Format } from './state.ts';

// ---------- layout ----------
export const layout = (title: string, body: ReturnType<typeof html>) => html`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — content-generator</title>
<script src="https://unpkg.com/@htmx.org@2.0.4" defer></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, 'Helvetica Neue', sans-serif; background: #0f1117; color: #e6e8ee; }
  header { display: flex; gap: 24px; align-items: center; padding: 16px 28px; background: #171a23; border-bottom: 1px solid #262b38; }
  header a { color: #9aa3b5; text-decoration: none; font-weight: 600; }
  header a:hover, header a.on { color: #22c55e; }
  main { max-width: 980px; margin: 0 auto; padding: 28px; }
  h1 { font-size: 22px; margin: 0 0 18px; }
  h2 { font-size: 17px; margin: 26px 0 10px; color: #9aa3b5; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #262b38; vertical-align: top; }
  th { color: #6b7280; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  input[type=text], input[type=number], textarea, select { width: 100%; padding: 8px 10px; background: #171a23;
    color: #e6e8ee; border: 1px solid #2d3344; border-radius: 6px; font: inherit; }
  textarea { min-height: 90px; }
  button { padding: 8px 16px; background: #22c55e; color: #0f1117; border: 0; border-radius: 6px;
    font: inherit; font-weight: 700; cursor: pointer; }
  button:hover { background: #16a34a; }
  button.ghost { background: transparent; color: #9aa3b5; border: 1px solid #2d3344; font-weight: 500; }
  button.danger { background: #ef4444; }
  .row { display: flex; gap: 10px; align-items: center; }
  .muted { color: #6b7280; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 12px; font-weight: 600; }
  .pill.sent { background: #14351f; color: #22c55e; }
  .pill.failed { background: #3a1418; color: #ef4444; }
  .pill.draft { background: #2b2f16; color: #b8bf2f; }
  .pill.rendered { background: #12293a; color: #38bdf8; }
  .pill.queued { background: #2a2440; color: #a78bfa; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: #171a23; border: 1px solid #262b38; border-radius: 10px; padding: 16px; }
  iframe { width: 100%; height: 500px; border: 1px dashed #2d3344; border-radius: 6px; background: #fff; }
  pre { white-space: pre-wrap; background: #171a23; padding: 12px; border-radius: 6px; font-size: 13px; }
</style>
</head>
<body>
<header><a href="/admin"><strong style="color:#e6e8ee">⚡ cg</strong></a>
  <a href="/admin">Dashboard</a><a href="/admin/pillars">Pilar</a><a href="/admin/posts">Post</a>
  <a href="/admin/templates">Template</a><a href="/admin/styles">Style</a>
</header>
<main>${body}</main>
</body></html>`;

// ---------- helpers ----------
const fmtDate = (d: Date | string | null): string =>
  d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const statusPill = (s: string): ReturnType<typeof html> =>
  html`<span class="pill ${s}">${s}</span>`;

// Escape utk blok yang dibangun manual (string polos, bukan html``).
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- dashboard ----------
export type DashData = {
  cron: { expr: string; enabled: boolean; running: boolean };
  queue: { running: boolean; pending: number };
  rotation: { platform: string; igFormat: string | null; liFormat: string | null; pillarId: number | null; updatedAt: string };
  nextSlot: { platform: Platform; format: Format; pillar_id: number };
  lastPosts: { id: number; platform: string; format: string; topic: string; status: string; createdAt: string }[];
};

export function dashboardPage(d: DashData): ReturnType<typeof html> {
  return layout('Dashboard', html`
  <h1>Dashboard</h1>
  <div class="grid">
    <div class="card">
      <h2 style="margin-top:0">Cron</h2>
      <p style="margin:6px 0">${d.cron.enabled ? '🟢' : '🔴'} <code>${d.cron.expr}</code>
        ${d.cron.running ? '<span class="muted">(berjalan)</span>' : ''}</p>
      <p class="muted" style="margin:6px 0">Zona: Asia/Jakarta · <a href="/admin/cron" style="color:#38bdf8">atur</a></p>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Queue</h2>
      <p style="margin:6px 0">${d.queue.running ? '⚙️ run aktif' : '💤 idle'} · ${d.queue.pending} menunggu</p>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Rotasi</h2>
      <table>
        <tr><th class="muted">last</th><td>${d.rotation.platform} / ${d.rotation.igFormat ?? '—'} / ${d.rotation.liFormat ?? '—'} / pilar ${d.rotation.pillarId ?? '—'}</td></tr>
        <tr><th class="muted">next</th><td><strong>${d.nextSlot.platform} / ${d.nextSlot.format} / pilar ${d.nextSlot.pillar_id}</strong></td></tr>
      </table>
      <p class="muted" style="margin:6px 0">update ${fmtDate(d.rotation.updatedAt)}</p>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Generate manual</h2>
      <button hx-post="/admin/gen" hx-swap="none">⚡ Generate sekarang</button>
      <p class="muted" style="margin:10px 0 0">Rotasi normal · hasil ke Telegram</p>
    </div>
  </div>
  <h2>Post terbaru</h2>
  <table>
    <thead><tr><th>#</th><th>Platform</th><th>Format</th><th>Topik</th><th>Status</th><th>Waktu</th></tr></thead>
    <tbody>${d.lastPosts.map((p) => html`<tr>
      <td><a href="/admin/posts/${p.id}" style="color:#38bdf8">${p.id}</a></td>
      <td>${p.platform}</td><td>${p.format}</td><td>${p.topic}</td>
      <td>${statusPill(p.status)}</td><td class="muted">${fmtDate(p.createdAt)}</td>
    </tr>`)}</tbody>
  </table>`);
}

// ---------- pillars ----------
export type Pillar = { id: number; name: string; description: string; is_news: boolean; active: boolean; sort_order: number };

export function pillarsPage(pillars: Pillar[]): ReturnType<typeof html> {
  return layout('Pilar', html`
  <h1>Pilar konten</h1>
  <table>
    <thead><tr><th>#</th><th>Nama</th><th>Deskripsi</th><th>News</th><th>Aktif</th><th></th></tr></thead>
    <tbody>
    ${pillars.map((p) => html`<tr>
      <td>${p.id}</td>
      <td><strong>${p.name}</strong></td>
      <td class="muted">${p.description}</td>
      <td>${p.is_news ? '📰' : ''}</td>
      <td>${p.active ? '✅' : '🚫'}</td>
      <td class="row">
        <form hx-post="/admin/pillars/${p.id}/toggle" hx-swap="none">${raw('<button class="ghost" type="submit">')}${p.active ? 'matikan' : 'aktifkan'}${raw('</button>')}</form>
        <form hx-post="/admin/pillars/${p.id}/delete" hx-swap="none" hx-confirm="Hapus pilar ${p.name}?">${raw('<button class="ghost danger" type="submit">')}${'hapus'}${raw('</button>')}</form>
      </td>
    </tr>`)}
    </tbody>
  </table>
  <h2>Tambah pilar</h2>
  <div class="card">
    <form hx-post="/admin/pillars" hx-swap="none" class="grid">
      <div><label>Nama</label><input type="text" name="name" required></div>
      <div><label>Sort</label><input type="number" name="sort_order" value="0"></div>
      <div style="grid-column:1/-1"><label>Deskripsi</label><textarea name="description" required></textarea></div>
      <div style="grid-column:1/-1" class="row">
        <label class="row"><input type="checkbox" name="is_news" value="1"> pilar berita (RSS)</label>
        <button type="submit">Tambah</button>
      </div>
    </form>
  </div>`);
}

// ---------- cron ----------
export function cronPage(s: { expr: string; enabled: boolean }): ReturnType<typeof html> {
  return layout('Cron', html`
  <h1>Jadwal cron</h1>
  <div class="card" style="max-width:520px">
    <form hx-post="/admin/cron" hx-swap="none">
      <label>Ekspresi cron (5 field, zona Asia/Jakarta)</label>
      <input type="text" name="expr" value="${s.expr}" required>
      <p class="muted" style="margin:8px 0">Default 0 7 * * * = tiap hari 07:00 WIB</p>
      <div class="row">
        <button type="submit">Simpan</button>
        <label class="row"><input type="checkbox" name="enabled" value="1" ${s.enabled ? raw('checked') : raw('')}> aktif</label>
      </div>
    </form>
  </div>`);
}

// ---------- posts ----------
export type PostRow = {
  id: number; platform: string; format: string; topic: string; caption: string;
  status: string; error: string | null; source: string; createdAt: string; pillarId: number | null;
};

export function postsPage(posts: PostRow[]): ReturnType<typeof html> {
  return layout('Post', html`
  <h1>Riwayat post</h1>
  <table>
    <thead><tr><th>#</th><th>Waktu</th><th>Platform</th><th>Format</th><th>Topik</th><th>Sumber</th><th>Status</th></tr></thead>
    <tbody>${posts.map((p) => html`<tr>
      <td><a href="/admin/posts/${p.id}" style="color:#38bdf8">${p.id}</a></td>
      <td class="muted">${fmtDate(p.createdAt)}</td>
      <td>${p.platform}</td><td>${p.format}</td><td>${p.topic}</td><td class="muted">${p.source}</td>
      <td>${statusPill(p.status)}</td>
    </tr>`)}</tbody>
  </table>`);
}

export function postDetailPage(p: PostRow, bodyText: string): ReturnType<typeof html> {
  return layout(`Post #${p.id}`, html`
  <p><a href="/admin/posts" style="color:#38bdf8">← semua post</a></p>
  <h1>${raw('')}#${p.id} ${p.topic}</h1>
  <p class="row">${statusPill(p.status)}
    <span class="muted">${p.platform} / ${p.format} · ${fmtDate(p.createdAt)} · sumber ${p.source}</span></p>
  ${p.error ? html`<h2>Error</h2><pre>${p.error}</pre>` : raw('')}
  <h2>Caption</h2>
  <pre>${p.caption}</pre>
  <h2>Body</h2>
  <pre>${bodyText}</pre>
  <div class="row" style="margin-top:18px">
    <form hx-post="/admin/posts/${p.id}/resend" hx-swap="none">
      <button type="submit" ${p.status === 'sent' || p.status === 'rendered' ? raw('') : raw('disabled')}>📤 Kirim ulang ke Telegram</button>
    </form>
  </div>`);
}

// ---------- style samples ----------
export type StyleSampleRow = { id: number; title: string; body: string; platform: string | null; createdAt: string };

export function stylesPage(samples: StyleSampleRow[]): ReturnType<typeof html> {
  return layout('Style', html`
  <h1>Style samples</h1>
  <p class="muted">Contoh postingan lama — disuntik ke prompt writer + critic (maks 8 terbaru).</p>
  <table>
    <thead><tr><th>Judul</th><th>Platform</th><th>Waktu</th><th></th></tr></thead>
    <tbody>${samples.map((s) => html`<tr>
      <td><strong>${s.title}</strong><div class="muted" style="max-height:3em;overflow:hidden">${s.body}</div></td>
      <td>${s.platform ?? 'semua'}</td>
      <td class="muted">${fmtDate(s.createdAt)}</td>
      <td><form hx-post="/admin/styles/${s.id}/delete" hx-swap="none" hx-confirm="Hapus sample ini?">
        ${raw('<button class="ghost danger" type="submit">')}hapus${raw('</button>')}</form></td>
    </tr>`)}</tbody>
  </table>
  <h2>Tambah sample</h2>
  <div class="card">
    <form hx-post="/admin/styles" hx-swap="none" class="grid">
      <div><label>Judul</label><input type="text" name="title" required></div>
      <div><label>Platform</label><select name="platform">
        <option value="">semua</option>
        <option value="instagram">instagram</option>
        <option value="linkedin">linkedin</option>
      </select></div>
      <div style="grid-column:1/-1"><label>Isi postingan</label><textarea name="body" required style="min-height:160px"></textarea></div>
      <div style="grid-column:1/-1"><button type="submit">Tambah</button></div>
    </form>
  </div>`);
}

// ---------- templates ----------
export type TemplateRow = { id: number; name: string; format: string; is_active: boolean; updatedAt: string };

const TPL_TOKENS: Record<string, string[]> = {
  'ig-carousel': ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
  'li-carousel': ['{{headline}}', '{{body}}', '{{index}}', '{{total}}'],
  'reel': ['{{overlay}}', '{{index}}', '{{total}}'],
};

const tokenList: string = Object.entries(TPL_TOKENS)
  .map(([f, toks]) => `${f}: ${toks.join(' ')}`)
  .join(' · ');

// Dummy data utk live preview (spec #16: preview render dengan dummy data, iframe sandbox).
const DUMMY_SLIDES = {
  caption: 'dummy',
  slides: [
    { headline: 'Slide pertama', body: 'Isi slide contoh untuk preview template.' },
    { headline: 'Slide kedua', body: 'Baris body maks 25 kata, satu ide per slide.' },
    { headline: 'CTA', body: 'Simpan + share kalau bermanfaat.' },
  ],
};
const DUMMY_REEL = {
  scenes: [
    { overlay_text: 'Bug production?', narration: 'a' },
    { overlay_text: 'Tenang dulu', narration: 'b' },
    { overlay_text: 'git bisect', narration: 'c' },
  ],
};

const previewScript = `<script>
  const DUMMY_SLIDES = ${JSON.stringify(DUMMY_SLIDES)};
  const DUMMY_REEL = ${JSON.stringify(DUMMY_REEL)};
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function fill(t, map){
    let out = t;
    for (const [k,v] of Object.entries(map)) out = out.replaceAll('{{'+k+'}}', esc(v));
    return out;
  }
  const input = document.getElementById('tpl-input');
  const sel = document.querySelector('select[name=format]');
  const pv = document.getElementById('pv');
  function render(){
    const tpl = input.value;
    if (!tpl.trim()) { pv.srcdoc = ''; return; }
    let out = '';
    if (sel.value === 'reel') {
      const scenes = DUMMY_REEL.scenes;
      scenes.forEach((sc, i) => { out += fill(tpl, {'overlay': sc.overlay_text, 'index': String(i+1), 'total': String(scenes.length)}) + '\\n'; });
    } else {
      const slides = DUMMY_SLIDES.slides;
      slides.forEach((sl, i) => { out += fill(tpl, {'headline': sl.headline, 'body': sl.body, 'index': String(i+1), 'total': String(slides.length)}) + '\\n'; });
    }
    pv.srcdoc = out;
  }
  input.addEventListener('input', render);
  sel.addEventListener('change', render);
  </script>`;

export function templatesPage(templates: TemplateRow[]): ReturnType<typeof html> {
  // Baris tabel dibangun manual + esc() — hindari html`` 3-level nested (parse hazard).
  const rows = templates
    .map(
      (t) => `<tr>
      <td><strong>${esc(t.name)}</strong></td>
      <td><code>${esc(t.format)}</code></td>
      <td>${t.is_active ? '✅' : '—'}</td>
      <td class="muted">${esc(fmtDate(t.updatedAt))}</td>
      <td class="row">
        ${t.is_active ? '' : `<form hx-post="/admin/templates/${t.id}/activate" hx-swap="none">
          <button class="ghost" type="submit">aktifkan</button></form>`}
        <form hx-post="/admin/templates/${t.id}/delete" hx-swap="none" hx-confirm="Hapus template ini?">
          <button class="ghost danger" type="submit">hapus</button></form>
      </td>
    </tr>`,
    )
    .join('');

  return layout('Template', html`
  <h1>Template visual</h1>
  <table>
    <thead><tr><th>Nama</th><th>Format</th><th>Aktif</th><th>Update</th><th></th></tr></thead>
    <tbody>${raw(rows)}</tbody>
  </table>
  <h2>Upload template baru</h2>
  <div class="card">
    <form hx-post="/admin/templates" hx-swap="none" class="grid">
      <div><label>Nama</label><input type="text" name="name" required></div>
      <div><label>Format</label><select name="format">
        <option value="ig-carousel">ig-carousel (IG 1080×1350)</option>
        <option value="li-carousel">li-carousel (LinkedIn 1080×1350 → PDF)</option>
        <option value="reel">reel (1080×1920)</option>
      </select></div>
      <div style="grid-column:1/-1"><label>HTML — token per format: ${tokenList}</label>
        <textarea name="html" id="tpl-input" required style="min-height:200px"></textarea></div>
      <div style="grid-column:1/-1"><label class="row">
        <input type="checkbox" name="is_active" value="1"> langsung aktifkan (nonaktifkan template lain di format sama)</label></div>
      <div style="grid-column:1/-1"><button type="submit">Upload</button></div>
    </form>
    <h2>Live preview (dummy data, sandbox)</h2>
    <iframe sandbox="" id="pv"></iframe>
  </div>
  ${raw(previewScript)}`);
}
