export const VIDEO_DOCTOR_SCHEMA_VERSION = "creative-studio-video-doctor/1.0" as const;

export const VIDEO_DOCTOR_FINDING_CODES = [
  "unowned-comfy-prompt",
  "orphaned-terminal-prompt",
  "external-comfy-work",
  "partial-comfy-api",
  "queue-unreachable",
  "queue-invalid",
  "log-stream-stale",
  "log-stream-unavailable",
  "cold-model-load",
  "host-buffer-resource-failure",
  "memory-pressure",
  "cuda-out-of-memory",
  "missing-model",
  "prompt-validation-failed",
  "execution-failed",
  "output-not-saved",
] as const;

export type VideoDoctorFindingCode = typeof VIDEO_DOCTOR_FINDING_CODES[number];
export type VideoDoctorSeverity = "info" | "warning" | "critical";
export type VideoDoctorStatus = "ready" | "working" | "attention" | "blocked" | "unknown";
export type VideoDoctorQueueState = "idle" | "busy" | "unreachable" | "invalid" | "unknown";
export type VideoDoctorLogState = "current" | "stale" | "unavailable" | "not-configured";
export type VideoDoctorApiState = "available" | "unavailable" | "unknown";

export type VideoDoctorFinding = {
  code: VideoDoctorFindingCode;
  severity: VideoDoctorSeverity;
  count: number | null;
  nodeId: string | null;
  nodeType: string | null;
};

export type VideoDoctorReport = {
  schemaVersion: typeof VIDEO_DOCTOR_SCHEMA_VERSION;
  status: VideoDoctorStatus;
  canClaimVideo: boolean;
  checkedAt: string;
  systemStats: VideoDoctorApiState;
  queue: {
    state: VideoDoctorQueueState;
    running: number;
    pending: number;
    promptId: string | null;
    creativeStudioJobId: string | null;
    promptStartedAt: string | null;
    activeJobMatch: boolean | null;
    jobStatus: "queued" | "running" | "retaining" | "completed" | "failed" | "cancelled" | null;
    blockedVideoJobs: number;
  };
  log: {
    state: VideoDoctorLogState;
    updatedAt: string | null;
  };
  findings: VideoDoctorFinding[];
};

export type VideoDoctorGuidance = {
  title: string;
  summary: string;
  action: string;
  requiresConfirmation: boolean;
};

const GUIDANCE: Record<VideoDoctorFindingCode, VideoDoctorGuidance> = {
  "orphaned-terminal-prompt": {
    title: "A finished job still owns Comfy",
    summary: "Comfy is still running a prompt whose Creative Studio job is already terminal, so no queued video can start.",
    action: "Let that exact prompt finish or stop it with confirmation in Comfy, then recheck before retrying the failed video.",
    requiresConfirmation: true,
  },
  "unowned-comfy-prompt": {
    title: "Comfy is busy outside the active job",
    summary: "A Creative Studio prompt is still in Comfy, but the runner is no longer heartbeating its job.",
    action: "Inspect that exact prompt in Comfy. Let it finish or stop it with confirmation before starting another video.",
    requiresConfirmation: true,
  },
  "external-comfy-work": {
    title: "Comfy is busy with other work",
    summary: "A prompt outside the active Creative Studio job is using Comfy, so new videos are waiting safely.",
    action: "Let that work finish or stop it in Comfy with confirmation, then recheck the queue.",
    requiresConfirmation: true,
  },
  "partial-comfy-api": {
    title: "Comfy is only partly responding",
    summary: "The queue responds, but system status does not. The current runner will not claim new work in this state.",
    action: "After the exact running prompt is finished or drained, restart Comfy and recheck system status.",
    requiresConfirmation: true,
  },
  "queue-unreachable": {
    title: "The Comfy queue cannot be verified",
    summary: "Creative Studio cannot prove whether Comfy is idle or still rendering, so it is safely holding new work.",
    action: "Check that Comfy is running on localhost and recheck. Do not start a second render until the queue is visible.",
    requiresConfirmation: false,
  },
  "queue-invalid": {
    title: "The Comfy queue response is invalid",
    summary: "Comfy answered, but its queue shape was not safe to interpret.",
    action: "Check the current Comfy build and custom-node startup output, then recheck before generating.",
    requiresConfirmation: false,
  },
  "log-stream-stale": {
    title: "The Comfy log is stale",
    summary: "The configured log stopped before the current prompt, so it cannot explain this render by itself.",
    action: "Restore Comfy stdout/stderr logging after the current prompt is safe; use live queue and job evidence for this incident.",
    requiresConfirmation: false,
  },
  "log-stream-unavailable": {
    title: "The Comfy log cannot be read",
    summary: "Live API evidence is available, but the local diagnostic log is missing or unreadable.",
    action: "Point the runner at the current Comfy log and keep that file owner-readable only.",
    requiresConfirmation: false,
  },
  "cold-model-load": {
    title: "The video model is loading",
    summary: "The newest prompt is still in its first model-load phase; this can be much slower than a warm same-model run.",
    action: "Leave the prompt running while activity continues. Avoid loading another GPU model until this phase finishes.",
    requiresConfirmation: false,
  },
  "host-buffer-resource-failure": {
    title: "Windows could not supply a model buffer",
    summary: "Comfy logged a host-buffer read failure associated with Windows resource exhaustion. This is not proven CUDA out-of-memory.",
    action: "Stop blind retries. Once the queue is safely drained, check system-drive headroom, pagefile and RAM pressure before restarting Comfy.",
    requiresConfirmation: true,
  },
  "memory-pressure": {
    title: "Comfy reports sustained memory pressure",
    summary: "Repeated watermark warnings indicate pressure, but do not prove the render has failed.",
    action: "Keep watching progress. If the prompt later fails, use the paired error finding before changing the workflow.",
    requiresConfirmation: false,
  },
  "cuda-out-of-memory": {
    title: "The GPU ran out of memory",
    summary: "The current Comfy log contains an explicit CUDA out-of-memory failure.",
    action: "After the prompt is drained, use the safer video profile or reduce resolution, frames or model overlap before retrying.",
    requiresConfirmation: false,
  },
  "missing-model": {
    title: "A required model is missing",
    summary: "Comfy could not find a model required by the selected workflow revision.",
    action: "Install or remap the named model in Comfy, refresh model discovery, then retry the same saved workflow revision.",
    requiresConfirmation: false,
  },
  "prompt-validation-failed": {
    title: "The workflow was rejected",
    summary: "Comfy rejected a node or input before video rendering began.",
    action: "Repair the reported workflow node or setting, save a new immutable revision, and retry from Creative Studio.",
    requiresConfirmation: false,
  },
  "execution-failed": {
    title: "A Comfy node failed",
    summary: "Comfy accepted the prompt but a node failed during execution.",
    action: "Inspect the sanitized node detail, correct that model or workflow dependency, and retry only after the queue is clear.",
    requiresConfirmation: false,
  },
  "output-not-saved": {
    title: "The workflow produced no saved video",
    summary: "Execution ended without a usable saved-video output.",
    action: "Connect and validate the workflow's video output node, save a new revision, then retry.",
    requiresConfirmation: false,
  },
};

export function videoDoctorGuidance(code: VideoDoctorFindingCode): VideoDoctorGuidance {
  return GUIDANCE[code];
}

export function primaryVideoDoctorFinding(report: VideoDoctorReport | null | undefined) {
  if (!report?.findings.length) return null;
  const priority: Record<VideoDoctorSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...report.findings].sort((left, right) => priority[left.severity] - priority[right.severity])[0];
}
