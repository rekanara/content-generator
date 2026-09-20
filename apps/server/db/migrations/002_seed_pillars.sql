-- 002: seed default content pillars (5 pillars from PRD) — content intentionally Indonesian
insert into pillars (name, description, is_news, sort_order) values
  ('Drama keseharian developer',
   'Cerita dan drama sehari-hari developer: debugging berjam-jam, code review yang bikin mood naik-turun, estimasi yang meleset, permintaan klien yang berubah-ubah, meeting yang bisa jadi email.',
   false, 1),
  ('AI dalam workflow',
   'Pengalaman nyata memakai AI untuk kerjaan coding: coding agent, teknik prompting yang benar-benar dipakai, kesalahan umum orang saat pakai AI, kapan AI membantu dan kapan merepotkan.',
   false, 2),
  ('Tips dan tools praktis',
   'Tips konkret dan tools yang langsung bisa dipakai developer: CLI, library, workflow, shortcut, trik debugging. Harus actionable, bukan teori.',
   false, 3),
  ('Freelance dan klien',
   'Pengalaman freelance: menangani klien, negosiasi harga, scope creep, pembayaran, kontrak, keseimbangan kerja. Berdasarkan pengalaman nyata.',
   false, 4),
  ('Berita tech untuk developer',
   'Berita tech terbaru diterjemahkan jadi "artinya buat developer apa". Ambil bahan dari RSS yang diberikan, tulis sudut pandang praktis untuk developer Indonesia.',
   true, 5)
on conflict (name) do nothing;

insert into rotation_state (id, last_platform, last_ig_format, last_li_format, last_pillar_id)
values (true, 'linkedin', 'reels', 'text', null)
on conflict (id) do nothing;
-- Seed: next run = instagram carousel, pillar sort_order 1.
