import { describe, expect, it } from "vitest";
import type { Artifact, EvolutionStudy } from "../../shared/contracts";
import { orderArtifactHistory } from "../../src/features/artifacts/artifactHistory";

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
});
