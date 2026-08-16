import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

export const RUNNER_VERSION = "1.0.0";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function configPath() {
  if (process.env.CS_RUNNER_CONFIG) return process.env.CS_RUNNER_CONFIG;
  const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(base, "Creative Studio Runner", "config.json");
}

export function loadConfig(path = configPath()) {
  if (!existsSync(path)) throw new Error(`Runner config not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  const apiBase = String(parsed.apiBase || "").replace(/\/+$/, "");
  const token = String(parsed.token || "");
  const comfyUrl = String(parsed.comfyUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const pollIntervalMs = Math.max(2_000, Math.min(60_000, Number(parsed.pollIntervalMs) || 5_000));
  if (!/^https:\/\//.test(apiBase) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(apiBase)) throw new Error("Runner apiBase must use HTTPS or local HTTP.");
  if (!/^csr_[A-Za-z0-9_-]{40,80}$/.test(token)) throw new Error("Runner token is missing or invalid.");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(comfyUrl)) throw new Error("ComfyUI must be bound to localhost.");
  return { apiBase, token, comfyUrl, pollIntervalMs };
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

async function machineHeartbeat(config, activeJobId = null, error = null) {
  let info = { comfyVersion: null, device: null };
  let reportedError = error;
  try {
    info = await comfyInfo(config);
  } catch (caught) {
    reportedError = reportedError || (caught instanceof Error ? caught.message : "comfyui_unavailable");
  }
  return runnerRequest(config, "/api/creative-studio/runner/heartbeat", {
    method: "POST",
    body: JSON.stringify({ version: RUNNER_VERSION, comfyUrl: config.comfyUrl, ...info, activeJobId, error: reportedError }),
  });
}

async function downloadInput(config, asset) {
  const response = await fetch(`${config.apiBase}/api/creative-studio/runner/media/${encodeURIComponent(asset.id)}`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  if (!response.ok) throw new Error(`runner_input_download_${response.status}`);
  return new Blob([await response.arrayBuffer()], { type: asset.mimeType });
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

export function findComfyOutput(historyEntry, modality) {
  const files = allFileObjects(historyEntry?.outputs || {});
  const extensions = EXTENSIONS[modality] || [];
  return files.find((file) => extensions.some((extension) => file.filename.toLowerCase().endsWith(extension))) || null;
}

function historyError(entry) {
  const status = entry?.status || {};
  if (status.status_str !== "error") return null;
  const messages = Array.isArray(status.messages) ? status.messages : [];
  const execution = messages.find((item) => Array.isArray(item) && item[0] === "execution_error");
  return execution?.[1]?.exception_message || execution?.[1]?.exception_type || "comfyui_execution_failed";
}

async function waitForOutput(config, bundle, promptId) {
  const started = Date.now();
  let lastHeartbeat = 0;
  while (Date.now() - started < 24 * 60 * 60_000) {
    const elapsed = Date.now() - started;
    if (Date.now() - lastHeartbeat >= 25_000) {
      const progress = Math.min(90, 10 + Math.floor(elapsed / 30_000));
      const heartbeat = await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ progress }),
      });
      await machineHeartbeat(config, bundle.job.id);
      if (!heartbeat.continue) throw new Error("creative_studio_job_cancelled");
      lastHeartbeat = Date.now();
    }
    const response = await fetch(`${config.comfyUrl}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`comfyui_history_${response.status}`);
    const history = await response.json();
    const entry = history[promptId];
    const error = historyError(entry);
    if (error) throw new Error(`comfyui_execution_failed:${error}`);
    const output = findComfyOutput(entry, bundle.job.modality);
    if (output) return output;
    await sleep(2_000);
  }
  throw new Error("comfyui_execution_timed_out");
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

async function executeBundle(config, bundle) {
  try {
    const graph = await prepareGraph(config, bundle);
    const promptId = bundle.job.upstreamId || await submitPrompt(config, graph, bundle.job.id);
    if (!bundle.job.upstreamId) {
      await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/heartbeat`, {
        method: "POST",
        body: JSON.stringify({ progress: 8, upstreamId: promptId }),
      });
    }
    const output = await waitForOutput(config, bundle, promptId);
    const retained = await fetchOutput(config, output);
    await runnerRequest(config, `/api/creative-studio/runner/jobs/${bundle.job.id}/complete`, {
      method: "POST",
      headers: {
        "content-type": retained.contentType,
        "x-cs-file-size": String(retained.bytes.byteLength),
        "x-cs-output-file-name": encodeURIComponent(output.filename),
      },
      body: retained.bytes,
    });
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

export async function runOnce(config, heartbeat = true) {
  if (heartbeat) await machineHeartbeat(config);
  const result = await runnerRequest(config, "/api/creative-studio/runner/jobs/claim", { method: "POST", body: "{}" });
  if (!result.bundle) return false;
  process.stdout.write(`[Creative Studio Runner] claimed ${result.bundle.job.id}: ${result.bundle.workflow.name}\n`);
  await executeBundle(config, result.bundle);
  return true;
}

function selfTest() {
  const graph = { "1": { class_type: "LoadImage", inputs: { image: "old.png" } } };
  const parameters = [{ id: "1::image", kind: "media", binding: { format: "comfyui-api", nodeId: "1", inputName: "image" } }];
  const patched = applyInputFilenames(graph, parameters, { "1::image": "new.png" });
  if (patched["1"].inputs.image !== "new.png" || graph["1"].inputs.image !== "old.png") throw new Error("runner_self_test_patch_failed");
  const output = findComfyOutput({ outputs: { "9": { images: [{ filename: "result.png", type: "output" }] } } }, "image");
  if (output?.filename !== "result.png") throw new Error("runner_self_test_output_failed");
  process.stdout.write("Creative Studio Local Runner self-test passed.\n");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const config = loadConfig();
  const once = process.argv.includes("--once");
  let lastHeartbeat = 0;
  process.stdout.write(`[Creative Studio Runner] v${RUNNER_VERSION} · ${config.apiBase} · ${config.comfyUrl}\n`);
  do {
    try {
      const heartbeat = once || Date.now() - lastHeartbeat >= 30_000;
      await runOnce(config, heartbeat);
      if (heartbeat) lastHeartbeat = Date.now();
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "runner_loop_failed";
      process.stderr.write(`[Creative Studio Runner] ${error}\n`);
      await machineHeartbeat(config, null, error).catch(() => undefined);
    }
    if (!once) await sleep(config.pollIntervalMs);
  } while (!once);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[Creative Studio Runner] fatal: ${error.message}\n`);
    process.exitCode = 1;
  });
}
