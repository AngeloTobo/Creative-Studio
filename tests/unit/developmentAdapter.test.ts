import { describe, expect, it } from "vitest";
import { createDevelopmentAdapter, type StorageLike } from "../../src/adapters/developmentAdapter";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("development adapter", () => {
  it("labels local Gemma enhancement unavailable and never fabricates a result", async () => {
    const storage = new MemoryStorage();
    const adapter = createDevelopmentAdapter({ storage });
    const snapshot = await adapter.load();

    expect(snapshot.promptEnhancements).toEqual([]);
    expect(snapshot.videoScriptDrafts).toEqual([]);
    expect(snapshot.capabilities.find((capability) => capability.key === "prompt-enhancement")).toMatchObject({
      state: "unavailable",
      provider: "local runner required",
    });
    await expect(adapter.createVideoPromptEnhancement({
      projectId: "project_1",
      workflowId: "workflow_1",
      workflowRevisionId: "revision_1",
      sourcePrompt: "The subject turns toward the moving light.",
      inputMode: "text-to-video",
      sourceId: null,
      videoDurationSeconds: 5,
      idempotencyKey: "enhance_dev_1",
    })).rejects.toThrow("prompt_enhancement_requires_local_runner");
    await expect(adapter.getVideoPromptEnhancement("prompt_enhancement_1")).rejects.toThrow("prompt_enhancement_requires_local_runner");
    expect(snapshot.capabilities.find((capability) => capability.key === "script-builder")).toMatchObject({
      state: "unavailable",
      provider: "local runner required",
    });
    await expect(adapter.createVideoScriptDraft({
      scriptFormat: "full-script-v2",
      projectId: "project_1",
      workflowId: "workflow_1",
      workflowRevisionId: "revision_1",
      inputMode: "text-to-video",
      sourceId: null,
      mode: "build",
      seedPhrases: ["tired astronaut", "living blue flower"],
      sceneDirection: "The astronaut kneels while the flower opens.",
      videoDurationSeconds: 10,
      idempotencyKey: "video_script_dev_1",
    })).rejects.toThrow("video_script_builder_requires_local_runner");
    await expect(adapter.getVideoScriptDraft("video_script_1")).rejects.toThrow("video_script_builder_requires_local_runner");
    await expect(adapter.updateVideoScriptDraft("video_script_1", {
      scriptFormat: "full-script-v2",
      currentScript: "The camera tracks the astronaut through the moonlit station while a low electrical hum grows, then settles on the opening flower as its blue glow fills the quiet room.",
      currentSpokenText: null,
      expectedRevision: 0,
    })).rejects.toThrow("video_script_builder_requires_local_runner");
  });

  it("persists DNA, durable job progression, artifacts, and decisions across adapter instances", async () => {
    const storage = new MemoryStorage();
    let clock = new Date("2026-08-16T04:00:00.000Z");
    let sequence = 0;
    const options = { storage, now: () => clock, id: (prefix: string) => `${prefix}_test_${++sequence}` };
    const adapter = createDevelopmentAdapter(options);
    const initial = await adapter.load();
    expect(initial.adapter.id).toBe("development-local-storage");
    expect(initial.projects).toHaveLength(0);
    expect(initial.mediaAssets).toEqual([]);
    expect(initial.worlds).toEqual([]);
    expect(initial.worldEntities).toEqual([]);
    expect(initial.continuityRules).toEqual([]);
    expect(initial.canonReferences).toEqual([]);
    expect(initial.canonPromotions).toEqual([]);
    await expect(adapter.uploadMedia("project_missing", new File(["real"], "real.png", { type: "image/png" }), true))
      .rejects.toThrow("media_upload_requires_creative_studio_worker");

    const project = await adapter.createProject({ name: "Durable Signal", type: "Visual System" });

    const dna = await adapter.saveCreativeDna({
      projectId: project.id,
      name: "Durable Signal",
      directive: "An electric midnight pulse that blooms into warm negative space.",
      targetModality: "image",
      sourceKind: "original",
    });
    const job = await adapter.submitJob({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", idempotencyKey: "submit_test_00000001" });
    expect(job.status).toBe("queued");

    const duplicate = await adapter.submitJob({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", idempotencyKey: "submit_test_00000001" });
    expect(duplicate.id).toBe(job.id);

    clock = new Date(clock.getTime() + 4_000);
    const completed = await adapter.refresh();
    const completedJob = completed.jobs.find((item) => item.id === job.id);
    expect(completedJob?.status).toBe("completed");
    const artifact = completed.artifacts.find((item) => item.jobId === job.id);
    expect(artifact?.status).toBe("ready");
    if (!artifact) throw new Error("artifact missing");

    await expect(adapter.reviewArtifact(artifact.id, "rejected", "   ")).rejects.toThrow("review_note_required");
    await adapter.reviewArtifact(artifact.id, "accepted", "Keep this direction.");
    const reloaded = await createDevelopmentAdapter(options).load();
    expect(reloaded.artifacts.find((item) => item.id === artifact.id)?.status).toBe("accepted");
    expect(reloaded.acceptances.find((item) => item.artifactId === artifact.id && item.decision === "accepted")).toMatchObject({ note: "Keep this direction.", actor: "development-user" });
    expect(reloaded.dnaArtifacts.some((item) => item.artifactId === dna.artifactId)).toBe(true);
    expect(reloaded.canonReferences).toEqual([]);
    expect(reloaded.canonPromotions).toEqual([]);
  });

  it("cancels active tracking and creates an idempotent retry with lineage", async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const adapter = createDevelopmentAdapter({ storage, id: (prefix) => `${prefix}_test_${++sequence}` });
    const project = await adapter.createProject({ name: "Retry Study", type: "Visual System" });
    const dna = await adapter.saveCreativeDna({
      projectId: project.id,
      name: "Retry Study",
      directive: "A clear original image system with a calm central rhythm.",
      targetModality: "image",
    });
    const job = await adapter.submitJob({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", idempotencyKey: "submit_retry_test_001" });
    expect((await adapter.cancelJob(job.id)).status).toBe("cancelled");
    const retry = await adapter.retryJob(job.id, "retry_test_000000001");
    expect(retry).toMatchObject({ status: "queued", retryOfJobId: job.id });
    expect(retry.prompt).toBe(job.settingsStamp.prompt);
    expect(retry.settingsStamp).toEqual({ ...job.settingsStamp, createdAt: retry.createdAt, reusedFromJobId: job.id });
    expect(await adapter.retryJob(job.id, "retry_test_000000001")).toEqual(retry);
  });

  it("creates, edits, and archives projects without seeded records", async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const adapter = createDevelopmentAdapter({ storage, id: (prefix) => `${prefix}_test_${++sequence}` });
    expect((await adapter.load()).projects).toEqual([]);
    const project = await adapter.createProject({ name: "Launch Identity", type: "Brand System", hue: "#22d3ee" });
    const updated = await adapter.updateProject(project.id, { name: "Launch Identity System", status: "paused" });
    expect(updated).toMatchObject({ name: "Launch Identity System", status: "paused", initials: "LI" });
    const archived = await adapter.archiveProject(project.id);
    expect(archived.status).toBe("archived");
  });

  it("persists World metadata and enforces optimistic versions locally", async () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const options = { storage, id: (prefix: string) => `${prefix}_test_${++sequence}` };
    const adapter = createDevelopmentAdapter(options);
    const project = await adapter.createProject({ name: "Blue Archive", type: "Narrative World" });
    const world = await adapter.createWorld({ projectId: project.id, name: "Blue Archive", premise: "A floating archive under blue stars" });
    const entity = await adapter.createWorldEntity(world.id, {
      projectId: project.id,
      kind: "character",
      name: "Iria",
      summary: "A mineral archivist with a translucent face",
      attributes: [{ facet: "face", value: "Faceted opal cheeks" }],
    });
    const rule = await adapter.createContinuityRule(world.id, {
      projectId: project.id,
      entityIds: [entity.id],
      facet: "face",
      strength: "must",
      instruction: "Keep the faceted opal cheeks",
      modalities: ["image", "video"],
    });
    const reference = await adapter.createCanonReference(world.id, {
      projectId: project.id,
      entityId: entity.id,
      source: { kind: "commercial-reference", identity: "Protected Franchise Name", lineageOnly: true },
      continuityNotes: [{ facet: "material", value: "Translucent mineral with internal light" }],
    });

    await expect(adapter.updateWorld(world.id, { expectedVersion: 7, premise: "Stale rewrite" })).rejects.toThrow("world_version_conflict");
    await expect(adapter.updateWorldEntity(world.id, entity.id, { expectedVersion: 7, summary: "Stale rewrite" })).rejects.toThrow("world_entity_version_conflict");
    await expect(adapter.updateContinuityRule(world.id, rule.id, { expectedVersion: 7, instruction: "Stale rewrite" })).rejects.toThrow("continuity_rule_version_conflict");
    await expect(adapter.updateCanonReference(world.id, reference.id, { expectedVersion: 7, continuityNotes: [{ facet: "material", value: "Stale rewrite" }] }))
      .rejects.toThrow("canon_reference_version_conflict");

    const reloaded = await createDevelopmentAdapter(options).load();
    expect(reloaded.worlds).toEqual([expect.objectContaining({ id: world.id, version: 1 })]);
    expect(reloaded.worldEntities).toEqual([expect.objectContaining({ id: entity.id, version: 1 })]);
    expect(reloaded.continuityRules).toEqual([expect.objectContaining({ id: rule.id, version: 1 })]);
    expect(reloaded.canonReferences).toEqual([expect.objectContaining({ id: reference.id, status: "candidate", version: 1 })]);
    expect(reloaded.canonPromotions).toEqual([]);
  });
});
