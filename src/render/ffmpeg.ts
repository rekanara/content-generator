// Pure arg builder ffmpeg/ffprobe — unit-test tanpa spawn.
export type SegmentArgs = string[];

/** ffprobe -v error -show_entries format=duration -of csv=p=0 <file> */
export function ffprobeDurationArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file];
}

/** Segmen: frame PNG + audio MP3 → MP4 1080x1920 h264 yuv420p, durasi ikut audio. */
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

/** Concat demuxer: daftar segmen → MP4 final (stream copy, tanpa re-encode). */
export function concatArgs(listFile: string, out: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out];
}
