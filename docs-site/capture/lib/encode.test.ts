import { describe, it, expect } from 'vitest';
import { ffmpegArgs } from './encode';

describe('ffmpegArgs', () => {
  it('reads numbered frames from framesDir at framerate 4', () => {
    const args = ffmpegArgs('/tmp/frames', 'out.mp4');
    expect(args).toContain('/tmp/frames/frame-%04d.png');
    expect(args).toEqual(expect.arrayContaining(['-framerate', '4']));
  });

  it('drops audio and writes yuv420p with faststart', () => {
    const args = ffmpegArgs('/tmp/frames', 'out.mp4');
    expect(args).toContain('-an');
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p']));
    expect(args).toEqual(expect.arrayContaining(['-movflags', '+faststart']));
  });

  it('scales to width 1280 with an even height', () => {
    const args = ffmpegArgs('/tmp/frames', 'out.mp4');
    expect(args).toEqual(expect.arrayContaining(['-vf', 'scale=1280:-2']));
  });

  it('ends with the output file path', () => {
    const args = ffmpegArgs('/tmp/frames', 'src/assets/drive/task.mp4');
    expect(args.at(-1)).toBe('src/assets/drive/task.mp4');
  });
});
