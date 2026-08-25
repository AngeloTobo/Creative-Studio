import { describe, expect, it } from "vitest";
import type { Artifact, EvolutionStudy } from "../../shared/contracts";
import { orderArtifactHistory, partitionArtifactHistory } from "../../src/features/artifacts/artifactHistory";

describe("artifact history ordering", () => {
  it("interleaves grouped studies and standalone artifacts newest first without duplicating branches", () => {
    const artifact = (id: string, createdAt: string) => ({ id, createdAt } as Artifact);
    const grouped = artifact("artifact_grouped", "2026-08-24T11:00:00.000Z");
    const newest = artifact("artifact_newest", "2026-08-24T12:00:00.000Z");
    const oldest = artifact("artifact_oldest", "2026-08-24T08:00:00.000Z");
    const study = {
      id: "study_middle",
      createdAt: "2026-08-24T09:00:00.000Z",
      branches: [{ artifactId: grouped.id, createdAt: "2026-08-24T09:00:00.000Z" }],
    } as EvolutionStudy;

    const history = orderArtifactHistory([oldest, grouped, newest], [study]);

    expect(history.map((entry) => entry.key)).toEqual([newest.id, study.id, oldest.id]);
    expect(history.map((entry) => entry.kind)).toEqual(["artifact", "study", "artifact"]);
  });

  it("hides standalone and fully archived studies while keeping mixed studies active", () => {
    const artifact = (id: string, status: Artifact["status"]) => ({ id, status, createdAt: `2026-08-24T${id.length}:00:00.000Z` } as Artifact);
    const ready = artifact("ready", "ready");
    const archived = artifact("archived", "archived");
    const mixedArchived = artifact("mixed-archived", "archived");
    const mixedReady = artifact("mixed-ready", "ready");
    const fullyArchived = artifact("study-archived", "archived");
    const study = (id: string, artifactIds: string[]) => ({
      id,
      createdAt: "2026-08-24T09:00:00.000Z",
      branches: artifactIds.map((artifactId) => ({ artifactId, createdAt: "2026-08-24T09:00:00.000Z" })),
    } as EvolutionStudy);
    const mixedStudy = study("mixed-study", [mixedArchived.id, mixedReady.id]);
    const archivedStudy = study("archived-study", [fullyArchived.id]);
    const artifacts = [ready, archived, mixedArchived, mixedReady, fullyArchived];

    const result = partitionArtifactHistory(orderArtifactHistory(artifacts, [mixedStudy, archivedStudy]), artifacts);

    expect(result.active.map((entry) => entry.key)).toEqual(expect.arrayContaining([ready.id, mixedStudy.id]));
    expect(result.archived.map((entry) => entry.key)).toEqual(expect.arrayContaining([archived.id, archivedStudy.id]));
    expect(result.active).toHaveLength(2);
    expect(result.archived).toHaveLength(2);
  });
});
