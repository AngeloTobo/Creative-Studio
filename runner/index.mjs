import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";
import { analyzeAudio, analyzeImage, synthesisDirective, synthesizeCreativeDna } from "./training.mjs";

export const RUNNER_VERSION = "1.4.2";
export const MIN_IDLE_POLL_INTERVAL_MS = 60_000;
export const LOCAL_IDLE_POLL_INTERVAL_MS = 5_000;
const ACTIVE_HEARTBEAT_INTERVAL_MS = 60_000;

const GEMMA_DESCRIPTION_MODEL = "gemma4_e4b_it_fp8_scaled.safetensors";
const GEMMA_DESCRIPTION_WORKFLOW_ID = "gemma4-multimodal-description";
const GEMMA_DESCRIPTION_WORKFLOW_VERSION = 1;
const GEMMA_DESCRIPTION_TEMPLATE = JSON.parse(readFileSync(new URL("./workflows/gemma4-multimodal-description.json", import.meta.url), "utf8"));
const GEMMA_DESCRIPTION_SETTINGS = Object.freeze({
  maxLength: 2048,
  samplingMode: "on",
  temperature: 0.7,
  topK: 64,
  topP: 0.95,
  minP: 0.05,
  repetitionPenalty: 1.05,
  seed: 0,
  presencePenalty: 0,
  thinking: false,
  useDefaultTemplate: true,
});

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function configPath() {
  if (process.env.CS_RUNNER_CONFIG) return process.env.CS_RUNNER_CONFIG;
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "Creative Studio Runner", "config.json");
}

export function loadConfig(path = configPath()) {
  const hasEnvironmentConfig = Boolean(process.env.CS_RUNNER_API_BASE || process.env.CS_RUNNER_TOKEN || process.env.CS_COMFY_URL);
  if (!existsSync(path) && !hasEnvironmentConfig) throw new Error(`Runner config not found: ${path}`);
  const parsed = existsSync(path) ? JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) : {};
  const apiBase = String(process.env.CS_RUNNER_API_BASE || parsed.apiBase || "").replace(/\/+$/, "");
  const token = String(process.env.CS_RUNNER_TOKEN || parsed.token || "");
  const comfyUrl = String(process.env.CS_COMFY_URL || parsed.comfyUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const pollIntervalMs = resolveRunnerPollInterval(apiBase, process.env.CS_RUNNER_POLL_MS || parsed.pollIntervalMs);
  if (!/^https:\/\//.test(apiBase) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiBase)) throw new Error("Runner apiBase must use HTTPS or local HTTP.");
  if (!/^csr_[A-Za-z0-9_-]{40,80}$/.test(token)) throw new Error("Runner token is missing or invalid.");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(comfyUrl)) throw new Error("ComfyUI must be bound to localhost.");
  return { apiBase, token, comfyUrl, pollIntervalMs };
}

export function resolveRunnerPollInterval(apiBase, value) {
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiBase);
  const fallback = local ? LOCAL_IDLE_POLL_INTERVAL_MS : MIN_IDLE_POLL_INTERVAL_MS;
  const minimum = local ? 2_000 : MIN_IDLE_POLL_INTERVAL_MS;
  return Math.max(minimum, Math.min(5 * 60_000, Number(value) || fallback));
}

async function runnerRequest(config, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${config.token}`);
  if (init.body && typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${config.apiBase}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok || (payload && payload.ok === false)) throw new Error(payload?.error || `runner_api_${response.status}`);
  return payload;
}

async function comfyInfo(config) {
  const response = await fetch(`${config.comfyUrl}/system_stats`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`comfyui_unavailable_${response.status}`);
  const stats = await response.json();
  const system = stats.system || {};
  const device = Array.isArray(stats.devices) ? stats.devices.map((item) => item?.name || item?.type).filter(Boolean).join(", ") : null;
  return { comfyVersion: system.comfyui_version || null, device };
}

async function machineState(config, activeJobId = null, error = null) {
  let info = { comfyVersion: null, device: null };
  let reportedError = error;
  try {
    info = await comfyInfo(config);
  } catch (caught) {
    reportedError = reportedError || (caught instanceof Error ? caught.message : "comfyui_unavailable");
  }
  return { version: RUNNER_VERSION, comfyUrl: config.comfyUrl, ...info, activeJobId, error: reportedError };
}

async function machineHeartbeat(config, activeJobId = null, error = null) {
  return runnerRequest(config, "/api/creative-studio/runner/heartbeat", {
    method: "POST",
    body: JSON.stringify(await machineState(config, activeJobId, error)),
  });
}

async function downloadInput(config, asset) {
  const response = await fetch(`${config.apiBase}/api/creative-studio/runner/media/${encodeURIComponent(asset.id)}`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) throw new Error(`runner_input_download_${response.status}`);
  return new Blob([await response.arrayBuffer()], { type: asset.mimeType });
}

async function downloadTrainingMedia(config, mediaId) {
  const response = await fetch(`${config.apiBase}/api/creative-studio/runner/media/${encodeURIComponent(mediaId)}`, {
    headers: { authorization: `Bearer ${config.token}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`training_input_download_${response.status}`);
  const disposition = response.headers.get("content-disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") || "application/octet-stream",
    name: encodedName ? decodeURIComponent(encodedName) : mediaId,
  };
}

async function uploadTrainingComfyInput(config, sourceId, media) {
  const original = basename(media.name || sourceId).replace(/[^a-z0-9._-]/gi, "_");
  const fileName = `cs_training_${sourceId}_${original}`;
  const form = new FormData();
  form.set("image", new Blob([media.buffer], { type: media.mimeType }), fileName);
  form.set("type", "input");
  form.set("overwrite", "true");
  const response = await fetch(`${config.comfyUrl}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`training_comfy_input_upload_${response.status}`);
  const result = await response.json();
  if (!result?.name) throw new Error("training_comfy_input_upload_invalid");
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

function descriptionPrompt(kind, label) {
  const shared = `Describe the uploaded ${kind} named "${String(label || "Untitled media").slice(0, 160)}". Be specific and concrete. Describe only what is present; do not invent identity, context, or hidden intent. Do not refer to this request, the upload process, or the model. Return exactly two labeled paragraphs separated by a blank line: LONG SUMMARY: a full detailed analysis; then SHORT SUMMARY: one polished reusable generation prompt.`;
  if (kind === "image") return `${shared} Cover subject and environment, composition and camera viewpoint, pose or action, materials and surface qualities, lighting, color palette, depth, mood, artistic medium or rendering style, fine details, and any visible text.`;
  if (kind === "audio") return `${shared} Cover voices and language when discernible, instruments and sound sources, tempo and rhythm, melody and harmony, structure and transitions, timbre, dynamics, spatial mix, production treatment, mood, and notable sonic details.`;
  return `${shared} Cover subjects and environment, the sequence of visible events, composition and camera movement, motion and timing, materials, lighting, color, depth, editing, mood, artistic treatment, visible text, dialogue or voices, music, ambience, and sound effects.`;
}

function descriptionSummaries(value) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").trim();
  const labeled = normalized.match(/(?:^|\n)\s*(?:long|detailed|full)\s+summary\s*:\s*([\s\S]*?)(?:\n+\s*(?:short|concise|generation)\s+(?:summary|prompt)\s*:\s*)([\s\S]+)$/i);
  if (labeled) return { longSummary: labeled[1].trim(), shortSummary: labeled[2].trim() };
  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paragraphs.length > 1 && paragraphs.at(-1).length >= 40) {
    return { longSummary: paragraphs.slice(0, -1).join("\n\n"), shortSummary: paragraphs.at(-1) };
  }
  return { longSummary: normalized, shortSummary: normalized };
}

export function buildGemmaDescriptionGraph(kind, filename, label = "Untitled media") {
  if (kind !== "image" && kind !== "audio" && kind !== "video") throw new Error("training_description_kind_unsupported");
  const graph = structuredClone(GEMMA_DESCRIPTION_TEMPLATE);
  const inputs = graph["1"].inputs;
  inputs.prompt = descriptionPrompt(kind, label);
  delete inputs.image;
  delete inputs.audio;
  delete inputs.video;
  if (kind === "image") {
    graph["2"].inputs.image = filename;
    inputs.image = ["2", 0];
    delete graph["5"];
    delete graph["6"];
    delete graph["7"];
  } else if (kind === "audio") {
    graph["5"].inputs.audio = filename;
    inputs.audio = ["5", 0];
    delete graph["2"];
    delete graph["6"];
    delete graph["7"];
  } else {
    graph["6"].inputs.file = filename;
    inputs.video = ["7", 0];
    inputs.audio = ["7", 1];
    delete graph["2"];
    delete graph["5"];
  }
  return graph;
}

async function uploadComfyInput(config, asset) {
  const fileName = `cs_${asset.id}_${basename(asset.originalFileName).replace(/[^a-z0-9._-]/gi, "_")}`;
  const form = new FormData();
  form.set("image", await downloadInput(config, asset), fileName);
  form.set("type", "input");
  form.set("overwrite", "true");
  const response = await fetch(`${config.comfyUrl}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`comfyui_input_upload_${response.status}`);
  const result = await response.json();
  if (!result?.name) throw new Error("comfyui_input_upload_invalid");
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

export function applyInputFilenames(graphValue, parameters, filenames) {
  const graph = structuredClone(graphValue);
  for (const [parameterId, filename] of Object.entries(filenames)) {
    const parameter = parameters.find((item) => item.id === parameterId);
    const binding = parameter?.binding;
    if (!parameter || parameter.kind !== "media" || binding?.format !== "comfyui-api") throw new Error(`runner_input_binding_invalid:${parameterId}`);
    const node = graph?.[binding.nodeId];
    if (!node?.inputs) throw new Error(`runner_input_node_missing:${binding.nodeId}`);
    node.inputs[binding.inputName] = filename;
  }
  return graph;
}

async function prepareGraph(config, bundle) {
  const assets = new Map(bundle.inputs.map((asset) => [asset.id, asset]));
  const filenames = {};
  for (const [parameterId, assetId] of Object.entries(bundle.job.settingsStamp.inputBindings || {})) {
    const asset = assets.get(assetId);
    if (!asset) throw new Error(`runner_input_asset_missing:${assetId}`);
    filenames[parameterId] = await uploadComfyInput(config, asset);
  }
  return applyInputFilenames(bundle.graph, bundle.workflow.currentRevision.parameters, filenames);
}

async function submitPrompt(config, graph, jobId) {
  const response = await fetch(`${config.comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: `creative-studio-${jobId}`, extra_data: { creative_studio_job_id: jobId } }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.prompt_id) {
    const detail = payload.error?.message || payload.error || payload.node_errors || `http_${response.status}`;
    throw new Error(`comfyui_prompt_rejected:${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return payload.prompt_id;
}

function allFileObjects(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) allFileObjects(item, result);
  } else if (value && typeof value === "object") {
    if (typeof value.filename === "string") result.push(value);
    else for (const item of Object.values(value)) allFileObjects(item, result);
  }
  return result;
}

const EXTENSIONS = {
  image: [".png", ".jpg", ".jpeg", ".webp"],
  music: [".wav", ".mp3", ".flac", ".ogg"],
  video: [".mp4", ".webm", ".mov"],
};

const OUTPUT_NODE_PATTERNS = {
  image: /save.*image|image.*save/i,
  music: /save.*audio|audio.*save/i,
  video: /save.*video|video.*save|video.*combine|combine.*video|saveanimatedwebp/i,
};

function matchingOutput(files, extensions, nodeId = null) {
  const file = files.find((item) => extensions.some((extension) => item.filename.toLowerCase().endsWith(extension)));
  return file ? { ...file, nodeId } : null;
}

export function findComfyOutput(historyEntry, modality, graph = null) {
  const extensions = EXTENSIONS[modality] || [];
  const outputs = historyEntry?.outputs || {};
  const preferred = graph && typeof graph === "object" ? Object.entries(graph)
    .filter(([, node]) => OUTPUT_NODE_PATTERNS[modality]?.test(String(node?.class_type || "")))
    .map(([nodeId]) => nodeId) : [];
  for (const nodeId of preferred) {
    const output = matchingOutput(allFileObjects(outputs[nodeId] || {}), extensions, nodeId);
    if (output) return output;
  }
  return matchingOutput(allFileObjects(outputs), extensions);
}

function historyError(entry) {
  const status = entry?.status || {};
  if (status.status_str !== "error") return null;
  const messages = Array.isArray(status.messages) ? status.messages : [];
  const execution = messages.find((item) => Array.isArray(item) && item[0] === "execution_error");
  return execution?.[1]?.exception_message || execution?.[1]?.exception_type || "comfyui_execution_failed";
}

function textValue(output) {
  for (const key of ["text", "generated_text", "string"]) {
    const value = output?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const text = value.filter((item) => typeof item === "string").join("\n").trim();
      if (text) return text;
    }
  }
  return null;
}

export function findComfyTextOutput(historyEntry, graph = null) {
  const outputs = historyEntry?.outputs || {};
  const preferred = graph && typeof graph === "object" ? Object.entries(graph)
    .filter(([, node]) => String(node?.class_type || "") === "PreviewAny")
    .map(([nodeId]) => nodeId) : [];
  for (const nodeId of preferred) {
    const text = textValue(outputs[nodeId]);
    if (text) return text;
  }
  for (const output of Object.values(outputs)) {
    const text = textValue(output);
    if (text) return text;
  }
  return null;
}

export function isTransientComfyPollError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError;
}

async function waitForOutput(config, bundle, promptId) {
  const started = Date.now();
  let lastHeartbeat = 0;
  while (Date.now() - started < 24 * 60 * 60_000) {
    const elapsed = Date.now() - started;
    if (Date.now() - lastHeartbeat >= ACTIVE_HEARTBEAT_INTERVAL_MS) {
      const progress = Math.min(90, 10 + Math.floor(elapsed / 30_000));
      const heartbeat = await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ progress, stage: "rendering" }),
      });
      if (!heartbeat.continue) throw new Error("creative_studio_job_cancelled");
      lastHeartbeat = Date.now();
    }
    let history;
    try {
      const response = await fetch(`${config.comfyUrl}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(15_000) });
      if (response.status >= 500) {
        await sleep(2_000);
        continue;
      }
      if (!response.ok) throw new Error(`comfyui_history_${response.status}`);
      history = await response.json();
    } catch (error) {
      if (!isTransientComfyPollError(error)) throw error;
      await sleep(2_000);
      continue;
    }
    const entry = history[promptId];
    const error = historyError(entry);
    if (error) throw new Error(`comfyui_execution_failed:${error}`);
    const output = findComfyOutput(entry, bundle.job.modality, bundle.graph);
    if (output) return output;
    await sleep(2_000);
  }
  throw new Error("comfyui_execution_timed_out");
}

async function waitForTextOutput(config, graph, promptId, onHeartbeat) {
  const started = Date.now();
  let lastHeartbeat = 0;
  while (Date.now() - started < 60 * 60_000) {
    if (Date.now() - lastHeartbeat >= ACTIVE_HEARTBEAT_INTERVAL_MS) {
      await onHeartbeat();
      lastHeartbeat = Date.now();
    }
    let history;
    try {
      const response = await fetch(`${config.comfyUrl}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(15_000) });
      if (response.status >= 500) {
        await sleep(2_000);
        continue;
      }
      if (!response.ok) throw new Error(`comfyui_history_${response.status}`);
      history = await response.json();
    } catch (error) {
      if (!isTransientComfyPollError(error)) throw error;
      await sleep(2_000);
      continue;
    }
    const entry = history[promptId];
    const error = historyError(entry);
    if (error) throw new Error(`comfyui_description_failed:${error}`);
    const text = findComfyTextOutput(entry, graph);
    if (text) return text;
    await sleep(2_000);
  }
  throw new Error("comfyui_description_timed_out");
}

async function describeTrainingMedia(config, trainingJobId, specification, media, progress, heartbeat) {
  const filename = await uploadTrainingComfyInput(config, specification.sourceId, media);
  const graph = buildGemmaDescriptionGraph(specification.kind, filename, specification.label);
  const promptId = await submitPrompt(config, graph, `${trainingJobId}-${specification.sourceId}`);
  const text = await waitForTextOutput(config, graph, promptId, async () => {
    await heartbeat(progress);
  });
  if (text.length < 40) throw new Error("comfyui_description_too_short");
  const summaries = descriptionSummaries(text);
  if (summaries.longSummary.length < 40 || summaries.shortSummary.length < 40) throw new Error("comfyui_description_summary_invalid");
  return {
    schemaVersion: "creative-dna-media-description/1.1",
    longSummary: summaries.longSummary.slice(0, 12_000),
    shortSummary: summaries.shortSummary.slice(0, 2_400),
    provider: "local-comfyui",
    workflowId: GEMMA_DESCRIPTION_WORKFLOW_ID,
    workflowVersion: GEMMA_DESCRIPTION_WORKFLOW_VERSION,
    model: GEMMA_DESCRIPTION_MODEL,
    prompt: graph["1"].inputs.prompt,
    comfyPromptId: promptId,
    settings: { ...GEMMA_DESCRIPTION_SETTINGS },
  };
}

function contentType(filename, upstream) {
  const current = String(upstream || "").split(";", 1)[0];
  if (/^(image|audio|video)\//.test(current)) return current;
  const extension = filename.toLowerCase().split(".").at(-1);
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" })[extension] || "application/octet-stream";
}

async function fetchOutput(config, output) {
  const query = new URLSearchParams({ filename: output.filename, subfolder: output.subfolder || "", type: output.type || "output" });
  const response = await fetch(`${config.comfyUrl}/view?${query}`, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`comfyui_output_download_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("comfyui_output_empty");
  return { bytes, contentType: contentType(output.filename, response.headers.get("content-type")) };
}

export async function createFirstFrameThumbnail(bytes, contentTypeValue) {
  if (!ffmpegPath) throw new Error("video_thumbnail_ffmpeg_unavailable");
  const extension = ({ "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" })[contentTypeValue] || "mp4";
  const directory = await mkdtemp(join(tmpdir(), "creative-studio-video-thumbnail-"));
  const inputPath = join(directory, `source.${extension}`);
  const outputPath = join(directory, "first-frame.jpg");
  try {
    await writeFile(inputPath, bytes);
    await new Promise((resolve, reject) => {
      const stderr = [];
      const child = spawn(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-ss", "0", "-i", inputPath,
        "-frames:v", "1", "-vf", "scale=960:-2:force_original_aspect_ratio=decrease", "-q:v", "3", "-y", outputPath,
      ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`video_thumbnail_ffmpeg_failed:${signal || code}:${Buffer.concat(stderr).toString("utf8").slice(0, 240)}`));
      });
    });
    const thumbnail = await readFile(outputPath);
    if (!thumbnail.byteLength) throw new Error("video_thumbnail_empty");
    return thumbnail;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executeBundle(config, bundle) {
  try {
    const graph = await prepareGraph(config, bundle);
    await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ progress: 7, stage: "submitting" }),
    });
    const promptId = bundle.job.upstreamId || await submitPrompt(config, graph, bundle.job.id);
    await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ progress: 8, upstreamId: promptId, stage: "rendering" }),
    });
    const output = await waitForOutput(config, bundle, promptId);
    await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ progress: 92, stage: "downloading-output" }),
    });
    const retained = await fetchOutput(config, output);
    let videoThumbnail = null;
    if (bundle.job.modality === "video") {
      try {
        videoThumbnail = await createFirstFrameThumbnail(retained.bytes, retained.contentType);
      } catch (thumbnailError) {
        process.stderr.write(`[Creative Studio Runner] first-frame thumbnail unavailable for ${bundle.job.id}: ${thumbnailError.message}\n`);
      }
    }
    await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
      method: "POST",
      body: JSON.stringify({ progress: 94, stage: "retaining" }),
    });
    await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/complete`, {
      method: "POST",
      headers: {
        "content-type": retained.contentType,
        "x-cs-file-size": String(retained.bytes.byteLength),
        "x-cs-output-file-name": encodeURIComponent(output.filename),
      },
      body: retained.bytes,
    });
    if (videoThumbnail) {
      try {
        await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/thumbnail`, {
          method: "POST",
          headers: { "content-type": "image/jpeg", "x-cs-file-size": String(videoThumbnail.byteLength) },
          body: videoThumbnail,
        });
      } catch (thumbnailError) {
        process.stderr.write(`[Creative Studio Runner] could not retain first-frame thumbnail for ${bundle.job.id}: ${thumbnailError.message}\n`);
      }
    }
    process.stdout.write(`[Creative Studio Runner] completed ${bundle.job.id} (${output.filename})\n`);
  } catch (caught) {
    const error = (caught instanceof Error ? caught.message : "local_runner_failed").slice(0, 500);
    try {
      await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/fail`, {
        method: "POST",
        body: JSON.stringify({ error }),
      });
    } catch (reportError) {
      process.stderr.write(`[Creative Studio Runner] could not report ${bundle.job.id}: ${reportError.message}\n`);
    }
    process.stderr.write(`[Creative Studio Runner] failed ${bundle.job.id}: ${error}\n`);
  } finally {
    await machineHeartbeat(config, null).catch(() => undefined);
  }
}

async function executeTrainingBundle(config, bundle) {
  try {
    const heartbeat = async (progress) => {
      const response = await runnerRequest(config, `/api/creative-studio/runner/training/${bundle.trainingJob.id}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ progress }),
      });
      if (!response.continue) throw new Error("training_cancelled");
    };
    const result = await synthesizeCreativeDna(bundle, {
      download: (mediaId) => downloadTrainingMedia(config, mediaId),
      heartbeat,
      describe: ({ specification, media, progress }) => describeTrainingMedia(config, bundle.trainingJob.id, specification, media, progress, heartbeat),
    });
    await runnerRequest(config, `/api/creative-studio/runner/training/${bundle.trainingJob.id}/complete`, {
      method: "POST",
      body: JSON.stringify(result),
    });
    process.stdout.write(`[Creative Studio Runner] completed CreativeDNA evidence synthesis ${bundle.trainingJob.id}\n`);
  } catch (caught) {
    const error = (caught instanceof Error ? caught.message : "creative_dna_training_failed").slice(0, 500);
    try {
      await runnerRequest(config, `/api/creative-studio/runner/training/${bundle.trainingJob.id}/fail`, {
        method: "POST",
        body: JSON.stringify({ error }),
      });
    } catch (reportError) {
      process.stderr.write(`[Creative Studio Runner] could not report training ${bundle.trainingJob.id}: ${reportError.message}\n`);
    }
    process.stderr.write(`[Creative Studio Runner] failed training ${bundle.trainingJob.id}: ${error}\n`);
  } finally {
    await machineHeartbeat(config, null).catch(() => undefined);
  }
}

export async function runOnce(config) {
  const work = await runnerRequest(config, "/api/creative-studio/runner/work/claim", {
    method: "POST",
    body: JSON.stringify(await machineState(config)),
  });
  if (work.kind === "generation" && work.bundle) {
    process.stdout.write(`[Creative Studio Runner] claimed ${work.bundle.job.id}: ${work.bundle.workflow.name}\n`);
    await executeBundle(config, work.bundle);
    return true;
  }
  if (work.kind !== "training" || !work.bundle) return false;
  process.stdout.write(`[Creative Studio Runner] claimed CreativeDNA evidence synthesis ${work.bundle.trainingJob.id}\n`);
  await executeTrainingBundle(config, work.bundle);
  return true;
}

async function selfTest() {
  if (resolveRunnerPollInterval("https://runner.cs.angelotoborg.com", 5_000) !== MIN_IDLE_POLL_INTERVAL_MS
    || resolveRunnerPollInterval("http://127.0.0.1:8787", 5_000) !== LOCAL_IDLE_POLL_INTERVAL_MS) {
    throw new Error("runner_self_test_poll_boundary_failed");
  }
  const graph = { "1": { class_type: "LoadImage", inputs: { image: "old.png" } } };
  const parameters = [{ id: "1::image", kind: "media", binding: { format: "comfyui-api", nodeId: "1", inputName: "image" } }];
  const patched = applyInputFilenames(graph, parameters, { "1::image": "new.png" });
  if (patched["1"].inputs.image !== "new.png" || graph["1"].inputs.image !== "old.png") throw new Error("runner_self_test_patch_failed");
  const output = findComfyOutput({ outputs: {
    "2": { images: [{ filename: "preview.png", type: "temp" }] },
    "9": { images: [{ filename: "result.png", type: "output" }] },
  } }, "image", {
    "2": { class_type: "PreviewImage" },
    "9": { class_type: "SaveImage" },
  });
  if (output?.filename !== "result.png") throw new Error("runner_self_test_output_failed");
  const descriptionGraph = buildGemmaDescriptionGraph("video", "source.mp4", "Self-test video");
  if (descriptionGraph["1"].inputs.video?.[0] !== "7" || descriptionGraph["1"].inputs.audio?.[0] !== "7" || descriptionGraph["2"] || descriptionGraph["5"]) {
    throw new Error("runner_self_test_description_graph_failed");
  }
  const description = findComfyTextOutput({ outputs: { "4": { text: ["Detailed reusable media description."] } } }, descriptionGraph);
  if (description !== "Detailed reusable media description.") throw new Error("runner_self_test_description_output_failed");
  const descriptionDirective = synthesisDirective(
    { trainingJob: { targetModality: "image" } },
    Object.fromEntries(["energy", "tension", "contrast", "warmth", "spaciousness", "rhythmicity", "organicity", "polish"].map((key) => [key, { value: 50 }])),
    [{ kind: "image", detailedDescription: {
      schemaVersion: "creative-dna-media-description/1.1",
      longSummary: "The source contains a centered matte black balloon above a green field beneath diffuse overcast light, with detailed material, composition, and depth evidence.",
      shortSummary: "A matte black balloon with a golden eye-like tuft floats above a flat green field beneath a pale overcast sky, centered in a wide landscape composition with soft diffused light and fine filament details.",
    } }],
  );
  if (!descriptionDirective.startsWith("A matte black balloon") || /Evidence-synthesized|Create an original image/i.test(descriptionDirective)) {
    throw new Error("runner_self_test_generation_description_failed");
  }
  if (!isTransientComfyPollError({ name: "TimeoutError" }) || isTransientComfyPollError(new Error("invalid_history"))) {
    throw new Error("runner_self_test_transient_poll_failed");
  }
  const testImage = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 220, g: 120, b: 40 } },
  }).png().toBuffer();
  const measured = await analyzeImage(testImage, "Self-test image");
  if (!Number.isFinite(measured.dimensions.warmth) || measured.metrics.width !== 8) throw new Error("runner_self_test_training_analysis_failed");
  const sampleRate = 16000;
  const sampleCount = sampleRate;
  const testAudio = Buffer.alloc(44 + sampleCount * 2);
  testAudio.write("RIFF", 0);
  testAudio.writeUInt32LE(36 + sampleCount * 2, 4);
  testAudio.write("WAVEfmt ", 8);
  testAudio.writeUInt32LE(16, 16);
  testAudio.writeUInt16LE(1, 20);
  testAudio.writeUInt16LE(1, 22);
  testAudio.writeUInt32LE(sampleRate, 24);
  testAudio.writeUInt32LE(sampleRate * 2, 28);
  testAudio.writeUInt16LE(2, 32);
  testAudio.writeUInt16LE(16, 34);
  testAudio.write("data", 36);
  testAudio.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    testAudio.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 8000), 44 + index * 2);
  }
  const measuredAudio = await analyzeAudio(testAudio, "self-test.wav", "audio/wav", "Self-test audio");
  if (measuredAudio.metrics.sampleRate !== sampleRate || !Number.isFinite(measuredAudio.dimensions.energy)) {
    throw new Error("runner_self_test_audio_analysis_failed");
  }
  process.stdout.write("Creative Studio Local Runner self-test passed.\n");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const config = loadConfig();
  const once = process.argv.includes("--once");
  process.stdout.write(`[Creative Studio Runner] v${RUNNER_VERSION} · ${config.apiBase} · ${config.comfyUrl}\n`);
  do {
    let nextDelay = config.pollIntervalMs;
    try {
      await runOnce(config);
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "runner_loop_failed";
      process.stderr.write(`[Creative Studio Runner] ${error}\n`);
      const cloudflareLimited = error === "runner_api_429" || error.includes("rate_limit");
      if (cloudflareLimited) nextDelay = 15 * 60_000;
      else await machineHeartbeat(config, null, error).catch(() => undefined);
    }
    if (!once) await sleep(nextDelay);
  } while (!once);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[Creative Studio Runner] fatal: ${error.message}\n`);
    process.exitCode = 1;
  });
}
