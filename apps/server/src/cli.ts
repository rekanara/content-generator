// CLI entry: npm run cli -- [--group slug] [--no-render] [--dry] [--platform X] [--format Y]
//            npm run user:add -- <username> [--admin]   (password via prompt/arg)
//            npm run user:pass -- <username>            (reset password)
import { generateDraft, resolveSlot } from './pipeline.ts';
import { getGroupCfg } from './groups.ts';
import { createUser, resetPassword, listUsers } from './auth.ts';
import { sql } from './db.ts';
import type { Platform, Format } from './state.ts';
import type { CarouselOut } from './schema.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function userCli(cmd: string): Promise<void> {
  if (cmd === 'list') {
    console.table(await listUsers());
  } else {
    const username = args[1];
    if (!username || !/^[a-z0-9_-]{2,32}$/.test(username)) {
      throw new Error('username: 2-32 char [a-z0-9_-]');
    }
    // password dari arg ke-3 atau prompt stdin (non-tty-safe: read stdin sekali)
    const readPass = async (): Promise<string> => {
      if (args[2]) return args[2];
      process.stdout.write(`password utk ${username}: `);
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString().trim();
    };
    const pass = await readPass();
    if (pass.length < 8) throw new Error('password minimal 8 karakter');
    if (cmd === 'add') {
      const u = await createUser(username, pass, flag('admin') ? 'admin' : 'user');
      console.log(`[user] dibuat: ${u.username} (${u.role})`);
    } else if (cmd === 'pass') {
      const ok = await resetPassword(username, pass);
      console.log(ok ? `[user] password ${username} diganti` : `[user] ${username} tidak ada`);
      if (!ok) process.exitCode = 1;
    } else {
      throw new Error(`subcommand tak dikenal: ${cmd}`);
    }
  }
  await sql.end();
}

async function main() {
  const sub = args[0];
  if (sub === 'user:add' || sub === 'user:pass' || sub === 'user:list') {
    await userCli(sub === 'user:add' ? 'add' : sub === 'user:pass' ? 'pass' : 'list');
    return;
  }

  const groupSlug = opt('group') ?? 'default';
  const cfg = await getGroupCfg(groupSlug);
  const platform = opt('platform') as Platform | undefined;
  const format = opt('format') as Format | undefined;

  const slot = await resolveSlot(cfg.id, platform ? { platform, format } : undefined);
  console.log(`[cli] group=${cfg.slug} slot: ${slot.platform} ${slot.format} pillar=${slot.pillar_id}`);

  const r = await generateDraft(cfg, slot, 'cli');
  console.log(`[cli] topic: ${r.topic}`);
  console.log('--- draft preview ---');
  console.log(preview(r.draft));
  console.log('--- end preview ---');

  if (flag('no-render')) {
    console.log('[cli] no-render: berhenti di draft, tidak update rotasi.');
    await sql.end();
    return;
  }

  // --dry: render + upload artefak, tapi tidak kirim telegram + tidak update rotasi
  if (flag('dry')) {
    if (slot.format === 'carousel' || slot.format === 'pdf') {
      const { renderAndSave } = await import('./render/carousel.ts');
      const a = await renderAndSave(r.postId, slot.platform, r.draft as CarouselOut, cfg.slug, cfg.id);
      console.log(`[cli] dry: ${a.files.length} artefak di ${a.prefix} (MinIO) + lokal out/${r.postId}/`);
    } else if (slot.format === 'reels') {
      const { renderReelsAndSave } = await import('./render/reels.ts');
      const a = await renderReelsAndSave(r.postId, r.draft as import('./schema.ts').ReelsOut, cfg);
      console.log(`[cli] dry: reel ${a.durationSec.toFixed(1)}s di ${a.prefix}`);
    } else {
      console.log('[cli] dry: format text tidak butuh render.');
    }
    console.log('[cli] dry: tidak kirim, tidak update rotasi.');
    await sql.end();
    return;
  }
  console.log('[cli] kirim via queue daemon / telegram — CLI berhenti di draft.');
  await sql.end();
}

function preview(d: unknown): string {
  if (d && typeof d === 'object' && 'slides' in d) {
    const c = d as { caption: string; slides: { headline: string; body: string }[] };
    return c.slides.map((s, i) => `Slide ${i + 1}: ${s.headline}\n  ${s.body}`).join('\n') +
      `\n\nCAPTION:\n${c.caption}`;
  }
  if (d && typeof d === 'object' && 'scenes' in d) {
    const r = d as { caption: string; scenes: { overlay_text: string; narration: string }[] };
    return r.scenes.map((s, i) => `Scene ${i + 1}: [${s.overlay_text}]\n  ${s.narration}`).join('\n') +
      `\n\nCAPTION:\n${r.caption}`;
  }
  return String((d as { body: string }).body);
}

main().catch((e) => { console.error(e); process.exit(1); });
