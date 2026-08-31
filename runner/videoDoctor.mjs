import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const VIDEO_DOCTOR_SCHEMA_VERSION = "creative-studio-video-doctor/1.0";
export const VIDEO_DOCTOR_LOG_TAIL_BYTES = 512 * 1024;

const DEFAULT_LOG_CANDIDATES = [
  "D:\\ComfyUI\\ComfyUI\\user\\comfyui_8188.log",
  "D:\\ComfyUI\\logs\\comfyui.log",
  join(homedir(), "ComfyUI", "user", "comfyui_8188.log"),
];

function boundedIdentifier(value, maximum = 120) {
  const text = String(value || "").trim();
  return /^[a-z0-9_.:-]+$/i.test(text) ? text.slice(0, maximum) : null;
}

function validDate(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function countMatches(text, expression) {
  return [...text.matchAll(expression)].length;
}

function queuePrompt(record) {
  if (!Array.isArray(record)) return null;
  const extra = record[3] && typeof record[3] === "object" ? record[3] : {};
  const createTime = Number(extra.create_time);
  const promptStartedAt = Number.isFinite(createTime) && createTime > 0
    ? new Date(createTime > 10_000_000_000 ? createTime : createTime * 1_000).toISOString()
    : null;
  return {
    promptId: boundedIdentifier(record[1]),
    creativeStudioJobId: boundedIdentifier(extra.creative_studio_job_id, 100),
    promptStartedAt,
  };
}

export function summarizeVideoDoctorQueue(observation, activeJobId = null) {
  const state = ["idle", "busy", "unreachable", "invalid"].includes(observation?.state)
    ? observation.state : "unknown";
  const queue = observation?.queue && typeof observation.queue === "object" ? observation.queue : {};
  const runningRows = Array.isArray(queue.queue_running) ? queue.queue_running : [];
  const pendingRows = Array.isArray(queue.queue_pending) ? queue.queue_pending : [];
  const firstPrompt = queuePrompt(runningRows[0] ?? pendingRows[0]);
  const safeActiveJobId = boundedIdentifier(activeJobId, 100);
  return {
    state,
    running: Math.max(0, Math.min(100, Number(observation?.runningCount ?? runningRows.length) || 0)),
    pending: Math.max(0, Math.min(100, Number(observation?.pendingCount ?? pendingRows.length) || 0)),
    promptId: firstPrompt?.promptId ?? null,
    creativeStudioJobId: firstPrompt?.creativeStudioJobId ?? null,
    promptStartedAt: firstPrompt?.promptStartedAt ?? null,
    activeJobMatch: firstPrompt?.creativeStudioJobId
      ? Boolean(safeActiveJobId && firstPrompt.creativeStudioJobId === safeActiveJobId)
      : null,
    jobStatus: null,
    blockedVideoJobs: 0,
  };
}

export function resolveComfyLogPath(config = {}, options = {}) {
  const configured = String(options.comfyLogPath || config.comfyLogPath || process.env.CS_COMFY_LOG_PATH || "").trim();
  if (configured) return { path: configured, configured: true };
  const candidates = Array.isArray(options.logCandidates) ? options.logCandidates : DEFAULT_LOG_CANDIDATES;
  const discovered = candidates.find((candidate) => candidate && existsSync(candidate));
  return { path: discovered || null, configured: false };
}

export async function readComfyLogTail(path, options = {}) {
  const maximum = Math.max(1, Math.min(VIDEO_DOCTOR_LOG_TAIL_BYTES, Number(options.maximumBytes) || VIDEO_DOCTOR_LOG_TAIL_BYTES));
  const handle = await open(path, "r");
  try {
    const details = await handle.stat();
    const length = Math.min(details.size, maximum);
    const buffer = Buffer.alloc(length);
    if (length) await handle.read(buffer, 0, length, Math.max(0, details.size - length));
    return { text: buffer.toString("utf8"), updatedAt: details.mtime.toISOString() };
  } finally {
    await handle.close();
  }
}

function finding(code, severity, values = {}) {
  return {
    code,
    severity,
    count: Number.isFinite(values.count) ? Math.max(0, Math.min(10_000, Math.round(values.count))) : null,
    nodeId: boundedIdentifier(values.nodeId, 80),
    nodeType: boundedIdentifier(values.nodeType, 120),
  };
}

function diagnosticLogScope(text) {
  const markers = ["got prompt", "Prompt received", "Received prompt"];
  const lower = text.toLowerCase();
  const start = Math.max(...markers.map((marker) => lower.lastIndexOf(marker.toLowerCase())));
  return start >= 0 ? text.slice(start) : text.slice(-128 * 1024);
}

export function classifyVideoDoctor(input) {
  const checkedAt = validDate(input.checkedAt) || new Date().toISOString();
  const queue = input.queue;
  const systemStats = ["available", "unavailable"].includes(input.systemStats) ? input.systemStats : "unknown";
  const findings = [];

  if (queue.state === "unreachable") findings.push(finding("queue-unreachable", "critical"));
  if (queue.state === "invalid") findings.push(finding("queue-invalid", "critical"));
  if (queue.state === "busy" && queue.creativeStudioJobId && queue.activeJobMatch === false) {
    findings.push(finding("unowned-comfy-prompt", "critical"));
  } else if (queue.state === "busy" && !queue.creativeStudioJobId) {
    findings.push(finding("external-comfy-work", "warning"));
  }
  if (systemStats === "unavailable" && queue.state === "idle") findings.push(finding("partial-comfy-api", "critical"));
  else if (systemStats === "unavailable" && ["busy", "unknown"].includes(queue.state)) findings.push(finding("partial-comfy-api", "warning"));

  const log = input.log || { state: "not-configured", updatedAt: null, text: "" };
  if (log.state === "stale" && queue.state === "busy") findings.push(finding("log-stream-stale", "warning"));
  if (log.state === "unavailable" && queue.state === "busy") findings.push(finding("log-stream-unavailable", "warning"));

  // An idle queue is authoritative for current claim safety. Old prompt-local errors can
  // remain at the end of a healthy log, so retain them only while work is present or the
  // queue itself is no longer observable (for example, after a Comfy process failure).
  if (log.state === "current" && log.text && queue.state !== "idle") {
    const scope = diagnosticLogScope(log.text);
    const watermarkCount = countMatches(scope, /ABOVE watermark/gi);
    if (/CUDA out of memory|torch\.OutOfMemoryError|OutOfMemoryError[^\r\n]{0,80}CUDA/i.test(scope)) {
      findings.push(finding("cuda-out-of-memory", "critical"));
    }
    if (/HostBuffer\.read_file_slice failed|(?:WinError|error\s*[=:]?)\s*1450|Insufficient system resources exist/i.test(scope)) {
      findings.push(finding("host-buffer-resource-failure", "critical"));
    }
    if (/(?:model|checkpoint)[^\r\n]{0,100}(?:not found|missing)|No such file or directory[^\r\n]{0,100}(?:safetensors|checkpoint|models?)/i.test(scope)) {
      findings.push(finding("missing-model", "critical"));
    }
    if (/Failed to validate prompt|Prompt outputs failed validation|comfyui_prompt_rejected|invalid prompt/i.test(scope)) {
      findings.push(finding("prompt-validation-failed", "critical"));
    } else if (/!!! Exception during processing !!!|execution_error/i.test(scope)) {
      findings.push(finding("execution-failed", "critical"));
    }
    if (/comfyui_media_output_not_scheduled|completed_without_(?:media_)?output/i.test(scope)) {
      findings.push(finding("output-not-saved", "critical"));
    }
    if (watermarkCount >= 25) findings.push(finding("memory-pressure", "warning", { count: watermarkCount }));
    const loadIndex = Math.max(scope.lastIndexOf("Requested to load LTX"), scope.lastIndexOf("Requested to load LTXV"));
    const loadedIndex = Math.max(scope.lastIndexOf("loaded completely"), scope.lastIndexOf("fully loaded"));
    if (queue.state === "busy" && loadIndex >= 0 && loadedIndex < loadIndex) findings.push(finding("cold-model-load", "info"));
  }

  const uniqueFindings = findings.filter((item, index) => findings.findIndex((candidate) => candidate.code === item.code) === index).slice(0, 8);
  const hasCritical = uniqueFindings.some((item) => item.severity === "critical");
  const hasWarning = uniqueFindings.some((item) => item.severity === "warning");
  const activeRender = queue.state === "busy" && queue.activeJobMatch === true;
  const canClaimVideo = queue.state === "idle" && systemStats === "available";
  const status = hasCritical ? "blocked"
    : activeRender ? "working"
      : hasWarning ? "attention"
        : canClaimVideo ? "ready"
          : queue.state === "busy" ? "working" : "unknown";
  return {
    schemaVersion: VIDEO_DOCTOR_SCHEMA_VERSION,
    status,
    canClaimVideo,
    checkedAt,
    systemStats,
    queue,
    log: { state: log.state, updatedAt: validDate(log.updatedAt) },
    findings: uniqueFindings,
  };
}

export async function collectVideoDoctor(config, context = {}, options = {}) {
  const now = options.now || Date.now;
  const checkedAt = new Date(now()).toISOString();
  const queue = summarizeVideoDoctorQueue(context.queueObservation, context.activeJobId);
  const resolvedLog = resolveComfyLogPath(config, options);
  let log = { state: resolvedLog.path ? "unavailable" : "not-configured", updatedAt: null, text: "" };
  if (resolvedLog.path) {
    try {
      const snapshot = await (options.readLogTail || readComfyLogTail)(resolvedLog.path, options);
      const updatedAt = validDate(snapshot.updatedAt);
      const updatedTime = Date.parse(updatedAt || "");
      const promptTime = Date.parse(queue.promptStartedAt || "");
      const predatesPrompt = Number.isFinite(promptTime) && Number.isFinite(updatedTime) && updatedTime < promptTime - 30_000;
      const oldWithoutPromptTime = !Number.isFinite(promptTime) && Number.isFinite(updatedTime) && now() - updatedTime > 20 * 60_000;
      log = { state: predatesPrompt || oldWithoutPromptTime ? "stale" : "current", updatedAt, text: String(snapshot.text || "") };
    } catch {
      log = { state: "unavailable", updatedAt: null, text: "" };
    }
  }
  return classifyVideoDoctor({
    checkedAt,
    queue,
    systemStats: context.systemStats,
    log,
  });
}
