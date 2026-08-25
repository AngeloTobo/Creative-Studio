import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Artifact } from "../../shared/contracts";
import { ArtifactThumb } from "../../src/components/Visuals";
import { ArtifactMediaReview } from "../../src/features/artifacts/ArtifactsView";
import { jobIssuePresentation } from "../../src/features/generation/jobFailure";

function artifact(kind: Artifact["kind"]): Artifact {
  return {
    id: `artifact-${kind}`,
    projectId: "project-review",
    jobId: `job-${kind}`,
    dnaArtifactId: "dna-review",
    kind,
    name: `Review ${kind}`,
    status: "ready",
    provider: "afdfw",
    prompt: `Original ${kind} prompt`,
    preview: { kind: "remote-media", url: `/api/creative-studio/artifacts/artifact-${kind}/media`, posterUrl: kind === "video" ? `/api/creative-studio/artifacts/artifact-${kind}/thumbnail` : null, colors: ["#111827", "#7c3aed"] },
    lineage: { sourceArtifactIds: [], parentArtifactId: null },
    retention: { state: "retained", size: 1024 },
    settingsStamp: {
      schemaVersion: 1,
      source: "creative-dna",
      createdAt: "2026-08-16T12:00:00.000Z",
      reusedFromJobId: null,
      prompt: `Original ${kind} prompt`,
      provider: "afdfw",
      modality: kind,
      workflow: null,
      parameters: {},
      models: [],
      inputAssetIds: [],
    },
    createdAt: "2026-08-16T12:00:00.000Z",
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
}

describe("real artifact media review", () => {
  it("renders retained music as audio with download and retained images as inspectable images", () => {
    const music = artifact("music");
    const musicMarkup = renderToStaticMarkup(<><ArtifactThumb artifact={music} /><ArtifactMediaReview artifact={music} onInspect={() => undefined} /></>);
    expect(musicMarkup).toContain("<audio");
    expect(musicMarkup).toContain("Download audio");
    expect(musicMarkup).toContain("download=");
    expect(musicMarkup).not.toContain("<img");

    const image = artifact("image");
    const imageMarkup = renderToStaticMarkup(<><ArtifactThumb artifact={image} /><ArtifactMediaReview artifact={image} onInspect={() => undefined} /></>);
    expect(imageMarkup).toContain("<img");
    expect(imageMarkup).toContain("Inspect full-size image");
    expect(imageMarkup).not.toContain("<audio");

    const video = artifact("video");
    const videoMarkup = renderToStaticMarkup(<><ArtifactThumb artifact={video} playable /><ArtifactMediaReview artifact={video} onInspect={() => undefined} onExtend={() => undefined} /></>);
    expect(videoMarkup).toContain("<video");
    expect(videoMarkup.match(/<video/g)).toHaveLength(1);
    expect(videoMarkup).toContain("controls=\"\"");
    expect(videoMarkup).toContain("poster=\"/api/creative-studio/artifacts/artifact-video/thumbnail\"");
    expect(videoMarkup).toContain("#t=0.001");
    expect(videoMarkup).toContain("Download video");
    expect(videoMarkup).toContain("Extend video");
    expect(videoMarkup).not.toContain("Inspect full-size image");
  });

  it("turns stored job error codes into actionable failure details without hiding the provider code", () => {
    expect(jobIssuePresentation("failed", "artifact_retention_verification_failed", "image")).toEqual({
      title: "Job failed",
      summary: "Creative Studio received media bytes that did not match the provider's declared size. Check the upstream output, then retry retention through a new job.",
      action: "Retry creates a new durable image job from the same CreativeDNA; this failed job remains in history.",
      raw: "artifact_retention_verification_failed",
    });
    expect(jobIssuePresentation("failed", "comfyui_media_output_not_scheduled", "video")).toEqual({
      title: "Job failed",
      summary: "ComfyUI accepted the graph but did not schedule its saved-media output. The job stopped immediately instead of blocking the runner; repair or re-export the workflow before retrying.",
      action: "Retry creates a new durable video job from the same CreativeDNA; this failed job remains in history.",
      raw: "comfyui_media_output_not_scheduled",
    });
    expect(jobIssuePresentation("running", null, "music")).toBeNull();
  });
});
