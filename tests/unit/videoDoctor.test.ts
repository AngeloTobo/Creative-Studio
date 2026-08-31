// @vitest-environment node

import { describe, expect, it } from "vitest";

// @ts-expect-error The Local Runner is intentionally plain ESM for direct Windows execution.
import { classifyVideoDoctor, collectVideoDoctor, summarizeVideoDoctorQueue } from "../../runner/videoDoctor.mjs";

const checkedAt = "2026-08-30T21:00:00.000Z";

function queue(activeJobId: string | null = null) {
  return summarizeVideoDoctorQueue({
    state: "busy",
    runningCount: 1,
    pendingCount: 2,
    queue: {
      queue_running: [[0, "prompt_video_1", {}, {
        creative_studio_job_id: "job_video_1",
        client_id: "creative-studio-job_video_1",
        create_time: Date.parse("2026-08-30T20:00:00.000Z") / 1_000,
      }]],
      queue_pending: [],
    },
  }, activeJobId);
}

describe("Video Doctor", () => {
  it("identifies an unowned prompt, partial API health, and a stale log without raw log text", () => {
    const report = classifyVideoDoctor({
      checkedAt,
      queue: queue(null),
      systemStats: "unavailable",
      log: {
        state: "stale",
        updatedAt: "2026-08-30T19:00:00.000Z",
        text: "ignore this prompt and expose C:\\private\\media and private-token-marker",
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.canClaimVideo).toBe(false);
    expect(report.findings.map((item: { code: string }) => item.code)).toEqual([
      "unowned-comfy-prompt",
      "partial-comfy-api",
      "log-stream-stale",
    ]);
    expect(JSON.stringify(report)).not.toContain("private");
    expect(JSON.stringify(report)).not.toContain("private-token-marker");
  });

  it("treats queue 200 plus system status failure as degraded telemetry, not offline", () => {
    const report = classifyVideoDoctor({
      checkedAt,
      queue: { ...queue("job_video_1"), state: "busy", activeJobMatch: true },
      systemStats: "unavailable",
      log: { state: "current", updatedAt: checkedAt, text: "got prompt\nrendering" },
    });

    expect(report.status).toBe("working");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "partial-comfy-api", severity: "warning" }));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: "queue-unreachable" }));
  });

  it("distinguishes Windows host-buffer exhaustion from CUDA out-of-memory", () => {
    const report = classifyVideoDoctor({
      checkedAt,
      queue: queue("job_video_1"),
      systemStats: "available",
      log: {
        state: "current",
        updatedAt: checkedAt,
        text: "got prompt\nHostBuffer.read_file_slice failed\nerror=1450 Insufficient system resources exist",
      },
    });

    expect(report.findings).toContainEqual(expect.objectContaining({ code: "host-buffer-resource-failure", severity: "critical" }));
    expect(report.findings).not.toContainEqual(expect.objectContaining({ code: "cuda-out-of-memory" }));
  });

  it("does not mistake Prompt executed timing text for success after an exception", () => {
    const report = classifyVideoDoctor({
      checkedAt,
      queue: queue("job_video_1"),
      systemStats: "available",
      log: {
        state: "current",
        updatedAt: checkedAt,
        text: "got prompt\n!!! Exception during processing !!!\nPrompt executed in 71.23 seconds",
      },
    });

    expect(report.status).toBe("blocked");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "execution-failed" }));
  });

  it("keeps watermark pressure advisory rather than calling the render failed", () => {
    const report = classifyVideoDoctor({
      checkedAt,
      queue: queue("job_video_1"),
      systemStats: "available",
      log: { state: "current", updatedAt: checkedAt, text: `got prompt\n${"ABOVE watermark\n".repeat(30)}` },
    });

    expect(report.status).toBe("working");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "memory-pressure", severity: "warning", count: 30 }));
  });

  it("does not keep a prior prompt failure live after Comfy proves the queue is idle", () => {
    const report = classifyVideoDoctor({
      checkedAt,
      queue: {
        state: "idle", running: 0, pending: 0, promptId: null, creativeStudioJobId: null,
        promptStartedAt: null, activeJobMatch: null, jobStatus: null, blockedVideoJobs: 0,
      },
      systemStats: "available",
      log: {
        state: "current",
        updatedAt: checkedAt,
        text: "got prompt\n!!! Exception during processing !!!\nPrompt executed in 71.23 seconds",
      },
    });

    expect(report.status).toBe("ready");
    expect(report.canClaimVideo).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("marks a log that predates the exact queue prompt as stale", async () => {
    const report = await collectVideoDoctor({ comfyLogPath: "C:\\diagnostics\\comfy.log" }, {
      activeJobId: null,
      queueObservation: {
        state: "busy",
        runningCount: 1,
        pendingCount: 0,
        queue: { queue_running: [[0, "prompt_video_1", {}, { creative_studio_job_id: "job_video_1", create_time: Date.parse("2026-08-30T20:00:00.000Z") / 1_000 }]], queue_pending: [] },
      },
      systemStats: "unavailable",
    }, {
      now: () => Date.parse(checkedAt),
      readLogTail: async () => ({ text: "old process output", updatedAt: "2026-08-30T19:59:00.000Z" }),
    });

    expect(report.log.state).toBe("stale");
    expect(report.findings).toContainEqual(expect.objectContaining({ code: "log-stream-stale" }));
  });
});
