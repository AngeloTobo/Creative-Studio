// @vitest-environment node

import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// The Local Runner is intentionally plain ESM so Windows can launch it directly with Node.
// @ts-expect-error TypeScript does not emit declarations for the runtime-only runner module.
import { assertGeneratedVideoAudio, combineVideoExtension } from "../../runner/index.mjs";

const describeWithFfmpeg = ffmpegPath ? describe : describe.skip;

describeWithFfmpeg("runner video extension sound", () => {
  let directory = "";

  const ffmpeg = (args: string[]) => {
    const result = spawnSync(ffmpegPath!, args, { encoding: "buffer" });
    if (result.status !== 0) throw new Error(String(result.stderr));
    return result.stdout;
  };

  const createVideo = (path: string, color: string, frequency?: number, audioDuration = 0.8, shortest = true) => {
    const args = ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=64x64:d=0.8:r=12`];
    if (frequency) {
      args.push("-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${audioDuration}`);
      if (shortest) args.push("-shortest");
    }
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
    if (frequency) args.push("-c:a", "aac");
    args.push("-movflags", "+faststart", "-y", path);
    ffmpeg(args);
  };

  const windowRms = (path: string, start: number, duration = 0.2) => {
    const pcm = ffmpeg([
      "-hide_banner", "-loglevel", "error", "-ss", String(start), "-i", path,
      "-t", String(duration), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-",
    ]);
    if (pcm.byteLength < 2) return 0;
    let sum = 0;
    const samples = Math.floor(pcm.byteLength / 2);
    for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
      const value = pcm.readInt16LE(offset);
      sum += value * value;
    }
    return Math.sqrt(sum / samples);
  };

  const windowFrequency = (path: string, start: number, duration = 0.2) => {
    const sampleRate = 16_000;
    const pcm = ffmpeg([
      "-hide_banner", "-loglevel", "error", "-ss", String(start), "-i", path,
      "-t", String(duration), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-",
    ]);
    let positiveCrossings = 0;
    let previous = pcm.byteLength >= 2 ? pcm.readInt16LE(0) : 0;
    for (let offset = 2; offset + 1 < pcm.byteLength; offset += 2) {
      const current = pcm.readInt16LE(offset);
      if (previous <= 0 && current > 0) positiveCrossings += 1;
      previous = current;
    }
    const measuredSeconds = pcm.byteLength / 2 / sampleRate;
    return measuredSeconds > 0 ? positiveCrossings / measuredSeconds : 0;
  };

  const mediaDuration = (path: string) => {
    const result = spawnSync(ffmpegPath!, ["-hide_banner", "-i", path], { encoding: "utf8" });
    const match = String(result.stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) throw new Error(`duration unavailable for ${path}`);
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "creative-studio-extension-test-"));
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps source sound and newly generated continuation sound across cuts and dissolves", async () => {
    const sourcePath = join(directory, "source-audio.mp4");
    const continuationPath = join(directory, "continuation-audio.mp4");
    createVideo(sourcePath, "red", 440);
    createVideo(continuationPath, "blue", 880);
    const [source, continuation] = await Promise.all([readFile(sourcePath), readFile(continuationPath)]);

    for (const transitionSeconds of [0, 0.25] as const) {
      const output = await combineVideoExtension(source, "video/mp4", continuation, "video/mp4", {
        kind: "extend", sourceId: "source", source: "artifact", sourceFrame: "last",
        outputMode: "combined", transitionSeconds, audioMode: "new-sound",
      });
      const outputPath = join(directory, `joined-${transitionSeconds}.mp4`);
      await writeFile(outputPath, output.bytes);
      expect(windowRms(outputPath, 0.15)).toBeGreaterThan(100);
      expect(windowRms(outputPath, transitionSeconds ? 0.9 : 1.0)).toBeGreaterThan(100);
      expect(windowFrequency(outputPath, 0.15)).toBeGreaterThan(400);
      expect(windowFrequency(outputPath, 0.15)).toBeLessThan(480);
      expect(windowFrequency(outputPath, transitionSeconds ? 0.9 : 1.0)).toBeGreaterThan(820);
      expect(windowFrequency(outputPath, transitionSeconds ? 0.9 : 1.0)).toBeLessThan(940);
      const expectedDuration = mediaDuration(sourcePath) + mediaDuration(continuationPath) - transitionSeconds;
      expect(Math.abs(mediaDuration(outputPath) - expectedDuration)).toBeLessThan(0.12);
    }
  }, 20_000);

  it("uses video-stream duration when source audio outlasts its picture", async () => {
    const sourcePath = join(directory, "long-source-audio.mp4");
    const continuationPath = join(directory, "long-source-continuation.mp4");
    createVideo(sourcePath, "yellow", 440, 1.4, false);
    createVideo(continuationPath, "blue", 880);
    expect(mediaDuration(sourcePath)).toBeGreaterThan(1.3);

    const output = await combineVideoExtension(
      await readFile(sourcePath), "video/mp4", await readFile(continuationPath), "video/mp4",
      {
        kind: "extend", sourceId: "source", source: "artifact", sourceFrame: "last",
        outputMode: "combined", transitionSeconds: 0.25, audioMode: "new-sound",
      },
    );
    const outputPath = join(directory, "long-source-audio-joined.mp4");
    await writeFile(outputPath, output.bytes);
    expect(mediaDuration(outputPath)).toBeGreaterThan(1.25);
    expect(mediaDuration(outputPath)).toBeLessThan(1.6);
    expect(windowFrequency(outputPath, 0.15)).toBeGreaterThan(400);
    expect(windowFrequency(outputPath, 0.9)).toBeGreaterThan(820);
  }, 20_000);

  it("aligns new continuation sound after a silent source and rejects a silent continuation", async () => {
    const silentSourcePath = join(directory, "silent-source.mp4");
    const continuationPath = join(directory, "audible-continuation.mp4");
    const silentContinuationPath = join(directory, "silent-continuation.mp4");
    createVideo(silentSourcePath, "green");
    createVideo(continuationPath, "purple", 660);
    createVideo(silentContinuationPath, "black");
    const [silentSource, continuation, silentContinuation] = await Promise.all([
      readFile(silentSourcePath), readFile(continuationPath), readFile(silentContinuationPath),
    ]);

    const output = await combineVideoExtension(silentSource, "video/mp4", continuation, "video/mp4", {
      kind: "extend", sourceId: "source", source: "artifact", sourceFrame: "last",
      outputMode: "combined", transitionSeconds: 0.25, audioMode: "new-sound",
    });
    const outputPath = join(directory, "silent-source-joined.mp4");
    await writeFile(outputPath, output.bytes);
    expect(windowRms(outputPath, 0.2)).toBeLessThan(20);
    expect(windowRms(outputPath, 0.9)).toBeGreaterThan(100);

    await expect(combineVideoExtension(silentSource, "video/mp4", silentContinuation, "video/mp4", {
      kind: "extend", sourceId: "source", source: "artifact", sourceFrame: "last",
      outputMode: "combined", transitionSeconds: 0, audioMode: "new-sound",
    })).rejects.toThrow("video_extension_generated_audio_missing");
    await expect(assertGeneratedVideoAudio(silentContinuation, "video/mp4"))
      .rejects.toThrow("video_extension_generated_audio_missing");
    await expect(assertGeneratedVideoAudio(continuation, "video/mp4")).resolves.toBeUndefined();
  }, 20_000);

  it("preserves the legacy source-audio-only policy", async () => {
    const sourcePath = join(directory, "legacy-source.mp4");
    const continuationPath = join(directory, "legacy-continuation.mp4");
    createVideo(sourcePath, "orange", 440);
    createVideo(continuationPath, "navy", 880);
    const output = await combineVideoExtension(
      await readFile(sourcePath), "video/mp4", await readFile(continuationPath), "video/mp4",
      {
        kind: "extend", sourceId: "source", source: "artifact", sourceFrame: "last",
        outputMode: "combined", transitionSeconds: 0, audioMode: "keep-source",
      },
    );
    const outputPath = join(directory, "legacy-joined.mp4");
    await writeFile(outputPath, output.bytes);
    expect(windowRms(outputPath, 0.15)).toBeGreaterThan(100);
    expect(windowRms(outputPath, 1.0)).toBeLessThan(20);
  }, 20_000);
});
