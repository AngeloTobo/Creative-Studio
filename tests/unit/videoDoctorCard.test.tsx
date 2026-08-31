// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VideoDoctorReport } from "../../shared/contracts";
import { VideoDoctorCard } from "../../src/features/runtime/VideoDoctorCard";

describe("Video Doctor card", () => {
  it("renders one prioritized action and keeps evidence collapsed", () => {
    const report: VideoDoctorReport = {
      schemaVersion: "creative-studio-video-doctor/1.0",
      status: "blocked",
      canClaimVideo: false,
      checkedAt: new Date().toISOString(),
      systemStats: "unavailable",
      queue: {
        state: "busy",
        running: 1,
        pending: 0,
        promptId: "prompt_video_1",
        creativeStudioJobId: "job_video_1",
        promptStartedAt: new Date(Date.now() - 60_000).toISOString(),
        activeJobMatch: false,
        jobStatus: "failed",
        blockedVideoJobs: 5,
      },
      log: { state: "stale", updatedAt: new Date(Date.now() - 3_600_000).toISOString() },
      findings: [
        { code: "orphaned-terminal-prompt", severity: "critical", count: null, nodeId: null, nodeType: null },
        { code: "partial-comfy-api", severity: "warning", count: null, nodeId: null, nodeType: null },
      ],
    };

    const html = renderToStaticMarkup(<VideoDoctorCard report={report} />);
    expect(html).toContain("A finished job still owns Comfy");
    expect(html).toContain("What to do");
    expect(html).toContain("5 queued videos waiting behind this");
    expect(html).toContain("<details");
    expect(html).toContain("Comfy is only partly responding");
  });
});
