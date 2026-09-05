// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error The runner is a native ESM executable.
import { assertGeneratedVideoAudio, requiresGeneratedVideoAudio } from '../../runner/index.mjs';

describe('normal video sound requirement', () => {
  it('requires audio even for speech-free video, but leaves extension audio policy to its existing processor', () => {
    const job = { modality: 'video', settingsStamp: { videoSpeech: { mode: 'no-speech' } } };
    expect(requiresGeneratedVideoAudio(job)).toBe(true);
    for (const audioMode of ['mute', 'keep-source', 'new-sound']) {
      expect(requiresGeneratedVideoAudio({ ...job, settingsStamp: {
        ...job.settingsStamp, videoOperation: { kind: 'extend', audioMode },
      } })).toBe(false);
    }
    expect(requiresGeneratedVideoAudio({ modality: 'video', settingsStamp: {} })).toBe(false);
    expect(requiresGeneratedVideoAudio({ ...job, modality: 'image' })).toBe(false);
  });
});

describe('decoded generated video audio', () => {
  let directory = '';
  const clips = new Map<string, Buffer>();

  beforeAll(async () => {
    if (!ffmpegPath) throw new Error('Required bundled ffmpeg is unavailable');
    directory = await mkdtemp(join(tmpdir(), 'creative-studio-audio-gate-test-'));
    for (const [name, audio] of [
      ['missing', null],
      ['silent', 'anullsrc=r=48000:cl=stereo'],
      ['quiet', 'sine=frequency=400:sample_rate=48000,volume=0.025'],
    ] as const) {
      const path = join(directory, `${name}.mp4`);
      const args = ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=12'];
      if (audio) args.push('-f', 'lavfi', '-i', audio);
      args.push('-t', '0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
      if (audio) args.push('-c:a', 'aac');
      args.push('-y', path);
      const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
      clips.set(name, await readFile(path));
    }
  }, 30_000);

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each(['missing', 'silent'])('rejects %s audio with the normal-video error', async (name) => {
    await expect(assertGeneratedVideoAudio(clips.get(name), 'video/mp4', 'video_generated_audio_missing'))
      .rejects.toThrow('video_generated_audio_missing');
  });

  it('accepts a quiet decoded track without demanding a loud mix', async () => {
    await expect(assertGeneratedVideoAudio(clips.get('quiet'), 'video/mp4', 'video_generated_audio_missing'))
      .resolves.toBeUndefined();
  });

  it('preserves the existing extension-specific missing-audio error', async () => {
    await expect(assertGeneratedVideoAudio(clips.get('silent'), 'video/mp4'))
      .rejects.toThrow('video_extension_generated_audio_missing');
  });
});
