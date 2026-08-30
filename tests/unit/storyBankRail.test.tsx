import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryPromptRecommendation, StoryThread } from "../../shared/contracts";
import { RecommendedDirectionsRail, StoryBankRail } from "../../src/features/stories/StoryBankRail";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-08-29T18:00:00.000Z";

function recommendation(
  modality: StoryPromptRecommendation["modality"],
  status: StoryPromptRecommendation["status"],
): StoryPromptRecommendation {
  return {
    id: `storyprompt_${modality}`,
    storyId: "story_luminous_orbit",
    version: 2,
    modality,
    role: modality === "image" ? "signature" : modality === "video" ? "frontier" : "awe",
    title: `${modality} direction`,
    prompt: `Exact reusable ${modality} prompt grounded in the retained luminous source.`,
    promptHash: modality.repeat(64).slice(0, 64),
    sourceId: "media_luminous_source",
    sourceType: "upload",
    sourceKind: "image",
    workflowId: `workflow_${modality}`,
    workflowRevisionId: `workflowrev_${modality}_4`,
    recipeId: `recipe_${modality}`,
    modelTarget: `Local ${modality} model`,
    durationSeconds: modality === "video" ? 5 : null,
    aspectRatio: modality === "music" ? null : "9:16",
    estimatedDurationMs: modality === "video" ? 120_000 : 45_000,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const story: StoryThread = {
  id: "story_luminous_orbit",
  projectId: "project_story",
  worldId: null,
  dnaArtifactId: "dna_story",
  title: "The chamber learns the signal",
  logline: "An amber organism crosses a mineral chamber whose light begins answering its pulse.",
  status: "developing",
  pinned: true,
  version: 5,
  sourceRefs: [{ id: "media_luminous_source", sourceType: "upload", kind: "image" }],
  evidenceFingerprint: "a".repeat(64),
  plannerProvider: "local-comfyui",
  plannerModel: "gemma4_e4b_it_fp8_scaled.safetensors",
  createdAt: NOW,
  updatedAt: NOW,
  recommendations: [
    recommendation("image", "ready"),
    recommendation("video", "stale"),
    recommendation("music", "used"),
  ],
};

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Story Bank recommendation rails", () => {
  it("shows only reusable current recommendations and hands off the exact stored object", async () => {
    const onUse = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<StoryBankRail
      threads={[story]}
      projectId={story.projectId}
      development={false}
      hasCreativeEvidence
      refreshStatus="completed"
      onUse={onUse}
    />));

    expect(container.textContent).toContain(story.title);
    expect(container.textContent).toContain("Image");
    expect(container.textContent).toContain("Song");
    expect(container.textContent).not.toContain("Video");

    const imageButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Image");
    await act(async () => imageButton?.click());
    expect(onUse).toHaveBeenCalledOnce();
    expect(onUse).toHaveBeenCalledWith({ story, recommendation: story.recommendations[0] });
  });

  it("lets the owner pin, park, restore, and archive evolving stories", async () => {
    const onUpdate = vi.fn<(story: StoryThread, input: { expectedVersion: number; status?: StoryThread["status"]; pinned?: boolean }) => void>();
    const activeStory = { ...story, pinned: false };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<StoryBankRail
      threads={[activeStory]}
      projectId={story.projectId}
      development={false}
      hasCreativeEvidence
      refreshStatus="completed"
      onUse={vi.fn()}
      onUpdate={onUpdate}
    />));

    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Pin ${story.title}"]`)?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Park ${story.title}"]`)?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Archive ${story.title}"]`)?.click());
    expect(onUpdate.mock.calls).toEqual([
      [activeStory, { expectedVersion: 5, pinned: true }],
      [activeStory, { expectedVersion: 5, status: "parked" }],
      [activeStory, { expectedVersion: 5, status: "archived" }],
    ]);

    onUpdate.mockClear();
    const parkedStory = { ...story, status: "parked" as const };
    await act(async () => root?.render(<StoryBankRail
      threads={[parkedStory]}
      projectId={story.projectId}
      development={false}
      hasCreativeEvidence
      refreshStatus="completed"
      onUse={vi.fn()}
      onUpdate={onUpdate}
    />));
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Restore")?.click());
    expect(onUpdate).toHaveBeenCalledWith(parkedStory, { expectedVersion: 5, status: "developing" });
  });

  it("does not offer a stale model direction in Create", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(<RecommendedDirectionsRail
      threads={[story]}
      projectId={story.projectId}
      modality="video"
      onUse={vi.fn()}
    />));

    expect(container.querySelector("[aria-label='Recommended video directions']")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
