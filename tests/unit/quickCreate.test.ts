import { describe, expect, it } from "vitest";
import { musicWorkflowLyricsParameter, type Job, type WorkflowDefinition, type WorkflowParameter } from "../../shared/contracts";
import { failedQuickWorkflowRecipeSignatures, preferredQuickWorkflow, quickAnimationDirection, quickGenerationSourceUsage, quickInputBindings, quickParameterValue, quickWorkflowRecipeSignature, workflowCreateIntent } from "../../src/features/generation/quickCreate";

function workflow(id: string, modality: WorkflowDefinition["modality"], mediaKind: WorkflowParameter["mediaKind"] = null): WorkflowDefinition {
  return {
    id, projectId: "project_1", name: id, description: "", sourceFileName: `${id}.json`, modality,
    executionState: "ready", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
    currentRevision: {
      id: `${id}_revision`, workflowId: id, version: 1, parentRevisionId: null, format: "comfyui-api", contentHash: id,
      nodeCount: 1, models: [], createdAt: "2026-08-23T00:00:00.000Z",
      parameters: mediaKind ? [{ id: `${id}_media`, label: "Source", kind: "media", value: "source.png", mediaKind, binding: { format: "comfyui-api", nodeId: "1", inputName: mediaKind } }] : [],
    },
  };
}

function workflowAttempt(
  workflowId: string,
  status: Job["status"],
  updatedAt: string,
  options: { durationSeconds?: number; megapixels?: number; error?: string | null } = {},
) {
  return {
    status,
    createdAt: updatedAt,
    updatedAt,
    completedAt: status === "queued" || status === "running" ? null : updatedAt,
    error: options.error ?? null,
    settingsStamp: {
      workflow: { workflowId, revisionId: `${workflowId}_revision` },
      videoDurationSeconds: options.durationSeconds ?? 5,
      videoPerformance: { workload: { durationSeconds: options.durationSeconds ?? 5, megapixels: options.megapixels ?? 0.2 } },
    },
  } as Pick<Job, "status" | "createdAt" | "updatedAt" | "completedAt" | "error" | "settingsStamp">;
}

describe("quick Create routing", () => {
  it("normalizes workflow modalities into the four task-first choices", () => {
    expect(workflowCreateIntent("audio")).toBe("music");
    expect(workflowCreateIntent("music")).toBe("music");
    expect(workflowCreateIntent("video")).toBe("video");
    expect(workflowCreateIntent("image")).toBe("image");
  });

  it("prefers a source-compatible workflow while preserving modality", () => {
    const textImage = workflow("text-image", "image");
    const imageToImage = workflow("image-image", "image", "image");
    const video = workflow("image-video", "video", "image");
    expect(preferredQuickWorkflow([textImage, imageToImage, video], "image", "image")?.id).toBe("image-image");
    expect(preferredQuickWorkflow([imageToImage, textImage, video], "image", null)?.id).toBe("text-image");
    expect(preferredQuickWorkflow([textImage, imageToImage, video], "video", "image")?.id).toBe("image-video");
  });

  it("prefers the faster proven compatible animation workflow", () => {
    const slower = workflow("slower-image-video", "video", "image");
    const faster = workflow("faster-image-video", "video", "image");
    expect(preferredQuickWorkflow(
      [slower, faster],
      "video",
      "image",
      { "slower-image-video": 240_000, "faster-image-video": 90_000 },
    )?.id).toBe("faster-image-video");
  });

  it("does not give MiniMax H3 an unsupported bonus over faster measured LTX", () => {
    const ltx = workflow("LTX 2.5 Image to Video", "video", "image");
    const h3 = workflow("MiniMax Video H3", "video", "image");
    expect(preferredQuickWorkflow(
      [ltx, h3],
      "video",
      "image",
      { [ltx.id]: 60_000, [h3.id]: 100_000 },
    )?.id).toBe(ltx.id);
  });

  it("suppresses only an exact repeatedly failing recipe and never treats timeouts as model evidence", () => {
    const h3 = workflow("MiniMax Video H3", "video", "image");
    const ltx = workflow("LTX 2.5 Image to Video", "video", "image");
    const h3Fast = quickWorkflowRecipeSignature({ workflowId: h3.id, revisionId: h3.currentRevision.id, durationSeconds: 5, megapixels: 0.2 });
    const h3Heavy = quickWorkflowRecipeSignature({ workflowId: h3.id, revisionId: h3.currentRevision.id, durationSeconds: 5, megapixels: 0.5 });
    const ltxTrusted = quickWorkflowRecipeSignature({ workflowId: ltx.id, revisionId: ltx.currentRevision.id, durationSeconds: 30, megapixels: 0.2 });
    const failures = [
      workflowAttempt(h3.id, "completed", "2026-08-29T10:00:00.000Z"),
      workflowAttempt(h3.id, "failed", "2026-08-29T12:00:00.000Z", { error: "invalid_video_variant" }),
      workflowAttempt(h3.id, "failed", "2026-08-29T13:00:00.000Z", { error: "invalid_video_variant" }),
      workflowAttempt(ltx.id, "failed", "2026-08-29T12:10:00.000Z", { durationSeconds: 30, error: "comfyui_prompt_timeout" }),
      workflowAttempt(ltx.id, "failed", "2026-08-29T13:10:00.000Z", { durationSeconds: 30, error: "job_timed_out" }),
    ];
    const failedRecipes = failedQuickWorkflowRecipeSignatures(failures);
    expect(failedRecipes.has(h3Fast)).toBe(true);
    expect(failedRecipes.has(h3Heavy)).toBe(false);
    expect(failedRecipes.has(ltxTrusted)).toBe(false);
    expect(preferredQuickWorkflow(
      [h3, ltx],
      "video",
      "image",
      { [h3.id]: 50_000, [ltx.id]: 100_000 },
      { failedRecipeSignatures: failedRecipes, recipeSignatureByWorkflowId: { [h3.id]: h3Fast, [ltx.id]: ltxTrusted } },
    )?.id).toBe(ltx.id);
    expect(preferredQuickWorkflow(
      [h3, ltx],
      "video",
      "image",
      { [h3.id]: 50_000, [ltx.id]: 100_000 },
      { failedRecipeSignatures: failedRecipes, recipeSignatureByWorkflowId: { [h3.id]: h3Heavy, [ltx.id]: ltxTrusted } },
    )?.id).toBe(h3.id);

    const recovered = failedQuickWorkflowRecipeSignatures([
      ...failures,
      workflowAttempt(h3.id, "completed", "2026-08-29T14:00:00.000Z"),
    ]);
    expect(recovered.has(h3Fast)).toBe(false);
  });

  it("uses retained source evidence internally and returns only a concise motion direction", () => {
    const prompt = quickAnimationDirection("A hand-built ceramic figure stands under a warm side light.");
    expect(prompt).not.toContain("A hand-built ceramic figure stands under a warm side light.");
    expect(prompt).not.toContain("Opening-frame evidence:");
    expect(prompt).toContain("exact first frame");
    expect(prompt).not.toMatch(/Beat [123]:/);
    expect(prompt).toMatch(/^The figure makes one small, motivated gesture/);
    expect(prompt).toContain("figure makes one small, motivated gesture");
    expect(prompt).toContain("preserve identity, anatomy, materials, palette, and light");
    expect(prompt).toContain("camera level");
    expect(prompt).toContain("coherent ambient sound and original nonverbal music");
    expect(prompt).toContain("No dialogue, narration, lyrics, added text, captions, logos, black frames");
    expect(prompt).toContain("camera roll");
    expect(prompt.length).toBeLessThan(700);
    expect(prompt).not.toContain("cybernetic");
    expect(quickAnimationDirection(null)).toContain("focal subject turns or tilts");
  });

  it("treats a character with anatomical and organic details as a person, not an embryo", () => {
    const prompt = quickAnimationDirection("Rebecca is a non-binary intergalactic alien with elongated pale-lavender anatomy, caught mid-laugh with a hand mirror beside an organic form and an anatomical seam.");
    expect(prompt).toContain("checks the hand mirror and breaks into a brief, natural laugh");
    expect(prompt).toContain("slow, level push-in");
    expect(prompt).not.toContain("Rebecca");
    expect(prompt).not.toContain("pale-lavender anatomy");
    expect(prompt).not.toContain("central organic form");
  });

  it("keeps explicitly biological human references on the biological motion path", () => {
    const embryo = quickAnimationDirection("A human embryo floats inside a membrane while cells divide around its body.");
    expect(embryo).toContain("fine light pulse crosses the central form");
    expect(embryo).not.toContain("figure makes one small, motivated gesture");

    const pluralOnly = quickAnimationDirection("Cells and organs divide inside the human body.");
    expect(pluralOnly).toContain("fine light pulse crosses the central form");
    expect(pluralOnly).not.toContain("figure makes one small, motivated gesture");
  });

  it("chooses motion vocabulary grounded in biological and architectural source descriptions", () => {
    const embryo = quickAnimationDirection("A translucent embryo floats inside a softly lit membrane with suspended particles.");
    expect(embryo).toContain("fine light pulse crosses the central form");
    expect(embryo).toContain("Nearby particles curl into a slow spiral");

    const city = quickAnimationDirection("A rain-dark city rooftop overlooks towers and traffic below.");
    expect(city).toContain("Practical lights wake across the visible structure");
    expect(city).toContain("newly revealed spatial relationship");
  });

  it("automatically binds one compatible retained source without overwriting explicit inputs", () => {
    const parameters = workflow("image-video", "video", "image").currentRevision.parameters;
    expect(quickInputBindings(parameters, {}, { id: "media_1", kind: "image" })).toEqual({ "image-video_media": "media_1" });
    expect(quickInputBindings(parameters, { "image-video_media": "media_2" }, { id: "media_1", kind: "image" })).toEqual({ "image-video_media": "media_2" });
    expect(quickInputBindings(parameters, {}, { id: "media_1", kind: "audio" })).toEqual({});
  });

  it("keeps song inspiration out of renderer media bindings", () => {
    const inspiration = { id: "media_song_art", kind: "image" as const, source: "upload" as const };
    expect(quickGenerationSourceUsage("music", inspiration)).toEqual({ rendererSource: null, promptOnly: true });
    expect(quickGenerationSourceUsage("video", inspiration)).toEqual({ rendererSource: inspiration, promptOnly: false });
    expect(quickInputBindings([], {}, quickGenerationSourceUsage("music", inspiration).rendererSource)).toEqual({});
  });

  it("always gives the current direction priority over a cached or imported workflow prompt", () => {
    const prompt: WorkflowParameter = {
      id: "105:104::prompt", label: "MiniMax H3: Prompt", kind: "text", value: "Imported cybernetic prompt", mediaKind: null,
      binding: { format: "comfyui-api", nodeId: "105:104", inputName: "prompt" },
    };
    expect(quickParameterValue(prompt, prompt.id, "New motion for this source", { [prompt.id]: "Previously saved prompt" })).toBe("New motion for this source");
    expect(quickParameterValue(prompt, prompt.id, "", { [prompt.id]: "Previously saved prompt" })).toBe("");
  });

  it("identifies the separate MiniMax Music caption and lyrics controls", () => {
    const caption: WorkflowParameter = {
      id: "37:13::caption", label: "MiniMax Music3 Text Encode: Caption", kind: "text", value: "Imported caption", mediaKind: null,
      binding: { format: "comfyui-api", nodeId: "37:13", inputName: "caption" },
    };
    const lyrics: WorkflowParameter = {
      id: "37:13::lyrics", label: "MiniMax Music3 Text Encode: Lyrics", kind: "text", value: "Imported demo lyrics", mediaKind: null,
      binding: { format: "comfyui-api", nodeId: "37:13", inputName: "lyrics" },
    };
    expect(musicWorkflowLyricsParameter([caption, lyrics], "music")).toBe(lyrics);
    expect(musicWorkflowLyricsParameter([caption, lyrics], "image")).toBeNull();
  });
});
