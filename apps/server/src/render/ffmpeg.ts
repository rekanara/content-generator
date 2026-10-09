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
