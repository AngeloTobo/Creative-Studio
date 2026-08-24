import { describe, expect, it } from "vitest";
import {
  compileCreativeTasteMemory,
  deriveEvolutionStudies,
  evolutionBranchPrompt,
  type Acceptance,
  type Artifact,
  type CreativeDnaTrainingReview,
  type CreativeDnaArtifact,
  type Job,
  type Project,
} from "../../shared/contracts";

const project = {
  id: "project_rebecca",
  activeDnaArtifactId: null,
  name: "Rebecca",
  type: "Character study",
  status: "active",
  description: "Rebecca has a precise biomechanical silhouette and luminous blue eyes.",
  note: "Keep the rooftop sequence nocturnal and intimate.",
  hue: "#d946ef",
  initials: "RE",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
} satisfies Project;

function artifact(id: string, jobId = `job_${id}`): Artifact {
  const createdAt = "2026-08-23T01:00:00.000Z";
  return {
    id, projectId: project.id, jobId, dnaArtifactId: "dna_rebecca", kind: "image", name: "Rebecca study",
    status: "accepted", provider: "local-comfyui", prompt: "Rebecca on a nocturnal rooftop.",
    preview: { kind: "remote-media", url: `/api/creative-studio/artifacts/${id}/media`, colors: ["#111", "#222"] },
    lineage: { sourceArtifactIds: [], parentArtifactId: null }, retention: { state: "retained", size: 100 },
    settingsStamp: { schemaVersion: 1, source: "comfyui-workflow", createdAt, reusedFromJobId: null, prompt: "Rebecca on a nocturnal rooftop.", provider: "local-comfyui", modality: "image", workflow: null, parameters: {}, models: [], inputAssetIds: [] },
    createdAt, updatedAt: createdAt,
  };
}

describe("Creative Studio taste memory and evolution", () => {
  it("keeps exact review clauses as provenance-backed preserve, redirect, and avoid signals", () => {
    const work = artifact("artifact_one");
    const acceptances: Acceptance[] = [
      { id: "accept_one", artifactId: work.id, decision: "accepted", note: "The texture and transition was everything, but it needs new background music.", actor: "angelo", createdAt: "2026-08-23T02:00:00.000Z" },
      { id: "accept_two", artifactId: work.id, decision: "rejected", note: "Random artifacts were floating and the audio was unintentional.", actor: "angelo", createdAt: "2026-08-23T03:00:00.000Z" },
      { id: "accept_three", artifactId: work.id, decision: "accepted", note: "It is interesting, the robot will need more explanation of its look.", actor: "angelo", createdAt: "2026-08-23T03:30:00.000Z" },
    ];
    const trainingReviews: CreativeDnaTrainingReview[] = [{ id: "review_one", projectId: project.id, trainingJobId: "train_one", dnaArtifactId: "dna_two", decision: "approved", note: "Keep the restrained metallic surface.", actor: "angelo", activeDnaArtifactId: "dna_two", createdAt: "2026-08-23T04:00:00.000Z" }];
    const memory = compileCreativeTasteMemory({ projects: [project], artifacts: [work], acceptances, trainingReviews });

    expect(memory.personal.preserve.map((signal) => signal.text)).toContain("The texture and transition was everything");
    expect(memory.personal.redirect.map((signal) => signal.text)).toContain("it needs new background music");
    expect(memory.personal.preserve.map((signal) => signal.text)).toContain("It is interesting");
    expect(memory.personal.redirect.map((signal) => signal.text)).toContain("the robot will need more explanation of its look");
    expect(memory.personal.avoid.map((signal) => signal.text)).toContain("Random artifacts were floating and the audio was unintentional");
    expect(memory.projects[project.id].canon).toEqual({ identity: project.description, currentDirection: project.note });
    expect(memory.personal.preserve[0].sourceReviewId).toBe("review_one");
  });

  it("builds distinct prompt branches without adding generic originality boilerplate", () => {
    const work = artifact("artifact_prompt");
    const memory = compileCreativeTasteMemory({
      projects: [project], artifacts: [work], trainingReviews: [],
      acceptances: [{ id: "accept_prompt", artifactId: work.id, decision: "accepted", note: "Keep the fine internal texture, but the silhouette needs more clarity.", actor: "angelo", createdAt: work.createdAt }],
    });
    const common = { basePrompt: work.prompt, canon: memory.projects[project.id].canon, personalTaste: memory.personal, projectTaste: memory.projects[project.id].taste, dimensions: { energy: 60, tension: 50, contrast: 70, warmth: 30, spaciousness: 80, rhythmicity: 50, organicity: 65, polish: 70 } } as const;
    const refine = evolutionBranchPrompt({ ...common, role: "refine" });
    const correct = evolutionBranchPrompt({ ...common, role: "correct" });
    const discovery = evolutionBranchPrompt({ ...common, role: "discovery" });

    expect(refine).toContain("Preserve these proven qualities");
    expect(correct).toContain("Resolve this feedback");
    expect(discovery).toContain("wide negative space");
    expect(new Set([refine, correct, discovery]).size).toBe(3);
    expect(refine.toLowerCase()).not.toContain("create an original image");
  });

  it("groups durable jobs and retained artifacts by their stamped evolution study", () => {
    const work = artifact("artifact_group", "job_group");
    work.settingsStamp.evolution = {
      schemaVersion: "creative-studio-evolution/1.0", studyId: "evolve_12345678", role: "refine",
      sourceId: "artifact_source", source: "artifact", sourceKind: "image", sourceName: "Source portrait",
      projectCanon: { identity: project.description, currentDirection: project.note }, personalTasteSignalIds: [], projectTasteSignalIds: [], createdAt: work.createdAt,
    };
    const job = { id: work.jobId, projectId: project.id, dnaArtifactId: work.dnaArtifactId, capability: "IMAGE_GENERATE", modality: "image", status: "completed", progress: 100, prompt: work.prompt, provider: work.provider, upstreamId: null, artifactId: work.id, retryOfJobId: null, error: null, createdAt: work.createdAt, updatedAt: work.updatedAt, startedAt: work.createdAt, executionStage: "completed", stageUpdatedAt: work.updatedAt, completedAt: work.updatedAt, settingsStamp: work.settingsStamp } satisfies Job;
    const studies = deriveEvolutionStudies([job], [work]);

    expect(studies).toHaveLength(1);
    expect(studies[0]).toMatchObject({ id: "evolve_12345678", sourceName: "Source portrait", branches: [{ role: "refine", artifactId: work.id, status: "accepted" }] });
  });

  it("retains commercial-reference feedback in memory while excluding its identity from provider prompts", () => {
    const work = artifact("artifact_rights");
    const commercialDna = { artifactId: work.dnaArtifactId, rights: { referenceStoredAsProvenanceOnly: true } } as CreativeDnaArtifact;
    const memory = compileCreativeTasteMemory({
      projects: [project], artifacts: [work], trainingReviews: [], dnaArtifacts: [commercialDna],
      acceptances: [{ id: "accept_rights", artifactId: work.id, decision: "accepted", note: "Keep the named commercial artist identity.", actor: "angelo", createdAt: work.createdAt }],
    });
    const signal = memory.personal.preserve[0];
    expect(signal).toMatchObject({ text: "Keep the named commercial artist identity", providerPromptEligible: false });
    const prompt = evolutionBranchPrompt({ basePrompt: work.prompt, role: "refine", canon: memory.projects[project.id].canon, personalTaste: memory.personal, projectTaste: memory.projects[project.id].taste, dimensions: { energy: 60, tension: 50, contrast: 70, warmth: 30, spaciousness: 80, rhythmicity: 50, organicity: 65, polish: 70 } });
    expect(prompt).not.toContain("commercial artist identity");
  });
});
