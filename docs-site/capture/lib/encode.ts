import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

export function ffmpegArgs(framesDir: string, outFile: string): readonly string[] {
  return [
    '-y',
    '-framerate',
    '4',
    '-i',
    join(framesDir, 'frame-%04d.png'),
    '-an',
    '-vf',
    'scale=1280:-2',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outFile,
  ];
}

export async function encodeFrames(framesDir: string, outFile: string): Promise<void> {
  await mkdir(dirname(outFile), { recursive: true });
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs(framesDir, outFile));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}
