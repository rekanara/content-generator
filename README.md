# content-generator

Daemon yang otomatis menghasilkan **satu konten per hari per group** untuk audiens developer (bahasa Indonesia) — Instagram (carousel / reels dengan voiceover) atau LinkedIn (PDF / teks), bergilir otomatis. Hasil dikirim ke chat Telegram untuk di-upload manual. Bukan auto-posting, bukan multi-agent.

Satu process: HTTP API + SPA admin + scheduler cron per group + bot Telegram (polling) + queue FIFO + pipeline (ideation → writer → critic → render → send).

Detail lengkap: [SPEC.md](SPEC.md) · Brief untuk AI agent: [AGENTS.md](AGENTS.md)

## Fitur utama

- **Rotasi otomatis** — platform IG ↔ LinkedIn, format bergilir per platform (carousel ↔ reels, PDF ↔ teks), pilar topik round-robin. Hari terlewat tidak merusak pola (state-based).
- **Multi-group, multi-user** — tiap group punya config sendiri (LLM, TTS, Telegram, cron, pilar, template) + auth session (admin / user biasa).
- **Approval gate (opsional per group)** — post berhenti di `awaiting_approval` sebelum dikirim; approve/reject via tombol inline di Telegram atau dari web.
- **Watchdog** — slot cron yang terlewat (daemon mati, run tak jalan) → alert ke Telegram saat boot + heartbeat tiap 6 jam. Run gagal juga alert — tidak ada failure senyap.
- **Calendar preview** — lihat N slot ke depan (platform/format/pilar + jadwalnya) tanpa menjalankan pipeline.
- **Audit trail** — semua peristiwa per post tersimpan (`post_events`).
- Konten berita tech dari RSS segar (Hacker News, dev.to) dengan fallback aman kalau feed mati.

## Requirements

- Node ≥ 20
- PostgreSQL 16+
- MinIO (artefact PNG/PDF/MP4)
- LLM API (OpenAI-compatible — base URL + API key bebas, mis. OpenRouter)
- Telegram bot token + chat ID

## Setup

```bash
npm install

# env dibaca dari CWD apps/server (script npm workspace jalan di situ)
cp .env.example apps/server/.env
# isi: DB_*, MINIO_*, LLM_*, TELEGRAM_* — lihat file untuk daftar lengkap

# terapkan migrasi SQL + seed user admin
npm run migrate
```

Seeding admin: hanya jalan kalau tabel `users` kosong. Username `admin`, password dari `CG_ADMIN_PASSWORD` di env — kalau tidak diisi, password random dibuat dan **dicetak sekali** di console saat migrate.

MinIO: bucket default `content-generator` (buat manual atau lewat console MinIO).

## Menjalankan

```bash
# build SPA dulu (daemon menyajikan apps/web/dist — wajib sebelum serve)
npm run build            # dari root (turbo) atau di apps/web

# jalankan daemon (API :8787 + cron + bot polling + queue)
npm run serve
```

Buka `http://localhost:8787` → login → admin SPA.

Catatan frontend: **tidak ada Vite dev proxy.** `npm run dev` (Vite :5173) akan gagal semua panggilan API — loop pengembangan FE adalah `npm run build` (web) → refresh halaman. Health check daemon: `GET /health` (tanpa auth).

## Perintah harian

| Perintah | Fungsi |
|---|---|
| `npm run migrate` | Migrasi SQL pending + seed admin |
| `npm run serve` | Jalankan daemon |
| `npm test` | Test unit (server, zero-dep `node:test`) |
| `npm run typecheck` | Typecheck semua workspace (turbo) |
| `npm run lint` | Lint (web + ui; ada 2 error pre-existing di packages/ui, shadcn pattern) |

CLI di `apps/server`:

| Perintah | Fungsi |
|---|---|
| `npm run daily -- [--group slug] [--dry\|--no-render] [--platform X] [--format Y]` | Satu run pipeline. `--no-render` berhenti di draft; `--dry` render + upload MinIO tapi **tidak** kirim Telegram & tidak majukan rotasi |
| `npm run user:add -- <name> [--admin]` | Buat user (password via arg/stdin) |
| `npm run user:pass -- <name>` | Reset password + revoke semua session |
| `npm run user:list` | Daftar user |

## Bot Telegram

Chat langsung dengan bot (token dari env global). Bot polling — tidak perlu public URL/webhook.

```
/gen [group] [platform] [format]   — generate manual (tanpa arg = group pertama, rotasi natural)
/status [group]                    — jadwal, posisi rotasi, post terakhir
/help                              — bantuan
```

Kalau group mengaktifkan approval gate, hasil generate dikirim dengan tombol **Approve / Reject** — approve = kirim sekarang + rotasi maju, reject = dibuang tanpa mengonsumsi rotasi.

## Struktur

```
apps/server        daemon — Hono API, postgres.js, cron, bot, queue, pipeline, render (Puppeteer + ffmpeg)
apps/web           SPA admin — React 19 + Vite (state-based view switcher, tanpa router URL)
packages/shared    kontrak FE↔BE tunggal (zod v4)
packages/ui        komponen (tailwind v4 + shadcn-style)
```

Aturan arsitektur ketat (layering, SQL parameterized, zod di boundary, PK UUID v7) — lihat [AGENTS.md](AGENTS.md) sebelum kontribusi.

Menambah komponen shadcn (dari root, repo ini npm bukan pnpm):

```bash
npx shadcn@latest add <name> -c apps/web
```

Komponen mendarat di `packages/ui/src/components`, di-import sebagai `@workspace/ui/components/<name>`.
