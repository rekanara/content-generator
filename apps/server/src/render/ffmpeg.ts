// Pure arg builder for ffmpeg/ffprobe — unit-testable without spawning.
export type SegmentArgs = string[];

/** ffprobe -v error -show_entries format=duration -of csv=p=0 <file> */
export function ffprobeDurationArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file];
}

/** Segment: PNG frame + MP3 audio → MP4 1080x1920 h264 yuv420p, duration follows audio. */
export function segmentArgs(png: string, mp3: string, durationSec: number, out: string): string[] {
  return [
    '-y',
    '-loop', '1',
    '-i', png,
    '-i', mp3,
    '-t', durationSec.toFixed(3),
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264',
    '-tune', 'stillimage',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-shortest',
    '-r', '30',
    '-movflags', '+faststart',
    out,
  ];
}

/** Concat demuxer: segment list → final MP4 (stream copy, no re-encode). */
export function concatArgs(listFile: string, out: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out];
}

/** Concat scene MP3s into one narration track (re-encode → clean timestamps across files). */
export function audioConcatArgs(listFile: string, out: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'aac', '-b:a', '128k', out];
}

/** Silent Remotion video + narration → final MP4. Video stream copied; ends with the shorter stream. */
export function muxArgs(video: string, audio: string, out: string): string[] {
  return ['-y', '-i', video, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out];
}

export type MixCue = { atSec: number; file: string; volume: number };

/** Narration + SFX cues → one m4a. Each cue delayed to its timestamp, narration stays full level. */
export function sfxMixArgs(narration: string, cues: MixCue[], out: string): string[] {
  if (cues.length === 0) return ['-y', '-i', narration, '-c:a', 'copy', out];
  const inputs = cues.flatMap((c) => ['-i', c.file]);
  const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.atSec * 1000)}|${Math.round(c.atSec * 1000)},volume=${c.volume}[s${i}]`);
  const labels = ['[0:a]', ...cues.map((_, i) => `[s${i}]`)].join('');
  const filter = `${delays.join(';')};${labels}amix=inputs=${cues.length + 1}:duration=first:dropout_transition=0:normalize=0[a]`;
  return ['-y', '-i', narration, ...inputs, '-filter_complex', filter, '-map', '[a]', '-c:a', 'aac', '-b:a', '160k', out];
}

/** Promo video track: optional narration + SFX cues + looped BGM ducked under, trimmed to the video length. */
export function promoAudioArgs(p: { narration?: string; durationSec: number; cues: MixCue[]; bgm?: string; bgmVolume?: number; out: string }): string[] {
  const dur = p.durationSec.toFixed(3);
  const args: string[] = ['-y'];
  const labels: string[] = [];
  const filters: string[] = [];
  let n = 0;
  if (p.narration) { args.push('-i', p.narration); labels.push(`[${n}:a]`); n++; }
  else { args.push('-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=44100:cl=stereo'); labels.push(`[${n}:a]`); n++; }
  for (const c of p.cues) {
    const ms = Math.round(c.atSec * 1000);
    args.push('-i', c.file);
    filters.push(`[${n}:a]adelay=${ms}|${ms},volume=${c.volume}[s${n}]`);
    labels.push(`[s${n}]`);
    n++;
  }
  if (p.bgm) {
    args.push('-stream_loop', '-1', '-i', p.bgm);
    const fade = Math.max(0.1, Math.min(1.2, p.durationSec / 4));
    filters.push(`[${n}:a]atrim=0:${dur},asetpts=N/SR/TB,volume=${p.bgmVolume ?? 0.22},afade=t=in:d=0.8,afade=t=out:st=${Math.max(0, p.durationSec - fade).toFixed(3)}:d=${fade.toFixed(3)}[bgm]`);
    labels.push('[bgm]');
    n++;
  }
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0,atrim=0:${dur}[a]`);
  return [...args, '-filter_complex', filters.join(';'), '-map', '[a]', '-t', dur, '-c:a', 'aac', '-b:a', '160k', p.out];
}
