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
    expect(initial.projects).toHaveLength(3);

    const dna = await adapter.saveCreativeDna({
      projectId: "internet-dreams",
      name: "Durable Signal",
      directive: "An electric midnight pulse that blooms into warm negative space.",
      targetModality: "image",
      sourceKind: "original",
    });
    const job = await adapter.submitJob({ projectId: "internet-dreams", dnaArtifactId: dna.artifactId, modality: "image" });
    expect(job.status).toBe("queued");

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
});
