import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import FFT from "fft.js";
import ffmpegPath from "ffmpeg-static";
import { parseBuffer } from "music-metadata";
import sharp from "sharp";

export const TRAINING_ANALYSIS_SCHEMA_VERSION = "creative-dna-training-analysis/1.0";
export const DIMENSION_KEYS = ["energy", "tension", "contrast", "warmth", "spaciousness", "rhythmicity", "organicity", "polish"];

const clamp = (value, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));
const rounded = (value, digits = 1) => Number(Number(value).toFixed(digits));
const score = (value) => Math.round(clamp(value));

function extension(name, mimeType, kind) {
  const candidate = extname(String(name || "")).toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(candidate)) return candidate;
  const byMime = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/flac": ".flac", "audio/ogg": ".ogg",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  };
  return byMime[mimeType] || (kind === "image" ? ".png" : kind === "audio" ? ".wav" : ".mp4");
}

async function runFfmpeg(args, options = {}) {
  if (!ffmpegPath) throw new Error("training_ffmpeg_unavailable");
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > (options.maxOutputBytes || 4_000_000)) child.kill();
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(`training_ffmpeg_failed:${signal || code}:${Buffer.concat(stderr).toString("utf8").slice(0, 240)}`));
    });
  });
}

function rgbMeasurements(raw, channels) {
  let red = 0;
  let green = 0;
  let blue = 0;
  let luma = 0;
  let lumaSquared = 0;
  let saturation = 0;
  const pixels = Math.floor(raw.length / channels);
  for (let index = 0; index < raw.length; index += channels) {
    const r = raw[index] / 255;
    const g = raw[index + 1] / 255;
    const b = raw[index + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    red += r;
    green += g;
    blue += b;
    luma += y;
    lumaSquared += y * y;
    const maximum = Math.max(r, g, b);
    saturation += maximum === 0 ? 0 : (maximum - Math.min(r, g, b)) / maximum;
  }
  const brightness = luma / pixels;
  return {
    red: red / pixels,
    green: green / pixels,
    blue: blue / pixels,
    brightness,
    contrast: Math.sqrt(Math.max(0, lumaSquared / pixels - brightness * brightness)),
    saturation: saturation / pixels,
  };
}

export async function analyzeImage(buffer, label = "Image") {
  const source = sharp(buffer, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) throw new Error("training_image_dimensions_missing");
  const [{ data, info }, statistics] = await Promise.all([
    source.clone().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    source.clone().stats(),
  ]);
  const rgb = rgbMeasurements(data, info.channels);
  const aspectRatio = metadata.width / metadata.height;
  const brightness = rgb.brightness * 100;
  const saturation = rgb.saturation * 100;
  const tonalContrast = clamp(rgb.contrast * 360);
  const warmth = clamp(50 + (rgb.red - rgb.blue) * 135);
  const sharpness = clamp(Number(statistics.sharpness || 0) * 22);
  const entropy = clamp(Number(statistics.entropy || 0) / 8 * 100);
  const dimensions = {
    energy: score(0.42 * saturation + 0.38 * tonalContrast + 0.2 * brightness),
    tension: score(0.58 * tonalContrast + 0.24 * sharpness + 0.18 * (100 - warmth)),
    contrast: score(tonalContrast),
    warmth: score(warmth),
    spaciousness: score(42 + Math.min(26, Math.abs(Math.log2(aspectRatio)) * 24) + (100 - tonalContrast) * 0.18),
    rhythmicity: score(0.52 * sharpness + 0.48 * entropy),
    organicity: score(0.42 * warmth + 0.34 * saturation + 0.24 * (100 - sharpness)),
    polish: score(0.48 * sharpness + 0.32 * entropy + 0.2 * (100 - Math.abs(55 - brightness))),
  };
  return {
    observations: [
      `${label} is ${metadata.width} by ${metadata.height} with a ${rounded(aspectRatio, 2)} aspect ratio.`,
      `Measured luminance is ${rounded(brightness)}%, saturation ${rounded(saturation)}%, and tonal contrast ${rounded(tonalContrast)}%.`,
      `Pixel analysis indicates ${warmth >= 55 ? "a warm" : warmth <= 45 ? "a cool" : "a balanced"} palette and ${sharpness >= 60 ? "crisp" : sharpness <= 35 ? "soft" : "moderate"} edge definition.`,
    ],
    metrics: {
      width: metadata.width,
      height: metadata.height,
      aspectRatio: rounded(aspectRatio, 3),
      brightness: rounded(brightness),
      saturation: rounded(saturation),
      tonalContrast: rounded(tonalContrast),
      warmth: rounded(warmth),
      entropy: rounded(statistics.entropy || 0, 3),
      sharpness: rounded(statistics.sharpness || 0, 3),
      dominantColor: `${statistics.dominant.r},${statistics.dominant.g},${statistics.dominant.b}`,
    },
    dimensions,
    confidence: 0.86,
  };
}

function pcmMeasurements(pcm, sampleRate) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  if (samples.length < 2048) throw new Error("training_audio_too_short");
  let squared = 0;
  let peak = 0;
  let crossings = 0;
  let clipped = 0;
  const envelope = [];
  const blockSize = Math.max(256, Math.floor(sampleRate * 0.05));
  for (let start = 0; start < samples.length; start += blockSize) {
    let blockSquared = 0;
    const end = Math.min(samples.length, start + blockSize);
    for (let index = start; index < end; index += 1) {
      const value = samples[index] / 32768;
      const absolute = Math.abs(value);
      squared += value * value;
      blockSquared += value * value;
      peak = Math.max(peak, absolute);
      if (absolute >= 0.995) clipped += 1;
      if (index > 0 && (samples[index - 1] < 0) !== (samples[index] < 0)) crossings += 1;
    }
    envelope.push(Math.sqrt(blockSquared / Math.max(1, end - start)));
  }
  const rms = Math.sqrt(squared / samples.length);
  const sortedEnvelope = [...envelope].sort((a, b) => a - b);
  const quiet = sortedEnvelope[Math.floor(sortedEnvelope.length * 0.1)] || 0;
  const loud = sortedEnvelope[Math.floor(sortedEnvelope.length * 0.9)] || rms;
  const dynamicRangeDb = 20 * Math.log10((loud + 1e-6) / (quiet + 1e-6));

  const fftSize = 4096;
  const fft = new FFT(fftSize);
  const input = new Array(fftSize).fill(0);
  const offset = Math.max(0, Math.floor(samples.length / 2 - fftSize / 2));
  for (let index = 0; index < fftSize && offset + index < samples.length; index += 1) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (fftSize - 1));
    input[index] = samples[offset + index] / 32768 * window;
  }
  const output = fft.createComplexArray();
  fft.realTransform(output, input);
  let magnitudeSum = 0;
  let weightedFrequency = 0;
  let highMagnitude = 0;
  for (let bin = 1; bin < fftSize / 2; bin += 1) {
    const magnitude = Math.hypot(output[bin * 2], output[bin * 2 + 1]);
    const frequency = bin * sampleRate / fftSize;
    magnitudeSum += magnitude;
    weightedFrequency += magnitude * frequency;
    if (frequency >= 4000) highMagnitude += magnitude;
  }
  const spectralCentroid = magnitudeSum ? weightedFrequency / magnitudeSum : 0;
  const highFrequencyRatio = magnitudeSum ? highMagnitude / magnitudeSum : 0;

  const envelopeRate = sampleRate / blockSize;
  let bestCorrelation = 0;
  let tempoBpm = 0;
  const mean = envelope.reduce((total, value) => total + value, 0) / envelope.length;
  const centered = envelope.map((value) => value - mean);
  const energy = centered.reduce((total, value) => total + value * value, 0) || 1;
  for (let bpm = 60; bpm <= 180; bpm += 2) {
    const lag = Math.round(envelopeRate * 60 / bpm);
    let correlation = 0;
    for (let index = lag; index < centered.length; index += 1) correlation += centered[index] * centered[index - lag];
    correlation /= energy;
    if (correlation > bestCorrelation) { bestCorrelation = correlation; tempoBpm = bpm; }
  }
  return {
    rms,
    peak,
    zeroCrossingRate: crossings / samples.length,
    clippingRatio: clipped / samples.length,
    dynamicRangeDb,
    spectralCentroid,
    highFrequencyRatio,
    tempoBpm,
    periodicity: clamp(bestCorrelation, 0, 1),
  };
}

async function decodedAudioMeasurements(filePath) {
  const sampleRate = 16000;
  const pcm = await runFfmpeg(["-i", filePath, "-vn", "-t", "30", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "pipe:1"], { maxOutputBytes: 1_000_000 });
  return pcmMeasurements(pcm, sampleRate);
}

function audioProfile(metadata, measured, label) {
  const format = metadata.format || {};
  const loudness = clamp((20 * Math.log10(measured.rms + 1e-8) + 48) / 38 * 100);
  const brightness = clamp(measured.spectralCentroid / 5000 * 100);
  const dynamicRange = clamp(measured.dynamicRangeDb / 24 * 100);
  const rhythmicity = clamp(measured.periodicity * 135);
  const warmth = clamp(100 - brightness * 0.72 - measured.highFrequencyRatio * 80);
  const sampleRate = Number(format.sampleRate || 0);
  const bitrate = Number(format.bitrate || 0);
  const fidelity = clamp((sampleRate / 48000) * 55 + (bitrate / 320000) * 35 + (1 - measured.clippingRatio * 100) * 10);
  const dimensions = {
    energy: score(0.68 * loudness + 0.32 * rhythmicity),
    tension: score(0.62 * brightness + 0.22 * loudness + 0.16 * measured.zeroCrossingRate * 700),
    contrast: score(dynamicRange),
    warmth: score(warmth),
    spaciousness: score(Number(format.numberOfChannels || 1) > 1 ? 68 : 42),
    rhythmicity: score(rhythmicity),
    organicity: score(0.55 * dynamicRange + 0.45 * warmth),
    polish: score(0.72 * fidelity + 0.28 * (100 - measured.clippingRatio * 5000)),
  };
  return {
    observations: [
      `${label} runs ${rounded(format.duration || 0)} seconds at ${sampleRate || "unknown"} Hz with ${format.numberOfChannels || "unknown"} channel(s).`,
      `Decoded signal measures ${rounded(20 * Math.log10(measured.rms + 1e-8))} dB RMS, ${rounded(measured.dynamicRangeDb)} dB envelope range, and a ${rounded(measured.spectralCentroid)} Hz spectral centroid.`,
      measured.tempoBpm ? `Rhythmic periodicity is strongest near ${measured.tempoBpm} BPM with ${rounded(measured.periodicity * 100)}% confidence.` : "No stable rhythmic period was detected in the analyzed segment.",
    ],
    metrics: {
      durationSeconds: rounded(format.duration || 0, 2),
      sampleRate,
      channels: Number(format.numberOfChannels || 0),
      bitrateKbps: rounded(bitrate / 1000),
      codec: String(format.codec || format.container || "unknown").slice(0, 120),
      rmsDb: rounded(20 * Math.log10(measured.rms + 1e-8)),
      peakDb: rounded(20 * Math.log10(measured.peak + 1e-8)),
      dynamicRangeDb: rounded(measured.dynamicRangeDb),
      spectralCentroidHz: rounded(measured.spectralCentroid),
      zeroCrossingRate: rounded(measured.zeroCrossingRate, 4),
      highFrequencyRatio: rounded(measured.highFrequencyRatio, 4),
      tempoBpm: measured.tempoBpm,
      periodicity: rounded(measured.periodicity, 3),
      clippingRatio: rounded(measured.clippingRatio, 5),
    },
    dimensions,
    confidence: 0.83,
  };
}

async function withMediaFile(buffer, name, mimeType, kind, callback) {
  const directory = await mkdtemp(join(tmpdir(), "creative-studio-training-"));
  const filePath = join(directory, `source${extension(name, mimeType, kind)}`);
  try {
    await writeFile(filePath, buffer);
    return await callback(filePath, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function analyzeAudio(buffer, name, mimeType, label = "Audio") {
  const metadata = await parseBuffer(buffer, { mimeType, size: buffer.byteLength }, { duration: true, skipCovers: true });
  return withMediaFile(buffer, name, mimeType, "audio", async (filePath) => audioProfile(metadata, await decodedAudioMeasurements(filePath), label));
}

export async function analyzeVideo(buffer, name, mimeType, label = "Video") {
  const metadata = await parseBuffer(buffer, { mimeType, size: buffer.byteLength }, { duration: true, skipCovers: true });
  return withMediaFile(buffer, name, mimeType, "video", async (filePath, directory) => {
    const framePattern = join(directory, "frame-%02d.png");
    await runFfmpeg(["-i", filePath, "-vf", "fps=1/4,scale=512:-2", "-frames:v", "4", framePattern]);
    const frameNames = (await readdir(directory)).filter((file) => /^frame-\d+\.png$/i.test(file)).sort();
    if (!frameNames.length) throw new Error("training_video_frames_missing");
    const frames = await Promise.all(frameNames.map(async (file, index) => analyzeImage(await readFile(join(directory, file)), `${label} frame ${index + 1}`)));
    const averaged = DIMENSION_KEYS.reduce((result, key) => {
      result[key] = score(frames.reduce((total, frame) => total + frame.dimensions[key], 0) / frames.length);
      return result;
    }, {});
    let audio = null;
    try { audio = audioProfile(metadata, await decodedAudioMeasurements(filePath), `${label} soundtrack`); } catch { /* video may be silent */ }
    if (audio) {
      for (const key of DIMENSION_KEYS) averaged[key] = score(averaged[key] * 0.78 + audio.dimensions[key] * 0.22);
    }
    const format = metadata.format || {};
    return {
      observations: [
        `${label} runs ${rounded(format.duration || 0)} seconds; ${frames.length} evenly spaced decoded frames were measured.`,
        ...frames.slice(0, 2).flatMap((frame) => frame.observations.slice(1, 2)),
        audio ? "The soundtrack was decoded and contributes 22% of the cross-modal profile." : "No decodable soundtrack was found; the profile is visual only.",
      ],
      metrics: {
        durationSeconds: rounded(format.duration || 0, 2),
        frameSamples: frames.length,
        codec: String(format.codec || format.container || "unknown").slice(0, 120),
        bitrateKbps: rounded(Number(format.bitrate || 0) / 1000),
        hasDecodedAudio: Boolean(audio),
      },
      dimensions: averaged,
      confidence: audio ? 0.8 : 0.76,
    };
  });
}

const TEXT_SIGNALS = {
  energy: [[/vibrant|explosive|dynamic|intense|energetic/i, 86], [/quiet|restrained|calm|gentle|minimal/i, 28]],
  tension: [[/tense|uneasy|angular|ominous|friction/i, 84], [/serene|resolved|peaceful|soft/i, 25]],
  contrast: [[/contrast|dramatic|stark|bold|chiaroscuro/i, 84], [/subtle|muted|even|tonal/i, 34]],
  warmth: [[/warm|golden|amber|sunlit|earthy/i, 84], [/cool|blue|icy|steel|moonlit/i, 24]],
  spaciousness: [[/spacious|wide|vast|open|airy|panoramic/i, 84], [/intimate|close|dense|tight|enclosed/i, 30]],
  rhythmicity: [[/rhythm|pulse|beat|pattern|repeating|syncopated/i, 82], [/drone|freeform|still|ambient/i, 33]],
  organicity: [[/organic|natural|handmade|earth|wood|acoustic/i, 84], [/synthetic|digital|chrome|plastic|machine/i, 26]],
  polish: [[/polished|refined|clean|finished|cinematic|studio/i, 86], [/raw|rough|lo-fi|imperfect|sketch/i, 28]],
};

function promptSignals(prompt) {
  const result = {};
  for (const [key, patterns] of Object.entries(TEXT_SIGNALS)) {
    const values = patterns.filter(([pattern]) => pattern.test(prompt)).map(([, value]) => value);
    if (values.length) result[key] = values.reduce((total, value) => total + value, 0) / values.length;
  }
  return result;
}

function addTrainingExampleContext(profile, example) {
  if (!example) return profile;
  const signals = promptSignals(String(example.prompt || ""));
  const dimensions = { ...profile.dimensions };
  for (const [key, value] of Object.entries(signals)) dimensions[key] = score(dimensions[key] * 0.82 + value * 0.18);
  const workflow = example.settingsStamp?.workflow;
  return {
    ...profile,
    observations: [...profile.observations, `Accepted generation context contributes its retained ${example.prompt.length}-character prompt and ${workflow ? `workflow ${workflow.name} v${workflow.version}` : "provider settings"}.`],
    metrics: {
      ...profile.metrics,
      promptCharacters: example.prompt.length,
      settingsProvider: String(example.settingsStamp?.provider || "unknown").slice(0, 120),
      settingsModel: String(example.settingsStamp?.model || "unknown").slice(0, 120),
      workflowHash: String(workflow?.contentHash || "none").slice(0, 120),
    },
    dimensions,
    confidence: clamp(profile.confidence + (Object.keys(signals).length ? 0.04 : 0.02), 0, 0.95),
  };
}

async function analyzeSource(specification, download) {
  const media = await download(specification.mediaId);
  let profile;
  if (specification.kind === "image") profile = await analyzeImage(media.buffer, specification.label);
  else if (specification.kind === "audio") profile = await analyzeAudio(media.buffer, media.name || specification.name, media.mimeType, specification.label);
  else profile = await analyzeVideo(media.buffer, media.name || specification.name, media.mimeType, specification.label);
  return addTrainingExampleContext(profile, specification.example);
}

function aggregateDimensions(sources, baseDna) {
  return DIMENSION_KEYS.reduce((result, key) => {
    const measured = sources.filter((source) => Number.isFinite(source.dimensions[key]));
    const weight = measured.reduce((total, source) => total + source.confidence, 0) || 1;
    let value = measured.reduce((total, source) => total + source.dimensions[key] * source.confidence, 0) / weight;
    if (baseDna?.shared && Number.isFinite(baseDna.shared[key])) value = value * 0.82 + baseDna.shared[key] * 0.18;
    result[key] = {
      value: score(value),
      confidence: rounded(clamp(measured.reduce((total, source) => total + source.confidence, 0) / Math.max(1, measured.length), 0, 0.95), 3),
      sourceIds: measured.map((source) => source.sourceId),
    };
    return result;
  }, {});
}

function synthesisDirective(bundle, dimensions, sources) {
  const ranked = DIMENSION_KEYS.map((key) => [key, dimensions[key].value]).sort((a, b) => b[1] - a[1]);
  const strongest = ranked.slice(0, 3).map(([key, value]) => `${key} ${value}`).join(", ");
  const restrained = [...ranked].sort((a, b) => a[1] - b[1]).slice(0, 2).map(([key, value]) => `${key} ${value}`).join(", ");
  const sourceTypes = [...new Set(sources.map((source) => source.kind))].join(", ");
  return `Evidence-synthesized ${bundle.trainingJob.targetModality} language from ${sources.length} consented ${sourceTypes} source${sources.length === 1 ? "" : "s"}. Emphasize ${strongest}; keep ${restrained} controlled. Preserve the measured balance as a reusable direction rather than reproducing any single source.`;
}

export async function synthesizeCreativeDna(bundle, { download, heartbeat = async () => undefined } = {}) {
  if (!bundle?.trainingJob || typeof download !== "function") throw new Error("training_bundle_invalid");
  const examples = new Map(bundle.trainingExamples.map((example) => [example.id, example]));
  const specifications = [
    ...bundle.assets.map((asset) => ({
      sourceId: asset.id, mediaId: asset.id, sourceType: "upload", kind: asset.kind,
      label: asset.name, name: asset.originalFileName, example: null,
    })),
    ...bundle.trainingExamples.map((example) => ({
      sourceId: example.id, mediaId: example.artifactId, sourceType: "accepted-artifact",
      kind: example.kind === "music" ? "audio" : example.kind === "video" ? "video" : "image",
      label: `Accepted ${example.kind} result`, name: `${example.artifactId}.${example.kind === "music" ? "wav" : example.kind === "video" ? "mp4" : "png"}`,
      example: examples.get(example.id),
    })),
  ];
  if (!specifications.length) throw new Error("training_inputs_required");

  const analyzed = [];
  for (let index = 0; index < specifications.length; index += 1) {
    const specification = specifications[index];
    await heartbeat(10 + Math.floor(index / specifications.length * 75));
    const profile = await analyzeSource(specification, download);
    analyzed.push({ ...specification, ...profile });
  }
  const dimensions = aggregateDimensions(analyzed, bundle.baseDna);
  const summary = synthesisDirective(bundle, dimensions, analyzed);
  const sources = analyzed.map(({ sourceId, mediaId, sourceType, kind, label, observations, metrics, dimensions: sourceDimensions, confidence }) => ({
    sourceId, mediaId, sourceType, kind, label, observations, metrics, dimensions: sourceDimensions, confidence: rounded(confidence, 3),
  }));
  await heartbeat(92);
  return {
    dna: {
      name: bundle.trainingJob.name,
      directive: summary,
      targetModality: bundle.trainingJob.targetModality,
      dimensions: Object.fromEntries(DIMENSION_KEYS.map((key) => [key, dimensions[key].value])),
      influence: bundle.baseDna?.influence || { angeloCore: 55, currentProject: 85, reference: 35 },
    },
    analysis: {
      schemaVersion: TRAINING_ANALYSIS_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      summary,
      sources,
      dimensions,
    },
  };
}
