import type { Artifact, EvolutionStudy } from "../../../shared/contracts";

export type ArtifactHistoryEntry =
  | { key: string; kind: "artifact"; createdAt: string; artifact: Artifact }
  | { key: string; kind: "study"; createdAt: string; study: EvolutionStudy };

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
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.key.localeCompare(right.key));
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

export function partitionArtifactHistory(history: ArtifactHistoryEntry[], artifacts: Artifact[]) {
  const active: ArtifactHistoryEntry[] = [];
  const archived: ArtifactHistoryEntry[] = [];

  history.forEach((entry) => {
    const entryArtifacts = artifactsForHistoryEntry(entry, artifacts);
    const fullyArchived = entry.kind === "artifact"
      ? entry.artifact.status === "archived"
      : entry.study.branches.length > 0
        && entryArtifacts.length === entry.study.branches.length
        && entryArtifacts.every((artifact) => artifact.status === "archived");
    (fullyArchived ? archived : active).push(entry);
  });

  return { active, archived };
}
