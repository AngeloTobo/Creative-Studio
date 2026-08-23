import { describe, expect, it } from "vitest";
import { matchCreativeStudioRoute } from "../../shared/contracts";

describe("Creative Studio BFF route allowlist", () => {
  it("matches only named product capabilities", () => {
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/snapshot")).toBe("snapshot");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/dna")).toBe("dna-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/projects")).toBe("project-create");
    expect(matchCreativeStudioRoute("PATCH", "/api/creative-studio/projects/project_123")).toBe("project-update");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/projects/project_123/archive")).toBe("project-archive");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs")).toBe("jobs-create");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs/job_123/retry")).toBe("job-retry");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs/job_123/cancel")).toBe("job-cancel");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs/job_123/reuse")).toBe("job-reuse");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/artifacts/artifact_123/accepted")).toBe("artifact-review");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/artifacts/artifact_123/thumbnail")).toBe("artifact-thumbnail");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/media")).toBe("media-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/media")).toBe("media-upload");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/media/media_123/content")).toBe("media-content");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/workflows")).toBe("workflows-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/workflows")).toBe("workflow-import");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/workflows/workflow_123/revisions")).toBe("workflow-revision-create");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/workflows/workflow_123/content")).toBe("workflow-content");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/training-jobs")).toBe("training-jobs-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/training-jobs")).toBe("training-job-create");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/training-jobs/dnatraining_123/review")).toBe("training-job-review");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/production-loops")).toBe("production-loops");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/production-cockpit")).toBe("production-cockpit");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/training/claim")).toBe("runner-training-claim");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/work/claim")).toBe("runner-work-claim");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/jobs/job_123/thumbnail")).toBe("runner-job-thumbnail");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/training/dnatraining_123/heartbeat")).toBe("runner-training-heartbeat");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/training/dnatraining_123/complete")).toBe("runner-training-complete");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/runner/training/dnatraining_123/fail")).toBe("runner-training-fail");
  });

  it("does not become a generic AFDFW proxy", () => {
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/admin")) .toBeNull();
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/proxy/api/profile")) .toBeNull();
    expect(matchCreativeStudioRoute("GET", "/api/profile-image/generations")) .toBeNull();
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/training-jobs/dnatraining_123/complete")) .toBeNull();
  });
});
