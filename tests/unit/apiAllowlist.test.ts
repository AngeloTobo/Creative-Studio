import { describe, expect, it } from "vitest";
import { matchCreativeStudioRoute } from "../../shared/contracts";

describe("Creative Studio BFF route allowlist", () => {
  it("matches only named product capabilities", () => {
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/dna")).toBe("dna-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/projects")).toBe("project-create");
    expect(matchCreativeStudioRoute("PATCH", "/api/creative-studio/projects/project_123")).toBe("project-update");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/projects/project_123/archive")).toBe("project-archive");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs")).toBe("jobs-create");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs/job_123/retry")).toBe("job-retry");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs/job_123/cancel")).toBe("job-cancel");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/jobs/job_123/reuse")).toBe("job-reuse");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/artifacts/artifact_123/accepted")).toBe("artifact-review");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/media")).toBe("media-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/media")).toBe("media-upload");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/media/media_123/content")).toBe("media-content");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/workflows")).toBe("workflows-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/workflows")).toBe("workflow-import");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/workflows/workflow_123/revisions")).toBe("workflow-revision-create");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/workflows/workflow_123/content")).toBe("workflow-content");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/training-jobs")).toBe("training-jobs-list");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/training-jobs")).toBe("training-job-create");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/training-jobs/dnatraining_123/claim")).toBe("training-job-claim");
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/training-jobs/dnatraining_123/bundle")).toBe("training-job-bundle");
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/training-jobs/dnatraining_123/complete")).toBe("training-job-complete");
  });

  it("does not become a generic AFDFW proxy", () => {
    expect(matchCreativeStudioRoute("GET", "/api/creative-studio/admin")) .toBeNull();
    expect(matchCreativeStudioRoute("POST", "/api/creative-studio/proxy/api/profile")) .toBeNull();
    expect(matchCreativeStudioRoute("GET", "/api/profile-image/generations")) .toBeNull();
  });
});
