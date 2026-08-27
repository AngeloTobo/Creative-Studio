import type { Artifact, EvolutionStudy } from "../../../shared/contracts";

export type ArtifactHistoryEntry =
  | { key: string; kind: "artifact"; createdAt: string; artifact: Artifact }
  | { key: string; kind: "study"; createdAt: string; study: EvolutionStudy };

export type ArtifactHistoryFilter = {
  boundary: "active" | "archived";
  statuses?: Artifact["status"][];
  kinds?: Artifact["kind"][];
  search?: string;
};

function newestStudyResultAt(study: EvolutionStudy, artifacts: Artifact[]) {
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return [study.createdAt, ...study.branches.map((branch) => branch.artifactId
    ? artifactById.get(branch.artifactId)?.createdAt ?? branch.createdAt
    : branch.createdAt)]
    .sort((left, right) => right.localeCompare(left))[0];
}

export function orderArtifactHistory(artifacts: Artifact[], studies: EvolutionStudy[]): ArtifactHistoryEntry[] {
  const groupedArtifactIds = new Set(studies.flatMap((study) => study.branches.flatMap((branch) => branch.artifactId ? [branch.artifactId] : [])));
  return [
    ...artifacts.filter((artifact) => !groupedArtifactIds.has(artifact.id))
      .map((artifact): ArtifactHistoryEntry => ({ key: artifact.id, kind: "artifact", createdAt: artifact.createdAt, artifact })),
    ...studies.map((study): ArtifactHistoryEntry => ({ key: study.id, kind: "study", createdAt: newestStudyResultAt(study, artifacts), study })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.key.localeCompare(left.key));
}

export function artifactsForHistoryEntry(entry: ArtifactHistoryEntry, artifacts: Artifact[]) {
  if (entry.kind === "artifact") return [entry.artifact];
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return entry.study.branches.flatMap((branch) => {
    if (!branch.artifactId) return [];
    const artifact = artifactById.get(branch.artifactId);
    return artifact ? [artifact] : [];
  });
}

export function artifactMatchesHistoryFilter(artifact: Artifact, filter: ArtifactHistoryFilter) {
  if (filter.boundary === "active" ? artifact.status === "archived" : artifact.status !== "archived") return false;
  if (filter.statuses?.length && !filter.statuses.includes(artifact.status)) return false;
  if (filter.kinds?.length && !filter.kinds.includes(artifact.kind)) return false;
  const search = filter.search?.trim().toLocaleLowerCase();
  return !search || `${artifact.name} ${artifact.prompt}`.toLocaleLowerCase().includes(search);
}

/**
 * Projects grouped studies down to the exact branches represented by a gallery
 * filter. A mixed study can therefore appear in both active and archived
 * history without leaking cards across either boundary.
 */
export function filterArtifactHistory(history: ArtifactHistoryEntry[], artifacts: Artifact[], filter: ArtifactHistoryFilter) {
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return history.flatMap((entry): ArtifactHistoryEntry[] => {
    if (entry.kind === "artifact") return artifactMatchesHistoryFilter(entry.artifact, filter) ? [entry] : [];

    const matchingArtifactIds = new Set(entry.study.branches.flatMap((branch) => {
      if (!branch.artifactId) return [];
      const artifact = artifactById.get(branch.artifactId);
      return artifact && artifactMatchesHistoryFilter(artifact, filter) ? [artifact.id] : [];
    }));
    if (!matchingArtifactIds.size) return [];

    const showContextRuns = filter.boundary === "active" && !filter.statuses?.length && !filter.search?.trim();
    const branches = entry.study.branches.filter((branch) => {
      if (branch.artifactId) return matchingArtifactIds.has(branch.artifactId);
      return showContextRuns && (!filter.kinds?.length || filter.kinds.includes(branch.modality));
    });
    const study = { ...entry.study, branches };
    return [{ ...entry, createdAt: newestStudyResultAt(study, artifacts), study }];
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.key.localeCompare(left.key));
}

/**
 * Builds a gallery only from the contiguous artifact IDs proven by the current
 * keyset query. The provider snapshot may also contain older rows loaded by a
 * different search, so it is never used as pagination evidence.
 */
export function loadedArtifactHistory(
  artifacts: Artifact[],
  studies: EvolutionStudy[],
  loadedArtifactIds: readonly string[],
  filter: ArtifactHistoryFilter,
  focusArtifactId?: string,
) {
  const loadedIds = new Set(loadedArtifactIds);
  if (focusArtifactId) loadedIds.add(focusArtifactId);
  const loadedArtifacts = artifacts.filter((artifact) => loadedIds.has(artifact.id));
  return filterArtifactHistory(orderArtifactHistory(loadedArtifacts, studies), loadedArtifacts, filter);
}

export function countArtifactsInHistory(history: ArtifactHistoryEntry[], artifacts: Artifact[]) {
  return new Set(history.flatMap((entry) => artifactsForHistoryEntry(entry, artifacts).map((artifact) => artifact.id))).size;
}

export function partitionArtifactHistory(history: ArtifactHistoryEntry[], artifacts: Artifact[]) {
  return {
    active: filterArtifactHistory(history, artifacts, { boundary: "active" }),
    archived: filterArtifactHistory(history, artifacts, { boundary: "archived" }),
  };
}
