Content generator

aku mau buat sistem content-generator dengan LLM openai compatible. detailnya:

- Membuat konten otomatis untuk di instagram dan linkedin
- Konten instagram bisa berubah carousel atau reels beserta caption
- Konten di linkedin berupa carousel juga tp sudah di dijadikan pdf beserta caption
- Waktu generate bergantian, misal hari ini untuk instragram artinya besok untuk linkedin

* Render Reels (MoneyPrinterTurbo + ffmpeg): CPU-bound, kira-kira semenit lebih per video. Di Mac mini tetap aman, cukup dijadwalkan pagi-pagi.
* Render carousel (Puppeteer/Chromium): hanya beberapa detik.
* Pola bergantian
* Simpan state kecil (file JSON atau SQLite) berisi platform terakhir yang digenerate, lalu rotasi dari sana. Jangan pakai genap/ganjil tanggal, karena hari yang terlewat akan merusak pola. Contoh:
  Hari Platform Format
  1 LinkedIn teks post
  2 Instagram carousel
  3 LinkedIn teks post
  4 Instagram Reels
  Format Instagram bergantian sendiri antara carousel dan Reels. Cron jalan tiap pagi, hasilnya masuk Telegram, lalu kamu upload.
* Agen dan konten
* Sebenarnya ini satu pipeline dengan beberapa "peran", bukan agen yang berdiri sendiri:
* Ideation: memilih topik dari pilar konten dan mencegah pengulangan (simpan riwayat topik).
* Writer LinkedIn: storytelling, insight, ajakan diskusi.
* Writer Instagram: hook tajam, slide pendek, atau script Reels.
* Renderer + pengirim Telegram.
* Supaya topiknya relate dengan keseharian developer, buat 4-5 pilar dan putar bergantian:
* Keseharian dan drama developer (debugging, code review, estimasi, permintaan klien)
* AI dalam workflow (coding agent, prompting, kesalahan umum)
* Tips dan tools praktis
* Pengalaman freelance dan klien
* Berita tech yang diterjemahkan jadi "artinya buat developer apa"
* Untuk pilar terakhir, ambil bahan dari RSS (Hacker News, dev.to, blog resmi vendor) lalu minta LLM menulis sudut pandangnya. Tanpa input segar, model lokal cenderung mengulang topik generik atau info yang sudah basi.
* Kualitas hasil
* Kualitas tulisan Indonesia dari model lokal ukuran menengah sering kaku. Beberapa cara memperbaikinya:
* Simpan 5-10 postingan lamamu sebagai contoh gaya di prompt.
* Buat aturan tegas: tanpa klise ("di era digital ini..."), tanpa emoji berlebihan, dan hook harus spesifik.
* Tambahkan satu langkah "kritik + revisi" dari LLM yang sama sebelum dikirim.

-
