// Prompt builder — pure functions, unit-testable. Bahasa Indonesia.
import type { Format, Platform } from './state.ts';
import type { Slide, Scene } from './schema.ts';

type Msg = { role: 'system' | 'user'; content: string };

export type StyleSample = { title: string; body: string; platform: string | null };
export type PillarFull = { id: string; name: string; description: string; is_news: boolean };

const R = 'Balas HANYA dengan JSON valid tanpa penjelasan apa pun di luar JSON.';

function styleBlock(samples: StyleSample[]): string {
  if (samples.length === 0) return 'Belum ada contoh gaya — tulis natural seperti developer yang share pengalaman.';
  return samples
    .map((s, i) => `Contoh ${i + 1}:\n${s.title}\n${s.body}`)
    .join('\n\n')
    .slice(0, 6000);
}

function rules(): string {
  return `ATURAN KETAT (pelanggaran = ditolak):
- Dilarang klise: "di era digital ini", "di dunia yang serba cepat", "tidak bisa dipungkiri", "game changer", "skyrocket".
- Hook baris pertama harus spesifik (angka, momen konkret, atau pertanyaan tajam) — dilarang hook generik.
- Emoji maksimal 2 di seluruh caption, LinkedIn idealnya tanpa emoji.
- Bahasa Indonesia santai tapi cerdas — seperti developer ngobrol, bukan korporat, bukan baku kaku.
- No fluff: setiap kalimat membawa informasi.`;
}

export function ideationPrompt(p: PillarFull, history: string[], newsContext: string | null): Msg[] {
  const hist = history.length
    ? `Topik yang SUDAH pernah dipakai (JANGAN mirip ini):\n${history.map((h) => `- ${h}`).join('\n')}`
    : 'Belum ada riwayat topik.';
  const news = newsContext
    ? `Bahan berita segar (pilih satu sebagai basis, tulis sudut pandang "artinya buat developer apa"):\n${newsContext}`
    : '';
  return [
    {
      role: 'system',
      content: `Kamu strategist konten developer Indonesia. Pilih satu topik spesifik dan sudut pandang (angle) yang belum pernah dipakai. ${R}`,
    },
    {
      role: 'user',
      content: `Pilar konten: ${p.name}
Deskripsi pilar: ${p.description}
${hist}
${news}
Output JSON: {"topic": "<topik 5-10 kata>", "angle": "<sudut pandang 1-2 kalimat, kenapa menarik>"}`,
    },
  ];
}

export function writerPrompt(
  platform: Platform,
  format: Format,
  topic: string,
  angle: string,
  pillarName: string,
  samples: StyleSample[],
): Msg[] {
  const plat =
    platform === 'instagram'
      ? 'Instagram (audiens developer Indonesia, scroll cepat)'
      : 'LinkedIn (audiens profesional tech, lebih tenang)';

  const fmt = {
    carousel: `Carousel ${platform === 'instagram' ? 'IG 5-8 slide' : 'LinkedIn 6-10 halaman'}. Slide 1 = hook. Slide terakhir = CTA ringan.
JSON: {"caption": string, "slides": [{"headline": "<maks 8 kata>", "body": "<maks 25 kata"}]}
headline: pemecah scroll, kontras pendek. body: satu ide per slide, kalimat pendek.`,
    reels: `Reels 15-30 detik, 4-6 scene, total narasi MAKSIMAL 55 kata (kecepatan bicara Indonesia ±2 kata/detik — lebih dari itu durasi meledak). Setiap narration MAKSIMAL 12 kata. Scene 1 = hook 5 detik. Scene terakhir = CTA.
JSON: {"caption": string, "scenes": [{"overlay_text": "<maks 10 kata, teks besar di layar>", "narration": "<1-2 kalimat diucapkan, bahasa lisan>"}]}
narration: bahasa bicara natural, bukan bahasa tulis. overlay_text: frasa pendek, bukan kalimat penuh.`,
    pdf: `Carousel LinkedIn jadi PDF 6-10 halaman. Halaman 1 = hook. Halaman terakhir = CTA/ajakan diskusi.
JSON: {"caption": string, "slides": [{"headline": "<maks 8 kata>", "body": "<maks 25 kata"}]}`,
    text: `Post teks LinkedIn. 150-250 kata. Hook 2 baris pertama harus menahan jempol. Struktur: hook → cerita/insight → refleksi → pertanyaan penutup untuk diskusi.
JSON: {"body": string}`,
  }[format]!;

  return [
    {
      role: 'system',
      content: `Kamu ghostwriter konten developer Indonesia untuk ${plat}. Tulis ${format} tentang topik yang diberikan. ${R}`,
    },
    {
      role: 'user',
      content: `Topik: ${topic}
Angle: ${angle}
Pilar: ${pillarName}

Format:
${fmt}

${rules()}

Contoh gaya penulisan (tiru rasa dan ritmenya, JANGAN tiru topiknya):
${styleBlock(samples)}`,
    },
  ];
}

export function criticPrompt(
  platform: Platform,
  format: Format,
  draft: unknown,
): Msg[] {
  const back = (f: Format): string => {
    if (f === 'reels') {
      const r = draft as { caption: string; scenes: Scene[] };
      return JSON.stringify(r);
    }
    if (f === 'text') {
      return JSON.stringify(draft as { body: string });
    }
    const c = draft as { caption: string; slides: Slide[] };
    return JSON.stringify(c);
  };
  return [
    {
      role: 'system',
      content: `Kamu editor kejam. Revisi draft konten sampai layak publish. Perbaiki: hook lemah, klise, emoji berlebihan, kalimat fluff, struktur berantakan. Pertahankan topik dan struktur format. ${R}`,
    },
    {
      role: 'user',
      content: `Platform: ${platform}, format: ${format}. ${rules()}${
        format === 'reels' ? '\nWAJIB: total narasi MAKSIMAL 55 kata, per scene maksimal 12 kata (durasi TTS 15-30 detik).' : ''
      }

Draft:
${back(format)}

Kembalikan JSON dengan struktur YANG SAMA persis (kunci dan jumlah slide/scene boleh berubah jika memperbaiki), hasil revisi final siap publish.`,
    },
  ];
}
