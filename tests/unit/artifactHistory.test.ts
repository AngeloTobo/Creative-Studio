import { describe, expect, it } from "vitest";
import type { Artifact, EvolutionStudy } from "../../shared/contracts";
import { artifactsForHistoryEntry, countArtifactsInHistory, filterArtifactHistory, loadedArtifactHistory, orderArtifactHistory, partitionArtifactHistory } from "../../src/features/artifacts/artifactHistory";

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

  it("uses the same descending id tie-break as durable D1 history", () => {
    const createdAt = "2026-08-24T12:00:00.000Z";
    const low = { id: "artifact_001", createdAt } as Artifact;
    const high = { id: "artifact_002", createdAt } as Artifact;

    expect(orderArtifactHistory([low, high], []).map((entry) => entry.key)).toEqual([high.id, low.id]);
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
    expect(result.archived.map((entry) => entry.key)).toEqual(expect.arrayContaining([archived.id, mixedStudy.id, archivedStudy.id]));
    expect(result.active).toHaveLength(2);
    expect(result.archived).toHaveLength(3);
  });

  it("filters every grouped branch independently and counts artifacts rather than study containers", () => {
    const artifact = (id: string, status: Artifact["status"], kind: Artifact["kind"], name: string) => ({
      id,
      status,
      kind,
      name,
      prompt: `${name} prompt`,
      createdAt: "2026-08-24T09:00:00.000Z",
    } as Artifact);
    const accepted = artifact("artifact_accepted", "accepted", "image", "Accepted portrait");
    const rejected = artifact("artifact_rejected", "rejected", "image", "Rejected portrait");
    const archived = artifact("artifact_archived", "archived", "video", "Archived motion");
    const study = {
      id: "study_mixed",
      createdAt: "2026-08-24T09:00:00.000Z",
      sourceName: "Mixed direction",
      branches: [accepted, rejected, archived].map((item, index) => ({
        artifactId: item.id,
        jobId: `job_${index}`,
        modality: item.kind,
        status: item.status,
        role: index === 0 ? "refine" : index === 1 ? "correct" : "discovery",
        createdAt: item.createdAt,
      })),
    } as EvolutionStudy;
    const artifacts = [accepted, rejected, archived];
    const history = orderArtifactHistory(artifacts, [study]);

    const acceptedOnly = filterArtifactHistory(history, artifacts, { boundary: "active", statuses: ["accepted"] });
    const archivedVideos = filterArtifactHistory(history, artifacts, { boundary: "archived", kinds: ["video"] });
    const rejectedSearch = filterArtifactHistory(history, artifacts, { boundary: "active", search: "rejected" });

    expect(artifactsForHistoryEntry(acceptedOnly[0]!, artifacts).map((item) => item.id)).toEqual([accepted.id]);
    expect(artifactsForHistoryEntry(archivedVideos[0]!, artifacts).map((item) => item.id)).toEqual([archived.id]);
    expect(artifactsForHistoryEntry(rejectedSearch[0]!, artifacts).map((item) => item.id)).toEqual([rejected.id]);
    expect(countArtifactsInHistory(acceptedOnly, artifacts)).toBe(1);
    expect(countArtifactsInHistory(history, artifacts)).toBe(3);
  });

  it("reorders a projected study by its newest remaining branch", () => {
    const artifact = (id: string, status: Artifact["status"], createdAt: string) => ({
      id,
      projectId: "project_projection",
      jobId: `job_${id}`,
      status,
      kind: "image",
      name: id,
      prompt: id,
      createdAt,
    } as Artifact);
    const retainedBranch = artifact("artifact_study_accepted", "accepted", "2026-08-24T10:00:00.000Z");
    const intervening = artifact("artifact_standalone", "accepted", "2026-08-24T11:00:00.000Z");
    const excludedNewerBranch = artifact("artifact_study_rejected", "rejected", "2026-08-24T12:00:00.000Z");
    const study = {
      id: "study_projection",
      createdAt: "2026-08-24T09:00:00.000Z",
      branches: [retainedBranch, excludedNewerBranch].map((item, index) => ({
        artifactId: item.id,
        jobId: item.jobId,
        modality: item.kind,
        status: item.status,
        role: index === 0 ? "refine" : "correct",
        createdAt: item.createdAt,
      })),
    } as EvolutionStudy;
    const artifacts = [retainedBranch, intervening, excludedNewerBranch];
    const history = orderArtifactHistory(artifacts, [study]);

    expect(history.map((entry) => entry.key)).toEqual([study.id, intervening.id]);
    const accepted = filterArtifactHistory(history, artifacts, { boundary: "active", statuses: ["accepted"] });
    expect(accepted.map((entry) => entry.key)).toEqual([intervening.id, study.id]);
    expect(accepted[1]?.createdAt).toBe(retainedBranch.createdAt);
  });

  it("never renders a cached artifact across an unproven cursor gap", () => {
    const artifact = (id: string, createdAt: string) => ({
      id,
      projectId: "project_cursor",
      jobId: `job_${id}`,
      status: "ready",
      kind: "image",
      name: id,
      prompt: id,
      createdAt,
    } as Artifact);
    const first = artifact("artifact_first", "2026-08-24T12:00:00.000Z");
    const nextPage = artifact("artifact_next_page", "2026-08-24T11:00:00.000Z");
    const cachedOld = artifact("artifact_cached_old", "2026-08-24T09:00:00.000Z");
    const artifacts = [first, nextPage, cachedOld];

    expect(loadedArtifactHistory(artifacts, [], [first.id], { boundary: "active" }).map((entry) => entry.key)).toEqual([first.id]);
    expect(loadedArtifactHistory(artifacts, [], [first.id, nextPage.id], { boundary: "active" }).map((entry) => entry.key)).toEqual([first.id, nextPage.id]);
    expect(loadedArtifactHistory(artifacts, [], [first.id], { boundary: "active" }, cachedOld.id).map((entry) => entry.key)).toEqual([first.id, cachedOld.id]);
  });

});
