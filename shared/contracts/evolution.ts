import type { CreativeDnaArtifact, CreativeDnaDimensions } from "./creativeDna";
import type {
  Acceptance,
  Artifact,
  CreativeDnaTrainingReview,
  CreativeTasteMemory,
  CreativeTasteProfile,
  CreativeTasteSignal,
  CreativeTasteSignalKind,
  EvolutionRole,
  EvolutionStudy,
  Job,
  Project,
  ProjectCanon,
} from "./domain";

const PRESERVE_CUES = /\b(keep|love|loved|good|great|strong|works?|worked|everything|interesting|successful|best|right|beautiful|favorite|favourite)\b/i;
const AVOID_CUES = /\b(avoid|without|remove|wrong|unintentional|artifact|random|too\s+|less\s+|no\s+|never|missed|bad|not\s+)\b/i;
const REDIRECT_CUES = /\b(needs?|should|change|replace|more\s+|explain|clarify|different|improve|fix|adjust)\b/i;

function clean(value: string, limit = 500) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function clauses(note: string) {
  return clean(note).split(/(?:[.!?;]+|,?\s+but\s+|,\s+(?=(?:and\s+)?(?:it|the|there|this|needs?|should)\b))/i).map((value) => clean(value)).filter(Boolean).slice(0, 8);
}

export function creativeTasteSignalKind(text: string, decision: Acceptance["decision"] | CreativeDnaTrainingReview["decision"]): CreativeTasteSignalKind {
  if (PRESERVE_CUES.test(text) && !AVOID_CUES.test(text) && !REDIRECT_CUES.test(text)) return "preserve";
  if (AVOID_CUES.test(text)) return decision === "accepted" || decision === "approved" ? "redirect" : "avoid";
  if (REDIRECT_CUES.test(text)) return "redirect";
  return decision === "accepted" || decision === "approved" ? "preserve" : "avoid";
}

export function creativeTasteSignalClauses(note: string, decision: Acceptance["decision"] | CreativeDnaTrainingReview["decision"]) {
  return clauses(note).map((text) => ({ kind: creativeTasteSignalKind(text, decision), text }));
}

function emptyProfile(): CreativeTasteProfile {
  return { signalCount: 0, preserve: [], redirect: [], avoid: [], updatedAt: null };
}

function profile(signals: CreativeTasteSignal[]): CreativeTasteProfile {
  const ordered = [...signals].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    signalCount: ordered.length,
    preserve: ordered.filter((signal) => signal.kind === "preserve").slice(0, 12),
    redirect: ordered.filter((signal) => signal.kind === "redirect").slice(0, 12),
    avoid: ordered.filter((signal) => signal.kind === "avoid").slice(0, 12),
    updatedAt: ordered[0]?.createdAt ?? null,
  };
}

export function projectCanon(project: Project): ProjectCanon {
  return { identity: clean(project.description), currentDirection: clean(project.note) };
}

export function compileCreativeTasteMemory(input: {
  projects: Project[];
  artifacts: Artifact[];
  acceptances: Acceptance[];
  trainingReviews: CreativeDnaTrainingReview[];
  dnaArtifacts?: CreativeDnaArtifact[];
}): CreativeTasteMemory {
  const artifacts = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const dna = new Map((input.dnaArtifacts ?? []).map((artifact) => [artifact.artifactId, artifact]));
  const signals: CreativeTasteSignal[] = [];
  for (const review of input.acceptances) {
    if (!review.note.trim() || review.decision === "archived") continue;
    const artifact = artifacts.get(review.artifactId);
    if (!artifact) continue;
    const providerPromptEligible = !dna.get(artifact.dnaArtifactId)?.rights.referenceStoredAsProvenanceOnly;
    for (const [index, clause] of creativeTasteSignalClauses(review.note, review.decision).entries()) signals.push({
      id: `taste_${review.id}_${index + 1}`,
      projectId: artifact.projectId,
      artifactId: artifact.id,
      modality: artifact.kind,
      kind: clause.kind,
      text: clause.text,
      decision: review.decision,
      actor: review.actor,
      source: "artifact-review",
      sourceReviewId: review.id,
      providerPromptEligible,
      createdAt: review.createdAt,
    });
  }
  for (const review of input.trainingReviews) {
    if (!review.note.trim()) continue;
    const providerPromptEligible = !dna.get(review.dnaArtifactId)?.rights.referenceStoredAsProvenanceOnly;
    for (const [index, clause] of creativeTasteSignalClauses(review.note, review.decision).entries()) signals.push({
      id: `taste_${review.id}_${index + 1}`,
      projectId: review.projectId,
      artifactId: null,
      modality: "training",
      kind: clause.kind,
      text: clause.text,
      decision: review.decision,
      actor: review.actor,
      source: "training-review",
      sourceReviewId: review.id,
      providerPromptEligible,
      createdAt: review.createdAt,
    });
  }
  return {
    schemaVersion: "creative-studio-taste-memory/1.0",
    personal: profile(signals),
    projects: Object.fromEntries(input.projects.map((project) => [project.id, {
      canon: projectCanon(project),
      taste: signals.length ? profile(signals.filter((signal) => signal.projectId === project.id)) : emptyProfile(),
    }])),
  };
}

export function deriveEvolutionStudies(jobs: Job[], artifacts: Artifact[]): EvolutionStudy[] {
  const artifactByJob = new Map(artifacts.map((artifact) => [artifact.jobId, artifact]));
  const studies = new Map<string, EvolutionStudy>();
  const representedJobIds = new Set<string>();
  for (const job of [...jobs].sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const evolution = job.settingsStamp.evolution;
    if (!evolution) continue;
    const artifact = artifactByJob.get(job.id);
    const current = studies.get(evolution.studyId) ?? {
      id: evolution.studyId,
      projectId: job.projectId,
      sourceId: evolution.sourceId,
      source: evolution.source,
      sourceKind: evolution.sourceKind,
      sourceName: evolution.sourceName,
      canon: evolution.projectCanon,
      branches: [],
      createdAt: evolution.createdAt,
    };
    current.branches.push({
      role: evolution.role,
      modality: job.modality,
      jobId: job.id,
      artifactId: artifact?.id ?? null,
      status: artifact?.status ?? job.status,
      createdAt: job.createdAt,
    });
    representedJobIds.add(job.id);
    studies.set(evolution.studyId, current);
  }
  for (const artifact of artifacts.filter((item) => item.settingsStamp.evolution && !representedJobIds.has(item.jobId))) {
    const evolution = artifact.settingsStamp.evolution!;
    const current = studies.get(evolution.studyId) ?? {
      id: evolution.studyId,
      projectId: artifact.projectId,
      sourceId: evolution.sourceId,
      source: evolution.source,
      sourceKind: evolution.sourceKind,
      sourceName: evolution.sourceName,
      canon: evolution.projectCanon,
      branches: [],
      createdAt: evolution.createdAt,
    };
    current.branches.push({ role: evolution.role, modality: artifact.kind, jobId: artifact.jobId, artifactId: artifact.id, status: artifact.status, createdAt: artifact.createdAt });
    studies.set(evolution.studyId, current);
  }
  return [...studies.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function notes(signals: CreativeTasteSignal[], count: number) {
  return [...new Map(signals.filter((signal) => signal.providerPromptEligible).map((signal) => [signal.id, signal])).values()].slice(0, count).map((signal) => signal.text).join("; ");
}

function discoveryLanguage(dimensions: CreativeDnaDimensions) {
  const scale = dimensions.spaciousness >= 55 ? "wide negative space and a sudden intimate crop" : "intimate detail opening into an unexpected wide field";
  const motion = dimensions.energy >= 55 ? "decisive motion interrupted by one suspended beat" : "restrained motion broken by one decisive gesture";
  const surface = dimensions.organicity >= 55 ? "tactile irregular surfaces against one precise synthetic element" : "precise synthetic surfaces interrupted by one tactile organic element";
  return `${scale}; ${motion}; ${surface}`;
}

export function evolutionBranchPrompt(input: {
  basePrompt: string;
  role: EvolutionRole;
  canon: ProjectCanon;
  personalTaste: CreativeTasteProfile;
  projectTaste: CreativeTasteProfile;
  dimensions: CreativeDnaDimensions;
}) {
  const base = clean(input.basePrompt, 2_600);
  const identity = input.canon.identity ? `Subject and world continuity: ${input.canon.identity}.` : "";
  const direction = input.canon.currentDirection ? `Current piece direction: ${input.canon.currentDirection}.` : "";
  const preserve = notes([...input.projectTaste.preserve, ...input.personalTaste.preserve], 3);
  const redirect = notes([...input.projectTaste.redirect, ...input.personalTaste.redirect], 3);
  const avoid = notes([...input.projectTaste.avoid, ...input.personalTaste.avoid], 3);
  if (input.role === "refine") return clean(`${base}. ${identity} ${direction} ${preserve ? `Preserve these proven qualities: ${preserve}.` : ""} Increase coherence, material specificity, and focal clarity.`, 4_000);
  if (input.role === "correct") return clean(`${base}. ${identity} ${direction} ${redirect ? `Resolve this feedback: ${redirect}.` : ""} ${avoid ? `Exclude these failed qualities: ${avoid}.` : ""}`, 4_000);
  return clean(`${base}. ${identity} ${direction} A distinct interpretation with ${discoveryLanguage(input.dimensions)}. ${preserve ? `Retain only the essential continuity: ${preserve}.` : ""}`, 4_000);
}
