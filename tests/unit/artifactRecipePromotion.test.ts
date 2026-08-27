import { describe, expect, it } from "vitest";
import type { Artifact, GenerationRecipe, Job, WorkflowDefinition } from "../../shared/contracts";
import {
  artifactCanSaveWinningRecipe,
  generationRecipeMatchesArtifact,
  winningRecipeForArtifact,
} from "../../src/features/artifacts/winningRecipe";

const now = "2026-08-27T04:00:00.000Z";

const workflow: WorkflowDefinition = {
  id: "workflow_image",
  projectId: "project_1",
  name: "Z Image Turbo",
  description: "Fast image workflow",
  sourceFileName: "z-image.json",
  modality: "image",
  executionState: "ready",
  currentRevision: {
    id: "workflowrev_image_3",
    workflowId: "workflow_image",
    version: 3,
    parentRevisionId: "workflowrev_image_2",
    format: "comfyui-api",
    contentHash: "hash_image_3",
    nodeCount: 5,
    parameters: [
      { id: "2::prompt", label: "Prompt", kind: "text", value: "A violet glass figure", mediaKind: null, promptRole: "positive", binding: { format: "comfyui-api", nodeId: "2", inputName: "prompt" } },
      { id: "3::steps", label: "Steps", kind: "number", value: 8, mediaKind: null, binding: { format: "comfyui-api", nodeId: "3", inputName: "steps" } },
      { id: "4::image", label: "Start image", kind: "media", value: "input.png", mediaKind: "image", binding: { format: "comfyui-api", nodeId: "4", inputName: "image" } },
    ],
    models: ["z_image_turbo_bf16.safetensors"],
    createdAt: now,
  },
  createdAt: now,
  updatedAt: now,
};

const artifact: Artifact = {
  id: "artifact_winner",
  projectId: "project_1",
  jobId: "job_winner",
  dnaArtifactId: "dna_1",
  kind: "image",
  name: "Violet figure",
  status: "accepted",
  provider: "local-comfyui",
  prompt: "A violet glass figure",
  preview: { kind: "remote-media", url: "/api/creative-studio/artifacts/artifact_winner/media", colors: ["#111827", "#7c3aed"] },
  lineage: { sourceArtifactIds: [], parentArtifactId: null },
  retention: { state: "retained", size: 2_048 },
  settingsStamp: {
    schemaVersion: 1,
    source: "comfyui-workflow",
    createdAt: now,
    reusedFromJobId: null,
    prompt: "A violet glass figure",
    provider: "local-comfyui",
    modality: "image",
    workflow: { workflowId: workflow.id, revisionId: workflow.currentRevision.id, version: 3, name: workflow.name, format: "comfyui-api", contentHash: workflow.currentRevision.contentHash },
    parameters: { "2::prompt": "A violet glass figure", "3::steps": 8, "4::image": "input.png" },
    models: ["z_image_turbo_bf16.safetensors"],
    inputAssetIds: ["media_1"],
    inputSources: [{ id: "media_1", source: "upload", kind: "image" }],
    inputBindings: { "4::image": "media_1" },
  },
  createdAt: now,
  updatedAt: now,
};

function recipeFromArtifact(): GenerationRecipe {
  const input = winningRecipeForArtifact(artifact, workflow);
  return {
    schemaVersion: "creative-studio-generation-recipe/1.0",
    id: "recipe_winner",
    name: input.name,
    description: input.description ?? "",
    projectId: input.projectId ?? null,
    worldId: input.worldId ?? null,
    mediaKind: input.mediaKind,
    workflowId: input.workflowId,
    workflowRevisionId: input.workflowRevisionId,
    modelIdentifier: input.modelIdentifier ?? null,
    promptProfile: input.promptProfile,
    parameters: input.parameters,
    sourceKinds: input.sourceKinds,
    intentTier: input.intentTier,
    evidence: [],
    evidenceSummary: { runs: 0, completed: 0, failed: 0, cancelled: 0, accepted: 0, rejected: 0, acceptanceRate: null, medianDurationMs: null, fastestDurationMs: null, slowestDurationMs: null },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

describe("artifact winner recipe promotion", () => {
  it("copies the immutable artifact stamp and workflow compatibility into a master recipe", () => {
    const input = winningRecipeForArtifact(artifact, workflow);
    expect(input).toMatchObject({
      projectId: "project_1",
      worldId: null,
      mediaKind: "image",
      workflowId: "workflow_image",
      workflowRevisionId: "workflowrev_image_3",
      modelIdentifier: "z_image_turbo_bf16.safetensors",
      promptProfile: { id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: "z_image_turbo_bf16.safetensors" },
      parameters: artifact.settingsStamp.parameters,
      sourceKinds: ["prompt", "image"],
      intentTier: "master",
    });
    expect(input.parameters).not.toBe(artifact.settingsStamp.parameters);
  });

  it("reuses only an exact active recipe and detects any settings drift", () => {
    const input = winningRecipeForArtifact(artifact, workflow);
    const exact = recipeFromArtifact();
    expect(generationRecipeMatchesArtifact(exact, input)).toBe(true);
    expect(generationRecipeMatchesArtifact({ ...exact, parameters: { ...exact.parameters, "3::steps": 12 } }, input)).toBe(false);
    expect(generationRecipeMatchesArtifact({ ...exact, intentTier: "explore" }, input)).toBe(false);
    expect(generationRecipeMatchesArtifact({ ...exact, archivedAt: now }, input)).toBe(false);
  });

  it("preserves the stamped model-specific music prompt profile", () => {
    const musicWorkflow: WorkflowDefinition = {
      ...workflow,
      name: "MiniMax Music 3",
      sourceFileName: "minimax-music3-api.json",
      modality: "music",
      currentRevision: {
        ...workflow.currentRevision,
        parameters: [
          { id: "2::caption", label: "Caption", kind: "text", value: "A violet pulse", mediaKind: null, promptRole: "positive", binding: { format: "comfyui-api", nodeId: "2", inputName: "caption" } },
        ],
        models: ["minimax_music_3.safetensors"],
      },
    };
    const musicArtifact: Artifact = {
      ...artifact,
      id: "artifact_song_winner",
      kind: "music",
      name: "Violet pulse",
      settingsStamp: {
        ...artifact.settingsStamp,
        modality: "music",
        models: ["minimax_music_3.safetensors"],
        promptEnhancement: {
          schemaVersion: "creative-studio-song-prompt-enhancement/1.1",
          sourcePrompt: "A violet pulse",
          enhancedPrompt: "118 BPM instrumental electronic pulse, tactile bass, concise dynamic drop.",
          provider: "local-comfyui",
          workflowId: "gemma4-song-prompt-enhancer",
          workflowVersion: 1,
          model: "gemma4_e4b_it_fp8_scaled.safetensors",
          comfyPromptId: "prompt_music_1",
          sourceWordCount: 4,
          enhancedWordCount: 10,
          createdAt: now,
          promptProfileId: "minimax-music-3-structured-caption/1.0",
          targetModel: "MiniMax Music 3",
          outputFormat: "structured-caption",
        },
      },
    };
    expect(winningRecipeForArtifact(musicArtifact, musicWorkflow).promptProfile).toEqual({
      id: "minimax-music-3-structured-caption",
      version: "1.0",
      targetModel: "MiniMax Music 3",
    });
  });

  it("shows promotion only for real retained artifacts backed by completed workflow jobs", () => {
    const completedJob = { id: artifact.jobId, status: "completed" } as Job;
    expect(artifactCanSaveWinningRecipe(artifact, completedJob, false, workflow)).toBe(true);
    expect(artifactCanSaveWinningRecipe(artifact, completedJob, false)).toBe(false);
    expect(artifactCanSaveWinningRecipe(artifact, { ...completedJob, status: "running" }, false, workflow)).toBe(false);
    expect(artifactCanSaveWinningRecipe(artifact, completedJob, true, workflow)).toBe(false);
    expect(artifactCanSaveWinningRecipe({ ...artifact, retention: { state: "development-only", size: null } }, completedJob, false, workflow)).toBe(false);
  });

  it("promotes video extension compatibility from its final-frame workflow input", () => {
    const extensionWorkflow: WorkflowDefinition = {
      ...workflow,
      id: "workflow_video",
      name: "MiniMax H3 I2V",
      sourceFileName: "minimax-h3-i2v.json",
      modality: "video",
      currentRevision: {
        ...workflow.currentRevision,
        id: "workflowrev_video_1",
        workflowId: "workflow_video",
        models: [],
      },
    };
    const extensionArtifact: Artifact = {
      ...artifact,
      id: "artifact_extension",
      jobId: "job_extension",
      kind: "video",
      name: "Continued motion",
      settingsStamp: {
        ...artifact.settingsStamp,
        modality: "video",
        models: [],
        workflow: { workflowId: extensionWorkflow.id, revisionId: extensionWorkflow.currentRevision.id, version: 1, name: extensionWorkflow.name, format: "comfyui-api", contentHash: extensionWorkflow.currentRevision.contentHash },
        inputSources: [{ id: "artifact_source_video", source: "artifact", kind: "video" }],
        inputBindings: { "4::image": "artifact_source_video" },
        videoOperation: { kind: "extend", sourceId: "artifact_source_video", source: "artifact", sourceFrame: "last", outputMode: "combined", transitionSeconds: 0.5, audioMode: "keep-source" },
      },
    };
    expect(winningRecipeForArtifact(extensionArtifact, extensionWorkflow)).toMatchObject({
      mediaKind: "video",
      sourceKinds: ["prompt", "image"],
      promptProfile: { id: "creative-studio-video-direct-prompt", version: "1.0", targetModel: "MiniMax H3 I2V" },
    });
    expect(artifactCanSaveWinningRecipe(extensionArtifact, { id: extensionArtifact.jobId, status: "completed" } as Job, false, extensionWorkflow)).toBe(true);
  });
});
