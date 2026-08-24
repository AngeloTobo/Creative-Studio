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
