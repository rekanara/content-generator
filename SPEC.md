# SPEC v4 — Content Generator (content-generator)

Sumber kebutuhan: `content-generator.md` + feedback Jack (v2→v4). **Status: diimplementasi** — monorepo, JSON API + React SPA, daemon live di Mac mini.

## 1. Objective

Daemon tunggal di Mac mini yang otomatis menghasilkan satu konten developer-audiens (bahasa Indonesia) per hari untuk Instagram atau LinkedIn (bergantian), dengan kontrol penuh lewat: (a) web admin SPA (React, Vite) — atur pilar topik, jadwal cron on/off, upload template visual & style samples, (b) bot Telegram — minta generate manual lewat chat. Hasil dikirim ke Telegram untuk di-upload manual oleh Jack.

Bukan multi-agen: satu pipeline dengan peran (ideation → writer → critic → render → send). Satu process: server + scheduler + bot + queue.

## 2. Acceptance Criteria

1. Cron jalan sesuai jadwal dari DB (`settings.cron_expr`), toggle on/off via FE, tanpa restart daemon.
2. Satu run = satu post. Platform dibalik dari run terakhir sukses (LinkedIn ↔ Instagram). Format bergilir per platform: IG carousel ↔ reels; LinkedIn teks ↔ PDF. Pilar juga bergilir. Hari terlewat tidak merusak pola (state-based, bukan paritas tanggal).
3. Output per slot:
   - IG carousel: N PNG 1080×1350 + caption.
   - IG reels: 1 MP4 1080×1920, 15–30 detik, **voiceover TTS**, teks overlay per scene, tanpa musik + caption.
   - LinkedIn PDF: 1 PDF multi-halaman + caption.
   - LinkedIn teks: body post saja.
4. Hasil + caption dikirim ke chat Telegram (sendMediaGroup / sendDocument / sendMessage).
5. Telegram command `/gen <platform> [format]` menjalankan generate manual via antrean; `/status` menampilkan jadwal, posisi rotasi, post terakhir.
6. FE admin SPA: CRUD pilar, atur cron (waktu + aktif/nonaktif), daftar post + preview + kirim ulang, tombol generate manual, upload template HTML per format, kelola style samples (teks).
7. Dedup topik: 30 topik terakhir per pilar disuntik ke prompt ideation; topik tersimpan di DB.
8. Pilar berita tech pakai RSS segar; RSS gagal → fallback pilar lain, run tetap jalan.
9. Setiap konten lewat critic + revisi (model critic terpisah via `LLM_MODEL_CRITIC`) sebelum render.
10. Output LLM tervalidasi (type guard); JSON rusak → maks 1 retry per langkah → run gagal status `failed`.
11. Gagal di tengah pipeline tidak mengkonsumsi rotasi: `rotation_state` hanya di-update setelah post `sent`.
12. Satu run aktif pada satu waktu (antrean FIFO in-process). Cron, bot, dan FE memasukkan ke antrean yang sama.

## 3. Arsitektur

```
daemon (apps/server/src/server.ts)
  ├─ Hono app: JSON API (/api/*) + serveStatic apps/web/dist (SPA fallback)
  ├─ node-cron: jadwal dari settings DB, re-schedule saat setting berubah
  ├─ Telegram bot: polling getUpdates (no webhook, no public URL)
  ├─ queue: FIFO, satu run aktif
  └─ pipeline (lib bersama):
        slot → ideation (pilar gilir + riwayat + RSS?) → writer → critic
        → render (Puppeteer PNG/PDF, TTS+ffmpeg MP4) → upload MinIO → telegram (stream dari MinIO) → update state

apps/web (React SPA — Vite, TypeScript strict, react 19)
  ├─ src/lib/api.ts       # typed fetch client → /api/*
  ├─ src/lib/hooks.ts     # useApi/useDashboard/usePosts/... (useEffect + fetch, no react-query)
  ├─ src/components/nav.tsx
  └─ src/views/           # dashboard, pillars (+cron), posts (+detail modal), styles, templates

packages/shared (zod v4 — single contract FE↔BE)
  └─ src/index.ts         # schema + types: Pillar, Post, Style, Template, Dashboard, Cron, input schemas

packages/ui              # shadcn-style components + globals.css (tailwind v4) — dipakai apps/web
```

Rotasi = pure function `(state) => nextSlot` di `apps/server/src/state.ts`, unit-test terpisah dari DB.

Reels + voiceover, scene-based sync (durasi frame mengikuti durasi audio):
```
scenes (writer output, 4–6 scene): {overlay_text, narration}
  → TTS per scene (msedge-tts, voice id-ID) → audio clip + ffprobe duration
  → frame PNG per scene (HTML template, teks overlay)
  → ffmpeg: [PNG + audio + durasi audio] → segmen MP4 → concat → MP4 final
```

## 4. Data Model (PostgreSQL)

Driver `postgres` (postgres.js). Migrasi SQL plain di `apps/server/db/migrations/`, runner sendiri, tabel `schema_migrations`. Tanpa ORM.

```sql
create table settings (
  id boolean primary key default true check (id),
  cron_expr text not null default '0 7 * * *',
  cron_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table pillars (
  id serial primary key,
  name text not null unique,
  description text not null,        -- instruksi untuk LLM
  is_news boolean not null default false,  -- pilar berita tech → wajib RSS
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
  -- soft delete via active=false (FK dari posts/rotation)
);

create table rotation_state (
  id boolean primary key default true check (id),
  last_platform text not null check (last_platform in ('instagram','linkedin')),
  last_ig_format text check (last_ig_format in ('carousel','reels')),
  last_li_format text check (last_li_format in ('text','pdf')),
  last_pillar_id int references pillars(id),
  updated_at timestamptz not null default now()
);

create table posts (
  id serial primary key,
  created_at timestamptz not null default now(),
  platform text not null check (platform in ('instagram','linkedin')),
  format text not null check (format in ('carousel','reels','pdf','text')),
  pillar_id int references pillars(id),
  topic text not null,
  caption text not null,
  body text,                        -- LinkedIn teks / script reels (scenes JSON)
  artifact_prefix text,             -- key prefix MinIO posts/<id>/, null untuk format text
  status text not null default 'queued'
        check (status in ('queued','draft','rendered','sent','failed')),
  error text,
  source text not null default 'cron' check (source in ('cron','telegram','web','cli')),
  llm_usage jsonb                   -- token usage per langkah
);

create table templates (
  id serial primary key,
  name text not null,
  format text not null check (format in ('ig-carousel','li-carousel','reel')),
  html text not null,               -- token {{headline}}, {{body}}, {{index}}, {{total}}, {{overlay}}
  is_active boolean not null default false,  -- satu aktif per format
  updated_at timestamptz not null default now()
);

create table style_samples (
  id serial primary key,
  title text not null,
  body text not null,               -- postingan lama Jack, contoh gaya
  platform text check (platform in ('instagram','linkedin')),  -- null = keduanya
  created_at timestamptz not null default now()
);

create table feeds_cache (
  url text primary key,
  fetched_at timestamptz not null,
  items jsonb not null
);
```

Boot cleanup: post berstatus `queued`/`draft`/`rendered` saat daemon start → tandai `failed` (orphan dari crash).

## 5. Commands & Entry

| Command | Fungsi |
|---|---|
| `npm run migrate` (apps/server) | Terapkan migrasi SQL pending |
| `npm run serve` (apps/server) | Jalankan daemon (server + cron + bot + queue) |
| `npm run daily [--dry\|--no-render]` (apps/server) | CLI: satu run pipeline (debug) |
| `npm run build` (apps/web) | Build SPA → `apps/web/dist` (server serveStatic dari sini) |
| `npm run dev` (apps/web) | Vite dev server (proxy /api ke :8787) |
| `npm test` (root) | Workspace test (27 test, node:test) |

Bot Telegram (polling):
- `/gen instagram|linkedin [carousel|reels|pdf|text]` — tanpa arg format → ikut rotasi format.
- `/status` — jadwal, cron aktif?, posisi rotasi, post terakhir.
- Balasan: langsung "queued", hasil dikirim saat selesai.

Process management: launchd plist atau pm2 — ops, di luar scope kode.

## 6. Project Structure

```
content-generator/          # npm workspaces
  SPEC.md
  package.json              # workspace root
  apps/
    server/                 # @workspace/server — daemon
      package.json          # tsx, typescript, puppeteer, postgres, rss-parser, hono, cron, msedge-tts, minio
      db/migrations/001_init.sql, 002_seed_pillars.sql
      src/
        config.ts           # env: DB_*, MINIO_*, LLM, TTS, Telegram, PORT
        db.ts               # pool postgres.js + migrasi runner + get/set rotation & pillars
        state.ts            # PURE: nextSlot/forcedSlot/nextState (zero import, unit-test)
        storage.ts          # MinIO: upload artefak posts/<id>/, stream untuk kirim Telegram
        llm.ts              # openai-compatible chat (JSON mode + retry)
        tts.ts              # text-to-speech: msedge-tts default, opsi openai-compatible
        schema.ts           # type guard output LLM (ideation/writer/critic)
        prompts.ts          # builder per peran + style samples dari DB
        rss.ts              # fetch feed → cache feeds_cache → pilih item segar
        pipeline.ts         # orkestrasi satu run
        queue.ts            # FIFO in-process, satu run aktif
        cron.ts             # scheduler dari settings, re-schedule on change
        bot.ts              # telegram polling + command parse (regex, no framework)
        server.ts           # hono: route /api/* + serveStatic web/dist + SPA fallback
        api.ts              # JSON API (zod-validated via @workspace/shared)
        telegram.ts         # Bot API via fetch: sendMessage, sendMediaGroup, sendDocument
        render/
          carousel.ts       # HTML → PNG 1080×1350 / PDF
          reels.ts          # TTS per scene + ffprobe + frame PNG + ffmpeg concat
          ffmpeg.ts         # pure: arg builder (unit-test)
          template.ts       # load template aktif dari DB, isi token, escape
      tests/                # node:test (27)
    web/                    # @workspace/web — SPA
      src/
        main.tsx
        App.tsx             # view switcher (state-based, no router)
        lib/api.ts          # typed fetch client
        lib/hooks.ts        # useApi + per-resource hooks
        components/         # nav.tsx, theme-provider.tsx
        views/              # dashboard, pillars, posts, styles, templates
  packages/
    shared/                 # @workspace/shared — zod schema kontrak FE↔BE
      src/index.ts
    ui/                     # @workspace/ui — tailwind v4 + shadcn-style components
      src/{components,hooks,lib,styles}
  out/                      # artefak per post, gitignored (server side)
```

## 7. JSON API Contract

Semua route zod-validated (input) via `@workspace/shared`. Response = typed schema yang sama (type-only di FE).

| Method | Route | Fungsi |
|---|---|---|
| GET | /api/dashboard | cron + queue + rotation + next_slot + 10 post terakhir |
| GET/POST | /api/pillars | list / tambah (PillarInput) |
| POST | /api/pillars/:id/toggle | aktif/off |
| DELETE | /api/pillars/:id | hapus fisik |
| GET/POST | /api/cron | status / simpan expr+enabled (validasi cron pkg) |
| GET | /api/posts | 100 post terakhir |
| GET | /api/posts/:id | detail + body_text (slides/scenes dirapikan) |
| POST | /api/posts/:id/resend | antrean kirim ulang |
| POST | /api/gen | generate manual (platform/format optional) |
| GET/POST | /api/styles | list / tambah (StyleInput) |
| DELETE | /api/styles/:id | hapus |
| GET/POST | /api/templates | list / tambah (TemplateInput) |
| POST | /api/templates/:id/activate | set aktif per format |
| DELETE | /api/templates/:id | hapus |

Error contract: 400 `{error, issues?}` (zod), 404 `{error}` (unknown post / unknown /api route), 500 default Hono. `:id` param di-guard `Number.isInteger` → 400 `{"error":"id tak valid"}`.

SPA fallback: route non-/api tak dikenal → `apps/web/dist/index.html` (client view switcher, state-based). `/api/*` tak dikenal → 404 JSON, tidak jatuh ke SPA.

## 8. Code Style

- TypeScript strict, ESM, Node 22+. Server: `tsx` tanpa build step. Web: Vite build.
- Monorepo npm workspaces: `@workspace/server`, `@workspace/web`, `@workspace/shared`, `@workspace/ui`.
- Zod v4 sebagai kontrak tunggal: BE parse input, FE type-only (upgrade path: FE runtime parse saat BE tak terpercaya).
- Fungsi murni untuk logika testable: rotasi, prompt builder, ffmpeg args, type guard, command parser.
- FE React: function components, hooks, no react-query (useApi hook kecil cukup), lucide-react icons, @workspace/ui Button.
- Komentar `ponytail:` untuk penyederhanaan disengaja (ceiling + jalur upgrade).
- Log terstruktur satu baris per langkah (`[ideation] topic=... tokens=...`).

## 9. Testing Strategy

- Runner `node:test` (zero dep). 27 test, all pass.
- Unit (pure, wajib): rotasi platform+format+pilar; type guard; ffmpeg arg builder; prompt builder; bot command parser; zod schema kontrak.
- Integration manual: `npm run migrate` → tabel + seed; `npm run daily --dry` → artefak di MinIO; SPA buka di browser (dashboard/pillars/posts/styles/templates), bot command dari HP.
- LLM tidak di-mock; kualitas = review manusia.

## 10. Config & Secrets

```
DB_HOST=localhost DB_PORT=5432 DB_USER=... DB_PASSWORD=... DB_NAME=content_generator
MINIO_ENDPOINT=localhost MINIO_PORT=9000 MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=...
MINIO_BUCKET=content-generator MINIO_USE_SSL=false
LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=...
LLM_MODEL_CRITIC=...            # kosong = pakai LLM_MODEL
TTS_PROVIDER=edge            # edge (default: gratis, voice neural id-ID) | openai
TTS_VOICE=id-ID-ArdiNeural
TTS_BASE_URL=... TTS_API_KEY=... TTS_MODEL=...   # hanya jika TTS_PROVIDER=openai
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
PORT=8787
```

Postgres & MinIO = service eksternal. Render staging lokal `out/<id>/` → upload ke MinIO → kirim Telegram streaming → staging boleh dibersihkan.

Log tidak pernah mencetak secret. Key hanya dibaca di `config.ts`.

## 11. Boundaries

**Selalu:**
- Validasi output LLM sebelum dipakai (trust boundary).
- Zod-parse semua input API (trust boundary); `:id` integer guard.
- Query SQL selalu parameterized (template tag postgres.js).
- Fail-safe RSS; fail-loud lainnya (`failed`, log error).
- Semua state di PostgreSQL. Queue in-process + boot cleanup.

**Ask first:**
- Tambah/hapus dependensi; ubah pilar default; ubah template visual default; ubah definisi rotasi.

**Never:**
- Auto-post ke Instagram/LinkedIn (upload manual Jack).
- Retry LLM tanpa batas (maks 1 per langkah).
- Secret ke log/DB/report.
- Render reels paralel (CPU-bound, satu per waktu — queue menjamin).
- Webhook Telegram (polling saja, Mac mini lokal tanpa public URL).

## 12. Keputusan (locked)

1. **Generate manual (bot/FE/CLI) memajukan rotasi** — sama seperti cron. Satu sumber kebenaran.
2. **Upload style = upload template HTML visual** per format.
3. **TTS default `msedge-tts`** — gratis, voice neural Indonesia. Opsi openai-compatible di belakang interface `tts.ts` yang sama. `ponytail:` upgrade ElevenLabs.
4. ~~Bukan monorepo, tanpa React~~ → **SUPERSEDED (2026-09-20): monorepo npm workspaces + React SPA.** Keputusan v2 (HTMX SSR) sudah terlampaui: API hono JSON-first memudahkan migrasi; SPA React memberi editor-interaksi kompleks (template upload, preview) tanpa HTMX acrobatics. Struktur: apps/server (daemon) + apps/web (SPA) + packages/shared (kontrak) + packages/ui (komponen). SSR admin (admin.ts, views.ts) dihapus — JSON API + SPA menggantikan sepenuhnya.
5. Bot Telegram command-based (`/gen`, `/status`), bukan natural language.
6. Reels 15–30 detik, 4–6 scene, narasi ~50–70 kata, tanpa musik.
7. Style samples selalu masuk prompt writer + critic (8 terbaru).
8. Cron in-app (node-cron) karena toggle FE; CLI `daily` tetap untuk debug.
9. **(2026-09-20) FE view-switcher state-based, bukan URL router** — admin single-user, 5 view, tidak perlu history/routing. `ponytail:` tambah react-router kalau FE publik/ multi-halaman.

## 13. Upgrade Paths (ponytail ceilings)

- FE runtime zod-parse response (saat ini type-only) — kalau BE jadi multi-client.
- react-router — kalau perlu URL per view (share link, back button).
- ElevenLabs TTS — di belakang interface `tts.ts` yang sama.
- Launchd/pm2 process management — ops, di luar kode.

## 14. Verification (2026-09-20)

- `npm test` workspace root: 27/27 pass.
- Typecheck: server, shared, ui, web — semua clean.
- Live daemon :8787: /api/* full CRUD verified; SPA fallback verified; /api 404 JSON verified; NaN id → 400 verified.
- Adversarial: parameterized SQL all routes; zod 400 malformed; orphan id → idempotent no-op.
