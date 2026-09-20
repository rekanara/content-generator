# SPEC — Content Generator (content-generator)

Sumber kebutuhan: `content-generator.md` + feedback Jack (revisi v2). Belum diimplementasi.

## 1. Objective

Daemon tunggal di Mac mini yang otomatis menghasilkan satu konten developer-audiens (bahasa Indonesia) per hari untuk Instagram atau LinkedIn (bergantian), dengan kontrol penuh lewat: (a) web admin FE — atur pilar topik, jadwal cron on/off, upload template visual & style samples, (b) bot Telegram — minta generate manual lewat chat. Hasil dikirim ke Telegram untuk di-upload manual oleh Jack.

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
6. FE admin: CRUD pilar, atur cron (waktu + aktif/nonaktif), daftar post + preview + kirim ulang, tombol generate manual, upload template HTML per format dengan live preview, kelola style samples (teks).
7. Dedup topik: 30 topik terakhir per pilar disuntik ke prompt ideation; topik tersimpan di DB.
8. Pilar berita tech pakai RSS segar; RSS gagal → fallback pilar lain, run tetap jalan.
9. Setiap konten lewat critic + revisi (model critic terpisah via `LLM_MODEL_CRITIC`) sebelum render.
10. Output LLM tervalidasi (type guard); JSON rusak → maks 1 retry per langkah → run gagal status `failed`.
11. Gagal di tengah pipeline tidak mengkonsumsi rotasi: `rotation_state` hanya di-update setelah post `sent`.
12. Satu run aktif pada satu waktu (antrean FIFO in-process). Cron, bot, dan FE memasukkan ke antrean yang sama.

## 3. Arsitektur

```
daemon (src/server.ts)
  ├─ Hono app: API + FE (server-rendered HTML + HTMX, auto-escape)
  ├─ node-cron: jadwal dari settings DB, re-schedule saat setting berubah
  ├─ Telegram bot: polling getUpdates (no webhook, no public URL)
  ├─ queue: FIFO, satu run aktif
  └─ pipeline (lib bersama):
        slot → ideation (pilar gilir + riwayat + RSS?) → writer → critic
        → render (Puppeteer PNG/PDF, TTS+ffmpeg MP4) → upload MinIO → telegram (stream dari MinIO) → update state
```

Rotasi = pure function `(state) => nextSlot` di `src/state.ts`, unit-test terpisah dari DB.

Reels + voiceover, scene-based sync (durasi frame mengikuti durasi audio — tidak perlu alignment rumit):
```
scenes (writer output, 4–6 scene): {overlay_text, narration}
  → TTS per scene (msedge-tts, voice id-ID) → audio clip + ffprobe duration
  → frame PNG per scene (HTML template, teks overlay)
  → ffmpeg: [PNG + audio + durasi audio] → segmen MP4 → concat → MP4 final
```

## 4. Data Model (PostgreSQL)

Driver `postgres` (postgres.js). Migrasi SQL plain di `db/migrations/`, runner sendiri (~40 baris), tabel `schema_migrations`. Tanpa ORM.

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
  -- soft delete: active=false, tidak dihapus fisik (FK dari posts/rotation)
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
  html text not null,               -- token {{TITLE}}, {{SLIDES}}, dst.
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
| `pnpm migrate` | Terapkan migrasi SQL pending |
| `pnpm serve` | Jalankan daemon (server + cron + bot + queue) |
| `pnpm daily [--dry\|--no-render]` | CLI: satu run pipeline (debug, tanpa bot/FE/cron) |
| `pnpm send --post <id>` / `pnpm render --post <id>` | Kirim/render ulang |

Bot Telegram (polling):
- `/gen instagram|linkedin [carousel|reels|pdf|text]` — tanpa arg format → ikut rotasi format.
- `/status` — jadwal, cron aktif?, posisi rotasi, post terakhir.
- Balasan: langsung "queued", hasil dikirim saat selesai.

Process management: launchd plist atau pm2 — ops, di luar scope kode.

## 6. Project Structure

```
content-generator/
  SPEC.md
  package.json        # tsx, typescript, puppeteer, postgres, rss-parser, hono, cron, msedge-tts, minio, @types/*
  .env.example
  db/migrations/001_init.sql, 002_seed_pillars.sql
  src/
    config.ts         # env: DB_*, MINIO_*, LLM, TTS, Telegram, PORT
    db.ts             # pool postgres.js + migrasi runner + get/set rotation & pillars
    state.ts          # PURE: nextSlot/forcedSlot/nextState (zero import, unit-test)
    storage.ts        # MinIO: upload artefak posts/<id>/, stream untuk kirim Telegram
    llm.ts            # openai-compatible chat (JSON mode + retry)
    tts.ts            # text-to-speech: msedge-tts default, opsi openai-compatible
    schema.ts         # type guard output LLM (ideation/writer/critic)
    prompts.ts        # builder per peran + style samples dari DB
    rss.ts            # fetch feed → cache feeds_cache → pilih item segar
    pipeline.ts       # orkestrasi satu run
    queue.ts          # FIFO in-process, satu run aktif
    cron.ts           # scheduler dari settings, re-schedule on change
    bot.ts            # telegram polling + command parse (regex, no framework)
    server.ts         # hono app: API + FE, entry daemon
    telegram.ts       # Bot API via fetch: sendMessage, sendMediaGroup, sendDocument
    render/
      carousel.ts     # HTML → PNG 1080×1350 / PDF
      reels.ts        # TTS per scene + ffprobe + frame PNG + ffmpeg concat
      ffmpeg.ts       # pure: arg builder (unit-test)
      template.ts     # load template aktif dari DB, isi token, escape
    views/            # hono/jsx atau html`` — halaman admin + partial HTMX
  out/                # artefak per post, gitignored
  tests/              # node:test
```

## 7. Code Style

- TypeScript strict, ESM, Node 22+, `tsx` tanpa build step.
- Fungsi murni untuk logika testable: rotasi, prompt builder, ffmpeg args, type guard, command parser.
- Deps final: `tsx`, `typescript`, `puppeteer`, `postgres`, `rss-parser`, `hono`, `cron`, `msedge-tts`, `minio` + `@types/*`. Tambahan = ask first.
- FE: server-rendered HTML + HTMX (CDN) + CSS kecil. Auto-escape semua konten user (hono html helper) — XSS boundary.
- Komentar `ponytail:` untuk penyederhanaan disengaja (ceiling + jalur upgrade).
- Log terstruktur satu baris per langkah (`[ideation] topic=... tokens=...`).

## 8. Testing Strategy

- Runner `node:test` (zero dep).
- Unit (pure, wajib): rotasi platform+format+pilar; type guard; ffmpeg arg builder; prompt builder (muat riwayat + style samples); bot command parser.
- Integration manual: `pnpm migrate` → tabel + seed masuk; `pnpm daily --dry` → artefak ada di MinIO `posts/<id>/` (object > 0 byte), MP4 durasi 10–30 detik, audio terdengar; FE buka di browser, bot command dari HP.
- LLM tidak di-mock; kualitas = review manusia.
- Template upload: preview render dengan dummy data (iframe sandbox).

## 9. Config & Secrets

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

Postgres & MinIO = service eksternal (config terpisah dari app). Render staging lokal `out/<id>/` → upload ke MinIO → kirim Telegram streaming dari MinIO → staging boleh dibersihkan.

Log tidak pernah mencetak secret. Key hanya dibaca di `config.ts`.

## 10. Boundaries

**Selalu:**
- Validasi output LLM sebelum dipakai (trust boundary).
- Auto-escape semua render FE; preview template di iframe sandbox.
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

## 11. Build Order

1. `db.ts` + migrasi + seed pilar + `state.ts` rotasi (+ test).
2. `llm.ts` + `schema.ts` + `prompts.ts` + `pipeline.ts` sampai critic → `pnpm daily --no-render` jalan.
3. `render/template.ts` + `carousel.ts` (PNG + PDF) → `--dry` jalan untuk slot non-reels.
4. `telegram.ts` + `bot.ts` → daemon v1 (bot polling + queue + `/gen` `/status`) — generate manual sudah bisa dari HP.
5. `cron.ts` + daemon penuh → cron otomatis jalan.
6. `tts.ts` + `render/reels.ts` + ffmpeg → reels voiceover jalan.
7. `server.ts` + `views/` FE admin: pilar, cron, history + preview + resend, generate manual.
8. FE upload template + preview; kelola style samples.
9. `rss.ts` + pilar berita.
10. Polish: launchd/pm2, seed 5+ style samples.

## 12. Keputusan (locked 2026-09-19)

1. **Generate manual (bot/FE/CLI) memajukan rotasi** — sama seperti cron. Satu sumber kebenaran, tidak ada flag one-off sampai diminta.
2. **Upload style = upload template HTML visual** per format + live preview dummy data (iframe sandbox).
3. **TTS default `msedge-tts`** — gratis, tanpa API key, voice neural Indonesia (`id-ID-ArdiNeural` / `id-ID-GadisNeural`). Opsi `TTS_PROVIDER=openai` untuk `/v1/audio/speech` via 9router — hanya kalau ada provider yang benar-benar serve audio (cek sekali via curl). `ponytail:` upgrade ElevenLabs di belakang interface `tts.ts` yang sama.
4. **Bukan monorepo, tanpa React** — satu package, FE server-rendered HTMX. FE = CRUD + toggle + upload + preview; monorepo menambah 2 build pipeline + workspace setup untuk kebutuhan yang belum ada. Upgrade path murah: API hono sudah JSON; saat FE butuh interaksi kompleks (editor slide drag-drop), tambah `web/` Vite React di repo yang sama — struktur server tidak berubah.

Asumsi tersisa (kecil, jalan tanpa konfirmasi):
5. Bot Telegram command-based (`/gen`, `/status`), bukan natural language.
6. Reels 15–30 detik, 4–6 scene, narasi ~50–70 kata, tanpa musik.
7. Style samples selalu masuk prompt writer + critic (8 terbaru).
8. Cron in-app (node-cron) karena toggle FE; `pnpm daily` CLI tetap untuk debug.
