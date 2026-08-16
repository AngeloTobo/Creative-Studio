import { describe, expect, it } from "vitest";
import { createDevelopmentAdapter, type StorageLike } from "../../src/adapters/developmentAdapter";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("development adapter", () => {
  it("persists DNA, durable job progression, artifacts, and decisions across adapter instances", async () => {
    const storage = new MemoryStorage();
    let clock = new Date("2026-08-16T04:00:00.000Z");
    let sequence = 0;
    const options = { storage, now: () => clock, id: (prefix: string) => `${prefix}_test_${++sequence}` };
    const adapter = createDevelopmentAdapter(options);
    const initial = await adapter.load();
    expect(initial.adapter.id).toBe("development-local-storage");
    expect(initial.projects).toHaveLength(0);

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

    await adapter.reviewArtifact(artifact.id, "accepted", "Keep this direction.");
    const reloaded = await createDevelopmentAdapter(options).load();
    expect(reloaded.artifacts.find((item) => item.id === artifact.id)?.status).toBe("accepted");
    expect(reloaded.acceptances.some((item) => item.artifactId === artifact.id && item.decision === "accepted")).toBe(true);
    expect(reloaded.dnaArtifacts.some((item) => item.artifactId === dna.artifactId)).toBe(true);
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
    expect((await adapter.retryJob(job.id, "retry_test_000000001")).id).toBe(retry.id);
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
});
