import {
  assessImagePerformance,
  assessTrustedVideoPresetGraph,
  assessTrustedVideoPresetExecution,
  assessVideoPerformance,
  canonicalGenerationPerformanceParameters,
  compileCreativeTasteMemory,
  deriveEvolutionStudies,
  deriveProjectProductionLoop,
  deriveProductionCockpit,
  generationWorkflowPromptParameters,
  musicWorkflowPromptProfile,
  normalizeVideoGenerationVariant,
  normalizeVideoSpeechStamp,
  VIDEO_EXTENSION_SOUND_DIRECTIVE,
  VIDEO_SOUND_DESIGN_DIRECTIVE,
  trustedVideoPresetById,
  trustedVideoPresetStamp,
  type AcceptanceDecision,
  type ArchiveEntryQuery,
  type ArtifactHistoryQuery,
  type Capability,
  type CreateCanonReferenceRequest,
  type CreateContinuityRuleRequest,
  type CreateProjectRequest,
  type CreateWorldEntityRequest,
  type CreateWorldRequest,
  matchCreativeStudioRoute,
  normalizeVideoDurationSeconds,
  primaryWorkflowPromptParameter,
  type CreateCreativeDnaRequest,
  type CreateCreativeDnaTrainingJobRequest,
  type CreateOvernightSessionRequest,
  type ConfigureLoveLoopRequest,
  type CompleteOvernightPlanRequest,
  type FailOvernightPlanRequest,
  type GenerationModality,
  type GenerationPromptReferenceStamp,
  type Job,
  type RetryJobRequest,
  type SaveWorkflowRevisionRequest,
  type StudioSnapshot,
  type SubmitJobBatchRequest,
  type SubmitJobRequest,
  type VideoDurationSeconds,
  type VideoPerformanceMode,
  type VideoPerformanceStamp,
  type VideoSpeechStamp,
  type UpdateProjectRequest,
  type UpdateCanonReferenceRequest,
  type UpdateContinuityRuleRequest,
  type UpdateWorldEntityRequest,
  type UpdateWorldRequest,
  type PromoteArtifactToCanonRequest,
  type PromoteToCanonRequest,
  type EnrollLocalRunnerRequest,
  type RunnerHeartbeatRequest,
  type RunnerJobHeartbeatRequest,
  type RunnerFailJobRequest,
  type OvernightPlanHeartbeatRequest,
  type RunnerTrainingHeartbeatRequest,
  type RunnerCompleteTrainingRequest,
  type ReviewCreativeDnaTrainingRequest,
  type CreateModelTrainingJobRequest,
  type CreateGenerationRecipeRequest,
  type RecordRecipeEvidenceRequest,
  type UpdateGenerationRecipeRequest,
  type ReviewModelTrainingDatasetRequest,
  type ReviewModelAdapterRequest,
  type RunnerModelTrainingHeartbeatRequest,
  type RunnerCompleteModelTrainingDatasetRequest,
  type RunnerCompleteModelTrainingRequest,
  type RunnerFailModelTrainingRequest,
  type CreateVideoPromptEnhancementRequest,
  type RunnerPromptEnhancementHeartbeatRequest,
  type RunnerCompletePromptEnhancementRequest,
  type RunnerFailPromptEnhancementRequest,
  type CreateVideoScriptDraftRequest,
  type UpdateVideoScriptDraftRequest,
  type RunnerVideoScriptDraftHeartbeatRequest,
  type RunnerCompleteVideoScriptDraftRequest,
  type RunnerFailVideoScriptDraftRequest,
  type CompleteStoryPlanRequest,
  type FailStoryPlanRequest,
  type RefreshStoryBankRequest,
  type StoryPlanHeartbeatRequest,
  type UpdateStoryThreadRequest,
  videoScriptWordRange,
  videoWorkflowDurationParameters,
  videoWorkflowPromptProfile,
  workflowSupportsVideoDuration,
} from "../../shared/contracts";
import { afdfwMedia, afdfwSession } from "../adapters/afdfw";
import { backendMode } from "../config";
import { enqueueJob } from "../jobs";
import { body, boundedText, json } from "../lib/http";
import { mediaContent, requestedMediaRange, uploadMedia } from "../media";
import {
  archiveIndexStatus,
  archiveMaterializationById,
  archiveSyncWork,
  claimArchiveMaterialization,
  completeArchiveCatalogSync,
  completeArchiveMaterialization,
  createArchiveMaterialization,
  failArchiveMaterialization,
  listArchiveEntries,
  putArchiveCatalogEntries,
  startArchiveCatalogSync,
} from "../archiveIndex";
import {
  artifactMediaPath,
  artifactThumbnailPath,
  artifactsByIds,
  archiveProject,
  cancelOwnedJob,
  createDevelopmentJob,
  createLocalDna,
  createProject,
  createQueuedJob,
  createGenerationRecipe,
  deleteGenerationRecipe,
  generationRecipeById,
  jobById,
  listAcceptances,
  listArtifacts,
  listArtifactHistoryPage,
  listJobs,
  listGenerationRecipes,
  listJobRuntime,
  listLocalDna,
  listMediaAssets,
  listTrainingExamples,
  listProjects,
  projectById,
  localDnaByIds,
  mediaAssetsByIds,
  reconcileDevelopmentJobs,
  reviewArtifact,
  runnerInputById,
  recordGenerationRecipeEvidence,
  updateGenerationRecipe,
  updateProject,
} from "../repository";
import {
  createCanonReference,
  createContinuityRule,
  createWorld,
  createWorldEntity,
  generationContinuityStamp,
  listWorldRecords,
  promoteArtifactToCanon,
  promoteReferenceToCanon,
  updateCanonReference,
  updateContinuityRule,
  updateWorld,
  updateWorldEntity,
  worldById,
} from "../worlds";
import { retainCompletedArtifact } from "../retention";
import type { Env, OwnerSession } from "../types";
import {
  createAutomationWorkflowRevision,
  createWorkflowRevision,
  importWorkflow,
  listWorkflows,
  promptSafeWorkflowExecutionPlan,
  workflowContent,
  workflowExecutionPlan,
  workflowsByIds,
} from "../workflows";
import {
  authenticateLocalRunner,
  claimLocalRunnerJob,
  completeClaimedLocalRunnerJob,
  enrollLocalRunner,
  failLocalRunnerJob,
  heartbeatLocalRunner,
  heartbeatLocalRunnerJob,
  isLocalRunnerRoute,
  listLocalRunners,
  localRunnerMedia,
  retainClaimedLocalRunnerVideoThumbnail,
  revokeLocalRunner,
  supportsCreativeDnaMediaDescriptions,
  supportsSongPromptEnhancement,
  supportsStoryPlanning,
} from "../runner";
import {
  cancelCreativeDnaTrainingJob,
  creativeDnaTrainingEvidencePool,
  creativeDnaTrainingReviewsByDnaIds,
  assertCreativeDnaReviewed,
  claimLocalRunnerTrainingJob,
  completeLocalRunnerTrainingJob,
  createCreativeDnaTrainingJob,
  failLocalRunnerTrainingJob,
  heartbeatLocalRunnerTrainingJob,
  listCreativeDnaTrainingJobs,
  listCreativeDnaTrainingReviews,
  reviewCreativeDnaTrainingJob,
} from "../training";
import {
  cancelModelTrainingJob,
  claimModelTrainingJob,
  completeModelTrainingDataset,
  completeModelTrainingJob,
  createModelTrainingJob,
  failModelTrainingJob,
  heartbeatModelTrainingJob,
  listModelAdapterReviews,
  listModelAdapters,
  listModelTrainingJobs,
  reviewModelAdapter,
  reviewModelTrainingDataset,
  activeMusicAdapterBindings,
} from "../modelTraining";
import {
  claimVideoPromptEnhancement,
  completeVideoPromptEnhancement,
  createVideoPromptEnhancement,
  failVideoPromptEnhancement,
  heartbeatVideoPromptEnhancement,
  listVideoPromptEnhancements,
  supportsVideoPromptEnhancement,
  videoPromptEnhancementById,
  videoPromptEnhancementStampForJob,
} from "../promptEnhancements";
import {
  claimVideoScriptDraft,
  completeVideoScriptDraft,
  createVideoScriptDraft,
  failVideoScriptDraft,
  heartbeatVideoScriptDraft,
  listVideoScriptDrafts,
  supportsVideoScriptDrafts,
  updateVideoScriptDraft,
  videoScriptDraftById,
  videoScriptStampForJob,
} from "../videoScripts";
import {
  cancelOvernightSession,
  claimOvernightPlan,
  completeOvernightPlan,
  createOvernightSession,
  failOvernightPlan,
  heartbeatOvernightPlan,
  listOvernightSessions,
  pauseOvernightSession,
  reconcileOvernightSessions,
  resumeOvernightSession,
} from "../overnight";
import {
  configureLoveLoop,
  disableLoveLoop,
  loveLoopForOwner,
  pauseLoveLoop,
  reconcileLoveLoops,
  resumeLoveLoop,
} from "../loveLoop";
import {
  claimStoryPlan,
  completeStoryPlan,
  createStoryBankRefresh,
  ensureAutomaticStoryRefresh,
  failStoryPlan,
  heartbeatStoryPlan,
  listStoryBank,
  markStoryRecommendationUsed,
  storyRecommendationStampForJob,
  updateStoryThread,
} from "../stories";
import {
  advanceGenerationBatch,
  cancelGenerationBatch,
  claimGenerationBatch,
  deferGenerationBatch,
  generationBatchById,
  generationBatchJobs,
  generationBatchLaneJobs,
  listGenerationBatches,
  prioritizeGenerationBatchJobs,
  registerGenerationBatch,
  releaseGenerationBatch,
  settleGenerationBatch,
  type GenerationBatchRecord,
} from "../generationBatches";

function developmentMode(env: Env) {
  return backendMode(env) === "development";
}

function localHardwareMode(env: Env) {
  return developmentMode(env) && env.LOCAL_HARDWARE_ONLY === "true";
}

async function ownerSession(env: Env, request: Request): Promise<OwnerSession> {
  if (developmentMode(env)) return { status: "development", userId: "development-angelo", displayName: "Angelo" };
  return afdfwSession(env, request);
}

function statusFor(error: string) {
  if (error === "approved_login_required" || error === "runner_authentication_required") return 401;
  if (error.endsWith("_not_found")) return 404;
  if (error.includes("not_configured") || error.startsWith("afdfw_")) return 503;
  if (error === "media_upload_too_large") return 413;
  if (error === "workflow_upload_too_large") return 413;
  if (error === "runner_output_too_large") return 413;
  if (error === "unsupported_media_type") return 415;
  if (error === "unsupported_workflow_type") return 415;
  if (error === "unsupported_runner_output_type") return 415;
  if (error === "media_upload_verification_failed") return 502;
  if (error === "archive_materialization_verification_failed" || error === "archive_materialization_retention_failed") return 502;
  if (error === "invalid_media_range") return 416;
  if (error === "generation_in_progress" || error === "job_not_cancellable" || error === "job_not_retryable"
    || error === "training_job_not_claimable" || error === "training_job_not_cancellable" || error === "training_job_not_completable"
    || error === "training_review_required" || error === "training_review_not_ready" || error === "training_evidence_already_reserved"
    || error === "model_training_job_not_cancellable" || error === "model_training_dataset_not_ready"
    || error === "model_adapter_already_reviewed" || error === "recipe_evidence_settings_immutable"
    || error === "generation_recipe_archived") return 409;
  if (error === "runner_job_not_completable" || error === "image_custom_mode_required"
    || error === "video_heavy_mode_required" || error === "video_heavy_mode_not_required"
    || error === "video_performance_revision_mismatch" || error === "trusted_video_preset_mode_required"
    || error === "trusted_video_preset_mismatch") return 409;
  if (error === "prompt_enhancement_not_completable" || error === "prompt_enhancement_not_ready"
    || error === "prompt_enhancement_idempotency_conflict" || error === "prompt_enhancement_context_mismatch"
    || error === "prompt_enhancement_applied_prompt_mismatch") return 409;
  if (error === "video_script_draft_not_completable" || error === "video_script_draft_not_ready"
    || error === "video_script_idempotency_conflict" || error === "video_script_context_mismatch"
    || error === "video_script_version_conflict" || error === "video_script_applied_text_mismatch"
    || error === "video_script_speech_mismatch") return 409;
  if (error === "overnight_session_already_active" || error === "overnight_session_not_pauseable"
    || error === "overnight_session_not_resumable" || error === "overnight_window_ended"
    || error === "overnight_plan_not_completable" || error === "overnight_plan_conflict") return 409;
  if (error === "love_loop_already_configured" || error === "love_loop_not_pauseable"
    || error === "love_loop_not_resumable" || error === "love_loop_not_active") return 409;
  if (error === "story_plan_not_completable" || error === "story_thread_version_conflict"
    || error === "story_recommendation_changed") return 409;
  if (error === "generation_batch_conflict" || error === "generation_batch_terminal") return 409;
  if (error === "archive_sync_source_conflict" || error === "archive_sync_batch_conflict"
    || error === "archive_sync_entry_conflict" || error === "archive_sync_not_writable"
    || error === "archive_sync_not_completable" || error === "archive_sync_count_mismatch"
    || error === "archive_entry_not_materializable" || error === "archive_materialization_idempotency_conflict"
    || error === "archive_materialization_not_claimable" || error === "archive_materialization_not_completable"
    || error === "archive_materialization_source_mismatch") return 409;
  if (error.endsWith("_version_conflict") || error === "artifact_acceptance_required" || error === "artifact_acceptance_mismatch"
    || error === "canon_reference_artifact_acceptance_required" || error === "canon_promotion_prerequisite_changed"
    || error === "artifact_already_canonical") return 409;
  return 400;
}

function idempotencyKey(value: unknown) {
  const key = String(value ?? "").trim();
  if (!/^[a-z0-9_-]{16,100}$/i.test(key)) throw new Error("invalid_idempotency_key");
  return key;
}

function boundedPrompt(value: unknown, limit = 4_000) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

function artifactHistoryQuery(url: URL): ArtifactHistoryQuery {
  const limitValue = url.searchParams.get("limit");
  const createdAt = boundedText(url.searchParams.get("cursorCreatedAt"), 40);
  const artifactId = boundedText(url.searchParams.get("cursorArtifactId"), 100);
  if (Boolean(createdAt) !== Boolean(artifactId)) throw new Error("invalid_artifact_history_cursor");
  const kinds = url.searchParams.getAll("kind").flatMap((value) => value.split(",")).filter(Boolean) as ArtifactHistoryQuery["kinds"];
  const statuses = url.searchParams.getAll("status").flatMap((value) => value.split(",")).filter(Boolean) as ArtifactHistoryQuery["statuses"];
  return {
    projectId: boundedText(url.searchParams.get("projectId"), 100) || null,
    cursor: createdAt && artifactId ? { createdAt, artifactId } : null,
    limit: limitValue === null ? undefined : Number(limitValue),
    kinds,
    statuses,
    includeArchived: url.searchParams.get("includeArchived") === "true",
    search: boundedText(url.searchParams.get("q"), 120),
  };
}

function archiveEntryQuery(url: URL): ArchiveEntryQuery {
  const cursorCatalogId = boundedText(url.searchParams.get("cursorCatalogId"), 100);
  const cursorSortName = boundedText(url.searchParams.get("cursorSortName"), 240);
  const cursorEntryId = boundedText(url.searchParams.get("cursorEntryId"), 100);
  const cursorParts = [cursorCatalogId, cursorSortName, cursorEntryId].filter(Boolean).length;
  if (cursorParts !== 0 && cursorParts !== 3) throw new Error("invalid_archive_entry_cursor");
  const limit = url.searchParams.get("limit");
  const observedYear = url.searchParams.get("observedYear");
  const materializable = url.searchParams.get("materializable");
  if (materializable !== null && materializable !== "true" && materializable !== "false") throw new Error("invalid_archive_entry_filter");
  return {
    cursor: cursorParts === 3 ? { catalogId: cursorCatalogId, sortName: cursorSortName, entryId: cursorEntryId } : null,
    limit: limit === null ? undefined : Number(limit),
    search: boundedText(url.searchParams.get("search"), 120),
    mediaKind: (boundedText(url.searchParams.get("mediaKind"), 20) || null) as ArchiveEntryQuery["mediaKind"],
    observedYear: observedYear === null || observedYear === "" ? null : Number(observedYear),
    materializable: materializable === null ? null : materializable === "true",
  };
}

function reconciliationEmail(request: Request) {
  const email = String(request.headers.get("cf-access-authenticated-user-email") ?? "").trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) throw new Error("background_identity_required");
  return email;
}

function generationBatchErrorIsPermanent(error: string) {
  return /^(?:invalid_|unknown_|creative_dna_not_found|dna_project_mismatch|project_not_found|project_archived|workflow_.*(?:required|missing|mismatch|not_found|not_supported)|runner_input_.*(?:not_found|mismatch)|video_.*(?:required|missing|mismatch|not_supported)|generation_batch_conflict)/i.test(error);
}

function authoredPromptBeforeContinuity(prompt: string, suffix: string, videoSpeech?: VideoSpeechStamp) {
  const marker = ` ${suffix}`;
  const markerIndex = prompt.lastIndexOf(marker);
  if (markerIndex < 0) return "";
  const trailing = prompt.slice(markerIndex + marker.length).trim();
  if (trailing) {
    if (!videoSpeech) return "";
    const allowedTrustedSpeechTails = new Set([
      videoSpeech.directive,
      `Audio: ${videoSpeech.directive}`,
      `${videoSpeech.directive}\nAudio: Soundscape follows the visible action.`,
    ]);
    if (!allowedTrustedSpeechTails.has(trailing)) return "";
  }
  return prompt.slice(0, markerIndex).replace(/[.\s]+$/, "").trim();
}

function internalBatchLaneRequest(incoming: Request, batch: GenerationBatchRecord, input: SubmitJobRequest) {
  const headers = new Headers(incoming.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("authorization");
  headers.delete("x-creative-studio-runner-token");
  if (batch.reconcileEmail) headers.set("cf-access-authenticated-user-email", batch.reconcileEmail);
  return new Request(new URL("/api/creative-studio/jobs", incoming.url), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
}

function batchLaneRetryKey(lane: number, failedJobId: string) {
  const stableJobId = failedJobId.replace(/[^a-z0-9_-]/gi, "_").slice(-72);
  return `batch_retry_${lane}_${stableJobId}`;
}

function internalBatchLaneRetryRequest(incoming: Request, batch: GenerationBatchRecord, failedJob: Job, lane: number) {
  const headers = new Headers(incoming.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("authorization");
  headers.delete("x-creative-studio-runner-token");
  if (batch.reconcileEmail) headers.set("cf-access-authenticated-user-email", batch.reconcileEmail);
  return new Request(new URL(`/api/creative-studio/jobs/${failedJob.id}/retry`, incoming.url), {
    method: "POST",
    headers,
    body: JSON.stringify({ idempotencyKey: batchLaneRetryKey(lane, failedJob.id) }),
  });
}

async function reconcileGenerationBatch(
  incoming: Request,
  env: Env,
  ownerId: string,
  requestedBatchId?: string,
) {
  let batch = await claimGenerationBatch(env, ownerId, requestedBatchId);
  if (!batch) return requestedBatchId ? generationBatchById(env, ownerId, requestedBatchId) : null;
  try {
    await prioritizeGenerationBatchJobs(env, ownerId, batch.id);
    const materialized = await generationBatchLaneJobs(env, ownerId, batch.id);
    const cancelled = materialized.find((job) => job.status === "cancelled");
    if (cancelled) {
      const cancelledLane = Number(cancelled.settingsStamp.outputBatch?.index ?? batch.nextLane);
      batch = (await cancelGenerationBatch(env, ownerId, batch.id, cancelledLane))!;
      return batch;
    }
    for (let lane = 1; lane <= batch.laneCount; lane += 1) {
      const laneRequest = batch.request.jobs[lane - 1];
      const laneJobs = materialized.filter((job) => Number(job.settingsStamp.outputBatch?.index) === lane);
      const completed = laneJobs.find((job) => job.status === "completed");
      const active = laneJobs.find((job) => job.status === "queued" || job.status === "running");
      const failed = laneJobs.filter((job) => job.status === "failed").at(-1);
      if (!completed && !active && failed) {
        const error = boundedText(failed.error, 500) || `generation_batch_lane_${lane}_render_failed`;
        if (batch.failedLane !== lane || !batch.nextAttemptAt) {
          batch = (await deferGenerationBatch(env, ownerId, batch.id, lane, error, generationBatchErrorIsPermanent(error)))!;
          return batch;
        }
        const response = await routeCreativeStudioApi(internalBatchLaneRetryRequest(incoming, batch, failed, lane), env);
        const payload = await response.json() as { ok?: boolean; error?: string; job?: Job };
        if (!response.ok || payload.ok !== true || !payload.job) {
          const retryError = boundedText(payload.error, 500) || `generation_batch_lane_${lane}_retry_failed`;
          batch = (await deferGenerationBatch(env, ownerId, batch.id, lane, retryError, generationBatchErrorIsPermanent(retryError)))!;
          return batch;
        }
        continue;
      }
      if (!completed && !active) {
        const response = await routeCreativeStudioApi(internalBatchLaneRequest(incoming, batch, laneRequest), env);
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || payload.ok !== true) {
          const error = boundedText(payload.error, 500) || `generation_batch_lane_${lane}_failed`;
          batch = (await deferGenerationBatch(env, ownerId, batch.id, lane, error, generationBatchErrorIsPermanent(error)))!;
          return batch;
        }
      }
      if (lane >= batch.nextLane) batch = (await advanceGenerationBatch(env, ownerId, batch.id, lane))!;
    }
    batch = (await settleGenerationBatch(env, ownerId, batch.id))!;
    return batch;
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "generation_batch_reconciliation_failed";
    batch = (await deferGenerationBatch(env, ownerId, batch.id, batch.nextLane, error, generationBatchErrorIsPermanent(error)))!;
    return batch;
  } finally {
    const current = await generationBatchById(env, ownerId, batch.id);
    if (current?.status === "running") await releaseGenerationBatch(env, ownerId, batch.id);
  }
}

function workflowJobModality(value: string): GenerationModality {
  if (value === "audio" || value === "music") return "music";
  if (value === "image" || value === "video") return value;
  throw new Error("workflow_modality_not_supported");
}

async function videoPerformanceForWorkflow(
  workflow: Awaited<ReturnType<typeof workflowExecutionPlan>>["workflow"],
  graph: Awaited<ReturnType<typeof workflowExecutionPlan>>["graph"],
  requestedDuration: VideoDurationSeconds | undefined,
  requestedMode: VideoPerformanceMode | undefined,
  requestedTrustedPresetId: unknown = undefined,
  outputCount = 1,
): Promise<{ stamp: VideoPerformanceStamp; effectiveDuration: VideoDurationSeconds | undefined }> {
  const trustedPreset = requestedTrustedPresetId === undefined ? null : trustedVideoPresetById(requestedTrustedPresetId);
  if (requestedTrustedPresetId !== undefined && !trustedPreset) throw new Error("invalid_trusted_video_preset");
  if (trustedPreset && workflow.modality !== "video") throw new Error("invalid_trusted_video_preset");
  if (trustedPreset && requestedMode !== "explicit-heavy") throw new Error("trusted_video_preset_mode_required");
  if (trustedPreset && requestedDuration !== undefined && requestedDuration !== trustedPreset.settings.durationSeconds) {
    throw new Error("trusted_video_preset_mismatch");
  }
  if (trustedPreset) {
    const trustedAssessment = assessTrustedVideoPresetExecution(workflow, outputCount, trustedPreset);
    if (!trustedAssessment.supported || !trustedAssessment.matches) throw new Error("trusted_video_preset_mismatch");
    const graphAssessment = await assessTrustedVideoPresetGraph(graph, trustedPreset);
    if (!graphAssessment.supported || !graphAssessment.matches) throw new Error("trusted_video_preset_mismatch");
  }
  const revisionDurationValues = videoWorkflowDurationParameters(workflow.currentRevision.parameters)
    .map((parameter) => Number(parameter.value));
  if (!revisionDurationValues.length || revisionDurationValues.some((value) => normalizeVideoDurationSeconds(value) === null)) {
    throw new Error("video_duration_control_missing");
  }
  if (new Set(revisionDurationValues).size !== 1) throw new Error("video_duration_revision_mismatch");
  const revisionDuration = normalizeVideoDurationSeconds(revisionDurationValues[0])!;
  if (requestedDuration !== undefined && requestedDuration !== revisionDuration) throw new Error("video_duration_revision_mismatch");
  if (!workflowSupportsVideoDuration(workflow, revisionDuration)) throw new Error("video_duration_not_supported_by_model");
  const effectiveDuration = requestedDuration ?? revisionDuration;
  const parameters = canonicalGenerationPerformanceParameters(workflow.currentRevision.parameters);
  const assessment = assessVideoPerformance({
    parameters,
    models: workflow.currentRevision.models,
    inputAssetIds: [],
    inputArtifactIds: [],
    prompt: "",
    videoDurationSeconds: effectiveDuration,
  });
  const mode = requestedMode ?? "fast-default";
  if (assessment.requiresExplicitHeavy && mode !== "explicit-heavy") throw new Error("video_heavy_mode_required");
  if (!assessment.requiresExplicitHeavy && mode !== "fast-default") throw new Error("video_heavy_mode_not_required");
  return {
    effectiveDuration,
    stamp: {
      schemaVersion: "creative-studio-video-performance/1.0",
      mode,
      workflowRevisionId: workflow.currentRevision.id,
      trustedPreset: trustedPreset ? trustedVideoPresetStamp(trustedPreset) : undefined,
      workload: {
        ...assessment.workload,
        frames: trustedPreset?.settings.frames ?? assessment.workload.frames,
        fps: trustedPreset?.settings.fps ?? assessment.workload.fps,
        requiresExplicitHeavy: assessment.requiresExplicitHeavy,
        reasons: [...assessment.reasons],
      },
    },
  };
}

async function revalidatedVideoPerformance(env: Env, ownerId: string, job: Job) {
  if (job.modality !== "video") return undefined;
  const workflow = job.settingsStamp.workflow;
  if (!workflow) throw new Error("runner_workflow_missing");
  const plan = await workflowExecutionPlan(env, ownerId, workflow.workflowId, workflow.revisionId);
  const stamped = job.settingsStamp.videoPerformance;
  if (stamped && stamped.workflowRevisionId !== plan.workflow.currentRevision.id) {
    throw new Error("video_performance_revision_mismatch");
  }
  return videoPerformanceForWorkflow(
    plan.workflow,
    plan.graph,
    job.settingsStamp.videoDurationSeconds,
    stamped?.mode,
    stamped?.trustedPreset?.id,
    job.settingsStamp.outputBatch?.count ?? 1,
  );
}

async function assertReusableLocalWorkflowPrompt(env: Env, ownerId: string, job: Job) {
  if (job.modality === "music") return;
  const workflow = job.settingsStamp.workflow;
  if (!workflow) throw new Error("runner_workflow_missing");
  const plan = await workflowExecutionPlan(env, ownerId, workflow.workflowId, workflow.revisionId);
  const expected = boundedText(job.settingsStamp.prompt, 4_000);
  const positives = generationWorkflowPromptParameters(plan.workflow.currentRevision.parameters);
  const negatives = plan.workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "text" && parameter.promptRole === "negative");
  if (!expected || !positives.length
    || positives.some((parameter) => boundedText(parameter.value, 4_000) !== expected
      || boundedText(job.settingsStamp.parameters[parameter.id], 4_000) !== expected)
    || negatives.some((parameter) => boundedText(parameter.value, 4_000) === expected
      || boundedText(job.settingsStamp.parameters[parameter.id], 4_000) === expected)) {
    throw new Error("workflow_prompt_integrity_failed");
  }
}

function requestedVideoOperation(value: SubmitJobRequest["videoOperation"], modality: GenerationModality) {
  if (value === undefined) return undefined;
  if (modality !== "video" || !value || typeof value !== "object" || value.kind !== "extend") {
    throw new Error("invalid_video_operation");
  }
  const sourceId = boundedText(value.sourceId, 100);
  const transitionSeconds = Number(value.transitionSeconds);
  if (!sourceId || !["upload", "artifact"].includes(value.source) || value.sourceFrame !== "last"
    || !["combined", "continuation"].includes(value.outputMode)
    || ![0, 0.25, 0.5, 1].includes(transitionSeconds)
    || !["new-sound", "keep-source", "mute"].includes(value.audioMode)
    || (value.outputMode === "continuation" && (transitionSeconds !== 0 || value.audioMode === "keep-source"))) {
    throw new Error("invalid_video_operation");
  }
  return { ...value, sourceId, transitionSeconds } as NonNullable<SubmitJobRequest["videoOperation"]>;
}

async function generationPromptReferenceStamp(
  env: Env,
  ownerId: string,
  projectId: string,
  modality: GenerationModality,
  value: SubmitJobRequest["promptReference"],
  inputBindings: Record<string, string>,
): Promise<GenerationPromptReferenceStamp | undefined> {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || modality !== "music"
    || value.schemaVersion !== "creative-studio-prompt-reference-request/1.0"
    || value.purpose !== "music-prompt-inspiration"
    || !["upload", "artifact"].includes(value.source)
    || !["image", "audio", "video"].includes(value.kind)) {
    throw new Error("invalid_generation_prompt_reference");
  }
  const sourceId = boundedText(value.sourceId, 100);
  if (!sourceId) throw new Error("invalid_generation_prompt_reference");
  if (Object.values(inputBindings).includes(sourceId)) throw new Error("prompt_reference_renderer_binding_conflict");
  const source = await runnerInputById(env, ownerId, sourceId);
  if (!source) throw new Error("prompt_reference_source_not_found");
  if (source.projectId !== projectId) throw new Error("prompt_reference_project_mismatch");
  if (source.source !== value.source || source.kind !== value.kind) throw new Error("prompt_reference_source_mismatch");
  return {
    schemaVersion: "creative-studio-prompt-reference/1.0",
    purpose: "music-prompt-inspiration",
    projectId,
    sourceId: source.id,
    source: source.source,
    kind: source.kind,
    name: boundedText(source.name, 200),
  };
}

function aceStepWorkflowIdentity(workflow: Awaited<ReturnType<typeof workflowExecutionPlan>>["workflow"]) {
  return [workflow.name, workflow.description, workflow.sourceFileName, ...workflow.currentRevision.models]
    .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function aceStepAdapterParameterIds(workflow: Awaited<ReturnType<typeof workflowExecutionPlan>>["workflow"]) {
  let fileId: string | null = null;
  let strengthId: string | null = null;
  for (const parameter of workflow.currentRevision.parameters) {
    const bindingName = parameter.binding.format === "comfyui-api" ? parameter.binding.inputName : "";
    const identity = `${parameter.id} ${parameter.label} ${bindingName}`.toLowerCase();
    if (!fileId && /(lora|adapter).*(name|file|path)|(name|file|path).*(lora|adapter)/.test(identity)) fileId = parameter.id;
    if (!strengthId && /(lora|adapter).*(strength|weight|scale)|(strength|weight|scale).*(lora|adapter)/.test(identity)) strengthId = parameter.id;
  }
  return { fileId, strengthId };
}

async function capabilities(env: Env, session: OwnerSession, knownRunners?: Awaited<ReturnType<typeof listLocalRunners>>): Promise<Capability[]> {
  const checkedAt = new Date().toISOString();
  if (developmentMode(env)) {
    const runnerList = knownRunners ?? await listLocalRunners(env, session.userId);
    const runnerAvailable = runnerList.some((runner) => runner.state === "online" || runner.state === "busy");
    const trainingRunnerAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsCreativeDnaMediaDescriptions(runner.version));
    const musicRunnerAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsSongPromptEnhancement(runner.version));
    const promptEnhancementAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsVideoPromptEnhancement(runner.version));
    const videoScriptAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsVideoScriptDrafts(runner.version));
    const storyPlannerAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsStoryPlanning(runner.version));
    const aceStepTrainingAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy")
      && runner.modelTrainingProviders.includes("ace-step-1.5-lora"));
    if (localHardwareMode(env)) return [
      { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Local Creative Studio D1", detail: "Versioned DNA stays in the Wrangler-local database on this machine.", checkedAt },
      { key: "creative-worlds", label: "Creative Worlds", state: "available", provider: "Local Creative Studio D1", detail: "Versioned worlds, elements, rules, candidates, and explicit canon promotions stay on this machine.", checkedAt },
      { key: "media-library", label: "Media library", state: env.ARTIFACTS ? "available" : "unavailable", provider: env.ARTIFACTS ? "Local Creative Studio R2" : "not configured", detail: env.ARTIFACTS ? "Uploads and generated results stay in Wrangler-local object storage." : "A local R2 binding is required for real media.", checkedAt },
      { key: "workflow-library", label: "ComfyUI workflows", state: "available", provider: "Local Creative Studio D1", detail: "Uploaded workflow JSON and immutable revisions stay on this machine.", checkedAt },
      { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "available", provider: "Local Creative Studio D1", detail: "Accepted prompts, settings, and consented uploads remain local training evidence.", checkedAt },
      { key: "creative-dna-training", label: "Analyze CreativeDNA", state: trainingRunnerAvailable ? "available" : "degraded", provider: "RTX hardware + Gemma 4", detail: trainingRunnerAvailable ? "The local runner can analyze image, audio, and video on this machine." : "Start the local stack and ComfyUI to process durable analysis jobs.", checkedAt },
      { key: "model-adapter-training", label: "ACE-Step music LoRA", state: aceStepTrainingAvailable ? "available" : "degraded", provider: "Local ACE-Step 1.5 + RTX 3090", detail: aceStepTrainingAvailable ? "This runner can prepare, train, retain, and review ACE-Step music LoRA adapters." : "Install the ACE-Step 1.5 runtime and Base checkpoints on the paired machine; Creative Studio will not simulate model training.", checkedAt },
      { key: "local-runner", label: "Local Runner", state: runnerAvailable ? "available" : "degraded", provider: "This Windows machine", detail: runnerAvailable ? "ComfyUI work is executing directly against localhost hardware." : "Start the local stack and ComfyUI to execute imported API-format workflows.", checkedAt },
      { key: "music-generation", label: "Music generation", state: musicRunnerAvailable ? "available" : "degraded", provider: "Local ComfyUI + Gemma 4", detail: musicRunnerAvailable ? "Gemma 4 compiles each direction with the selected music model's prompt profile before rendering." : "Start Local Runner 1.7 or newer so song prompts are compiled for the selected model.", checkedAt },
      { key: "image-generation", label: "Image generation", state: runnerAvailable ? "available" : "degraded", provider: "Local ComfyUI", detail: "A real executable image workflow is required; no development media is generated.", checkedAt },
      { key: "video-generation", label: "Video generation", state: runnerAvailable ? "available" : "degraded", provider: "Local ComfyUI", detail: "A real executable video workflow is required and runs on this machine.", checkedAt },
      { key: "prompt-enhancement", label: "Video prompt enhancement", state: promptEnhancementAvailable ? "available" : "degraded", provider: "Local ComfyUI + Gemma 4", detail: promptEnhancementAvailable ? "Gemma 4 can inspect the selected first frame and compile an editable, model-specific video direction." : "Start Local Runner 1.10 or newer with Gemma 4 available.", checkedAt },
      { key: "script-builder", label: "Full Video Script", state: videoScriptAvailable ? "available" : "degraded", provider: "Local ComfyUI + Gemma 4", detail: videoScriptAvailable ? "Turn one idea into an editable model-specific scene with action, camera, sound, and optional dialogue." : "Start Local Runner 1.12 or newer with Gemma 4 available.", checkedAt },
      { key: "story-bank", label: "Story Bank", state: storyPlannerAvailable ? "available" : "degraded", provider: "Local ComfyUI + Gemma 4", detail: storyPlannerAvailable ? "The idle Local Runner prepares reusable story, image, video, and music directions in one batch, then unloads the model." : "Start Local Runner 1.17 or newer to prepare durable recommendations.", checkedAt },
      { key: "afdfw-music-generation", label: "AFDFW music generation", state: "unavailable", provider: "remote mode only", detail: "Local hardware mode never sends music generation to AFDFW.", checkedAt },
      { key: "afdfw-image-generation", label: "AFDFW image generation", state: "unavailable", provider: "remote mode only", detail: "Local hardware mode never sends image generation to AFDFW.", checkedAt },
      { key: "artifact-review", label: "Artifact review", state: "available", provider: "Local Creative Studio D1", detail: "Review decisions are explicit, append-only, and local.", checkedAt },
      { key: "artifact-retention", label: "Artifact retention", state: env.ARTIFACTS ? "available" : "unavailable", provider: "Local Creative Studio R2", detail: env.ARTIFACTS ? "Every completed local result is byte-verified before review." : "Local jobs cannot complete without object storage.", checkedAt },
      { key: "afdfw-session", label: "AFDFW backend", state: "unavailable", provider: "remote mode only", detail: "Local hardware mode never calls AFDFW or Cloudflare generation services.", checkedAt },
    ];
    return [
      { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Creative Studio D1", detail: "Versioned DNA is stored in the standalone Worker database.", checkedAt },
      { key: "creative-worlds", label: "Creative Worlds", state: "available", provider: "Creative Studio D1", detail: "World continuity and explicit canon decisions are real product-owned records; development media is never promoted automatically.", checkedAt },
      { key: "media-library", label: "Media library", state: env.ARTIFACTS ? "available" : "unavailable", provider: env.ARTIFACTS ? "Creative Studio R2" : "not configured", detail: env.ARTIFACTS ? "Owner uploads are size-verified and retained under project scope." : "An R2 binding is required for real uploads.", checkedAt },
      { key: "workflow-library", label: "ComfyUI workflows", state: "available", provider: "Creative Studio D1", detail: "Uploaded graphs and custom settings are stored as immutable, content-hashed revisions.", checkedAt },
      { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "available", provider: "Creative Studio D1", detail: "Generated results enter a candidate set; explicit acceptance promotes prompt and settings evidence to training-ready.", checkedAt },
      { key: "creative-dna-training", label: "Analyze CreativeDNA", state: "unavailable", provider: "local runner required", detail: "Real upload analysis jobs require the Creative Studio Worker and an authenticated local runner.", checkedAt },
      { key: "model-adapter-training", label: "ACE-Step music LoRA", state: "unavailable", provider: "local ACE-Step runner required", detail: "Model training is never simulated by the development adapter.", checkedAt },
      { key: "local-runner", label: "Local Runner", state: "unavailable", provider: "not paired", detail: "Pair a Windows runner through Settings to execute API-format ComfyUI workflows.", checkedAt },
      { key: "music-generation", label: "Music generation", state: "degraded", provider: "development worker", detail: "Durable metadata and decisions are real; generated media is a development placeholder.", checkedAt },
      { key: "image-generation", label: "Image generation", state: "degraded", provider: "development worker", detail: "Durable metadata and decisions are real; generated media is a development placeholder.", checkedAt },
      { key: "video-generation", label: "Video generation", state: "unavailable", provider: "local runner required", detail: "Video workflow execution requires a paired Local Runner.", checkedAt },
      { key: "prompt-enhancement", label: "Video prompt enhancement", state: "unavailable", provider: "local runner required", detail: "Real prompt enhancement is never simulated by the development adapter.", checkedAt },
      { key: "script-builder", label: "Full Video Script", state: "unavailable", provider: "local runner required", detail: "Real full-scene writing is never simulated by the development adapter.", checkedAt },
      { key: "story-bank", label: "Story Bank", state: "unavailable", provider: "local runner required", detail: "The development adapter never invents placeholder stories or prompt recommendations.", checkedAt },
      { key: "afdfw-music-generation", label: "AFDFW music generation", state: "unavailable", provider: "not configured", detail: "Development mode does not call AFDFW.", checkedAt },
      { key: "afdfw-image-generation", label: "AFDFW image generation", state: "unavailable", provider: "not configured", detail: "Development mode does not call AFDFW.", checkedAt },
      { key: "artifact-review", label: "Artifact review", state: "available", provider: "Creative Studio D1", detail: "Accept, reject, and archive decisions are explicit and append-only.", checkedAt },
      { key: "artifact-retention", label: "Artifact retention", state: "degraded", provider: "Creative Studio D1", detail: "History is durable; standalone media retention awaits the Creative Studio R2 boundary.", checkedAt },
      { key: "afdfw-session", label: "AFDFW backend", state: "unavailable", provider: "not configured", detail: "Development mode does not call AFDFW.", checkedAt },
    ];
  }

  const runnerList = knownRunners ?? await listLocalRunners(env, session.userId);
  const runnerAvailable = runnerList.some((runner) => runner.state === "online" || runner.state === "busy");
  const trainingRunnerAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsCreativeDnaMediaDescriptions(runner.version));
  const musicRunnerAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsSongPromptEnhancement(runner.version));
  const promptEnhancementAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsVideoPromptEnhancement(runner.version));
  const videoScriptAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsVideoScriptDrafts(runner.version));
  const storyPlannerAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy") && supportsStoryPlanning(runner.version));
  const aceStepTrainingAvailable = runnerList.some((runner) => (runner.state === "online" || runner.state === "busy")
    && runner.modelTrainingProviders.includes("ace-step-1.5-lora"));
  const generationState = session.status === "approved" ? "available" : "unavailable";
  return [
    { key: "creative-dna", label: "CreativeDNA v1", state: "available", provider: "Creative Studio D1", detail: "Versioned CreativeDNA remains owned by the standalone product.", checkedAt },
    { key: "creative-worlds", label: "Creative Worlds", state: "available", provider: "Creative Studio D1", detail: "Versioned world continuity and explicit canon promotions remain Creative Studio-owned; artifact acceptance never changes canon.", checkedAt },
    { key: "media-library", label: "Media library", state: env.ARTIFACTS ? "available" : "unavailable", provider: env.ARTIFACTS ? "Creative Studio R2" : "not configured", detail: env.ARTIFACTS ? "Uploaded image, audio, and video are retained with owner, project, consent, and provenance metadata." : "An R2 binding is required for real uploads.", checkedAt },
    { key: "workflow-library", label: "ComfyUI workflows", state: "available", provider: "Creative Studio D1", detail: "Workflow JSON, detected controls, models, revisions, and content hashes remain product-owned.", checkedAt },
    { key: "creative-dna-training-data", label: "CreativeDNA training data", state: "available", provider: "Creative Studio D1", detail: "Prompts and exact generation settings are candidates until artifact review makes them training-ready or excluded.", checkedAt },
    { key: "creative-dna-training", label: "Analyze CreativeDNA", state: trainingRunnerAvailable ? "available" : "degraded", provider: "Creative Studio D1 + Gemma 4", detail: trainingRunnerAvailable ? "The paired machine measures selected media and uses Gemma 4 to retain a detailed image, audio, or video description with each source." : "Analysis jobs remain durable until a paired Local Runner 1.2 or newer comes online.", checkedAt },
    { key: "model-adapter-training", label: "ACE-Step music LoRA", state: aceStepTrainingAvailable ? "available" : "degraded", provider: "Creative Studio Local Runner + ACE-Step 1.5", detail: aceStepTrainingAvailable ? "The paired machine can execute reviewed ACE-Step tensor preprocessing and LoRA training locally." : "Install ACE-Step 1.5 Base checkpoints on the paired runner. The job stays durable and no fake checkpoint is produced.", checkedAt },
    { key: "local-runner", label: "Local Runner", state: runnerAvailable ? "available" : "degraded", provider: "Creative Studio Windows agent", detail: runnerAvailable ? "A paired machine is online and can claim ComfyUI workflow jobs without an open browser." : "Pair and start the Windows agent in Settings to execute imported API-format workflows.", checkedAt },
    { key: "music-generation", label: "Music generation", state: musicRunnerAvailable ? "available" : "degraded", provider: "Local Runner + Gemma 4 + ComfyUI", detail: musicRunnerAvailable ? "Gemma 4 compiles the authored music brief with the selected model's prompt profile before ComfyUI runs, including MiniMax Music 3's structured caption." : "Music jobs remain durable until a paired Local Runner 1.7 or newer can compile and render them.", checkedAt },
    { key: "image-generation", label: "Image generation", state: runnerAvailable ? "available" : "degraded", provider: "Creative Studio Local Runner + ComfyUI", detail: runnerAvailable ? "Imported API-format image workflows execute on the paired machine." : "Image jobs remain durable and wait for the paired machine to come online.", checkedAt },
    { key: "video-generation", label: "Video generation", state: runnerAvailable ? "available" : "degraded", provider: "Local Runner + ComfyUI", detail: runnerAvailable ? "Versioned API-format video workflows can execute on the paired machine." : "Video jobs remain durable and wait for the paired machine to come online.", checkedAt },
    { key: "prompt-enhancement", label: "Video prompt enhancement", state: promptEnhancementAvailable ? "available" : "degraded", provider: "Local Runner + Gemma 4 + ComfyUI", detail: promptEnhancementAvailable ? "Gemma 4 can inspect a selected image or extension frame and return an editable prompt compiled for the selected video model." : "Prompt requests stay durable until Local Runner 1.10 or newer is online.", checkedAt },
    { key: "script-builder", label: "Full Video Script", state: videoScriptAvailable ? "available" : "degraded", provider: "Local Runner + Gemma 4 + ComfyUI", detail: videoScriptAvailable ? "Gemma 4 expands even one seed into an owner-reviewed, model-specific full scene with optional exact dialogue." : "Full-script drafts stay durable until Local Runner 1.12 or newer is online.", checkedAt },
    { key: "story-bank", label: "Story Bank", state: storyPlannerAvailable ? "available" : "degraded", provider: "Local Runner + Gemma 4 + Creative Studio D1", detail: storyPlannerAvailable ? "Reusable story and model-ready prompt packs are prepared locally only while the runner is otherwise idle." : "Recommendations stay durable and wait for Local Runner 1.17 or newer; browsing them never loads a model.", checkedAt },
    { key: "afdfw-music-generation", label: "AFDFW music generation", state: generationState, provider: "AFDFW Stable Audio adapter", detail: "Optional remote route through the exact allowlisted AFDFW music capability; it is never selected automatically.", checkedAt },
    { key: "afdfw-image-generation", label: "AFDFW image generation", state: generationState, provider: "AFDFW Z-Image adapter", detail: "Optional remote route through the exact allowlisted AFDFW image capability; it is never selected automatically.", checkedAt },
    { key: "artifact-review", label: "Artifact review", state: "available", provider: "Creative Studio D1", detail: "Creative Studio decisions do not silently mutate AFDFW profile or feed state.", checkedAt },
    { key: "artifact-retention", label: "Artifact retention", state: env.ARTIFACTS ? "available" : "degraded", provider: env.ARTIFACTS ? "Creative Studio R2" : "AFDFW temporary media + Creative Studio history", detail: env.ARTIFACTS ? "Every completed result is copied and size-verified under Creative Studio ownership before its job completes." : "Jobs cannot complete without a Creative Studio R2 binding.", checkedAt },
    { key: "afdfw-session", label: "AFDFW session", state: session.status === "approved" ? "available" : "unavailable", provider: "approved-session handoff", detail: "The browser sees only the same-origin Creative Studio session route.", checkedAt },
  ];
}

async function syncJobs(env: Env, ownerId: string) {
  if (developmentMode(env) && !localHardwareMode(env)) {
    await reconcileDevelopmentJobs(env, ownerId);
  }
}

function mergeSnapshotExact<T>(current: T[], exact: T[], key: (item: T) => string) {
  const represented = new Set(current.map(key));
  return [...current, ...exact.filter((item) => !represented.has(key(item)))];
}

async function buildStudioSnapshot(env: Env, session: OwnerSession): Promise<StudioSnapshot> {
  await syncJobs(env, session.userId);
  const [projects, recentDnaArtifacts, jobs, generationBatches, jobRuntime, recentArtifacts, recentMediaAssets, acceptances, trainingExamples, recentWorkflows, recipes, trainingJobs, recentTrainingReviews, modelTrainingJobs, modelAdapters, modelAdapterReviews, promptEnhancements, videoScriptDrafts, overnightSessions, loveLoop, storyBank, runners, worldRecords] = await Promise.all([
    listProjects(env, session.userId),
    listLocalDna(env, session.userId),
    listJobs(env, session.userId),
    listGenerationBatches(env, session.userId),
    listJobRuntime(env, session.userId),
    listArtifacts(env, session.userId),
    listMediaAssets(env, session.userId),
    listAcceptances(env, session.userId),
    listTrainingExamples(env, session.userId),
    listWorkflows(env, session.userId),
    listGenerationRecipes(env, session.userId),
    listCreativeDnaTrainingJobs(env, session.userId),
    listCreativeDnaTrainingReviews(env, session.userId),
    listModelTrainingJobs(env, session.userId),
    listModelAdapters(env, session.userId),
    listModelAdapterReviews(env, session.userId),
    listVideoPromptEnhancements(env, session.userId),
    listVideoScriptDrafts(env, session.userId),
    listOvernightSessions(env, session.userId),
    loveLoopForOwner(env, session.userId),
    listStoryBank(env, session.userId),
    listLocalRunners(env, session.userId),
    listWorldRecords(env, session.userId),
  ]);
  const visibleRecommendations = storyBank.storyThreads.flatMap((story) => story.recommendations);
  const requiredDnaIds = [...new Set([
    ...projects.map((project) => project.activeDnaArtifactId).filter((value): value is string => Boolean(value)),
    ...storyBank.storyThreads.map((story) => story.dnaArtifactId),
  ])];
  const [exactDnaArtifacts, exactArtifacts, exactMediaAssets, exactWorkflows, exactTrainingReviews] = await Promise.all([
    localDnaByIds(env, session.userId, requiredDnaIds),
    artifactsByIds(env, session.userId, visibleRecommendations
      .filter((recommendation) => recommendation.sourceType === "artifact" && recommendation.sourceId)
      .map((recommendation) => recommendation.sourceId!)),
    mediaAssetsByIds(env, session.userId, visibleRecommendations
      .filter((recommendation) => recommendation.sourceType === "upload" && recommendation.sourceId)
      .map((recommendation) => recommendation.sourceId!)),
    workflowsByIds(env, session.userId, visibleRecommendations
      .map((recommendation) => recommendation.workflowId)
      .filter((value): value is string => Boolean(value))),
    creativeDnaTrainingReviewsByDnaIds(env, session.userId, requiredDnaIds),
  ]);
  const dnaArtifacts = mergeSnapshotExact(recentDnaArtifacts, exactDnaArtifacts, (artifact) => artifact.artifactId);
  const artifacts = mergeSnapshotExact(recentArtifacts, exactArtifacts, (artifact) => artifact.id);
  const mediaAssets = mergeSnapshotExact(recentMediaAssets, exactMediaAssets, (asset) => asset.id);
  const workflows = mergeSnapshotExact(recentWorkflows, exactWorkflows, (workflow) => workflow.id);
  const trainingReviews = mergeSnapshotExact(recentTrainingReviews, exactTrainingReviews, (review) => review.id);
  const computedAt = new Date().toISOString();
  const tasteMemory = compileCreativeTasteMemory({ projects, artifacts, acceptances, trainingReviews, dnaArtifacts });
  const evidencePools = await Promise.all(projects.map((project) => creativeDnaTrainingEvidencePool(env, session.userId, project.id)));
  const productionLoops = projects.map((project, index) => deriveProjectProductionLoop({
    project, dnaArtifacts, jobs, artifacts, trainingExamples, trainingJobs, trainingReviews,
    reservedTrainingExampleIds: evidencePools[index].reservedIds,
    computedAt,
  }));
  return {
    adapter: {
      id: "creative-studio-bff",
      label: localHardwareMode(env) ? "Creative Studio Local BFF · hardware-only" : "Creative Studio Worker",
      development: developmentMode(env),
      durableScope: "backend",
    },
    session: { status: session.status, userId: session.userId, displayName: session.displayName },
    projects,
    dnaArtifacts,
    jobs,
    generationBatches,
    promptEnhancements,
    videoScriptDrafts,
    overnightSessions,
    loveLoop,
    storyThreads: storyBank.storyThreads,
    storyBankRefreshes: storyBank.storyBankRefreshes,
    artifacts,
    mediaAssets,
    workflows,
    recipes,
    trainingExamples,
    trainingJobs,
    trainingReviews,
    modelTrainingJobs,
    modelAdapters,
    modelAdapterReviews,
    productionLoops,
    productionCockpit: deriveProductionCockpit({
      projects, dnaArtifacts, jobs, artifacts, mediaAssets, acceptances, trainingJobs, trainingReviews, runners,
      jobRuntime, computedAt,
    }),
    runners,
    capabilities: await capabilities(env, session, runners),
    acceptances,
    ...worldRecords,
    tasteMemory,
    evolutionStudies: deriveEvolutionStudies(jobs, artifacts),
    refreshedAt: computedAt,
  };
}

async function routeLocalRunnerRequest(request: Request, env: Env, route: NonNullable<ReturnType<typeof matchCreativeStudioRoute>>, url: URL) {
  const runner = await authenticateLocalRunner(env, request);
  if (route === "runner-work-claim") {
    const input = await body<RunnerHeartbeatRequest>(request);
    if (!input) throw new Error("invalid_runner_request");
    const heartbeat = await heartbeatLocalRunner(env, runner, input);
    const currentRunner = { ...runner, version: heartbeat.version };
    const archiveSync = await archiveSyncWork(env, currentRunner, input.archiveIndex);
    if (archiveSync) return json({ ok: true, kind: "archive-sync", bundle: archiveSync });
    if (input.archiveIndex?.state === "ready") {
      const materialization = await claimArchiveMaterialization(env, currentRunner);
      if (materialization) return json({ ok: true, kind: "archive-materialization", bundle: materialization });
    }
    if (input.comfyReady !== true) return json({ ok: true, kind: null, bundle: null });
    await reconcileLoveLoops(env, currentRunner.ownerId);
    await reconcileOvernightSessions(env, currentRunner.ownerId);
    // Ready/resumable media work owns the single workstation GPU. Reconcile a
    // durable multi-output lane and claim generation before any standalone
    // Gemma helper can replace a warm LTX/H3 model family.
    await reconcileGenerationBatch(request, env, currentRunner.ownerId);
    const generation = await claimLocalRunnerJob(env, currentRunner);
    if (generation) return json({ ok: true, kind: "generation", bundle: generation });
    const promptEnhancement = await claimVideoPromptEnhancement(env, currentRunner);
    if (promptEnhancement) return json({ ok: true, kind: "prompt-enhancement", bundle: promptEnhancement });
    const videoScript = await claimVideoScriptDraft(env, currentRunner);
    if (videoScript) return json({ ok: true, kind: "video-script", bundle: videoScript });
    const training = await claimLocalRunnerTrainingJob(env, currentRunner);
    if (training) return json({ ok: true, kind: "training", bundle: training });
    const modelTraining = await claimModelTrainingJob(env, currentRunner, input.modelTrainingProviders ?? []);
    if (modelTraining) return json({ ok: true, kind: "model-training", bundle: modelTraining });
    const overnightPlan = await claimOvernightPlan(env, currentRunner);
    if (overnightPlan) return json({ ok: true, kind: "overnight-plan", bundle: overnightPlan });
    if (supportsStoryPlanning(currentRunner.version)) {
      await ensureAutomaticStoryRefresh(env, currentRunner.ownerId);
      const storyPlan = await claimStoryPlan(env, currentRunner);
      if (storyPlan) return json({ ok: true, kind: "story-plan", bundle: storyPlan });
    }
    return json({ ok: true, kind: null, bundle: null });
  }
  if (route === "runner-heartbeat") {
    const input = await body<RunnerHeartbeatRequest>(request);
    if (!input) throw new Error("invalid_runner_request");
    return json({ ok: true, runner: await heartbeatLocalRunner(env, runner, input) });
  }
  if (route === "runner-archive-sync-start") {
    const input = await body<unknown>(request);
    if (!input) throw new Error("invalid_archive_sync_request");
    return json({ ok: true, catalog: await startArchiveCatalogSync(env, runner, input) });
  }
  if (route === "runner-archive-sync-batch") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/archive-index\/syncs\/([a-z0-9_]+)\/entries$/i);
    const input = await body<unknown>(request);
    if (!match || !input) throw new Error("invalid_archive_sync_batch");
    return json({ ok: true, catalog: await putArchiveCatalogEntries(env, runner, match[1], input) });
  }
  if (route === "runner-archive-sync-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/archive-index\/syncs\/([a-z0-9_]+)\/complete$/i);
    const input = await body<unknown>(request);
    if (!match || !input) throw new Error("invalid_archive_sync_request");
    return json({ ok: true, catalog: await completeArchiveCatalogSync(env, runner, match[1], input) });
  }
  if (route === "runner-archive-materialization-claim") {
    return json({ ok: true, bundle: await claimArchiveMaterialization(env, runner) });
  }
  if (route === "runner-archive-materialization-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/archive-materializations\/([a-z0-9_]+)\/complete$/i);
    if (!match || !request.body) throw new Error("empty_archive_materialization");
    const declaredSize = Number(request.headers.get("x-cs-file-size") ?? request.headers.get("content-length"));
    return json({ ok: true, ...await completeArchiveMaterialization(env, runner, match[1],
      request.headers.get("x-cs-claim-token"), request.body, request.headers.get("content-type") ?? "", declaredSize) });
  }
  if (route === "runner-archive-materialization-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/archive-materializations\/([a-z0-9_]+)\/fail$/i);
    const input = await body<unknown>(request);
    if (!match || !input) throw new Error("invalid_archive_materialization_failure");
    return json({ ok: true, ...await failArchiveMaterialization(env, runner, match[1],
      request.headers.get("x-cs-claim-token"), input) });
  }
  if (route === "runner-overnight-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/overnight\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<OvernightPlanHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, overnightSession: await heartbeatOvernightPlan(env, runner, match[1], input) });
  }
  if (route === "runner-overnight-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/overnight\/([a-z0-9_]+)\/complete$/i);
    const input = await body<CompleteOvernightPlanRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, overnightSession: await completeOvernightPlan(env, runner, match[1], input) });
  }
  if (route === "runner-overnight-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/overnight\/([a-z0-9_]+)\/fail$/i);
    const input = await body<FailOvernightPlanRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, overnightSession: await failOvernightPlan(env, runner, match[1], input) });
  }
  if (route === "runner-story-plan-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/story-plans\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<StoryPlanHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, storyBankRefresh: await heartbeatStoryPlan(env, runner, match[1], input) });
  }
  if (route === "runner-story-plan-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/story-plans\/([a-z0-9_]+)\/complete$/i);
    const input = await body<CompleteStoryPlanRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, storyBankRefresh: await completeStoryPlan(env, runner, match[1], input) });
  }
  if (route === "runner-story-plan-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/story-plans\/([a-z0-9_]+)\/fail$/i);
    const input = await body<FailStoryPlanRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, storyBankRefresh: await failStoryPlan(env, runner, match[1], input) });
  }
  if (route === "runner-prompt-enhancement-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/prompt-enhancements\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<RunnerPromptEnhancementHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, promptEnhancement: await heartbeatVideoPromptEnhancement(env, runner, match[1], input.progress) });
  }
  if (route === "runner-prompt-enhancement-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/prompt-enhancements\/([a-z0-9_]+)\/complete$/i);
    const input = await body<RunnerCompletePromptEnhancementRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, promptEnhancement: await completeVideoPromptEnhancement(env, runner, match[1], input) });
  }
  if (route === "runner-prompt-enhancement-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/prompt-enhancements\/([a-z0-9_]+)\/fail$/i);
    const input = await body<RunnerFailPromptEnhancementRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, promptEnhancement: await failVideoPromptEnhancement(env, runner, match[1], input.error) });
  }
  if (route === "runner-video-script-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/video-scripts\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<RunnerVideoScriptDraftHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, videoScriptDraft: await heartbeatVideoScriptDraft(env, runner, match[1], input.progress) });
  }
  if (route === "runner-video-script-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/video-scripts\/([a-z0-9_]+)\/complete$/i);
    const input = await body<RunnerCompleteVideoScriptDraftRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, videoScriptDraft: await completeVideoScriptDraft(env, runner, match[1], input) });
  }
  if (route === "runner-video-script-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/video-scripts\/([a-z0-9_]+)\/fail$/i);
    const input = await body<RunnerFailVideoScriptDraftRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, videoScriptDraft: await failVideoScriptDraft(env, runner, match[1], input.error) });
  }
  if (route === "runner-job-claim") {
    await reconcileGenerationBatch(request, env, runner.ownerId);
    return json({ ok: true, bundle: await claimLocalRunnerJob(env, runner) });
  }
  if (route === "runner-job-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<RunnerJobHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, ...await heartbeatLocalRunnerJob(env, runner, match[1], input) });
  }
  if (route === "runner-job-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/fail$/i);
    const input = await body<RunnerFailJobRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    const job = await failLocalRunnerJob(env, runner, match[1], input.error);
    if (job.settingsStamp.outputBatch) {
      await reconcileGenerationBatch(request, env, runner.ownerId, job.settingsStamp.outputBatch.batchId);
    }
    return json({ ok: true, job });
  }
  if (route === "runner-job-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/complete$/i);
    if (!match || !request.body) throw new Error("empty_runner_output");
    const declaredSize = Number(request.headers.get("x-cs-file-size") ?? request.headers.get("content-length"));
    const job = await completeClaimedLocalRunnerJob(env, runner, match[1], request.body, request.headers.get("content-type") ?? "", declaredSize);
    return json({ ok: true, job });
  }
  if (route === "runner-job-thumbnail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/jobs\/([a-z0-9_]+)\/thumbnail$/i);
    if (!match || !request.body) throw new Error("empty_video_thumbnail");
    const declaredSize = Number(request.headers.get("x-cs-file-size") ?? request.headers.get("content-length"));
    const thumbnail = await retainClaimedLocalRunnerVideoThumbnail(env, runner, match[1], request.body, request.headers.get("content-type") ?? "", declaredSize);
    return json({ ok: true, thumbnail });
  }
  if (route === "runner-media-content") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/media\/([a-z0-9_]+)$/i);
    if (!match) throw new Error("invalid_runner_request");
    return localRunnerMedia(env, runner, match[1]);
  }
  if (route === "runner-training-claim") {
    return json({ ok: true, bundle: await claimLocalRunnerTrainingJob(env, runner) });
  }
  if (route === "runner-training-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/training\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<RunnerTrainingHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, ...await heartbeatLocalRunnerTrainingJob(env, runner, match[1], input.progress) });
  }
  if (route === "runner-training-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/training\/([a-z0-9_]+)\/complete$/i);
    const input = await body<RunnerCompleteTrainingRequest>(request);
    if (!match || !input?.dna || !input.analysis) throw new Error("invalid_runner_request");
    return json({ ok: true, trainingJob: await completeLocalRunnerTrainingJob(env, runner, match[1], input) });
  }
  if (route === "runner-training-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/training\/([a-z0-9_]+)\/fail$/i);
    const input = await body<RunnerFailJobRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, trainingJob: await failLocalRunnerTrainingJob(env, runner, match[1], input.error) });
  }
  if (route === "runner-model-training-dataset") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/model-training\/([a-z0-9_]+)\/dataset$/i);
    const input = await body<RunnerCompleteModelTrainingDatasetRequest>(request);
    if (!match || !input?.dataset) throw new Error("invalid_runner_request");
    return json({ ok: true, modelTrainingJob: await completeModelTrainingDataset(env, runner, match[1], { runnerId: runner.id, dataset: input.dataset }) });
  }
  if (route === "runner-model-training-heartbeat") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/model-training\/([a-z0-9_]+)\/heartbeat$/i);
    const input = await body<RunnerModelTrainingHeartbeatRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, ...await heartbeatModelTrainingJob(env, runner, match[1], input.progress, input.stage, input.upstreamId) });
  }
  if (route === "runner-model-training-complete") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/model-training\/([a-z0-9_]+)\/complete$/i);
    const input = await body<RunnerCompleteModelTrainingRequest>(request);
    if (!match || !input?.localFile || !input.evaluation) throw new Error("invalid_runner_request");
    return json({ ok: true, ...await completeModelTrainingJob(env, runner, match[1], { ...input, runnerId: runner.id }) });
  }
  if (route === "runner-model-training-fail") {
    const match = url.pathname.match(/^\/api\/creative-studio\/runner\/model-training\/([a-z0-9_]+)\/fail$/i);
    const input = await body<RunnerFailModelTrainingRequest>(request);
    if (!match || !input) throw new Error("invalid_runner_request");
    return json({ ok: true, modelTrainingJob: await failModelTrainingJob(env, runner, match[1], input.error) });
  }
  throw new Error("creative_studio_route_not_found");
}

export async function routeCreativeStudioApi(request: Request, env: Env) {
  const url = new URL(request.url);
  const route = matchCreativeStudioRoute(request.method, url.pathname);
  if (!route) return json({ ok: false, error: "creative_studio_route_not_found" }, { status: 404 });

  try {
    if (isLocalRunnerRoute(route)) return await routeLocalRunnerRequest(request, env, route, url);
    const session = await ownerSession(env, request);
    const responseHeaders = session.setCookie ? { "set-cookie": session.setCookie } : undefined;

    if (route === "snapshot") {
      return json({ ok: true, snapshot: await buildStudioSnapshot(env, session) }, { headers: responseHeaders });
    }
    if (route === "session") return json({ ok: true, session: { status: session.status, userId: session.userId, displayName: session.displayName } }, { headers: responseHeaders });
    if (route === "projects") return json({ ok: true, projects: await listProjects(env, session.userId) });
    if (route === "project-create") {
      const input = await body<CreateProjectRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_json" }, { status: 400 });
      return json({ ok: true, project: await createProject(env, session.userId, input) }, { status: 201 });
    }
    if (route === "project-update") {
      const match = url.pathname.match(/^\/api\/creative-studio\/projects\/([a-z0-9_]+)$/i);
      const input = await body<UpdateProjectRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_project_request" }, { status: 400 });
      return json({ ok: true, project: await updateProject(env, session.userId, match[1], input) });
    }
    if (route === "project-archive") {
      const match = url.pathname.match(/^\/api\/creative-studio\/projects\/([a-z0-9_]+)\/archive$/i);
      if (!match) return json({ ok: false, error: "invalid_project_request" }, { status: 400 });
      return json({ ok: true, project: await archiveProject(env, session.userId, match[1]) });
    }
    if (route === "worlds-list") {
      const records = await listWorldRecords(env, session.userId);
      const projectId = boundedText(url.searchParams.get("projectId"), 100);
      if (!projectId) return json({ ok: true, ...records });
      const worldIds = new Set(records.worlds.filter((world) => world.projectId === projectId).map((world) => world.id));
      return json({
        ok: true,
        worlds: records.worlds.filter((world) => worldIds.has(world.id)),
        worldEntities: records.worldEntities.filter((entity) => worldIds.has(entity.worldId)),
        continuityRules: records.continuityRules.filter((rule) => worldIds.has(rule.worldId)),
        canonReferences: records.canonReferences.filter((reference) => worldIds.has(reference.worldId)),
        canonPromotions: records.canonPromotions.filter((promotion) => worldIds.has(promotion.worldId)),
      });
    }
    if (route === "world-create") {
      const input = await body<CreateWorldRequest>(request);
      if (!input) throw new Error("invalid_world_request");
      return json({ ok: true, world: await createWorld(env, session.userId, input) }, { status: 201 });
    }
    if (route === "world-get") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)$/i);
      if (!match) throw new Error("invalid_world_request");
      const records = await worldById(env, session.userId, match[1]);
      if (!records) throw new Error("world_not_found");
      return json({
        ok: true,
        world: records.world,
        worldEntities: records.entities,
        continuityRules: records.rules,
        canonReferences: records.references,
        canonPromotions: records.promotions,
      });
    }
    if (route === "world-update" || route === "world-archive") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)(?:\/archive)?$/i);
      const input = await body<UpdateWorldRequest>(request);
      if (!match || !input) throw new Error("invalid_world_request");
      return json({ ok: true, world: await updateWorld(env, session.userId, match[1], route === "world-archive" ? { expectedVersion: input.expectedVersion, status: "archived" } : input) });
    }
    if (route === "world-entity-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/entities$/i);
      const input = await body<CreateWorldEntityRequest>(request);
      if (!match || !input) throw new Error("invalid_world_entity_request");
      return json({ ok: true, entity: await createWorldEntity(env, session.userId, match[1], input) }, { status: 201 });
    }
    if (route === "world-entity-update" || route === "world-entity-retire") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/entities\/([a-z0-9_]+)(?:\/retire)?$/i);
      const input = await body<UpdateWorldEntityRequest>(request);
      if (!match || !input) throw new Error("invalid_world_entity_request");
      return json({ ok: true, entity: await updateWorldEntity(env, session.userId, match[1], match[2], route === "world-entity-retire" ? { expectedVersion: input.expectedVersion, status: "retired" } : input) });
    }
    if (route === "world-rule-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/rules$/i);
      const input = await body<CreateContinuityRuleRequest>(request);
      if (!match || !input) throw new Error("invalid_continuity_rule_request");
      return json({ ok: true, rule: await createContinuityRule(env, session.userId, match[1], input) }, { status: 201 });
    }
    if (route === "world-rule-update" || route === "world-rule-retire") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/rules\/([a-z0-9_]+)(?:\/retire)?$/i);
      const input = await body<UpdateContinuityRuleRequest>(request);
      if (!match || !input) throw new Error("invalid_continuity_rule_request");
      return json({ ok: true, rule: await updateContinuityRule(env, session.userId, match[1], match[2], route === "world-rule-retire" ? { expectedVersion: input.expectedVersion, status: "retired" } : input) });
    }
    if (route === "world-reference-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/references$/i);
      const input = await body<CreateCanonReferenceRequest>(request);
      if (!match || !input) throw new Error("invalid_canon_reference_request");
      return json({ ok: true, reference: await createCanonReference(env, session.userId, match[1], input) }, { status: 201 });
    }
    if (route === "world-reference-update" || route === "world-reference-retire") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/references\/([a-z0-9_]+)(?:\/retire)?$/i);
      const input = await body<UpdateCanonReferenceRequest>(request);
      if (!match || !input) throw new Error("invalid_canon_reference_request");
      return json({ ok: true, reference: await updateCanonReference(env, session.userId, match[1], match[2], route === "world-reference-retire" ? { expectedVersion: input.expectedVersion, status: "retired" } : input) });
    }
    if (route === "world-reference-promote") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/references\/([a-z0-9_]+)\/promote$/i);
      const input = await body<PromoteToCanonRequest>(request);
      if (!match || !input || input.referenceId !== match[2]) throw new Error("invalid_canon_promotion_request");
      return json({ ok: true, promotion: await promoteReferenceToCanon(env, session.userId, match[1], input) });
    }
    if (route === "world-artifact-promote") {
      const match = url.pathname.match(/^\/api\/creative-studio\/worlds\/([a-z0-9_]+)\/promote-artifact$/i);
      const input = await body<PromoteArtifactToCanonRequest>(request);
      if (!match || !input || input.worldId !== match[1]) throw new Error("invalid_canon_promotion_request");
      return json({ ok: true, promotion: await promoteArtifactToCanon(env, session.userId, boundedText(input.artifactId, 100), input) }, { status: 201 });
    }
    if (route === "dna-list") {
      const artifacts = await listLocalDna(env, session.userId);
      return json({ ok: true, artifacts });
    }
    if (route === "dna-create") {
      const input = await body<CreateCreativeDnaRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_json" }, { status: 400 });
      if (input.parentArtifactId) {
        const parent = (await listLocalDna(env, session.userId)).find((artifact) => artifact.artifactId === input.parentArtifactId);
        if (!parent) throw new Error("parent_artifact_not_found");
        await assertCreativeDnaReviewed(env, session.userId, parent);
      }
      const artifact = await createLocalDna(env, session.userId, input);
      return json({ ok: true, artifact }, { status: 201 });
    }
    if (route === "jobs-list") {
      await syncJobs(env, session.userId);
      return json({ ok: true, jobs: await listJobs(env, session.userId) });
    }
    if (route === "overnight-list") {
      return json({ ok: true, overnightSessions: await listOvernightSessions(env, session.userId) });
    }
    if (route === "overnight-create") {
      const input = await body<CreateOvernightSessionRequest>(request);
      if (!input) throw new Error("invalid_overnight_session");
      return json({ ok: true, overnightSession: await createOvernightSession(env, session.userId, input) }, { status: 201 });
    }
    if (route === "overnight-pause" || route === "overnight-resume" || route === "overnight-cancel") {
      const match = url.pathname.match(/^\/api\/creative-studio\/overnight\/([a-z0-9_]+)\/(pause|resume|cancel)$/i);
      if (!match) throw new Error("invalid_overnight_session");
      const overnightSession = route === "overnight-pause"
        ? await pauseOvernightSession(env, session.userId, match[1])
        : route === "overnight-resume"
          ? await resumeOvernightSession(env, session.userId, match[1])
          : await cancelOvernightSession(env, session.userId, match[1]);
      return json({ ok: true, overnightSession });
    }
    if (route === "love-loop-get") {
      return json({ ok: true, loveLoop: await loveLoopForOwner(env, session.userId) });
    }
    if (route === "love-loop-configure") {
      const input = await body<ConfigureLoveLoopRequest>(request);
      if (!input) throw new Error("invalid_love_loop");
      return json({ ok: true, loveLoop: await configureLoveLoop(env, session.userId, input) }, { status: 201 });
    }
    if (route === "love-loop-pause" || route === "love-loop-resume" || route === "love-loop-disable") {
      const loveLoop = route === "love-loop-pause"
        ? await pauseLoveLoop(env, session.userId)
        : route === "love-loop-resume"
          ? await resumeLoveLoop(env, session.userId)
          : await disableLoveLoop(env, session.userId);
      return json({ ok: true, loveLoop });
    }
    if (route === "story-bank-list") {
      const projectId = boundedText(url.searchParams.get("projectId"), 100) || null;
      const limit = Number(url.searchParams.get("limit") ?? 24);
      return json({ ok: true, ...await listStoryBank(env, session.userId, projectId, limit) });
    }
    if (route === "story-bank-refresh") {
      const input = await body<RefreshStoryBankRequest>(request);
      if (!input) throw new Error("invalid_story_bank_refresh");
      return json({ ok: true, storyBankRefresh: await createStoryBankRefresh(env, session.userId, input) }, { status: 202 });
    }
    if (route === "story-thread-update") {
      const match = url.pathname.match(/^\/api\/creative-studio\/story-bank\/stories\/([a-z0-9_]+)$/i);
      const input = await body<UpdateStoryThreadRequest>(request);
      if (!match || !input) throw new Error("invalid_story_thread_update");
      return json({ ok: true, storyThread: await updateStoryThread(env, session.userId, match[1], input) });
    }
    if (route === "prompt-enhancement-create") {
      const input = await body<CreateVideoPromptEnhancementRequest>(request);
      if (!input) throw new Error("invalid_prompt_enhancement_request");
      return json({ ok: true, promptEnhancement: await createVideoPromptEnhancement(env, session.userId, input) }, { status: 202 });
    }
    if (route === "prompt-enhancement-get") {
      const match = url.pathname.match(/^\/api\/creative-studio\/prompt-enhancements\/([a-z0-9_]+)$/i);
      if (!match) throw new Error("invalid_prompt_enhancement_request");
      return json({ ok: true, promptEnhancement: await videoPromptEnhancementById(env, session.userId, match[1]) });
    }
    if (route === "video-script-create") {
      const input = await body<CreateVideoScriptDraftRequest>(request);
      if (!input) throw new Error("invalid_video_script_request");
      return json({ ok: true, videoScriptDraft: await createVideoScriptDraft(env, session.userId, input) }, { status: 202 });
    }
    if (route === "video-script-get") {
      const match = url.pathname.match(/^\/api\/creative-studio\/video-scripts\/([a-z0-9_]+)$/i);
      if (!match) throw new Error("invalid_video_script_request");
      return json({ ok: true, videoScriptDraft: await videoScriptDraftById(env, session.userId, match[1]) });
    }
    if (route === "video-script-update") {
      const match = url.pathname.match(/^\/api\/creative-studio\/video-scripts\/([a-z0-9_]+)$/i);
      const input = await body<UpdateVideoScriptDraftRequest>(request);
      if (!match || !input) throw new Error("invalid_video_script_request");
      return json({ ok: true, videoScriptDraft: await updateVideoScriptDraft(env, session.userId, match[1], input) });
    }
    if (route === "job-batch-create") {
      const input = await body<SubmitJobBatchRequest>(request);
      if (!input) throw new Error("invalid_generation_batch");
      const registered = await registerGenerationBatch(
        env,
        session.userId,
        input,
        developmentMode(env) ? null : reconciliationEmail(request),
      );
      if (registered.status === "failed" || registered.status === "cancelled") throw new Error("generation_batch_terminal");
      const reconciled = await reconcileGenerationBatch(request, env, session.userId, registered.id) ?? registered;
      if (reconciled.status === "failed" || reconciled.status === "cancelled") throw new Error("generation_batch_terminal");
      const jobs = await generationBatchJobs(env, session.userId, reconciled);
      return json({
        ok: true,
        batch: {
          batchId: reconciled.id,
          status: reconciled.status,
          completedLanes: jobs.length,
          laneCount: reconciled.laneCount,
        },
        jobs,
      }, { status: 202 });
    }
    if (route === "jobs-create") {
      const input = await body<SubmitJobRequest>(request);
      if (!input || !["music", "image", "video"].includes(input.modality)) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const requestKey = idempotencyKey(input.idempotencyKey);
      const dnaArtifacts = await listLocalDna(env, session.userId);
      const dna = dnaArtifacts.find((item) => item.artifactId === input.dnaArtifactId);
      if (!dna) return json({ ok: false, error: "creative_dna_not_found" }, { status: 404 });
      if (dna.projectId !== input.projectId) return json({ ok: false, error: "dna_project_mismatch" }, { status: 400 });
      const project = await projectById(env, session.userId, input.projectId);
      if (!project) return json({ ok: false, error: "project_not_found" }, { status: 404 });
      if (project.status === "archived") return json({ ok: false, error: "project_archived" }, { status: 400 });
      await assertCreativeDnaReviewed(env, session.userId, dna);
      let evolutionSource: Awaited<ReturnType<typeof runnerInputById>> = null;
      let evolutionTaste: ReturnType<typeof compileCreativeTasteMemory> | null = null;
      if (input.evolution) {
        if (input.evolution.schemaVersion !== "creative-studio-evolution-request/1.0"
          || !/^evolve_[a-z0-9-]{8,100}$/i.test(boundedText(input.evolution.studyId, 120))
          || !["refine", "correct", "discovery"].includes(input.evolution.role)
          || !["upload", "artifact"].includes(input.evolution.source)) throw new Error("invalid_evolution_request");
        evolutionSource = await runnerInputById(env, session.userId, boundedText(input.evolution.sourceId, 100));
        if (!evolutionSource || evolutionSource.projectId !== input.projectId || evolutionSource.source !== input.evolution.source) {
          throw new Error("evolution_source_invalid");
        }
        const [reviewArtifacts, reviews, dnaReviews, allProjects] = await Promise.all([
          listArtifacts(env, session.userId),
          listAcceptances(env, session.userId),
          listCreativeDnaTrainingReviews(env, session.userId),
          listProjects(env, session.userId),
        ]);
        evolutionTaste = compileCreativeTasteMemory({ projects: allProjects, artifacts: reviewArtifacts, acceptances: reviews, trainingReviews: dnaReviews, dnaArtifacts });
      }
      const modality = input.modality as GenerationModality;
      const outputBatch = input.outputBatch === undefined ? undefined : {
        schemaVersion: input.outputBatch.schemaVersion,
        batchId: boundedText(input.outputBatch.batchId, 120),
        index: Number(input.outputBatch.index),
        count: Number(input.outputBatch.count),
      };
      if (outputBatch && (
        outputBatch.schemaVersion !== "creative-studio-output-batch/1.0"
        || !/^[a-z0-9_-]{8,120}$/i.test(outputBatch.batchId)
        || !Number.isInteger(outputBatch.index)
        || ![1, 2, 4].includes(outputBatch.count)
        || outputBatch.index < 1
        || outputBatch.index > outputBatch.count
      )) throw new Error("invalid_output_batch");
      if (outputBatch && modality === "music") throw new Error("output_batch_modality_not_supported");
      const normalizedVideoDuration = input.videoDurationSeconds === undefined ? undefined : normalizeVideoDurationSeconds(input.videoDurationSeconds);
      if (input.videoDurationSeconds !== undefined && normalizedVideoDuration === null) throw new Error("invalid_video_duration");
      const videoDurationSeconds = normalizedVideoDuration ?? undefined;
      if (videoDurationSeconds !== undefined && modality !== "video") throw new Error("invalid_video_duration");
      const videoOperation = requestedVideoOperation(input.videoOperation, modality);
      const videoVariant = input.videoVariant === undefined ? undefined : normalizeVideoGenerationVariant(input.videoVariant);
      if (videoVariant && modality !== "video") throw new Error("invalid_video_generation_variant");
      const videoSpeech = input.videoSpeech === undefined ? undefined : normalizeVideoSpeechStamp(input.videoSpeech);
      if (videoSpeech && modality !== "video") throw new Error("invalid_video_speech");
      if (modality === "video" && !videoSpeech) throw new Error("video_speech_policy_required");
      if (videoSpeech?.spokenText && videoDurationSeconds !== undefined
        && videoSpeech.spokenText.split(/\s+/).filter(Boolean).length > videoScriptWordRange(videoDurationSeconds).maximum) {
        throw new Error("video_speech_too_long_for_duration");
      }
      if (input.videoScript && (modality !== "video" || !videoSpeech || videoDurationSeconds === undefined)) {
        throw new Error("video_script_video_workflow_required");
      }
      if (input.promptEnhancement && modality !== "video") throw new Error("prompt_enhancement_video_workflow_required");
      if (input.performanceMode !== undefined && input.performanceMode !== "fast-default" && input.performanceMode !== "explicit-custom") {
        throw new Error("invalid_image_performance_mode");
      }
      if (input.performanceMode !== undefined && modality !== "image") throw new Error("invalid_image_performance_mode");
      if (input.videoPerformanceMode !== undefined
        && input.videoPerformanceMode !== "fast-default"
        && input.videoPerformanceMode !== "explicit-heavy") throw new Error("invalid_video_performance_mode");
      if (input.videoPerformanceMode !== undefined && modality !== "video") throw new Error("invalid_video_performance_mode");
      if (input.trustedVideoPresetId !== undefined
        && (modality !== "video" || !trustedVideoPresetById(input.trustedVideoPresetId))) {
        throw new Error("invalid_trusted_video_preset");
      }
      if (input.provider !== undefined && input.provider !== "afdfw" && input.provider !== "development-preview") {
        throw new Error("invalid_generation_provider");
      }
      if (input.promptReference && !input.workflow) throw new Error("prompt_reference_workflow_required");
      if (input.storyRecommendation && !input.workflow) throw new Error("story_recommendation_workflow_required");
      if (input.workflow) {
        if (input.provider) throw new Error("workflow_provider_conflict");
        if (!input.workflow.workflowId || !input.workflow.revisionId || !input.workflow.inputBindings || typeof input.workflow.inputBindings !== "object") {
          throw new Error("invalid_workflow_job_request");
        }
        let plan = await workflowExecutionPlan(env, session.userId, boundedText(input.workflow.workflowId, 100), boundedText(input.workflow.revisionId, 100));
        const expectedModality = workflowJobModality(plan.workflow.modality);
        if (expectedModality !== modality) throw new Error("workflow_modality_mismatch");
        if (videoDurationSeconds !== undefined) {
          const durationParameters = videoWorkflowDurationParameters(plan.workflow.currentRevision.parameters);
          if (!durationParameters.length) throw new Error("video_duration_control_missing");
          if (!workflowSupportsVideoDuration(plan.workflow, videoDurationSeconds)) throw new Error("video_duration_not_supported_by_model");
          if (durationParameters.some((parameter) => Number(parameter.value) !== videoDurationSeconds)) {
            throw new Error("video_duration_revision_mismatch");
          }
        }
        const mediaParameters = plan.workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "media");
        const allowedParameters = new Map(mediaParameters.map((parameter) => [parameter.id, parameter]));
        const inputBindings = Object.fromEntries(Object.entries(input.workflow.inputBindings)
          .map(([parameterId, assetId]) => [boundedText(parameterId, 180), boundedText(assetId, 100)])
          .filter(([parameterId, assetId]) => Boolean(parameterId && assetId))) as Record<string, string>;
        if (Object.keys(inputBindings).some((parameterId) => !allowedParameters.has(parameterId))) throw new Error("unknown_workflow_media_parameter");
        if (mediaParameters.some((parameter) => !inputBindings[parameter.id])) throw new Error("workflow_media_input_required");
        const promptReference = await generationPromptReferenceStamp(env, session.userId, input.projectId, modality, input.promptReference, inputBindings);
        if (videoOperation) {
          const extensionInputs = mediaParameters.filter((parameter) => parameter.mediaKind === "image" && inputBindings[parameter.id] === videoOperation.sourceId);
          if (extensionInputs.length !== 1) throw new Error("video_extension_image_input_required");
        }
        const resolvedInputs = await Promise.all(mediaParameters.map(async (parameter) => ({
          parameter,
          input: await runnerInputById(env, session.userId, inputBindings[parameter.id]),
        })));
        for (const { parameter, input: resolvedInput } of resolvedInputs) {
          if (!resolvedInput) throw new Error("runner_input_source_not_found");
          if (resolvedInput.projectId !== input.projectId) throw new Error("runner_input_project_mismatch");
          const finalFrameInput = Boolean(videoOperation
            && parameter.mediaKind === "image"
            && inputBindings[parameter.id] === videoOperation.sourceId
            && resolvedInput.source === videoOperation.source
            && resolvedInput.kind === "video");
          if (parameter.mediaKind && resolvedInput.kind !== parameter.mediaKind && !finalFrameInput) {
            throw new Error("runner_input_media_mismatch");
          }
        }
        if (videoOperation) {
          const source = resolvedInputs.find(({ input: resolvedInput }) => resolvedInput?.id === videoOperation.sourceId)?.input;
          if (!source || source.source !== videoOperation.source || source.kind !== "video") throw new Error("video_extension_source_invalid");
        }
        const inputSources = resolvedInputs.map(({ input: resolvedInput }) => ({
          id: resolvedInput!.id,
          source: resolvedInput!.source,
          kind: resolvedInput!.kind,
        }));
        // Older LTX revisions could contain the authored positive direction in
        // their negative encoder because the browser was given contaminated
        // prompt-role metadata. Repair only that exact conflict into a new,
        // immutable execution revision before performance and prompt checks.
        plan = await promptSafeWorkflowExecutionPlan(
          env,
          session.userId,
          plan.workflow.id,
          plan.workflow.currentRevision.id,
        );
        const parameterValues = Object.fromEntries(plan.workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));
        const performanceMode = modality === "image" ? input.performanceMode ?? "fast-default" : undefined;
        if (modality === "image" && assessImagePerformance(parameterValues).requiresExplicitCustom && performanceMode !== "explicit-custom") {
          throw new Error("image_custom_mode_required");
        }
        const videoPerformance = modality === "video"
          ? await videoPerformanceForWorkflow(
            plan.workflow,
            plan.graph,
            videoDurationSeconds,
            input.videoPerformanceMode,
            input.trustedVideoPresetId,
            outputBatch?.count ?? 1,
          )
          : undefined;
        const promptParameters = generationWorkflowPromptParameters(plan.workflow.currentRevision.parameters);
        const workflowPromptParameter = primaryWorkflowPromptParameter(plan.workflow.currentRevision.parameters, plan.workflow.modality);
        const exactExpectedPrompt = String(input.workflow.expectedPrompt ?? "").trim();
        const exactWorkflowPrompt = String(workflowPromptParameter?.value ?? "").trim();
        if (input.videoScript && (exactExpectedPrompt.length > 4_000 || exactWorkflowPrompt.length > 4_000)) {
          throw new Error("video_script_combined_prompt_too_long");
        }
        const expectedPrompt = boundedPrompt(exactExpectedPrompt);
        const workflowPrompt = boundedPrompt(exactWorkflowPrompt);
        const negativePromptParameters = plan.workflow.currentRevision.parameters.filter((parameter) => parameter.kind === "text" && parameter.promptRole === "negative");
        if (!expectedPrompt) throw new Error("workflow_prompt_confirmation_required");
        if (!workflowPromptParameter || !workflowPrompt || workflowPromptParameter.promptRole === "negative") throw new Error("workflow_positive_prompt_missing");
        if (workflowPrompt !== expectedPrompt) throw new Error("workflow_prompt_confirmation_mismatch");
        if (!promptParameters.length || promptParameters.some((parameter) => boundedPrompt(parameter.value) !== workflowPrompt)) {
          throw new Error("workflow_positive_prompt_ambiguous");
        }
        if (negativePromptParameters.some((parameter) => boundedPrompt(parameter.value) === workflowPrompt)) {
          throw new Error("workflow_prompt_bound_to_negative");
        }
        const prompt = workflowPrompt;
        if (videoSpeech && !prompt.includes(videoSpeech.directive)) throw new Error("video_speech_prompt_mismatch");
        const extensionSuppressesNewSound = videoOperation?.audioMode === "keep-source" || videoOperation?.audioMode === "mute";
        if (videoSpeech && !extensionSuppressesNewSound && !videoSpeech.directive.includes(VIDEO_SOUND_DESIGN_DIRECTIVE)) {
          throw new Error("video_speech_prompt_mismatch");
        }
        if (videoOperation?.audioMode === "new-sound" && !prompt.includes(VIDEO_EXTENSION_SOUND_DIRECTIVE)) {
          throw new Error("video_extension_sound_prompt_required");
        }
        if (input.promptEnhancement && boundedPrompt(input.promptEnhancement.appliedPrompt) !== prompt) {
          throw new Error("prompt_enhancement_applied_prompt_mismatch");
        }
        const promptEnhancementInputMode = input.videoOperation ? "video-extension" as const
          : input.workflow.inputBindings && Object.entries(input.workflow.inputBindings)
            .some(([parameterId]) => mediaParameters.some((parameter) => parameter.id === parameterId && parameter.mediaKind === "image"))
            ? "image-to-video" as const : "text-to-video" as const;
        const promptEnhancementProfile = videoWorkflowPromptProfile(plan.workflow, promptEnhancementInputMode);
        const promptEnhancementSourceId = promptEnhancementInputMode === "text-to-video"
          ? null
          : videoOperation?.sourceId ?? resolvedInputs.find(({ parameter }) => parameter.mediaKind === "image")?.input?.id ?? null;
        const promptEnhancement = input.promptEnhancement ? await videoPromptEnhancementStampForJob(env, session.userId, {
          ...input.promptEnhancement,
          projectId: input.projectId,
          workflowId: plan.workflow.id,
          workflowRevisionId: plan.workflow.currentRevision.id,
          promptProfileId: promptEnhancementProfile.id,
          promptOutputFormat: promptEnhancementProfile.outputFormat,
          videoDurationSeconds: videoDurationSeconds!,
          inputMode: promptEnhancementInputMode,
          sourceId: promptEnhancementSourceId,
        }) : undefined;
        const videoScript = input.videoScript
          ? input.videoScript.scriptFormat === "full-script-v2"
            ? await videoScriptStampForJob(env, session.userId, {
              ...input.videoScript,
              projectId: input.projectId,
              videoDurationSeconds: videoDurationSeconds!,
              videoSpeech: videoSpeech!,
              workflowId: plan.workflow.id,
              workflowRevisionId: plan.workflow.currentRevision.id,
              promptProfileId: promptEnhancementProfile.id,
              promptOutputFormat: promptEnhancementProfile.outputFormat,
              inputMode: promptEnhancementInputMode,
              sourceId: promptEnhancementSourceId,
              jobPrompt: prompt,
              videoVariant: videoVariant ?? null,
              promptEnhancementRequestId: promptEnhancement?.requestId ?? null,
              evolution: input.evolution ? {
                studyId: boundedText(input.evolution.studyId, 120),
                role: input.evolution.role,
              } : null,
            })
            : await videoScriptStampForJob(env, session.userId, {
              ...input.videoScript,
              projectId: input.projectId,
              videoDurationSeconds: videoDurationSeconds!,
              videoSpeech: videoSpeech!,
            })
          : undefined;
        const continuity = input.continuity
          ? await generationContinuityStamp(env, session.userId, input.projectId, modality, input.continuity, prompt)
          : undefined;
        if (continuity) {
          if (modality === "music") throw new Error("music_continuity_not_supported");
          const suffix = continuity.directive.text;
          const authoredPrompt = authoredPromptBeforeContinuity(prompt, suffix, videoSpeech);
          if (authoredPrompt.length < 4) throw new Error("workflow_continuity_prompt_mismatch");
        }
        const createdAt = new Date().toISOString();
        const aceStepWorkflow = modality === "music" && /\bace\s*step\b/.test(aceStepWorkflowIdentity(plan.workflow));
        const modelAdapters = aceStepWorkflow ? await activeMusicAdapterBindings(env, session.userId, input.projectId) : [];
        if (modelAdapters.length) {
          const adapterParameters = aceStepAdapterParameterIds(plan.workflow);
          if (!adapterParameters.fileId || !adapterParameters.strengthId) throw new Error("ace_step_workflow_adapter_controls_missing");
          parameterValues[adapterParameters.fileId] = modelAdapters[0].relativePath;
          parameterValues[adapterParameters.strengthId] = modelAdapters[0].strength;
        }
        const evolution = input.evolution && evolutionSource && evolutionTaste ? {
          schemaVersion: "creative-studio-evolution/1.0" as const,
          studyId: boundedText(input.evolution.studyId, 120),
          role: input.evolution.role,
          sourceId: evolutionSource.id,
          source: evolutionSource.source,
          sourceKind: evolutionSource.kind,
          sourceName: boundedText(evolutionSource.name, 200),
          projectCanon: evolutionTaste.projects[input.projectId]?.canon ?? { identity: project.description, currentDirection: project.note },
          personalTasteSignalIds: evolutionTaste.personal.preserve.concat(evolutionTaste.personal.redirect, evolutionTaste.personal.avoid).map((signal) => signal.id),
          projectTasteSignalIds: Object.values(evolutionTaste.projects[input.projectId]?.taste ?? { preserve: [], redirect: [], avoid: [] }).flatMap((value) => Array.isArray(value) ? value.map((signal) => signal.id) : []),
          createdAt,
        } : undefined;
        const storyRecommendation = input.storyRecommendation
          ? await storyRecommendationStampForJob(env, session.userId, {
            projectId: input.projectId,
            dnaArtifactId: dna.artifactId,
            modality,
            prompt,
            workflowId: plan.workflow.id,
            workflowRevisionId: plan.workflow.currentRevision.id,
            selection: input.storyRecommendation,
          })
          : undefined;
        const created = await createQueuedJob(env, session.userId, {
          projectId: input.projectId,
          dna,
          modality,
          idempotencyKey: requestKey,
          reconcileEmail: null,
          provider: "local-comfyui",
          promptOverride: prompt,
          executionTarget: "local-comfyui",
          workflowId: plan.workflow.id,
          workflowRevisionId: plan.workflow.currentRevision.id,
          priority: outputBatch ? 900 : undefined,
          settingsStampOverride: {
            schemaVersion: 1,
            source: "comfyui-workflow",
            createdAt,
            reusedFromJobId: null,
            prompt,
            provider: "local-comfyui",
            modality,
            performanceMode,
            videoPerformance: videoPerformance?.stamp,
            videoDurationSeconds: videoPerformance?.effectiveDuration ?? videoDurationSeconds,
            workflow: {
              workflowId: plan.workflow.id,
              revisionId: plan.workflow.currentRevision.id,
              version: plan.workflow.currentRevision.version,
              name: plan.workflow.name,
              format: plan.workflow.currentRevision.format,
              contentHash: plan.workflow.currentRevision.contentHash,
            },
            parameters: parameterValues,
            models: plan.workflow.currentRevision.models,
            modelAdapters,
            workloadEvidence: {
              source: "workflow-revision",
              profileId: plan.workflow.currentRevision.id,
              label: `${plan.workflow.name} v${plan.workflow.currentRevision.version}`,
            },
            inputAssetIds: inputSources.filter((inputSource) => inputSource.source === "upload").map((inputSource) => inputSource.id),
            inputArtifactIds: inputSources.filter((inputSource) => inputSource.source === "artifact").map((inputSource) => inputSource.id),
            inputSources,
            inputBindings,
            promptReference,
            musicPromptProfile: modality === "music" ? musicWorkflowPromptProfile(plan.workflow) : undefined,
            videoVariant,
            videoSpeech,
            videoScript,
            videoOperation,
            evolution,
            outputBatch: outputBatch ? {
              schemaVersion: "creative-studio-output-batch/1.0",
              batchId: outputBatch.batchId,
              index: outputBatch.index,
              count: outputBatch.count as 1 | 2 | 4,
            } : undefined,
            continuity,
            promptEnhancement,
            storyRecommendation,
          },
        });
        if (input.storyRecommendation) await markStoryRecommendationUsed(env, session.userId, input.storyRecommendation);
        return json({ ok: true, job: created.job }, { status: 202 });
      }
      if (input.continuity) throw new Error("continuity_workflow_required");
      if (outputBatch) throw new Error("output_batch_workflow_required");
      if (videoOperation) throw new Error("video_workflow_required");
      if (modality === "video") throw new Error("video_workflow_required");
      if (localHardwareMode(env)) throw new Error("local_comfyui_workflow_required");
      if (developmentMode(env)) {
        if (input.provider !== "development-preview") throw new Error("generation_provider_required");
        const job = await createDevelopmentJob(env, session.userId, input.projectId, dna, modality, requestKey);
        return json({ ok: true, job }, { status: 202 });
      }
      if (input.provider !== "afdfw") throw new Error("generation_provider_required");
      const created = await createQueuedJob(env, session.userId, {
        projectId: input.projectId,
        dna,
        modality,
        idempotencyKey: requestKey,
        reconcileEmail: reconciliationEmail(request),
        provider: modality === "music" ? "afdfw-stable-audio-3" : "afdfw-z-image",
      });
      try { await enqueueJob(env, created.job.id); } catch (error) { console.error("creative_studio_job_enqueue_failed", created.job.id, error); }
      const job = created.job;
      return json({ ok: true, job }, { status: 202 });
    }
    if (route === "job-reuse") {
      const match = url.pathname.match(/^\/api\/creative-studio\/jobs\/([a-z0-9_]+)\/reuse$/i);
      const input = await body<RetryJobRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const original = await jobById(env, session.userId, match[1]);
      if (!original) throw new Error("job_not_found");
      const dna = (await listLocalDna(env, session.userId)).find((item) => item.artifactId === original.dnaArtifactId);
      if (!dna) throw new Error("creative_dna_not_found");
      const project = await projectById(env, session.userId, original.projectId);
      if (!project) throw new Error("project_not_found");
      if (project.status === "archived") throw new Error("project_archived");
      await assertCreativeDnaReviewed(env, session.userId, dna);
      const localWorkflow = original.settingsStamp.source === "comfyui-workflow" && Boolean(original.settingsStamp.workflow);
      if (localHardwareMode(env) && !localWorkflow) throw new Error("local_comfyui_workflow_required");
      if (localWorkflow) await assertReusableLocalWorkflowPrompt(env, session.userId, original);
      if (localWorkflow && original.modality === "image" && assessImagePerformance(original.settingsStamp.parameters).requiresExplicitCustom
        && original.settingsStamp.performanceMode !== "explicit-custom") throw new Error("image_custom_mode_required");
      const videoPerformance = localWorkflow ? await revalidatedVideoPerformance(env, session.userId, original) : undefined;
      const createdAt = new Date().toISOString();
      const created = await createQueuedJob(env, session.userId, {
        projectId: original.projectId,
        dna,
        modality: original.modality,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        reconcileEmail: developmentMode(env) || localWorkflow ? null : reconciliationEmail(request),
        provider: localWorkflow ? original.provider : developmentMode(env) ? "development-worker" : original.provider,
        promptOverride: original.settingsStamp.prompt,
        executionTarget: localWorkflow ? "local-comfyui" : "afdfw",
        workflowId: original.settingsStamp.workflow?.workflowId ?? null,
        workflowRevisionId: original.settingsStamp.workflow?.revisionId ?? null,
        settingsStampOverride: {
          ...original.settingsStamp,
          createdAt,
          reusedFromJobId: original.id,
          provider: localWorkflow ? original.provider : developmentMode(env) ? "development-worker" : original.provider,
          evolution: undefined,
          loveLoop: undefined,
          videoPerformance: videoPerformance?.stamp,
          videoDurationSeconds: videoPerformance?.effectiveDuration ?? original.settingsStamp.videoDurationSeconds,
        },
      });
      if (!developmentMode(env) && !localWorkflow) {
        try { await enqueueJob(env, created.job.id); } catch (error) { console.error("creative_studio_job_reuse_enqueue_failed", created.job.id, error); }
      }
      return json({ ok: true, job: created.job }, { status: 202 });
    }
    if (route === "job-retry") {
      const match = url.pathname.match(/^\/api\/creative-studio\/jobs\/([a-z0-9_]+)\/retry$/i);
      const input = await body<RetryJobRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const original = await jobById(env, session.userId, match[1]);
      if (!original) throw new Error("job_not_found");
      if (original.status !== "failed" && original.status !== "cancelled") throw new Error("job_not_retryable");
      const dna = (await listLocalDna(env, session.userId)).find((item) => item.artifactId === original.dnaArtifactId);
      if (!dna) throw new Error("creative_dna_not_found");
      const project = await projectById(env, session.userId, original.projectId);
      if (!project) throw new Error("project_not_found");
      if (project.status === "archived") throw new Error("project_archived");
      await assertCreativeDnaReviewed(env, session.userId, dna);
      const localWorkflow = original.settingsStamp.source === "comfyui-workflow" && Boolean(original.settingsStamp.workflow);
      if (localHardwareMode(env) && !localWorkflow) throw new Error("local_comfyui_workflow_required");
      if (localWorkflow) await assertReusableLocalWorkflowPrompt(env, session.userId, original);
      if (localWorkflow && original.modality === "image" && assessImagePerformance(original.settingsStamp.parameters).requiresExplicitCustom
        && original.settingsStamp.performanceMode !== "explicit-custom") throw new Error("image_custom_mode_required");
      const videoPerformance = localWorkflow ? await revalidatedVideoPerformance(env, session.userId, original) : undefined;
      const resumeLocalUpstream = localWorkflow && original.status === "failed" && Boolean(original.upstreamId)
        && /timeout|timed_out|output_download|retention|artifact_storage|fetch failed/i.test(original.error ?? "");
      const createdAt = new Date().toISOString();
      const created = await createQueuedJob(env, session.userId, {
        projectId: original.projectId,
        dna,
        modality: original.modality,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
        reconcileEmail: developmentMode(env) || localWorkflow ? null : reconciliationEmail(request),
        provider: localWorkflow ? original.provider : developmentMode(env) ? "development-worker" : original.provider,
        retryOfJobId: original.id,
        promptOverride: original.settingsStamp.prompt,
        executionTarget: localWorkflow ? "local-comfyui" : "afdfw",
        workflowId: original.settingsStamp.workflow?.workflowId ?? null,
        workflowRevisionId: original.settingsStamp.workflow?.revisionId ?? null,
        upstreamId: resumeLocalUpstream ? original.upstreamId : null,
        priority: original.settingsStamp.outputBatch ? 900 : undefined,
        settingsStampOverride: {
          ...original.settingsStamp,
          createdAt,
          reusedFromJobId: original.id,
          loveLoop: undefined,
          videoPerformance: videoPerformance?.stamp,
          videoDurationSeconds: videoPerformance?.effectiveDuration ?? original.settingsStamp.videoDurationSeconds,
        },
      });
      if (!developmentMode(env) && !localWorkflow) {
        try { await enqueueJob(env, created.job.id); } catch (error) { console.error("creative_studio_job_retry_enqueue_failed", created.job.id, error); }
      }
      return json({ ok: true, job: created.job }, { status: 202 });
    }
    if (route === "job-cancel") {
      const match = url.pathname.match(/^\/api\/creative-studio\/jobs\/([a-z0-9_]+)\/cancel$/i);
      if (!match) return json({ ok: false, error: "invalid_job_request" }, { status: 400 });
      const job = await cancelOwnedJob(env, session.userId, match[1]);
      if (job.settingsStamp.outputBatch) {
        await cancelGenerationBatch(env, session.userId, job.settingsStamp.outputBatch.batchId, job.settingsStamp.outputBatch.index);
      }
      return json({ ok: true, job });
    }
    if (route === "artifacts-list") {
      if (url.search) return json({ ok: true, page: await listArtifactHistoryPage(env, session.userId, artifactHistoryQuery(url)) });
      await syncJobs(env, session.userId);
      const [artifacts, acceptances, trainingExamples] = await Promise.all([
        listArtifacts(env, session.userId), listAcceptances(env, session.userId), listTrainingExamples(env, session.userId),
      ]);
      return json({ ok: true, artifacts, acceptances, trainingExamples });
    }
    if (route === "media-list") return json({ ok: true, assets: await listMediaAssets(env, session.userId) });
    if (route === "media-upload") return json({ ok: true, asset: await uploadMedia(env, request, session.userId) }, { status: 201 });
    if (route === "media-content") {
      const match = url.pathname.match(/^\/api\/creative-studio\/media\/([a-z0-9_]+)\/content$/i);
      if (!match) return json({ ok: false, error: "invalid_media_route" }, { status: 400 });
      return await mediaContent(env, request, session.userId, match[1]);
    }
    if (route === "archive-index-status") {
      return json({ ok: true, ...await archiveIndexStatus(env, session.userId) });
    }
    if (route === "archive-index-list") {
      return json({ ok: true, page: await listArchiveEntries(env, session.userId, archiveEntryQuery(url)) });
    }
    if (route === "archive-materialization-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/archive-index\/entries\/([a-z0-9_]+)\/materializations$/i);
      const input = await body<unknown>(request);
      if (!match || !input) throw new Error("invalid_archive_materialization_request");
      return json({ ok: true, ...await createArchiveMaterialization(env, session.userId, match[1], input) }, { status: 202 });
    }
    if (route === "archive-materialization-get") {
      const match = url.pathname.match(/^\/api\/creative-studio\/archive-index\/materializations\/([a-z0-9_]+)$/i);
      if (!match) throw new Error("invalid_archive_materialization_request");
      return json({ ok: true, ...await archiveMaterializationById(env, session.userId, match[1]) });
    }
    if (route === "workflows-list") return json({ ok: true, workflows: await listWorkflows(env, session.userId) });
    if (route === "workflow-import") return json({ ok: true, workflow: await importWorkflow(env, request, session.userId) }, { status: 201 });
    if (route === "workflow-revision-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/workflows\/([a-z0-9_]+)\/revisions$/i);
      const input = await body<SaveWorkflowRevisionRequest>(request);
      if (!match || !input || !input.values || typeof input.values !== "object") return json({ ok: false, error: "invalid_workflow_revision_request" }, { status: 400 });
      const scope = input.scope === undefined ? "library-current" : input.scope;
      if (scope !== "library-current" && scope !== "execution-only") {
        return json({ ok: false, error: "invalid_workflow_revision_scope" }, { status: 400 });
      }
      const workflow = scope === "execution-only"
        ? await createAutomationWorkflowRevision(env, session.userId, match[1], input)
        : await createWorkflowRevision(env, session.userId, match[1], input);
      return json({ ok: true, workflow }, { status: 201 });
    }
    if (route === "workflow-content") {
      const match = url.pathname.match(/^\/api\/creative-studio\/workflows\/([a-z0-9_]+)\/content$/i);
      if (!match) return json({ ok: false, error: "invalid_workflow_route" }, { status: 400 });
      return workflowContent(env, session.userId, match[1], url.searchParams.get("revision"));
    }
    if (route === "recipes-list") {
      return json({ ok: true, recipes: await listGenerationRecipes(env, session.userId, url.searchParams.get("includeArchived") === "true") });
    }
    if (route === "recipe-get") {
      const match = url.pathname.match(/^\/api\/creative-studio\/recipes\/([a-z0-9_]+)$/i);
      if (!match) return json({ ok: false, error: "invalid_recipe_route" }, { status: 400 });
      const recipe = await generationRecipeById(env, session.userId, match[1]);
      if (!recipe) return json({ ok: false, error: "generation_recipe_not_found" }, { status: 404 });
      return json({ ok: true, recipe });
    }
    if (route === "recipe-create") {
      const input = await body<CreateGenerationRecipeRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_recipe_request" }, { status: 400 });
      return json({ ok: true, recipe: await createGenerationRecipe(env, session.userId, input) }, { status: 201 });
    }
    if (route === "recipe-update") {
      const match = url.pathname.match(/^\/api\/creative-studio\/recipes\/([a-z0-9_]+)$/i);
      const input = await body<UpdateGenerationRecipeRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_recipe_request" }, { status: 400 });
      return json({ ok: true, recipe: await updateGenerationRecipe(env, session.userId, match[1], input) });
    }
    if (route === "recipe-delete") {
      const match = url.pathname.match(/^\/api\/creative-studio\/recipes\/([a-z0-9_]+)$/i);
      if (!match) return json({ ok: false, error: "invalid_recipe_route" }, { status: 400 });
      return json({ ok: true, recipe: await deleteGenerationRecipe(env, session.userId, match[1]) });
    }
    if (route === "recipe-evidence-create") {
      const match = url.pathname.match(/^\/api\/creative-studio\/recipes\/([a-z0-9_]+)\/evidence$/i);
      const input = await body<RecordRecipeEvidenceRequest>(request);
      if (!match || !input?.jobId) return json({ ok: false, error: "invalid_recipe_evidence_request" }, { status: 400 });
      return json({ ok: true, ...await recordGenerationRecipeEvidence(env, session.userId, match[1], input.jobId) }, { status: 201 });
    }
    if (route === "runners-list") return json({ ok: true, runners: await listLocalRunners(env, session.userId) });
    if (route === "runner-enroll") {
      const input = await body<EnrollLocalRunnerRequest>(request);
      if (!input) return json({ ok: false, error: "invalid_runner_request" }, { status: 400 });
      return json({ ok: true, ...await enrollLocalRunner(env, request, session.userId, input.name) }, { status: 201 });
    }
    if (route === "runner-revoke") {
      const match = url.pathname.match(/^\/api\/creative-studio\/runners\/([a-z0-9_]+)\/revoke$/i);
      if (!match) return json({ ok: false, error: "invalid_runner_request" }, { status: 400 });
      return json({ ok: true, runner: await revokeLocalRunner(env, session.userId, match[1]) });
    }
    if (route === "training-jobs-list") {
      const [trainingJobs, trainingReviews] = await Promise.all([
        listCreativeDnaTrainingJobs(env, session.userId),
        listCreativeDnaTrainingReviews(env, session.userId),
      ]);
      return json({ ok: true, trainingJobs, trainingReviews });
    }
    if (route === "production-loops") {
      await syncJobs(env, session.userId);
      const [projects, dnaArtifacts, jobs, artifacts, trainingExamples, trainingJobs, trainingReviews] = await Promise.all([
        listProjects(env, session.userId),
        listLocalDna(env, session.userId),
        listJobs(env, session.userId),
        listArtifacts(env, session.userId),
        listTrainingExamples(env, session.userId),
        listCreativeDnaTrainingJobs(env, session.userId),
        listCreativeDnaTrainingReviews(env, session.userId),
      ]);
      const computedAt = new Date().toISOString();
      const evidencePools = await Promise.all(projects.map((project) => creativeDnaTrainingEvidencePool(env, session.userId, project.id)));
      return json({
        ok: true,
        productionLoops: projects.map((project, index) => deriveProjectProductionLoop({
          project, dnaArtifacts, jobs, artifacts, trainingExamples, trainingJobs, trainingReviews,
          reservedTrainingExampleIds: evidencePools[index].reservedIds,
          computedAt,
        })),
      });
    }
    if (route === "production-cockpit") {
      await syncJobs(env, session.userId);
      const [projects, dnaArtifacts, jobs, jobRuntime, artifacts, mediaAssets, acceptances, trainingJobs, trainingReviews, runners] = await Promise.all([
        listProjects(env, session.userId),
        listLocalDna(env, session.userId),
        listJobs(env, session.userId),
        listJobRuntime(env, session.userId),
        listArtifacts(env, session.userId),
        listMediaAssets(env, session.userId),
        listAcceptances(env, session.userId),
        listCreativeDnaTrainingJobs(env, session.userId),
        listCreativeDnaTrainingReviews(env, session.userId),
        listLocalRunners(env, session.userId),
      ]);
      return json({ ok: true, productionCockpit: deriveProductionCockpit({
        projects, dnaArtifacts, jobs, artifacts, mediaAssets, acceptances, trainingJobs, trainingReviews, runners,
        jobRuntime, computedAt: new Date().toISOString(),
      }) });
    }
    if (route === "training-job-create") {
      const input = await body<CreateCreativeDnaTrainingJobRequest>(request);
      if (!input || !Array.isArray(input.assetIds)) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      const trainingJob = await createCreativeDnaTrainingJob(env, session.userId, {
        ...input,
        idempotencyKey: idempotencyKey(input.idempotencyKey),
      });
      return json({ ok: true, trainingJob }, { status: 202 });
    }
    if (route === "training-job-cancel") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/cancel$/i);
      if (!match) return json({ ok: false, error: "invalid_training_job_request" }, { status: 400 });
      return json({ ok: true, trainingJob: await cancelCreativeDnaTrainingJob(env, session.userId, match[1]) });
    }
    if (route === "training-job-review") {
      const match = url.pathname.match(/^\/api\/creative-studio\/training-jobs\/([a-z0-9_]+)\/review$/i);
      const input = await body<ReviewCreativeDnaTrainingRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_training_review" }, { status: 400 });
      const actor = developmentMode(env) ? "development-user" : "angelo";
      return json({ ok: true, ...await reviewCreativeDnaTrainingJob(env, session.userId, match[1], input, actor) }, { status: 201 });
    }
    if (route === "model-training-jobs-list") {
      const [modelTrainingJobs, modelAdapters, modelAdapterReviews] = await Promise.all([
        listModelTrainingJobs(env, session.userId), listModelAdapters(env, session.userId), listModelAdapterReviews(env, session.userId),
      ]);
      return json({ ok: true, modelTrainingJobs, modelAdapters, modelAdapterReviews });
    }
    if (route === "model-training-job-create") {
      const input = await body<CreateModelTrainingJobRequest>(request);
      if (!input || !Array.isArray(input.assetIds)) return json({ ok: false, error: "invalid_model_training_request" }, { status: 400 });
      return json({ ok: true, modelTrainingJob: await createModelTrainingJob(env, session.userId, { ...input, idempotencyKey: idempotencyKey(input.idempotencyKey) }) }, { status: 202 });
    }
    if (route === "model-training-job-cancel") {
      const match = url.pathname.match(/^\/api\/creative-studio\/model-training-jobs\/([a-z0-9_]+)\/cancel$/i);
      if (!match) return json({ ok: false, error: "invalid_model_training_request" }, { status: 400 });
      return json({ ok: true, modelTrainingJob: await cancelModelTrainingJob(env, session.userId, match[1]) });
    }
    if (route === "model-training-dataset-review") {
      const match = url.pathname.match(/^\/api\/creative-studio\/model-training-jobs\/([a-z0-9_]+)\/dataset-review$/i);
      const input = await body<ReviewModelTrainingDatasetRequest>(request);
      if (!match || !input || !Array.isArray(input.items)) return json({ ok: false, error: "invalid_model_training_dataset_review" }, { status: 400 });
      return json({ ok: true, modelTrainingJob: await reviewModelTrainingDataset(env, session.userId, match[1], input) });
    }
    if (route === "model-adapter-review") {
      const match = url.pathname.match(/^\/api\/creative-studio\/model-adapters\/([a-z0-9_]+)\/review$/i);
      const input = await body<ReviewModelAdapterRequest>(request);
      if (!match || !input) return json({ ok: false, error: "invalid_model_adapter_review" }, { status: 400 });
      const actor = developmentMode(env) ? "development-user" : "angelo";
      return json({ ok: true, ...await reviewModelAdapter(env, session.userId, match[1], input.decision, input.note, actor) }, { status: 201 });
    }
    if (route === "artifact-review") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/(accepted|rejected|archived)$/i);
      if (!match) return json({ ok: false, error: "invalid_review_route" }, { status: 400 });
      const decision = match[2] as AcceptanceDecision;
      const input = await body<{ note?: unknown }>(request);
      const note = boundedText(input?.note, 500);
      if ((decision === "accepted" || decision === "rejected") && !note) throw new Error("review_note_required");
      if (!developmentMode(env)) {
        const source = await artifactMediaPath(env, session.userId, match[1]);
        if (!source) throw new Error("artifact_not_found");
        if (source.mediaPath || source.retainedKey) await retainCompletedArtifact(env, request, session.userId, match[1]);
      }
      return json({ ok: true, ...await reviewArtifact(env, session.userId, match[1], decision, note) });
    }
    if (route === "artifact-media") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/media$/i);
      const media = match ? await artifactMediaPath(env, session.userId, match[1]) : null;
      if (media?.retainedKey && env.ARTIFACTS) {
        const size = Number(media.retainedSize ?? 0);
        const range = requestedMediaRange(request.headers.get("range"), size);
        const object = await env.ARTIFACTS.get(media.retainedKey, range ? { range } : undefined);
        if (object) {
          const headers = new Headers({
            "accept-ranges": "bytes",
            "cache-control": "private, max-age=3600",
            "content-length": String(range?.length ?? size),
            "content-type": media.retainedContentType || "application/octet-stream",
            "x-content-type-options": "nosniff",
          });
          if (range) headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
          object.writeHttpMetadata(headers);
          return new Response(object.body, { status: range ? 206 : 200, headers });
        }
      }
      if (!media?.mediaPath) return json({ ok: false, error: "artifact_media_not_found" }, { status: 404 });
      return afdfwMedia(env, request, media.mediaPath);
    }
    if (route === "artifact-thumbnail") {
      const match = url.pathname.match(/^\/api\/creative-studio\/artifacts\/([a-z0-9_]+)\/thumbnail$/i);
      const thumbnail = match ? await artifactThumbnailPath(env, session.userId, match[1]) : null;
      if (!thumbnail?.thumbnailKey || !env.ARTIFACTS) return json({ ok: false, error: "artifact_thumbnail_not_found" }, { status: 404 });
      const object = await env.ARTIFACTS.get(thumbnail.thumbnailKey);
      if (!object) return json({ ok: false, error: "artifact_thumbnail_not_found" }, { status: 404 });
      const headers = new Headers({
        "cache-control": "private, max-age=3600",
        "content-length": String(thumbnail.thumbnailSize ?? object.size),
        "content-type": thumbnail.thumbnailContentType || "image/jpeg",
        "x-content-type-options": "nosniff",
      });
      object.writeHttpMetadata(headers);
      return new Response(object.body, { headers });
    }
    if (route === "capabilities") return json({ ok: true, capabilities: await capabilities(env, session) });
    return json({ ok: false, error: "creative_studio_route_not_found" }, { status: 404 });
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : "creative_studio_request_failed";
    return json({ ok: false, error }, { status: statusFor(error) });
  }
}
