# SPEC v5 — Content Generator (content-generator)

Sumber kebutuhan: `content-generator.md` + feedback Jack (v2→v5). **Status: diimplementasi** — monorepo, JSON API + React SPA, auth multi-user, multi-group, daemon live di Mac mini.

## 1. Objective

Daemon tunggal di Mac mini yang otomatis menghasilkan satu konten developer-audiens (bahasa Indonesia) per hari per group untuk Instagram atau LinkedIn (bergantian), dengan kontrol penuh lewat: (a) web admin SPA (React, Vite) — login, kelola group, atur pilar topik, jadwal cron on/off, upload template visual & style samples, (b) bot Telegram — minta generate manual lewat chat. Hasil dikirim ke Telegram untuk di-upload manual oleh Jack.

Bukan multi-agen: satu pipeline dengan peran (ideation → writer → critic → render → send). Satu process: server + scheduler + bot + queue.

Multi-group: setiap group = satu "akun konten" dengan konfigurasi sendiri (LLM, TTS, Telegram, cron, pilar, rotasi, style, template). Admin melihat semua group; user biasa hanya group miliknya. Group pertama user = default saat login.

## 2. Acceptance Criteria

1. Cron jalan sesuai jadwal per group (`groups.cron_expr`), toggle on/off via FE, tanpa restart daemon.
2. Satu run = satu post per group. Platform dibalik dari run terakhir sukses (LinkedIn ↔ Instagram). Format bergilir per platform: IG carousel ↔ reels; LinkedIn teks ↔ PDF. Pilar juga bergilir. Hari terlewat tidak merusak pola (state-based, bukan paritas tanggal).
3. Output per slot:
   - IG carousel: N PNG 1080×1350 + caption.
   - IG reels: 1 MP4 1080×1920, 15–30 detik, **voiceover TTS**, teks overlay per scene, tanpa musik + caption.
   - LinkedIn PDF: 1 PDF multi-halaman + caption.
   - LinkedIn teks: body post saja.
4. Hasil + caption dikirim ke chat Telegram group (sendMediaGroup / sendDocument / sendMessage).
5. Telegram command `/gen [group] <platform> [format]` menjalankan generate manual via antrean; `/status [group]` menampilkan jadwal, posisi rotasi, post terakhir.
6. FE admin SPA: login/logout + reset password, CRUD group (admin), CRUD pilar, atur cron, daftar post + preview + kirim ulang, tombol generate manual, upload template HTML per format, kelola style samples, manajemen user (admin).
7. Dedup topik: 30 topik terakhir per pilar disuntik ke prompt ideation; topik tersimpan di DB.
8. Pilar berita tech pakai RSS segar (Hacker News, dev.to, blog vendor); RSS gagal → fallback pilar non-news, run tetap jalan.
9. Setiap konten lewat critic + revisi (model critic terpisah via override group / `LLM_MODEL_CRITIC`) sebelum render.
10. Output LLM tervalidasi (type guard); JSON rusak → maks 1 retry per langkah → run gagal status `failed`.
11. Gagal di tengah pipeline tidak mengkonsumsi rotasi: `rotation_state` hanya di-update setelah post `sent`.
12. Satu run aktif pada satu waktu per daemon (antrean FIFO in-process). Cron, bot, dan FE memasukkan ke antrean yang sama.
13. Auth: session cookie httpOnly (sha256 token di DB, sliding 30 hari), rate-limit login per IP (5 gagal/15 menit → lock 15 menit), anti-enumeration login, admin guard untuk user-management + group CRUD.
14. **Approval gate (per group, default off)**: run dengan `groups.approval_required` → render → status `awaiting_approval` → tombol Approve/Reject (inline keyboard Telegram atau FE) → approve = kirim + rotasi maju; reject = terminal `rejected`, rotasi TIDAK maju. `awaiting_approval` sengaja survive daemon restart (bukan orphan).
15. **Watchdog**: slot cron terlewat (daemon down / run tak pernah mulai) terdeteksi di boot + heartbeat tiap 6 jam → alert ke chat Telegram group. Run gagal (queue) + orphan boot juga alert — tidak ada failure senyap.
16. **Calendar preview**: `GET /api/g/:slug/calendar?n=` — N slot berikutnya (pure `previewSlots`) + tanggal fire dari cron expr. Tidak merefleksikan run yang sedang in-flight.

## 3. Arsitektur

```
daemon (apps/server/src/server.ts)
  ├─ Hono app: JSON API (/api/*) + serveStatic apps/web/dist (SPA fallback)
  ├─ node-cron: jadwal per group dari DB, re-schedule saat setting berubah
  ├─ Telegram bot: polling getUpdates (no webhook, no public URL)
  ├─ queue: FIFO, satu run aktif
  └─ pipeline (lib bersama):
        slot → ideation (pilar gilir + riwayat + RSS?) → writer → critic
        → render (Puppeteer PNG/PDF, TTS+ffmpeg MP4) → upload MinIO → telegram (stream dari MinIO) → update state
```

Layered (pragmatic, bukan full Clean Architecture):
```
src/
  api.ts          # transport: auth middleware, zod, status codes — zero SQL
  auth/           # password (scrypt) | session | rate-limit | users + barrel
  db/             # pool (postgres.js) | migrate (runner + admin seeder)
  repos/          # pillars, posts, styles, templates, rotation — SQL only
  usecases/       # dashboard (agregasi)
  groups.ts       # group repo + config resolution (env fallback + DB override)
  rss.ts          # feed fetch → feeds_cache → fresh items → ideation context
  state.ts        # PURE: rotasi (zero import, unit-test)
  adapters:       # llm.ts, tts.ts, storage.ts, telegram.ts, render/*
```

apps/web (React SPA — Vite, TypeScript strict, react 19)
```
src/lib/api.ts       # typed fetch client → /api/*
src/lib/hooks.ts     # useApi/useDashboard/usePosts/... (useEffect + fetch, no react-query)
src/views/           # login, dashboard, pillars, posts, styles, templates, groups, users, reset-password
```

packages/shared (zod v4 — single contract FE↔BE): schema + types + input schemas.

Reels + voiceover, scene-based sync (durasi frame mengikuti durasi audio):
```
scenes (writer output, 4–6 scene): {overlay_text, narration}
  → TTS per scene (msedge-tts, voice id-ID) → audio clip + ffprobe duration
  → frame PNG per scene (HTML template, teks overlay)
  → ffmpeg: [PNG + audio + durasi audio] → segmen MP4 → concat → MP4 final
```

## 4. Data Model (PostgreSQL)

Driver `postgres` (postgres.js). Migrasi SQL plain di `apps/server/db/migrations/` (001–007), runner sendiri, tabel `schema_migrations`. Tanpa ORM. **Semua PK UUID v7** (time-ordered, string di TS).

```sql
groups            -- id, slug, name, user_id (owner, null=admin), cron_expr, cron_enabled, approval_required,
                   --   llm_* overrides, tts_* overrides, telegram_* overrides, created_at
users             -- id, username unique, password_hash (scrypt), role (admin|user), created_at
sessions          -- id, user_id, token_hash (sha256), expires_at (sliding 30d), created_at
pillars           -- id, group_id, name, description, is_news, active, sort_order
rotation_state    -- group_id PK, last_platform, last_ig_format, last_li_format, last_pillar_id
posts             -- id, group_id, platform, format, pillar_id, topic, caption, body (jsonb),
                   --   artifact_prefix, status (queued|draft|rendered|awaiting_approval|sent|failed|rejected),
                   --   error, source, llm_usage
templates         -- id, name, format (ig-carousel|li-carousel|reel), html, is_active (satu per format per group)
style_samples     -- id, group_id, title, body, platform
feeds_cache       -- url PK, fetched_at, items jsonb
```

Status lifecycle: `queued → draft → rendered → awaiting_approval →(approve) sent` | `→(reject) rejected` | `→ failed` (error di langkah mana pun). `awaiting_approval` survive restart; lainnya in-flight → orphan-failed di boot.

Migrasi 001–009 (009 = approval gate). Watchdog pakai `cronmath.ts` (prevFire/nextFires di atas CronTime `cron` package, TZ Asia/Jakarta).

Boot cleanup: post berstatus `queued`/`draft`/`rendered` saat daemon start → tandai `failed` (orphan dari crash). Migrate runner men-seed admin default (username `admin`, password dari `CG_ADMIN_PASSWORD` env atau random+dicetak sekali) jika tabel users kosong.

## 5. Commands & Entry

| Command | Fungsi |
|---|---|
| `npm run migrate` (apps/server) | Terapkan migrasi SQL pending + seed admin |
| `npm run serve` (apps/server) | Jalankan daemon (server + cron + bot + queue) |
| `npm run daily [--dry\|--no-render] [--group slug]` | CLI: satu run pipeline (debug) |
| `npm run user:add -- <name> [--admin]` | Buat user (password via arg/stdin) |
| `npm run user:pass -- <name>` | Reset password + revoke sessions |
| `npm run user:list` | Daftar user |
| `npm run build` (apps/web) | Build SPA → `apps/web/dist` |
| `npm test` (root) | Workspace test (43 test, node:test) |

Bot Telegram (polling):
- `/gen [group] [platform] [format]` — tanpa group = group pertama; tanpa format → ikut rotasi.
- `/status [group]` — jadwal, cron aktif?, posisi rotasi, post terakhir.
- `/rerender [group]` — re-render post TERAKHIR dengan template saat ini (konten sama, tanpa LLM). Status `sent` → kirim ulang artefak baru (rotasi tak disentuh); `awaiting_approval` → awaiting + tombol approval baru (rotasi tetap menunggu approve); `rendered` → ikut gerbang approval (gate on → awaiting+tombol; gate off → deliver + rotasi maju — first send). Paritas FE: tombol rerender di Posts tab + `POST /api/g/:slug/posts/:id/rerender`.
- `/override [group]` — buat override content via flow terpandu: pilih type (tombol) → gambar (mix: 1 foto auto-lanjut; image_only: multi + tombol Selesai; text_only: skip) → description → tanggal (YYYY-MM-DD / DD-MM-YYYY) → commit (gambar di-download ke MinIO). `/cancel` membatalkan sesi. Sesi 30 menit, per chat.
- Menu command bot ter-register otomatis saat boot (`setMyCommands`): /gen, /override, /rerender, /status, /cancel, /help — muncul sebagai tombol menu "/" di chat.

### Override content

- **Konten manual yang menggantikan pipeline di tanggal tertentu** (per group, `overrides` table): type `mix` (tepat 1 gambar + teks) | `image_only` (1-10 gambar + caption) | `text_only` (teks saja). Gambar disimpan `overrides/<id>/img-NN.<ext>` di MinIO. `template_id` opsional — tersimpan untuk render di masa depan (ponytail), delivery saat ini kirim raw.
- **Satu override per (group, tanggal)** — DB unique index, `cancelled` membebaskan tanggal. `templates.type` (`regular` default | tipe override) memfilter pilihan template di form (dashboard + Telegram).
- **Redirect di runGenerate** (satu corong: cron/bot/FE): lihat **Plans** di bawah — override otomatis membuat plan row.
- Delivery: text_only → sendMessage; 1 gambar → sendPhoto; multi → sendMediaGroup.
- **Watchdog**: slot dengan override terkirim dianggap ter-cover (tidak false-alarm). Override scheduled yang belum terkirim tetap alert.
- Dashboard: tab **Overrides** (list + thumbnail, create multipart multi-upload, cancel, delete). Delivery failure → alert Telegram, override tetap scheduled (retry via /gen).

### Plans (date-scoped source of truth)

- **`plans` table**: apa yang jalan di tanggal tertentu, per group. **Plans adalah pengecualian (exception), bukan schedule** — tanpa plan row = rotasi natural (state-based, self-healing; schedule pre-computed akan drift). Tidak ada code path yang pre-generate plan untuk horizon tanggal.
- **type `slot_override`**: run di tanggal itu pakai spec yang di-pin — `platform`/`format`/`pillar_id`/`template_id` (semua nullable → fallback natural per-field; pillar harus masih aktif; template by-id dirender walau tidak active). Pipeline normal jalan (rotasi maju setelah `sent`). Use case: "rekomendasi repo github" di-pin ke template `image_only`, tanggal tertentu.
- **type `override_content`**: dibuat OTOMATIS oleh flow override (override + plan atomik dalam satu transaksi) — konten override yang dikirim, rotasi tidak maju.
- **Satu plan aktif per (group, tanggal)** — partial unique index; `cancelled` membebaskan tanggal. Create override di tanggal yang sudah ada plan slot → konflik → friendly error.
- **runGenerate konsult plan dulu** (sebelum resolve slot): override_content → deliver override / skip; slot_override → `plannedSlot` (pure) + templateId ke render; kosong/cancelled → natural (forced `/gen` args diabaikan saat plan aktif — dengan info message).
- Dashboard: **Next runs** menampilkan badge plan/override per tanggal + section **Plans** (form pin: date/platform/format/pillar/template + note, list, cancel). Calendar API merge plans (spec pinned menggantikan display slot natural).

### Cover image (halaman pertama carousel/PDF)

- **Satu row template = satu paket visual**: `html` (slide tengah) + `html_first` (cover, token `{{image}}`, nullable) + `html_last` (CTA, nullable). Null → halaman itu pakai body. 1 template aktif per format. Reels hanya pakai `html`.
- **`groups.image_model`** — per-group ONLY, tanpa env fallback (opt-in, beda dari llm/tts/telegram yang env=fallback). Kosong = cover OFF.
- Urutan render: slide 1 = html_first (hanya jika gambar tersedia), slide 2..n-1 = html, slide terakhir = html_last.
- Gambar di-generate SEKALI per post via `/images/generations` (gateway sama dengan LLM), disimpan `posts/<id>/cover.png` di MinIO → `/rerender` pakai ulang tanpa bayar ulang.
- **Fail-safe**: generate gagal → post parkir di `awaiting_cover` + notifikasi Telegram "Generate cover gagal" (dengan teks error) → upload foto manual ATAU tombol "Lewati — render tanpa cover". Skip selalu mengakhiri alur (tidak ada percobaan generate kedua). Post `sent` yang di-rerender tetap fail-safe senyap (tidak parkir — menjaga rotasi dari double-advance). html_first tanpa gambar = tidak dipakai (tidak ada `<img src="">` kosong).

Process management: launchd plist atau pm2 — ops, di luar scope kode.

## 6. Project Structure

```
content-generator/          # npm workspaces
  SPEC.md
  apps/
    server/                 # @workspace/server — daemon
      db/migrations/001..007*.sql
      src/
        config.ts           # env: DB_*, MINIO_*, LLM, TTS, Telegram, PORT, ADMIN_*
        db/pool.ts          # koneksi postgres.js
        db/migrate.ts       # runner + seed admin
        auth/               # password, session, rate-limit, users, barrel
        repos/              # pillars, posts, styles, templates, rotation
        usecases/dashboard.ts
        groups.ts           # group repo + config resolution
        state.ts            # PURE: rotasi
        rss.ts              # feed fetch + cache + freshness filter
        storage.ts          # MinIO upload/stream
        llm.ts / tts.ts     # openai-compatible adapters (group override aware)
        schema.ts           # type guard output LLM
        prompts.ts          # builder per peran + style samples
        pipeline.ts         # orkestrasi satu run
        queue.ts / cron.ts / bot.ts / telegram.ts / server.ts / api.ts / cli.ts
        render/             # carousel, reels, ffmpeg (pure args), template
      scripts/              # dev utilities (reset-db, check-db, test-login, test-rss)
      tests/                # node:test (43): state, bot, ffmpeg, auth, posts, rss
    web/                    # @workspace/web — SPA
      src/{views,lib,components}/
  packages/
    shared/                 # @workspace/shared — zod contract
    ui/                     # @workspace/ui — tailwind v4 + shadcn-style
  out/                      # artefak per post, gitignored
```

## 7. JSON API Contract

Semua route zod-validated (input) via `@workspace/shared`. `:id` param di-guard UUID regex → 400.

| Method | Route | Fungsi |
|---|---|---|
| POST | /api/login, /api/logout | session cookie |
| GET | /api/me | user + groups visible |
| POST/GET | /api/users (admin) | buat / daftar user |
| POST | /api/users/:id/password | reset password (self/admin) |
| DELETE | /api/users/:id (admin) | hapus user (last-admin guard) |
| GET/POST | /api/groups | daftar / buat (admin) |
| PATCH/DELETE | /api/groups/:slug | ubah / hapus (admin, owner check) |
| GET | /api/g/:slug/dashboard | cron + queue + rotation + next_slot + 10 post terakhir |
| GET/POST | /api/g/:slug/pillars, /:id/toggle, PATCH /:id, DELETE /:id | CRUD pilar (edit = full-field: name, description, is_news, sort_order) |
| GET/POST | /api/g/:slug/cron | status / simpan expr+enabled |
| GET/POST | /api/g/:slug/posts, /:id, POST /:id/resend | daftar / detail (termasuk `artifacts` — nama file artefak per format) / kirim ulang |
| GET | /api/g/:slug/posts/:id/artifacts/:file | stream artefak dari MinIO (whitelist nama per format, session-auth, no-store) |
| POST | /api/g/:slug/posts/:id/approve, /:id/reject | approval gate (approve via queue; reject langsung + status guard) |
| POST | /api/g/:slug/posts/:id/rerender | re-render dengan template saat ini (konten sama; guard status + format) |
| GET | /api/g/:slug/calendar?n=7 | preview N slot berikutnya + tanggal fire cron |
| GET/POST | /api/g/:slug/overrides, /:id/cancel, DELETE /:id, GET /:id/images/:file | override content (create = multipart multi-upload; image streaming whitelist) |
| GET/POST | /api/g/:slug/plans, /:id/cancel, DELETE /:id | plans — pin spec tanggal (slot_override); override_content dibuat sistem |
| GET/POST | /api/g/:slug/styles, PATCH/DELETE /:id | CRUD style samples (edit = title, body, platform) |
| GET/POST | /api/g/:slug/templates, GET/PATCH/DELETE /:id, /:id/activate | CRUD + aktivasi template (detail termasuk html; edit = name + html, format immutable) |

Error contract: 400 `{error, issues?}` (zod), 401 unauthenticated, 404 `{error}` (unknown resource / group tak terlihat user), 500 default Hono. Group tak terlihat = 404 (bukan 403) — tidak bocor keberadaan group.

SPA fallback: route non-/api tak dikenal → `apps/web/dist/index.html`. `/api/*` tak dikenal → 404 JSON.

## 8. Code Style

- TypeScript strict, ESM, Node 22+. Server: `tsx` tanpa build step. Web: Vite build.
- Monorepo npm workspaces: `@workspace/server`, `@workspace/web`, `@workspace/shared`, `@workspace/ui`.
- Zod v4 sebagai kontrak tunggal: BE parse input, FE type-only.
- Fungsi murni untuk logika testable: rotasi, prompt builder, ffmpeg args, type guard, command parser, RSS freshness filter, flattenBody.
- FE React: function components, hooks, no react-query, lucide-react icons, @workspace/ui.
- Komentar `ponytail:` untuk penyederhanaan disengaja.
- Log terstruktur satu baris per langkah (`[ideation] topic=... tokens=...`).

## 9. Testing Strategy

- Runner `node:test` (zero dep). 43 test, all pass: state (13), bot (5), ffmpeg (7), auth/password (4), posts/flattenBody (4), rss (5) + shared schema tests.
- Unit (pure, wajib): rotasi, type guard, ffmpeg arg, prompt builder, bot parser, zod contract, RSS filter, flattenBody, password hash round-trip.
- Integration manual: `npm run migrate` → tabel + admin seed; `npm run daily --dry` → artefak MinIO; SPA di browser; bot dari HP; `scripts/test-rss.ts` live feed.
- LLM tidak di-mock; kualitas = review manusia.

## 10. Config & Secrets

Env file dibaca dari CWD process — script npm workspace jalan di `apps/server`, jadi `.env` harus di `apps/server/.env` (bukan repo root). Loader: `config.ts` (`file:.env` + `.env.local`).

```
DB_HOST=localhost DB_PORT=5432 DB_USER=... DB_PASSWORD=... DB_NAME=content_generator
MINIO_ENDPOINT=localhost MINIO_PORT=9000 MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=...
MINIO_BUCKET=content-generator MINIO_USE_SSL=false
LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=...        # fallback global
LLM_MODEL_CRITIC=...                                   # kosong = pakai LLM_MODEL
TTS_PROVIDER=edge TTS_VOICE=id-ID-ArdiNeural           # edge default, opsi openai
TTS_BASE_URL=... TTS_API_KEY=... TTS_MODEL=...
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
CG_ADMIN_PASSWORD=...                                   # seed admin saat migrate (sekali, username admin)
PORT=8787
```

Env = fallback; per-group override di tabel `groups` (llm_*, tts_*, telegram_*, cron_*). Resolusi di `groups.ts` (`toGroupCfg`).

Postgres & MinIO = service eksternal. Log tidak pernah mencetak secret. Key hanya dibaca di `config.ts` (env) dan `groups.ts` (DB).

## 11. Boundaries

**Selalu:**
- Validasi output LLM sebelum dipakai (trust boundary).
- Zod-parse semua input API (trust boundary); `:id` UUID guard.
- Query SQL selalu parameterized (template tag postgres.js; patchGroup pakai whitelist identifier).
- Fail-safe RSS (per-feed allSettled, cache TTL 30 menit); fail-loud lainnya.
- Semua state di PostgreSQL. Queue in-process + boot cleanup.

**Ask first:**
- Tambah/hapus dependensi; ubah pilar default; ubah template visual default; ubah definisi rotasi.

**Never:**
- Auto-post ke Instagram/LinkedIn (upload manual Jack).
- Retry LLM tanpa batas (maks 1 per langkah).
- Secret ke log/DB/report.
- Render reels paralel (CPU-bound — queue menjamin satu per waktu).
- Webhook Telegram (polling saja) — dan `getUpdates` wajib pass `allowed_updates=["message","callback_query"]` eksplisit: filter itu persisten per-bot di sisi Telegram; tanpa itu, filter `["message"]` lama dari consumer sebelumnya drop semua callback_query (tombol approval mati senyap — ketemu 2026-09-21).

## 12. Keputusan (locked)

1. **Generate manual (bot/FE/CLI) memajukan rotasi** — sama seperti cron. Satu sumber kebenaran.
2. **Upload style = upload template HTML visual** per format.
3. **TTS default `msedge-tts`** — gratis, voice neural Indonesia. `ponytail:` upgrade ElevenLabs.
4. ~~Bukan monorepo, tanpa React~~ → **SUPERSEDED (2026-09-20): monorepo npm workspaces + React SPA.**
5. Bot Telegram command-based, bukan natural language.
6. Reels 15–30 detik, 4–6 scene, narasi ~50–70 kata, tanpa musik.
7. Style samples selalu masuk prompt writer + critic (8 terbaru).
8. Cron in-app (node-cron) karena toggle FE; CLI `daily` tetap untuk debug.
9. **(2026-09-20) FE view-switcher state-based, bukan URL router.** `ponytail:` react-router kalau FE publik.
10. **(2026-09-21) Multi-group + auth multi-user.** Group = unit isolasi konfigurasi (LLM/TTS/Telegram/cron/pilar/rotasi). Slug reserved (`users`, `login`). ID semua UUID v7. Postgres.js tanpa ORM tetap.
11. **(2026-09-21) Pragmatic layered, bukan full Clean Architecture.** Tidak ada interface satu-impl / domain-application-infrastructure nesting. Lapisan: transport (api) → usecases → repos → adapters. `ponytail:` interface repo kalau butuh swap DB.
12. **(2026-09-21) Approval gate: render SEBELUM approval** — approve→deliver instan (tanpa tunggu render saat tombol ditekan); reject membuang render CPU, itu harga yang diterima. Approve via queue (serial), reject langsung (tanpa kerja berat). Send gagal saat approve → post TETAP `awaiting_approval` (tap approve lagi), bukan failed.
13. **(2026-09-21) Watchdog = alert-only, tidak auto-catchup.** Auto-run saat boot berisiko double-generate kalau deteksi salah; alert + `/gen` manual cukup. Dedup alert per slot in-memory (ponytail: DB-backed).
14. **(2026-09-21) Missed slot = "tidak ada post dibuat setelah fire time"** — post apa pun (cron/manual, status apa pun) menganggap slot terpenuhi; run yang gagal adalah sinyal berbeda (alert lewat jalur failure).

## 13. Upgrade Paths (ponytail ceilings)

- FE runtime zod-parse response — kalau BE jadi multi-client.
- react-router — kalau perlu URL per view.
- ElevenLabs TTS — di belakang interface `tts.ts`.
- Repo interfaces — kalau perlu swap DB/tes dengan DB lain.
- Outbox/persistent queue — kalau daemon crash sering menggigit queue in-process.

## 14. Verification (2026-09-21)

- `npm test` workspace: 63/63 pass (43 lama + 10 cronmath + 5 previewSlots + 5 parseCallback).
- Typecheck: server, shared, ui, web — semua clean. FE build (tsc -b + vite) clean.
- `npm run migrate`: 009 applied (constraint status/event baru + groups.approval_required terverifikasi via pg_constraint).
- Live E2E (daemon di Mac mini): watchdog mendeteksi missed slot 07:00 asli → alert Telegram terkirim; approval gate → post nyata `generated → rendered → awaiting_approval → rejected`, rotation TIDAK maju (updated_at tidak berubah); calendar endpoint mengembalikan siklus PRD + tanggal cron.
- **Bug fix**: `sql('kolom, kolom')` postgres.js = Identifier (bukan fragment) — break `getRotation`/`listPosts` sejak refactor e887922 (cron run gagal senyap). Fixed: kolom di-inline literal.
