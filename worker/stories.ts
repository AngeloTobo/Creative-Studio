import {
  compileCreativeTasteMemory,
  creativeDnaDescriptionSummaries,
  generationWorkflowPromptParameters,
  musicWorkflowPromptProfile,
  normalizeStoryPlan,
  normalizeVideoDurationSeconds,
  recoverWorkflowPromptRoles,
  resolveCreativeDnaGenerationArtifact,
  summarizeRecipeEvidence,
  STORY_SELECTION_SCHEMA_VERSION,
  videoWorkflowDurationParameters,
  videoWorkflowPromptProfile,
  type CompleteStoryPlanRequest,
  type CreativeDnaArtifact,
  type CreativeDnaTrainingReview,
  type FailStoryPlanRequest,
  type GenerationRecipe,
  type GenerationRecipePromptProfile,
  type GenerationRecipeSourceKind,
  type GenerationModality,
  type RecipeEvidence,
  type RefreshStoryBankRequest,
  type StoryBankRefresh,
  type StoryPlan,
  type StoryPlanHeartbeatRequest,
  type StoryPlannerBundle,
  type StoryPlannerContext,
  type StoryPlannerSource,
  type StoryPlannerWorkflow,
  type StoryPromptAspectRatio,
  type StoryPromptRecommendation,
  type StoryRecommendationSelection,
  type StoryRecommendationStamp,
  type StorySourceRef,
  type StoryThread,
  type StoryThreadStatus,
  type UpdateStoryThreadRequest,
  type WorkflowDefinition,
  type WorkflowParameter,
  type WorkflowScalar,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import {
  listAcceptances,
  listArtifacts,
  listLocalDna,
  listProjects,
} from "./repository";
import { listCreativeDnaTrainingReviews } from "./training";
import type { Env } from "./types";
import { listWorldRecords } from "./worlds";

type RunnerIdentity = { id: string; ownerId: string; version: string | null };

type StoryRefreshRow = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  worldId: string | null;
  evidenceFingerprint: string;
  trigger: StoryBankRefresh["trigger"];
  sourceRefsJson: string;
  plannerContextJson: string;
  workflowsJson: string;
  status: StoryBankRefresh["status"];
  runnerId: string | null;
  runnerLeaseUntil: string | null;
  plannerProvider: "local-comfyui";
  plannerModel: string | null;
  comfyPromptId: string | null;
  error: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type StoryThreadRow = {
  id: string;
  projectId: string;
  refreshId: string;
  worldId: string | null;
  dnaArtifactId: string;
  title: string;
  logline: string;
  status: StoryThreadStatus;
  pinned: number;
  version: number;
  sourceRefsJson: string;
  evidenceFingerprint: string;
  plannerProvider: "local-comfyui";
  plannerModel: string;
  createdAt: string;
  updatedAt: string;
};

type RecommendationRow = {
  id: string;
  projectId: string;
  refreshId: string;
  storyId: string;
  version: number;
  modality: GenerationModality;
  role: StoryPromptRecommendation["role"];
  title: string;
  prompt: string;
  promptHash: string;
  sourceId: string | null;
  sourceType: "upload" | "artifact" | null;
  sourceKind: StoryPromptRecommendation["sourceKind"];
  workflowId: string | null;
  workflowRevisionId: string | null;
  recipeId: string | null;
  modelTarget: string | null;
  durationSeconds: number | null;
  aspectRatio: StoryPromptAspectRatio | null;
  estimatedDurationMs: number | null;
  status: StoryPromptRecommendation["status"];
  createdAt: string;
  updatedAt: string;
};

const REFRESH_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId, world_id as worldId,
  evidence_fingerprint as evidenceFingerprint, trigger, source_refs_json as sourceRefsJson,
  planner_context_json as plannerContextJson, workflows_json as workflowsJson, status,
  runner_id as runnerId, runner_lease_until as runnerLeaseUntil, planner_provider as plannerProvider,
  planner_model as plannerModel, comfy_prompt_id as comfyPromptId, error, idempotency_key as idempotencyKey,
  created_at as createdAt, updated_at as updatedAt, started_at as startedAt, completed_at as completedAt`;

const THREAD_COLUMNS = `id, project_id as projectId, refresh_id as refreshId, world_id as worldId,
  dna_artifact_id as dnaArtifactId, title, logline, status, pinned, version,
  source_refs_json as sourceRefsJson, evidence_fingerprint as evidenceFingerprint,
  planner_provider as plannerProvider, planner_model as plannerModel,
  created_at as createdAt, updated_at as updatedAt`;

const RECOMMENDATION_COLUMNS = `id, project_id as projectId, refresh_id as refreshId, story_id as storyId,
  version, modality, role, title, prompt, prompt_hash as promptHash, source_id as sourceId,
  source_type as sourceType, source_kind as sourceKind, workflow_id as workflowId,
  workflow_revision_id as workflowRevisionId, recipe_id as recipeId, model_target as modelTarget,
  duration_seconds as durationSeconds, aspect_ratio as aspectRatio, estimated_duration_ms as estimatedDurationMs,
  status, created_at as createdAt, updated_at as updatedAt`;

const JOINED_RECOMMENDATION_COLUMNS = `r.id, r.project_id as projectId, r.refresh_id as refreshId,
  r.story_id as storyId, r.version, r.modality, r.role, r.title, r.prompt,
  r.prompt_hash as promptHash, r.source_id as sourceId, r.source_type as sourceType,
  r.source_kind as sourceKind, r.workflow_id as workflowId,
  r.workflow_revision_id as workflowRevisionId, r.recipe_id as recipeId,
  r.model_target as modelTarget, r.duration_seconds as durationSeconds,
  r.aspect_ratio as aspectRatio, r.estimated_duration_ms as estimatedDurationMs,
  r.status, r.created_at as createdAt, r.updated_at as updatedAt`;

function storedJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function storedWorkflowParameters(value: string): WorkflowParameter[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.some((parameter) => {
    if (!parameter || typeof parameter !== "object") return true;
    const candidate = parameter as Partial<WorkflowParameter>;
    return !["text", "number", "boolean", "choice", "media"].includes(candidate.kind ?? "")
      || (candidate.kind === "media"
        && candidate.mediaKind !== null
        && !["image", "audio", "video"].includes(candidate.mediaKind ?? ""));
  })) return null;
  return parsed as WorkflowParameter[];
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function publicRefresh(row: StoryRefreshRow): StoryBankRefresh {
  return {
    id: row.id,
    projectId: row.projectId,
    dnaArtifactId: row.dnaArtifactId,
    worldId: row.worldId,
    evidenceFingerprint: row.evidenceFingerprint,
    status: row.status,
    trigger: row.trigger,
    runnerId: row.runnerId,
    plannerProvider: row.plannerProvider,
    plannerModel: row.plannerModel,
    comfyPromptId: row.comfyPromptId,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function publicRecommendation(row: RecommendationRow, derivedStale = false): StoryPromptRecommendation {
  return {
    id: row.id,
    storyId: row.storyId,
    version: Number(row.version),
    modality: row.modality,
    role: row.role,
    title: row.title,
    prompt: row.prompt,
    promptHash: row.promptHash,
    sourceId: row.sourceId,
    sourceType: row.sourceType,
    sourceKind: row.sourceKind,
    workflowId: row.workflowId,
    workflowRevisionId: row.workflowRevisionId,
    recipeId: row.recipeId,
    modelTarget: row.modelTarget,
    durationSeconds: row.durationSeconds === null ? null : Number(row.durationSeconds),
    aspectRatio: row.aspectRatio,
    estimatedDurationMs: row.estimatedDurationMs === null ? null : Number(row.estimatedDurationMs),
    status: derivedStale && (row.status === "ready" || row.status === "used") ? "stale" : row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicThread(row: StoryThreadRow, recommendations: RecommendationRow[], staleRecommendationIds: ReadonlySet<string> = new Set()): StoryThread {
  return {
    id: row.id,
    projectId: row.projectId,
    worldId: row.worldId,
    dnaArtifactId: row.dnaArtifactId,
    title: row.title,
    logline: row.logline,
    status: row.status,
    pinned: Boolean(row.pinned),
    version: Number(row.version),
    sourceRefs: storedJson<StorySourceRef[]>(row.sourceRefsJson, []),
    evidenceFingerprint: row.evidenceFingerprint,
    plannerProvider: row.plannerProvider,
    plannerModel: row.plannerModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    recommendations: recommendations.map((recommendation) => publicRecommendation(
      recommendation,
      staleRecommendationIds.has(recommendation.id),
    )),
  };
}

function compatibilityKey(...parts: Array<string | null>) {
  return parts.map((part) => part ?? "").join("\u0000");
}

async function staleStoryRecommendationIds(
  env: Env,
  ownerId: string,
  threads: StoryThreadRow[],
  recommendations: RecommendationRow[],
) {
  const actionable = recommendations.filter((row) => row.status === "ready" || row.status === "used");
  if (!threads.length || !actionable.length) return new Set<string>();

  const projectIds = [...new Set(threads.map((row) => row.projectId))];
  const workflowIds = [...new Set(actionable.map((row) => row.workflowId).filter((value): value is string => Boolean(value)))];
  const uploadIds = [...new Set(actionable
    .filter((row) => row.sourceType === "upload" && row.sourceId)
    .map((row) => row.sourceId!))];
  const artifactIds = [...new Set(actionable
    .filter((row) => row.sourceType === "artifact" && row.sourceId)
    .map((row) => row.sourceId!))];

  const dnaResult = await env.DB.prepare(`with recursive ancestry(project_id, id, parent_artifact_id) as (
    select project.id, artifact.id, artifact.parent_artifact_id
      from creative_projects project
      join creative_dna_artifacts artifact on artifact.id = project.active_dna_artifact_id
        and artifact.owner_id = project.owner_id and artifact.project_id = project.id
      where project.owner_id = ? and project.id in (${projectIds.map(() => "?").join(", ")})
    union
    select ancestry.project_id, artifact.id, artifact.parent_artifact_id
      from ancestry join creative_dna_artifacts artifact on artifact.id = ancestry.parent_artifact_id
        and artifact.owner_id = ? and artifact.project_id = ancestry.project_id
  ) select project_id as projectId, id from ancestry`)
    .bind(ownerId, ...projectIds, ownerId).all<{ projectId: string; id: string }>();
  const compatibleDna = new Set((dnaResult.results ?? []).map((row) => compatibilityKey(row.projectId, row.id)));

  const compatibleWorkflowRevisions = new Map<string, WorkflowParameter[]>();
  if (workflowIds.length) {
    const workflowResult = await env.DB.prepare(`with recursive ancestry(project_id, workflow_id, modality, id, parent_revision_id, parameters_json) as (
      select workflow.project_id, workflow.id, workflow.modality, revision.id, revision.parent_revision_id,
        revision.parameters_json
        from creative_workflows workflow
        join creative_workflow_revisions revision on revision.id = workflow.current_revision_id
          and revision.workflow_id = workflow.id and revision.owner_id = workflow.owner_id
        where workflow.owner_id = ? and workflow.execution_state = 'ready'
          and workflow.id in (${workflowIds.map(() => "?").join(", ")})
      union
      select ancestry.project_id, ancestry.workflow_id, ancestry.modality, revision.id, revision.parent_revision_id,
        ancestry.parameters_json
        from ancestry join creative_workflow_revisions revision on revision.id = ancestry.parent_revision_id
          and revision.workflow_id = ancestry.workflow_id and revision.owner_id = ?
    ) select project_id as projectId, workflow_id as workflowId, modality, id,
      parameters_json as parametersJson from ancestry`)
      .bind(ownerId, ...workflowIds, ownerId)
      .all<{ projectId: string; workflowId: string; modality: string; id: string; parametersJson: string }>();
    for (const row of workflowResult.results ?? []) {
      const modality = modalityForWorkflow(row.modality);
      const parameters = storedWorkflowParameters(row.parametersJson);
      if (modality && parameters) compatibleWorkflowRevisions.set(
        compatibilityKey(row.projectId, row.workflowId, row.id, modality),
        parameters,
      );
    }
  }

  const compatibleSources = new Set<string>();
  if (uploadIds.length) {
    const uploadResult = await env.DB.prepare(`select id, project_id as projectId, kind from creative_media_assets
      where owner_id = ? and status = 'retained' and id in (${uploadIds.map(() => "?").join(", ")})`)
      .bind(ownerId, ...uploadIds).all<{ id: string; projectId: string; kind: StoryPromptRecommendation["sourceKind"] }>();
    for (const row of uploadResult.results ?? []) {
      compatibleSources.add(compatibilityKey("upload", row.projectId, row.id, row.kind));
    }
  }
  if (artifactIds.length) {
    const artifactResult = await env.DB.prepare(`select id, project_id as projectId, kind from creative_artifacts
      where owner_id = ? and retained_key is not null and id in (${artifactIds.map(() => "?").join(", ")})`)
      .bind(ownerId, ...artifactIds).all<{ id: string; projectId: string; kind: GenerationModality }>();
    for (const row of artifactResult.results ?? []) {
      compatibleSources.add(compatibilityKey(
        "artifact",
        row.projectId,
        row.id,
        row.kind === "music" ? "audio" : row.kind,
      ));
    }
  }

  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  return new Set(actionable.filter((recommendation) => {
    const thread = threadById.get(recommendation.storyId);
    if (!thread || !compatibleDna.has(compatibilityKey(thread.projectId, thread.dnaArtifactId))) return true;
    if (!recommendation.workflowId || !recommendation.workflowRevisionId) return true;
    const currentParameters = compatibleWorkflowRevisions.get(compatibilityKey(
      recommendation.projectId,
      recommendation.workflowId,
      recommendation.workflowRevisionId,
      recommendation.modality,
    ));
    if (!currentParameters) return true;
    const mediaParameters = currentParameters.filter((parameter) => parameter.kind === "media");
    if (recommendation.modality === "music") {
      if (mediaParameters.length) return true;
    } else if (!recommendation.sourceId) {
      if (mediaParameters.length) return true;
    } else if (mediaParameters.length !== 1
      || (mediaParameters[0].mediaKind && mediaParameters[0].mediaKind !== recommendation.sourceKind)) return true;
    if (!recommendation.sourceId) return false;
    if (!recommendation.sourceType || !recommendation.sourceKind) return true;
    return !compatibleSources.has(compatibilityKey(
      recommendation.sourceType,
      recommendation.projectId,
      recommendation.sourceId,
      recommendation.sourceKind,
    ));
  }).map((row) => row.id));
}

async function refreshRowById(env: Env, ownerId: string, refreshId: string) {
  return env.DB.prepare(`select ${REFRESH_COLUMNS} from creative_story_refreshes where id = ? and owner_id = ?`)
    .bind(boundedText(refreshId, 100), ownerId).first<StoryRefreshRow>();
}

async function storyThreadById(env: Env, ownerId: string, storyId: string) {
  const row = await env.DB.prepare(`select ${THREAD_COLUMNS} from creative_story_threads where id = ? and owner_id = ?`)
    .bind(boundedText(storyId, 100), ownerId).first<StoryThreadRow>();
  if (!row) return null;
  const recommendations = await env.DB.prepare(`select ${RECOMMENDATION_COLUMNS} from creative_story_recommendations
    where owner_id = ? and story_id = ? order by case modality when 'image' then 0 when 'video' then 1 else 2 end`)
    .bind(ownerId, row.id).all<RecommendationRow>();
  return publicThread(row, recommendations.results ?? []);
}

export async function listStoryBank(env: Env, ownerId: string, projectId: string | null = null, limit = 24) {
  const boundedLimit = Math.max(1, Math.min(60, Math.round(Number(limit) || 24)));
  const projectClause = projectId ? " and project_id = ?" : "";
  const statement = env.DB.prepare(`select ${THREAD_COLUMNS} from creative_story_threads
    where owner_id = ?${projectClause} and status != 'archived'
    order by pinned desc, case status when 'suggested' then 0 when 'developing' then 1 else 2 end,
      updated_at desc, id desc limit ?`);
  const threadResult = projectId
    ? await statement.bind(ownerId, boundedText(projectId, 100), boundedLimit).all<StoryThreadRow>()
    : await statement.bind(ownerId, boundedLimit).all<StoryThreadRow>();
  const rows = threadResult.results ?? [];
  const recommendations = rows.length
    ? await env.DB.prepare(`select ${RECOMMENDATION_COLUMNS} from creative_story_recommendations
      where owner_id = ? and story_id in (${rows.map(() => "?").join(", ")})
      order by case modality when 'image' then 0 when 'video' then 1 else 2 end`)
      .bind(ownerId, ...rows.map((row) => row.id)).all<RecommendationRow>()
    : { results: [] as RecommendationRow[] };
  const byStory = new Map<string, RecommendationRow[]>();
  for (const recommendation of recommendations.results ?? []) {
    byStory.set(recommendation.storyId, [...(byStory.get(recommendation.storyId) ?? []), recommendation]);
  }
  const staleRecommendationIds = await staleStoryRecommendationIds(env, ownerId, rows, recommendations.results ?? []);
  const refreshStatement = env.DB.prepare(`select ${REFRESH_COLUMNS} from creative_story_refreshes
    where owner_id = ?${projectClause} order by created_at desc limit 12`);
  const refreshResult = projectId
    ? await refreshStatement.bind(ownerId, boundedText(projectId, 100)).all<StoryRefreshRow>()
    : await refreshStatement.bind(ownerId).all<StoryRefreshRow>();
  return {
    storyThreads: rows.map((row) => publicThread(row, byStory.get(row.id) ?? [], staleRecommendationIds)),
    storyBankRefreshes: (refreshResult.results ?? []).map(publicRefresh),
  };
}

function modalityForWorkflow(value: string): GenerationModality | null {
  if (value === "audio" || value === "music") return "music";
  if (value === "image" || value === "video") return value;
  return null;
}

function sourceKinds(workflow: WorkflowDefinition) {
  return workflow.currentRevision.parameters
    .filter((parameter) => parameter.kind === "media" && parameter.mediaKind)
    .map((parameter) => parameter.mediaKind!);
}

function aspectRatioForWorkflow(workflow: WorkflowDefinition): StoryPromptAspectRatio | null {
  const values = workflow.currentRevision.parameters.flatMap((parameter) => {
    const identity = `${parameter.id} ${parameter.label}`;
    return /aspect|ratio|width|height/i.test(identity) ? [String(parameter.value)] : [];
  }).join(" ");
  const ratio = values.match(/(?:^|\D)(9\s*:\s*16|16\s*:\s*9|1\s*:\s*1)(?:\D|$)/)?.[1]?.replace(/\s+/g, "");
  return ratio === "9:16" || ratio === "16:9" || ratio === "1:1" ? ratio : null;
}

function redacted(value: string, identities: string[], limit: number) {
  let output = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
  for (const identity of identities.filter(Boolean)) {
    const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?:['\\u2019]s)?(?=$|[^\\p{L}\\p{N}_])`, "giu"), "$1");
  }
  return boundedText(output.replace(/\s+([,.;:!?])/g, "$1").replace(/\s{2,}/g, " "), limit);
}

function sanitizeContext<T>(value: T, identities: string[]): T {
  if (typeof value === "string") return redacted(value, identities, 12_000) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeContext(item, identities)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeContext(item, identities)])) as T;
  }
  return value;
}

type PlanningDnaRow = { id: string; projectId: string; dnaJson: string };

type PlanningWorkflowRow = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  sourceFileName: string;
  modality: WorkflowDefinition["modality"];
  executionState: WorkflowDefinition["executionState"];
  createdAt: string;
  updatedAt: string;
  revisionId: string;
  revisionVersion: number;
  parentRevisionId: string | null;
  format: WorkflowDefinition["currentRevision"]["format"];
  contentHash: string;
  graphJson: string;
  nodeCount: number;
  parametersJson: string;
  modelsJson: string;
  revisionCreatedAt: string;
};

type PlanningRecipeRow = {
  id: string;
  projectId: string | null;
  worldId: string | null;
  name: string;
  description: string;
  mediaKind: GenerationModality;
  workflowId: string;
  workflowRevisionId: string;
  modelIdentifier: string | null;
  promptProfileJson: string;
  parametersJson: string;
  sourceKindsJson: string;
  intentTier: GenerationRecipe["intentTier"];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type PlanningRecipeEvidenceRow = {
  id: string;
  recipeId: string;
  jobId: string;
  outcome: RecipeEvidence["outcome"];
  durationMs: number | null;
  failure: string | null;
  acceptance: RecipeEvidence["acceptance"];
  observedAt: string;
  createdAt: string;
  updatedAt: string;
};

type RetainedPlanningSource = {
  id: string;
  projectId: string;
  sourceType: "upload" | "artifact";
  kind: StoryPromptRecommendation["sourceKind"];
};

function planningDnaFromRow(row: PlanningDnaRow) {
  try {
    const artifact = resolveCreativeDnaGenerationArtifact(JSON.parse(row.dnaJson) as CreativeDnaArtifact);
    return artifact.artifactId === row.id && artifact.projectId === row.projectId ? artifact : null;
  } catch {
    return null;
  }
}

async function planningDnaById(env: Env, ownerId: string, dnaArtifactId: string) {
  const row = await env.DB.prepare(`select id, project_id as projectId, dna_json as dnaJson
    from creative_dna_artifacts where id = ? and owner_id = ?`)
    .bind(dnaArtifactId, ownerId).first<PlanningDnaRow>();
  return row ? planningDnaFromRow(row) : null;
}

async function planningDnaByIds(env: Env, ownerId: string, dnaArtifactIds: string[]) {
  if (!dnaArtifactIds.length) return [];
  const rows = await env.DB.prepare(`select id, project_id as projectId, dna_json as dnaJson
    from creative_dna_artifacts where owner_id = ? and id in (select value from json_each(?))`)
    .bind(ownerId, JSON.stringify([...new Set(dnaArtifactIds)])).all<PlanningDnaRow>();
  return (rows.results ?? []).map(planningDnaFromRow).filter((artifact): artifact is CreativeDnaArtifact => Boolean(artifact));
}

function planningWorkflowFromRow(row: PlanningWorkflowRow): WorkflowDefinition | null {
  const storedParameters = storedWorkflowParameters(row.parametersJson);
  const models = storedJson<unknown>(row.modelsJson, null);
  if (!storedParameters || !Array.isArray(models) || models.some((model) => typeof model !== "string")) return null;
  const textParameters = storedParameters.filter((parameter) => parameter.kind === "text");
  const needsPromptRoleRecovery = textParameters.some((parameter) => parameter.promptRole === undefined)
    || (!textParameters.some((parameter) => parameter.promptRole === "negative")
      && textParameters.filter((parameter) => parameter.promptRole === "positive").length > 1);
  let parameters = storedParameters;
  if (needsPromptRoleRecovery) {
    try { parameters = recoverWorkflowPromptRoles(JSON.parse(row.graphJson), storedParameters); } catch { /* preserve stored roles */ }
  }
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    sourceFileName: row.sourceFileName,
    modality: row.modality,
    executionState: row.executionState,
    currentRevision: {
      id: row.revisionId,
      workflowId: row.id,
      version: Number(row.revisionVersion),
      parentRevisionId: row.parentRevisionId,
      format: row.format,
      contentHash: row.contentHash,
      nodeCount: Number(row.nodeCount),
      parameters,
      models: models as string[],
      createdAt: row.revisionCreatedAt,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function planningRecipeFromRow(row: PlanningRecipeRow, evidenceRows: PlanningRecipeEvidenceRow[]): GenerationRecipe {
  const evidence: RecipeEvidence[] = evidenceRows.map((evidenceRow) => ({
    ...evidenceRow,
    durationMs: evidenceRow.durationMs === null ? null : Number(evidenceRow.durationMs),
  }));
  return {
    schemaVersion: "creative-studio-generation-recipe/1.0",
    id: row.id,
    name: row.name,
    description: row.description,
    projectId: row.projectId,
    worldId: row.worldId,
    mediaKind: row.mediaKind,
    workflowId: row.workflowId,
    workflowRevisionId: row.workflowRevisionId,
    modelIdentifier: row.modelIdentifier,
    promptProfile: storedJson<GenerationRecipePromptProfile>(row.promptProfileJson, {
      id: "unknown",
      version: "unknown",
      targetModel: null,
    }),
    parameters: storedJson<Record<string, WorkflowScalar>>(row.parametersJson, {}),
    sourceKinds: storedJson<GenerationRecipeSourceKind[]>(row.sourceKindsJson, []),
    intentTier: row.intentTier,
    evidence,
    evidenceSummary: summarizeRecipeEvidence(evidence),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

async function selectedPlanningDna(env: Env, ownerId: string, projectIds: string[]) {
  if (!projectIds.length) return [];
  const rows = await env.DB.prepare(`with recursive selected(id, project_id, parent_artifact_id, dna_json) as (
    select artifact.id, artifact.project_id, artifact.parent_artifact_id, artifact.dna_json
      from creative_projects project
      join creative_dna_artifacts artifact on artifact.id = project.active_dna_artifact_id
        and artifact.owner_id = project.owner_id and artifact.project_id = project.id
      where project.owner_id = ? and project.status = 'active' and project.active_dna_artifact_id is not null
        and project.id in (select value from json_each(?))
    union
    select artifact.id, artifact.project_id, artifact.parent_artifact_id, artifact.dna_json
      from selected
      join creative_dna_artifacts artifact on artifact.id = selected.parent_artifact_id
        and artifact.owner_id = ? and artifact.project_id = selected.project_id
  ) select id, project_id as projectId, dna_json as dnaJson from selected`)
    .bind(ownerId, JSON.stringify(projectIds), ownerId).all<PlanningDnaRow>();
  return (rows.results ?? []).map(planningDnaFromRow).filter((artifact): artifact is CreativeDnaArtifact => Boolean(artifact));
}

async function selectedPlanningWorkflows(env: Env, ownerId: string, projectIds: string[]) {
  if (!projectIds.length) return [];
  const rows = await env.DB.prepare(`select workflow.id, workflow.project_id as projectId, workflow.name,
    workflow.description, workflow.source_file_name as sourceFileName, workflow.modality,
    workflow.execution_state as executionState, workflow.created_at as createdAt, workflow.updated_at as updatedAt,
    revision.id as revisionId, revision.version as revisionVersion, revision.parent_revision_id as parentRevisionId,
    revision.format, revision.content_hash as contentHash, revision.graph_json as graphJson,
    revision.node_count as nodeCount, revision.parameters_json as parametersJson,
    revision.models_json as modelsJson, revision.created_at as revisionCreatedAt
    from creative_workflows workflow
    join creative_workflow_revisions revision on revision.id = workflow.current_revision_id
      and revision.workflow_id = workflow.id and revision.owner_id = workflow.owner_id
    where workflow.owner_id = ? and workflow.execution_state = 'ready'
      and workflow.modality in ('image', 'audio', 'music', 'video')
      and workflow.project_id in (select value from json_each(?))
    order by workflow.updated_at desc, workflow.id desc`)
    .bind(ownerId, JSON.stringify(projectIds)).all<PlanningWorkflowRow>();
  return (rows.results ?? []).map(planningWorkflowFromRow).filter((workflow): workflow is WorkflowDefinition => Boolean(workflow));
}

async function selectedPlanningRecipes(env: Env, ownerId: string, projectIds: string[]) {
  if (!projectIds.length) return [];
  const recipeRows = await env.DB.prepare(`select recipe.id, recipe.project_id as projectId,
    recipe.world_id as worldId, recipe.name, recipe.description, recipe.media_kind as mediaKind,
    recipe.workflow_id as workflowId, recipe.workflow_revision_id as workflowRevisionId,
    recipe.model_identifier as modelIdentifier, recipe.prompt_profile_json as promptProfileJson,
    recipe.parameters_json as parametersJson, recipe.source_kinds_json as sourceKindsJson,
    recipe.intent_tier as intentTier, recipe.created_at as createdAt, recipe.updated_at as updatedAt,
    recipe.archived_at as archivedAt
    from creative_generation_recipes recipe
    join creative_workflows workflow on workflow.id = recipe.workflow_id and workflow.owner_id = recipe.owner_id
      and workflow.current_revision_id = recipe.workflow_revision_id and workflow.execution_state = 'ready'
    where recipe.owner_id = ? and recipe.archived_at is null
      and (recipe.project_id is null or recipe.project_id = workflow.project_id)
      and workflow.project_id in (select value from json_each(?))
    order by recipe.updated_at desc, recipe.id desc`)
    .bind(ownerId, JSON.stringify(projectIds)).all<PlanningRecipeRow>();
  const rows = recipeRows.results ?? [];
  if (!rows.length) return [];
  const evidenceRows = await env.DB.prepare(`with ranked as (
    select evidence.id, evidence.recipe_id as recipeId, evidence.job_id as jobId, evidence.outcome,
      evidence.duration_ms as durationMs, evidence.failure, evidence.acceptance,
      evidence.observed_at as observedAt, evidence.created_at as createdAt,
      evidence.updated_at as updatedAt,
      row_number() over (partition by evidence.recipe_id order by evidence.observed_at desc, evidence.id desc) as rank
    from creative_generation_recipe_evidence evidence
    where evidence.owner_id = ? and evidence.recipe_id in (select value from json_each(?))
  ) select id, recipeId, jobId, outcome, durationMs, failure, acceptance, observedAt, createdAt, updatedAt
    from ranked where rank <= 10 order by recipeId, observedAt desc, id desc`)
    .bind(ownerId, JSON.stringify(rows.map((row) => row.id))).all<PlanningRecipeEvidenceRow>();
  const evidenceByRecipe = new Map<string, PlanningRecipeEvidenceRow[]>();
  for (const evidence of evidenceRows.results ?? []) {
    evidenceByRecipe.set(evidence.recipeId, [...(evidenceByRecipe.get(evidence.recipeId) ?? []), evidence]);
  }
  return rows.map((row) => planningRecipeFromRow(row, evidenceByRecipe.get(row.id) ?? []));
}

async function selectedPlanningReviews(env: Env, ownerId: string, dnaArtifactIds: string[]) {
  if (!dnaArtifactIds.length) return [];
  const rows = await env.DB.prepare(`select id, project_id as projectId, training_job_id as trainingJobId,
    dna_artifact_id as dnaArtifactId, decision, note, actor,
    active_dna_artifact_id as activeDnaArtifactId, created_at as createdAt
    from creative_dna_training_reviews
    where owner_id = ? and dna_artifact_id in (select value from json_each(?))
    order by created_at desc, rowid desc`)
    .bind(ownerId, JSON.stringify(dnaArtifactIds)).all<CreativeDnaTrainingReview>();
  return rows.results ?? [];
}

async function selectedRetainedPlanningSources(env: Env, ownerId: string, dnaArtifacts: CreativeDnaArtifact[]) {
  const sources = dnaArtifacts.flatMap((artifact) => artifact.training?.analysis.sources ?? []);
  const uploadIds = [...new Set(sources.filter((source) => source.sourceType === "upload").map((source) => source.mediaId))];
  const artifactIds = [...new Set(sources.filter((source) => source.sourceType === "accepted-artifact").map((source) => source.mediaId))];
  const rows = await env.DB.prepare(`select id, project_id as projectId, 'upload' as sourceType, kind
    from creative_media_assets where owner_id = ? and status = 'retained'
      and id in (select value from json_each(?))
    union all
    select id, project_id as projectId, 'artifact' as sourceType,
      case kind when 'music' then 'audio' else kind end as kind
    from creative_artifacts where owner_id = ? and retained_key is not null and retained_size > 0
      and id in (select value from json_each(?))`)
    .bind(ownerId, JSON.stringify(uploadIds), ownerId, JSON.stringify(artifactIds)).all<RetainedPlanningSource>();
  return new Map((rows.results ?? []).map((source) => [compatibilityKey(
    source.sourceType,
    source.projectId,
    source.id,
    source.kind,
  ), source]));
}

function mergeByKey<T>(preferred: T[], supplemental: T[], key: (item: T) => string) {
  return [...new Map([...supplemental, ...preferred].map((item) => [key(item), item])).values()];
}

async function loadPlanningEvidenceCatalog(env: Env, ownerId: string, requestedProjectId: string | null = null) {
  const [projects, recentDna, artifacts, acceptances, recentTrainingReviews, worldRecords, recent] = await Promise.all([
    listProjects(env, ownerId),
    listLocalDna(env, ownerId),
    listArtifacts(env, ownerId),
    listAcceptances(env, ownerId),
    listCreativeDnaTrainingReviews(env, ownerId),
    listWorldRecords(env, ownerId),
    listStoryBank(env, ownerId, requestedProjectId, 60),
  ]);
  const activeProjectIds = projects.filter((project) => project.status === "active" && project.activeDnaArtifactId)
    .filter((project) => !requestedProjectId || project.id === requestedProjectId)
    .map((project) => project.id);
  const [selectedDna, tasteSignalDna, workflows, recipes] = await Promise.all([
    selectedPlanningDna(env, ownerId, activeProjectIds),
    planningDnaByIds(env, ownerId, [
      ...artifacts.map((artifact) => artifact.dnaArtifactId),
      ...recentTrainingReviews.map((review) => review.dnaArtifactId),
    ]),
    selectedPlanningWorkflows(env, ownerId, activeProjectIds),
    selectedPlanningRecipes(env, ownerId, activeProjectIds),
  ]);
  const [retainedSources, selectedTrainingReviews] = await Promise.all([
    selectedRetainedPlanningSources(env, ownerId, selectedDna),
    selectedPlanningReviews(env, ownerId, selectedDna.map((artifact) => artifact.artifactId)),
  ]);
  return {
    dnaArtifacts: mergeByKey(selectedDna,
      mergeByKey(tasteSignalDna, recentDna, (artifact) => artifact.artifactId),
      (artifact) => artifact.artifactId),
    retainedSources,
    artifacts,
    acceptances,
    trainingReviews: mergeByKey(selectedTrainingReviews, recentTrainingReviews, (review) => review.id),
    projects,
    workflows,
    recipes,
    worldRecords,
    recent,
  };
}

type PlanningEvidenceCatalog = Awaited<ReturnType<typeof loadPlanningEvidenceCatalog>>;

async function planningEvidence(
  env: Env,
  ownerId: string,
  projectId: string,
  suppliedCatalog?: PlanningEvidenceCatalog,
) {
  const catalog = suppliedCatalog ?? await loadPlanningEvidenceCatalog(env, ownerId, projectId);
  const { dnaArtifacts, retainedSources, artifacts, acceptances, trainingReviews, projects, workflows, recipes, worldRecords } = catalog;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const recentStories = catalog.recent.storyThreads.filter((story) => story.projectId === projectId).slice(0, 12);
  if (!project || project.status !== "active" || !project.activeDnaArtifactId) throw new Error("story_bank_project_not_ready");
  const dna = dnaArtifacts.find((item) => item.artifactId === project.activeDnaArtifactId && item.projectId === project.id);
  if (!dna) throw new Error("story_bank_analyzed_sources_required");
  const dnaById = new Map(dnaArtifacts.filter((item) => item.projectId === project.id).map((item) => [item.artifactId, item]));
  let evidenceDna: typeof dna | null = dna;
  const visitedDna = new Set<string>();
  while (evidenceDna && !evidenceDna.training?.analysis.sources.length) {
    if (visitedDna.has(evidenceDna.artifactId)) throw new Error("story_bank_dna_lineage_invalid");
    visitedDna.add(evidenceDna.artifactId);
    evidenceDna = evidenceDna.lineage.parentArtifactId ? dnaById.get(evidenceDna.lineage.parentArtifactId) ?? null : null;
  }
  if (!evidenceDna?.training?.analysis.sources.length || evidenceDna.rights.referenceStoredAsProvenanceOnly) {
    throw new Error("story_bank_analyzed_sources_required");
  }
  if (evidenceDna.training) {
    const latestReview = trainingReviews.filter((review) => review.dnaArtifactId === evidenceDna!.artifactId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
    if (latestReview?.decision !== "approved") throw new Error("training_review_required");
  }
  const plannerSources: StoryPlannerSource[] = [];
  for (const [index, source] of evidenceDna.training.analysis.sources.entries()) {
    if (!source.detailedDescription) continue;
    const sourceType = source.sourceType === "accepted-artifact" ? "artifact" as const : "upload" as const;
    const retained = retainedSources.get(compatibilityKey(sourceType, project.id, source.mediaId, source.kind));
    if (!retained) continue;
    const summaries = creativeDnaDescriptionSummaries(source.detailedDescription);
    plannerSources.push({
      id: source.mediaId,
      sourceType,
      kind: source.kind,
      name: `${source.kind} source ${index + 1}`,
      shortSummary: summaries.shortSummary,
      longSummary: summaries.longSummary,
    });
  }
  if (!plannerSources.length) throw new Error("story_bank_analyzed_sources_required");

  const activeWorlds = worldRecords.worlds.filter((world) => world.projectId === project.id && world.status === "active")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const world = activeWorlds[0] ?? null;
  const commercialReferences = worldRecords.canonReferences.filter((reference) => reference.projectId === project.id
    && reference.status !== "retired" && reference.source.kind === "commercial-reference");
  const protectedIdentities = [
    dna.source.kind === "commercial_reference" ? dna.source.referenceLabel ?? "" : "",
    evidenceDna.source.kind === "commercial_reference" ? evidenceDna.source.referenceLabel ?? "" : "",
    ...commercialReferences.map((reference) => reference.source.kind === "commercial-reference" ? reference.source.identity : ""),
  ].filter(Boolean);
  const tasteMemory = compileCreativeTasteMemory({ projects, artifacts, acceptances, trainingReviews, dnaArtifacts });
  const projectTaste = tasteMemory.projects[project.id]?.taste;
  const tasteTexts = (kind: "preserve" | "redirect" | "avoid") => [
    ...(projectTaste?.[kind] ?? []),
    ...tasteMemory.personal[kind],
  ].filter((signal) => signal.providerPromptEligible).map((signal) => signal.text)
    .filter((text, index, all) => all.indexOf(text) === index).slice(0, 8);

  const context: StoryPlannerContext = sanitizeContext({
    project: { name: project.name, description: project.description, currentDirection: project.note },
    creativeDna: {
      name: dna.name,
      directive: dna.source.directive,
      dimensions: dna.shared,
      imageLanguage: dna.generationPrompts.image,
      musicLanguage: dna.generationPrompts.music,
    },
    world: world ? {
      name: world.name,
      premise: world.premise,
      rules: worldRecords.continuityRules.filter((rule) => rule.worldId === world.id && rule.status === "active")
        .map((rule) => `${rule.strength} ${rule.facet}: ${rule.instruction}`).slice(0, 24),
      canonNotes: worldRecords.worldEntities.filter((entity) => entity.worldId === world.id && entity.status === "active")
        .flatMap((entity) => [entity.summary, ...entity.attributes.map((attribute) => `${attribute.facet}: ${attribute.value}`)])
        .filter(Boolean).slice(0, 32),
    } : null,
    sources: plannerSources.slice(0, 6),
    taste: { preserve: tasteTexts("preserve"), redirect: tasteTexts("redirect"), avoid: tasteTexts("avoid") },
    recentStories: recentStories.map((story) => ({
      role: story.recommendations[0]?.role ?? "signature",
      title: story.title,
      logline: story.logline,
    })),
  }, protectedIdentities);

  const projectWorkflows = workflows.filter((workflow) => workflow.projectId === project.id
    && workflow.executionState === "ready" && modalityForWorkflow(workflow.modality)
    && generationWorkflowPromptParameters(workflow.currentRevision.parameters).length);
  const workflowSelections: StoryPlannerWorkflow[] = [];
  for (const modality of ["image", "video", "music"] as GenerationModality[]) {
    const candidates = projectWorkflows.filter((workflow) => modalityForWorkflow(workflow.modality) === modality);
    const matchingRecipes = recipes.filter((recipe) => !recipe.archivedAt && recipe.mediaKind === modality
      && (!recipe.projectId || recipe.projectId === project.id)
      && (!recipe.worldId || recipe.worldId === world?.id)
      && candidates.some((workflow) => workflow.id === recipe.workflowId && workflow.currentRevision.id === recipe.workflowRevisionId))
      .sort((left, right) => (right.evidenceSummary.completed - left.evidenceSummary.completed)
        || ((left.evidenceSummary.medianDurationMs ?? Number.MAX_SAFE_INTEGER) - (right.evidenceSummary.medianDurationMs ?? Number.MAX_SAFE_INTEGER))
        || right.updatedAt.localeCompare(left.updatedAt));
    const recipe = matchingRecipes[0] ?? null;
    const workflow = recipe
      ? candidates.find((item) => item.id === recipe.workflowId && item.currentRevision.id === recipe.workflowRevisionId) ?? null
      : candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
    if (!workflow) throw new Error("story_bank_workflows_required");
    const supportedSources = new Set(sourceKinds(workflow));
    const source = modality === "music"
      ? plannerSources.find((item) => item.kind === "image") ?? plannerSources[0] ?? null
      : plannerSources.find((item) => item.kind === "image" && supportedSources.has("image")) ?? null;
    let promptProfileId: string | null = recipe?.promptProfile.id ?? null;
    let promptOutputFormat: string | null = null;
    let modelTarget = recipe?.promptProfile.targetModel ?? recipe?.modelIdentifier ?? workflow.currentRevision.models[0] ?? workflow.name;
    let durationSeconds: number | null = null;
    if (modality === "video") {
      const profile = videoWorkflowPromptProfile(workflow, source ? "image-to-video" : "text-to-video");
      promptProfileId = profile.id;
      promptOutputFormat = profile.outputFormat;
      modelTarget = profile.targetModel;
      durationSeconds = normalizeVideoDurationSeconds(videoWorkflowDurationParameters(workflow.currentRevision.parameters)[0]?.value);
    } else if (modality === "music") {
      const profile = musicWorkflowPromptProfile(workflow);
      promptProfileId = profile.id;
      promptOutputFormat = profile.outputFormat;
      modelTarget = profile.targetModel;
    }
    workflowSelections.push({
      modality,
      workflowId: workflow.id,
      workflowRevisionId: workflow.currentRevision.id,
      recipeId: recipe?.id ?? null,
      modelTarget,
      promptProfileId,
      promptOutputFormat,
      sourceId: source?.id ?? null,
      sourceType: source?.sourceType ?? null,
      sourceKind: source?.kind ?? null,
      durationSeconds,
      aspectRatio: aspectRatioForWorkflow(workflow),
      estimatedDurationMs: recipe?.evidenceSummary.medianDurationMs ?? null,
    });
  }
  const sourceRefs = plannerSources.map(({ id: sourceId, sourceType, kind }) => ({ id: sourceId, sourceType, kind }));
  const fingerprint = await digest(JSON.stringify({
    project: { id: project.id, updatedAt: project.updatedAt },
    dna: { id: dna.artifactId, version: dna.version },
    evidenceDna: { id: evidenceDna.artifactId, version: evidenceDna.version },
    world: world ? { id: world.id, version: world.version, updatedAt: world.updatedAt } : null,
    sources: sourceRefs,
    taste: context.taste,
    workflows: workflowSelections.map((item) => ({ modality: item.modality, revision: item.workflowRevisionId, recipe: item.recipeId })),
  }));
  return { project, dna, world, context, workflowSelections, sourceRefs, fingerprint };
}

async function insertRefresh(
  env: Env,
  ownerId: string,
  evidence: Awaited<ReturnType<typeof planningEvidence>>,
  trigger: StoryBankRefresh["trigger"],
  idempotencyKey: string,
) {
  const existing = await env.DB.prepare(`select ${REFRESH_COLUMNS} from creative_story_refreshes where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, idempotencyKey).first<StoryRefreshRow>();
  if (existing) return publicRefresh(existing);
  const active = await env.DB.prepare(`select ${REFRESH_COLUMNS} from creative_story_refreshes where owner_id = ? and project_id = ?
    and status in ('waiting-for-runner', 'running') order by created_at desc limit 1`)
    .bind(ownerId, evidence.project.id).first<StoryRefreshRow>();
  if (active) return publicRefresh(active);
  const refreshId = id("storyplan");
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(`insert into creative_story_refreshes (
      id, owner_id, project_id, dna_artifact_id, world_id, evidence_fingerprint, trigger,
      source_refs_json, planner_context_json, workflows_json, status, planner_provider,
      idempotency_key, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting-for-runner', 'local-comfyui', ?, ?, ?)`)
      .bind(refreshId, ownerId, evidence.project.id, evidence.dna.artifactId, evidence.world?.id ?? null,
        evidence.fingerprint, trigger, JSON.stringify(evidence.sourceRefs), JSON.stringify(evidence.context),
        JSON.stringify(evidence.workflowSelections), idempotencyKey, now, now).run();
  } catch (error) {
    const raced = await env.DB.prepare(`select ${REFRESH_COLUMNS} from creative_story_refreshes where owner_id = ? and project_id = ?
      and status in ('waiting-for-runner', 'running') order by created_at desc limit 1`)
      .bind(ownerId, evidence.project.id).first<StoryRefreshRow>();
    if (raced) return publicRefresh(raced);
    throw error;
  }
  const row = await refreshRowById(env, ownerId, refreshId);
  if (!row) throw new Error("story_bank_refresh_not_found");
  return publicRefresh(row);
}

export async function createStoryBankRefresh(env: Env, ownerId: string, input: RefreshStoryBankRequest) {
  const projectId = boundedText(input.projectId, 100);
  const idempotencyKey = boundedText(input.idempotencyKey, 100);
  if (!projectId || !/^[a-z0-9_-]{8,100}$/i.test(idempotencyKey)) throw new Error("invalid_story_bank_refresh");
  const evidence = await planningEvidence(env, ownerId, projectId);
  return insertRefresh(env, ownerId, evidence, "manual", idempotencyKey);
}

const STORY_AUTOMATIC_SCAN_INTERVAL_MS = 8 * 60 * 60_000;
const STORY_TRANSIENT_RETRY_MS = 15 * 60_000;

type StorySchedulerRow = {
  nextScanAt: string;
  transientRetryAt: string | null;
  lastScannedAt: string | null;
  evidenceHighWatermark: string | null;
};

type StoryEvidenceHighWaterRow = {
  projects: string;
  dna: string;
  media: string;
  artifacts: string;
  acceptances: string;
  trainingReviews: string;
  workflows: string;
  recipes: string;
  recipeEvidence: string;
  worlds: string;
  worldEntities: string;
  continuityRules: string;
  canonReferences: string;
  canonPromotions: string;
};

function transientStoryPlanningFailure(error: string | null) {
  return /(?:timeout|timed_out|temporar|unreachable|unresponsive|connection|network|runner|comfyui.*(?:busy|offline|queue))/i.test(error ?? "");
}

async function storyEvidenceHighWatermark(env: Env, ownerId: string) {
  // This fixed-size query runs only after the durable eight-hour gate. It
  // returns one row rather than hydrating hundreds of owner records merely to
  // discover that nothing relevant changed.
  const row = await env.DB.prepare(`select
    coalesce((select max(updated_at) from creative_projects where owner_id = ?), '') as projects,
    coalesce((select max(created_at) from creative_dna_artifacts where owner_id = ?), '') as dna,
    coalesce((select max(updated_at) from creative_media_assets where owner_id = ?), '') as media,
    coalesce((select max(updated_at) from creative_artifacts where owner_id = ?), '') as artifacts,
    coalesce((select max(created_at) from creative_acceptances where owner_id = ?), '') as acceptances,
    coalesce((select max(created_at) from creative_dna_training_reviews where owner_id = ?), '') as trainingReviews,
    coalesce((select max(updated_at) from creative_workflows where owner_id = ?), '') as workflows,
    coalesce((select max(updated_at) from creative_generation_recipes where owner_id = ?), '') as recipes,
    coalesce((select max(updated_at) from creative_generation_recipe_evidence where owner_id = ?), '') as recipeEvidence,
    coalesce((select max(updated_at) from creative_worlds where owner_id = ?), '') as worlds,
    coalesce((select max(updated_at) from creative_world_entities where owner_id = ?), '') as worldEntities,
    coalesce((select max(updated_at) from creative_continuity_rules where owner_id = ?), '') as continuityRules,
    coalesce((select max(updated_at) from creative_canon_references where owner_id = ?), '') as canonReferences,
    coalesce((select max(promoted_at) from creative_canon_promotions where owner_id = ?), '') as canonPromotions`)
    .bind(...Array.from({ length: 14 }, () => ownerId)).first<StoryEvidenceHighWaterRow>();
  return digest(JSON.stringify(row ?? {}));
}

async function claimAutomaticStoryScan(env: Env, ownerId: string) {
  const now = new Date();
  const nowValue = now.toISOString();
  let state = await env.DB.prepare(`select next_scan_at as nextScanAt, transient_retry_at as transientRetryAt,
    last_scanned_at as lastScannedAt, evidence_high_watermark as evidenceHighWatermark
    from creative_story_scheduler_state where owner_id = ?`)
    .bind(ownerId).first<StorySchedulerRow>();
  if (!state) {
    await env.DB.prepare(`insert or ignore into creative_story_scheduler_state
      (owner_id, next_scan_at, transient_retry_at, last_scanned_at, evidence_high_watermark, updated_at)
      values (?, ?, null, null, null, ?)`)
      .bind(ownerId, nowValue, nowValue).run();
    state = await env.DB.prepare(`select next_scan_at as nextScanAt, transient_retry_at as transientRetryAt,
      last_scanned_at as lastScannedAt, evidence_high_watermark as evidenceHighWatermark
      from creative_story_scheduler_state where owner_id = ?`)
      .bind(ownerId).first<StorySchedulerRow>();
  }
  if (!state) return null;
  const dueAt = new Date(state.nextScanAt).getTime();
  if (Number.isFinite(dueAt) && dueAt > now.getTime()) return null;
  const nextScanAt = new Date(now.getTime() + STORY_AUTOMATIC_SCAN_INTERVAL_MS).toISOString();
  const claimed = await env.DB.prepare(`update creative_story_scheduler_state set next_scan_at = ?, updated_at = ?
    where owner_id = ? and next_scan_at = ?`)
    .bind(nextScanAt, nowValue, ownerId, state.nextScanAt).run();
  return claimed.meta.changes ? { ...state, claimedNextScanAt: nextScanAt, claimedAt: nowValue } : null;
}

async function finishAutomaticStoryScan(
  env: Env,
  ownerId: string,
  scan: NonNullable<Awaited<ReturnType<typeof claimAutomaticStoryScan>>>,
  evidenceHighWatermark: string | null,
  transientRetryAt: string | null,
) {
  await env.DB.prepare(`update creative_story_scheduler_state set last_scanned_at = ?,
    evidence_high_watermark = coalesce(?, evidence_high_watermark), transient_retry_at = ?,
    next_scan_at = case when ? is not null and ? < next_scan_at then ? else next_scan_at end,
    updated_at = ?
    where owner_id = ? and next_scan_at = ?`)
    .bind(scan.claimedAt, evidenceHighWatermark, transientRetryAt,
      transientRetryAt, transientRetryAt, transientRetryAt,
      new Date().toISOString(), ownerId, scan.claimedNextScanAt).run();
}

async function scheduleAutomaticStoryRetry(env: Env, ownerId: string) {
  const now = new Date();
  const retryAt = new Date(now.getTime() + STORY_TRANSIENT_RETRY_MS).toISOString();
  const nowValue = now.toISOString();
  await env.DB.prepare(`insert into creative_story_scheduler_state
    (owner_id, next_scan_at, transient_retry_at, last_scanned_at, evidence_high_watermark, updated_at)
    values (?, ?, ?, null, null, ?)
    on conflict(owner_id) do update set
      next_scan_at = case when creative_story_scheduler_state.next_scan_at > excluded.next_scan_at
        then excluded.next_scan_at else creative_story_scheduler_state.next_scan_at end,
      transient_retry_at = case
        when creative_story_scheduler_state.transient_retry_at is null
          or creative_story_scheduler_state.transient_retry_at > excluded.transient_retry_at
        then excluded.transient_retry_at else creative_story_scheduler_state.transient_retry_at end,
      updated_at = excluded.updated_at`)
    .bind(ownerId, retryAt, retryAt, nowValue).run();
}

function earlierRetryAt(current: string | null, candidate: string) {
  return !current || candidate < current ? candidate : current;
}

async function latestRefreshesForEvidence(
  env: Env,
  ownerId: string,
  evidence: Array<Awaited<ReturnType<typeof planningEvidence>>>,
) {
  if (!evidence.length) return new Map<string, StoryRefreshRow>();
  const requested = evidence.map((item) => ({ projectId: item.project.id, fingerprint: item.fingerprint }));
  const rows = await env.DB.prepare(`with requested as (
    select json_extract(value, '$.projectId') as project_id,
      json_extract(value, '$.fingerprint') as evidence_fingerprint
    from json_each(?)
  ), ranked as (
    select refresh.*, row_number() over (
      partition by refresh.project_id, refresh.evidence_fingerprint
      order by refresh.created_at desc, refresh.id desc
    ) as evidence_rank
    from creative_story_refreshes refresh
    join requested on requested.project_id = refresh.project_id
      and requested.evidence_fingerprint = refresh.evidence_fingerprint
    where refresh.owner_id = ?
  ) select ${REFRESH_COLUMNS} from ranked where evidence_rank = 1`)
    .bind(JSON.stringify(requested), ownerId).all<StoryRefreshRow>();
  return new Map((rows.results ?? []).map((row) => [compatibilityKey(row.projectId, row.evidenceFingerprint), row]));
}

export async function ensureAutomaticStoryRefresh(env: Env, ownerId: string) {
  const scan = await claimAutomaticStoryScan(env, ownerId);
  if (!scan) return null;
  const highWatermark = await storyEvidenceHighWatermark(env, ownerId);
  const scanTime = new Date(scan.claimedAt).getTime();
  const scheduledRetryTime = new Date(scan.transientRetryAt ?? "").getTime();
  const transientRetryDue = Number.isFinite(scheduledRetryTime) && scheduledRetryTime <= scanTime;
  if (scan.evidenceHighWatermark === highWatermark && !transientRetryDue) {
    await finishAutomaticStoryScan(env, ownerId, scan, highWatermark,
      Number.isFinite(scheduledRetryTime) && scheduledRetryTime > scanTime ? scan.transientRetryAt : null);
    return null;
  }

  const catalog = await loadPlanningEvidenceCatalog(env, ownerId);
  const projects = catalog.projects.filter((project) => project.status === "active" && project.activeDnaArtifactId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  let scanComplete = true;
  let nextTransientRetryAt: string | null = null;
  const evidenceByProject = new Map<string, Awaited<ReturnType<typeof planningEvidence>>>();
  for (const project of projects) {
    try {
      evidenceByProject.set(project.id, await planningEvidence(env, ownerId, project.id, catalog));
    } catch {
      scanComplete = false;
    }
  }
  const plannedEvidence = [...evidenceByProject.values()];
  const latestByEvidence = await latestRefreshesForEvidence(env, ownerId, plannedEvidence);
  let firstRefresh: StoryBankRefresh | null = null;
  for (const evidence of plannedEvidence) {
    const latest = latestByEvidence.get(compatibilityKey(evidence.project.id, evidence.fingerprint)) ?? null;
    if (latest) {
      if (latest.status !== "failed") continue;
      const transient = transientStoryPlanningFailure(latest.error);
      const retryAt = new Date(latest.updatedAt).getTime() + STORY_TRANSIENT_RETRY_MS;
      if (!transient || !Number.isFinite(retryAt)) continue;
      if (retryAt > scanTime) {
        nextTransientRetryAt = earlierRetryAt(nextTransientRetryAt, new Date(retryAt).toISOString());
        continue;
      }
      const now = new Date().toISOString();
      const retried = await env.DB.prepare(`update creative_story_refreshes set status = 'waiting-for-runner',
        runner_id = null, runner_lease_until = null, planner_model = null, comfy_prompt_id = null,
        error = null, started_at = null, completed_at = null, updated_at = ?
        where id = ? and owner_id = ? and status = 'failed' and updated_at = ?`)
        .bind(now, latest.id, ownerId, latest.updatedAt).run();
      if (retried.meta.changes) {
        const row = await refreshRowById(env, ownerId, latest.id);
        if (!firstRefresh && row) firstRefresh = publicRefresh(row);
      }
      continue;
    }
    const inserted = await insertRefresh(env, ownerId, evidence, "automatic", `story_auto_${evidence.fingerprint}`.slice(0, 100));
    if (!firstRefresh) firstRefresh = inserted;
  }
  await finishAutomaticStoryScan(env, ownerId, scan, scanComplete ? highWatermark : null, nextTransientRetryAt);
  return firstRefresh;
}

function plannerBundle(row: StoryRefreshRow): StoryPlannerBundle {
  return {
    refresh: publicRefresh(row),
    context: storedJson<StoryPlannerContext>(row.plannerContextJson, {
      project: { name: "", description: "", currentDirection: "" },
      creativeDna: { name: "", directive: "", dimensions: {}, imageLanguage: "", musicLanguage: "" },
      world: null,
      sources: [],
      taste: { preserve: [], redirect: [], avoid: [] },
      recentStories: [],
    }),
    workflows: storedJson<StoryPlannerWorkflow[]>(row.workflowsJson, []),
  };
}

export async function claimStoryPlan(env: Env, runner: RunnerIdentity) {
  const now = new Date();
  const nowValue = now.toISOString();
  const candidate = await env.DB.prepare(`select ${REFRESH_COLUMNS} from creative_story_refreshes
    where owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)
    order by case when status = 'running' and runner_id = ? then 0 else 1 end, created_at limit 1`)
    .bind(runner.ownerId, nowValue, runner.id, runner.id).first<StoryRefreshRow>();
  if (!candidate) return null;
  const leaseUntil = new Date(now.getTime() + 2 * 60_000).toISOString();
  const changed = await env.DB.prepare(`update creative_story_refreshes set status = 'running', runner_id = ?,
    runner_lease_until = ?, error = null, started_at = coalesce(started_at, ?), updated_at = ?
    where id = ? and owner_id = ? and status in ('waiting-for-runner', 'running')
      and (runner_lease_until is null or runner_lease_until <= ? or runner_id = ?)`)
    .bind(runner.id, leaseUntil, nowValue, nowValue, candidate.id, runner.ownerId, nowValue, runner.id).run();
  if (!changed.meta.changes) return null;
  return plannerBundle({ ...candidate, status: "running", runnerId: runner.id, runnerLeaseUntil: leaseUntil,
    startedAt: candidate.startedAt ?? nowValue, updatedAt: nowValue });
}

export async function heartbeatStoryPlan(env: Env, runner: RunnerIdentity, refreshId: string, input: StoryPlanHeartbeatRequest) {
  const progress = Number(input.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) throw new Error("story_plan_not_completable");
  const now = new Date();
  const changed = await env.DB.prepare(`update creative_story_refreshes set runner_lease_until = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(new Date(now.getTime() + 2 * 60_000).toISOString(), now.toISOString(), boundedText(refreshId, 100), runner.ownerId, runner.id).run();
  if (!changed.meta.changes) throw new Error("story_plan_not_completable");
  const row = await refreshRowById(env, runner.ownerId, refreshId);
  if (!row) throw new Error("story_bank_refresh_not_found");
  return publicRefresh(row);
}

function containsIdentity(value: string, identities: string[]) {
  return identities.some((identity) => identity && redacted(value, [identity], value.length + 1) !== boundedText(value, value.length + 1));
}

function assertStoryPlanMatchesWorkflowProfiles(plan: StoryPlan, workflows: StoryPlannerWorkflow[]) {
  const video = workflows.find((item) => item.modality === "video");
  const music = workflows.find((item) => item.modality === "music");
  if (!video || !music) throw new Error("story_plan_workflows_invalid");
  for (const story of plan.stories) {
    if (/^(?:create|generate|prompt)\b/i.test(story.image.prompt)) throw new Error("story_plan_image_format_invalid");
    if (video.promptOutputFormat === "minimax-h3-timeline") {
      const lines = story.video.prompt.split("\n").map((line) => line.trim()).filter(Boolean);
      const audioLines = lines.filter((line) => /^Audio:/i.test(line));
      if (!/^SHOT 1\b/i.test(lines[0] ?? "") || audioLines.length !== 1 || lines.at(-1) !== audioLines[0]) {
        throw new Error("story_plan_video_format_invalid");
      }
    }
    if (music.promptOutputFormat === "structured-caption"
      && !/^### Global Metadata\s*\n[\s\S]+?^### Vocal Details\s*\n[\s\S]+?^### Arrangement\s*\n/im.test(story.music.prompt)) {
      throw new Error("story_plan_music_format_invalid");
    }
  }
}

export async function completeStoryPlan(env: Env, runner: RunnerIdentity, refreshId: string, input: CompleteStoryPlanRequest) {
  const current = await refreshRowById(env, runner.ownerId, refreshId);
  if (!current) throw new Error("story_bank_refresh_not_found");
  if (current.status === "completed") return publicRefresh(current);
  if (current.status !== "running" || current.runnerId !== runner.id) throw new Error("story_plan_not_completable");
  const plan = normalizeStoryPlan(input.plan);
  const plannerModel = boundedText(input.plannerModel, 180);
  const comfyPromptId = boundedText(input.comfyPromptId, 120);
  if (!plannerModel || !comfyPromptId) throw new Error("story_plan_result_invalid");
  const dna = await planningDnaById(env, runner.ownerId, current.dnaArtifactId);
  const worldRecords = await listWorldRecords(env, runner.ownerId);
  const protectedIdentities = [
    dna?.source.kind === "commercial_reference" ? dna.source.referenceLabel ?? "" : "",
    ...worldRecords.canonReferences.filter((reference) => reference.projectId === current.projectId
      && reference.source.kind === "commercial-reference")
      .map((reference) => reference.source.kind === "commercial-reference" ? reference.source.identity : ""),
  ].filter(Boolean);
  const allText = plan.stories.flatMap((story) => [story.title, story.logline, story.image.prompt, story.video.prompt, story.music.prompt]).join("\n");
  if (containsIdentity(allText, protectedIdentities)) throw new Error("continuity_commercial_identity_in_prompt");
  if (/\b(?:as an ai|language model|workflow id|model path|comfyui|schemaVersion|json object)\b/i.test(allText)) {
    throw new Error("story_plan_metadata_leak");
  }
  const workflows = storedJson<StoryPlannerWorkflow[]>(current.workflowsJson, []);
  if (workflows.length !== 3 || new Set(workflows.map((item) => item.modality)).size !== 3) throw new Error("story_plan_workflows_invalid");
  assertStoryPlanMatchesWorkflowProfiles(plan, workflows);
  const sourceRefs = storedJson<StorySourceRef[]>(current.sourceRefsJson, []);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const story of plan.stories) {
    const storyId = id("story");
    statements.push(env.DB.prepare(`insert into creative_story_threads (
      id, owner_id, project_id, refresh_id, world_id, dna_artifact_id, title, logline, status,
      pinned, version, source_refs_json, evidence_fingerprint, planner_provider, planner_model, created_at, updated_at
    ) select ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', 0, 1, ?, ?, 'local-comfyui', ?, ?, ?
      where exists (select 1 from creative_story_refreshes where id = ? and owner_id = ? and runner_id = ? and status = 'running')`)
      .bind(storyId, runner.ownerId, current.projectId, current.id, current.worldId, current.dnaArtifactId,
        story.title, story.logline, JSON.stringify(sourceRefs), current.evidenceFingerprint, plannerModel, now, now,
        current.id, runner.ownerId, runner.id));
    for (const modality of ["image", "video", "music"] as GenerationModality[]) {
      const recommendation = story[modality];
      const workflow = workflows.find((item) => item.modality === modality);
      if (!workflow) throw new Error("story_plan_workflows_invalid");
      const promptHash = await digest(recommendation.prompt);
      statements.push(env.DB.prepare(`insert into creative_story_recommendations (
        id, owner_id, project_id, refresh_id, story_id, version, modality, role, title, prompt, prompt_hash,
        source_id, source_type, source_kind, workflow_id, workflow_revision_id, recipe_id, model_target,
        duration_seconds, aspect_ratio, estimated_duration_ms, status, created_at, updated_at
      ) select ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?
        where exists (select 1 from creative_story_refreshes where id = ? and owner_id = ? and runner_id = ? and status = 'running')`)
        .bind(id("storyprompt"), runner.ownerId, current.projectId, current.id, storyId, modality, story.role,
          recommendation.title, recommendation.prompt, promptHash, workflow.sourceId, workflow.sourceType,
          workflow.sourceKind, workflow.workflowId, workflow.workflowRevisionId, workflow.recipeId,
          workflow.modelTarget, workflow.durationSeconds, workflow.aspectRatio, workflow.estimatedDurationMs,
          now, now, current.id, runner.ownerId, runner.id));
    }
  }
  statements.push(env.DB.prepare(`update creative_story_refreshes set status = 'completed', planner_model = ?,
    comfy_prompt_id = ?, runner_lease_until = null, error = null, completed_at = ?, updated_at = ?
    where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(plannerModel, comfyPromptId, now, now, current.id, runner.ownerId, runner.id));
  const results = await env.DB.batch(statements);
  if (results.some((result) => !result.meta.changes)) throw new Error("story_plan_not_completable");
  const completed = await refreshRowById(env, runner.ownerId, refreshId);
  if (!completed) throw new Error("story_bank_refresh_not_found");
  return publicRefresh(completed);
}

export async function failStoryPlan(env: Env, runner: RunnerIdentity, refreshId: string, input: FailStoryPlanRequest) {
  const error = boundedText(input.error, 500) || "story_planning_failed";
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_story_refreshes set status = 'failed', error = ?,
    runner_lease_until = null, completed_at = ?, updated_at = ? where id = ? and owner_id = ? and runner_id = ? and status = 'running'`)
    .bind(error, now, now, boundedText(refreshId, 100), runner.ownerId, runner.id).run();
  if (!changed.meta.changes) throw new Error("story_plan_not_completable");
  if (transientStoryPlanningFailure(error)) await scheduleAutomaticStoryRetry(env, runner.ownerId);
  const row = await refreshRowById(env, runner.ownerId, refreshId);
  if (!row) throw new Error("story_bank_refresh_not_found");
  return publicRefresh(row);
}

export async function updateStoryThread(env: Env, ownerId: string, storyId: string, input: UpdateStoryThreadRequest) {
  const expectedVersion = Number(input.expectedVersion);
  const statuses = new Set<StoryThreadStatus>(["suggested", "developing", "parked", "archived"]);
  const status = input.status === undefined ? null : input.status;
  const pinned = input.pinned === undefined ? null : Boolean(input.pinned);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || (status !== null && !statuses.has(status))) {
    throw new Error("invalid_story_thread_update");
  }
  if (status === null && pinned === null) throw new Error("invalid_story_thread_update");
  const now = new Date().toISOString();
  const changed = await env.DB.prepare(`update creative_story_threads set status = coalesce(?, status),
    pinned = coalesce(?, pinned), version = version + 1, updated_at = ?
    where id = ? and owner_id = ? and version = ?`)
    .bind(status, pinned === null ? null : pinned ? 1 : 0, now, boundedText(storyId, 100), ownerId, expectedVersion).run();
  if (!changed.meta.changes) throw new Error("story_thread_version_conflict");
  const story = await storyThreadById(env, ownerId, storyId);
  if (!story) throw new Error("story_thread_not_found");
  return story;
}

type RecommendationUseRow = RecommendationRow & {
  storyVersion: number;
  storyTitle: string;
  storyDnaArtifactId: string;
  storyEvidenceFingerprint: string;
  plannerProvider: "local-comfyui";
  plannerModel: string;
};

export async function storyRecommendationStampForJob(env: Env, ownerId: string, input: {
  projectId: string;
  dnaArtifactId: string;
  modality: GenerationModality;
  prompt: string;
  workflowId: string;
  workflowRevisionId: string;
  selection: StoryRecommendationSelection;
}): Promise<StoryRecommendationStamp> {
  const selection = input.selection;
  if (selection.schemaVersion !== STORY_SELECTION_SCHEMA_VERSION
    || !Number.isInteger(selection.storyVersion) || selection.storyVersion < 1
    || !Number.isInteger(selection.recommendationVersion) || selection.recommendationVersion < 1
    || selection.modality !== input.modality
    || !["faithful", "signature", "frontier", "awe"].includes(selection.role)
    || !/^[a-f0-9]{64}$/i.test(selection.promptHash)) throw new Error("invalid_story_recommendation_selection");
  const row = await env.DB.prepare(`select ${JOINED_RECOMMENDATION_COLUMNS}, s.version as storyVersion,
    s.title as storyTitle, s.dna_artifact_id as storyDnaArtifactId,
    s.evidence_fingerprint as storyEvidenceFingerprint, s.planner_provider as plannerProvider,
    s.planner_model as plannerModel from creative_story_recommendations r
    join creative_story_threads s on s.id = r.story_id and s.owner_id = r.owner_id
    where r.id = ? and r.story_id = ? and r.owner_id = ? and r.project_id = ?`)
    .bind(boundedText(selection.recommendationId, 100), boundedText(selection.storyId, 100), ownerId, input.projectId)
    .first<RecommendationUseRow>();
  if (!row) throw new Error("story_recommendation_not_found");
  if (Number(row.storyVersion) !== selection.storyVersion || Number(row.version) !== selection.recommendationVersion
    || row.role !== selection.role || row.modality !== selection.modality || row.promptHash !== selection.promptHash
    || row.status === "dismissed" || row.workflowId !== input.workflowId) {
    throw new Error("story_recommendation_changed");
  }
  if (row.storyDnaArtifactId !== input.dnaArtifactId) {
    const ancestor = await env.DB.prepare(`with recursive ancestry(id, parent_artifact_id) as (
      select id, parent_artifact_id from creative_dna_artifacts
        where id = ? and owner_id = ? and project_id = ?
      union all
      select artifact.id, artifact.parent_artifact_id from creative_dna_artifacts artifact
        join ancestry on artifact.id = ancestry.parent_artifact_id
        where artifact.owner_id = ? and artifact.project_id = ?
    ) select id from ancestry where id = ? limit 1`)
      .bind(input.dnaArtifactId, ownerId, input.projectId, ownerId, input.projectId, row.storyDnaArtifactId)
      .first<{ id: string }>();
    if (!ancestor) throw new Error("story_recommendation_changed");
  }
  if (row.workflowRevisionId !== input.workflowRevisionId) {
    const ancestor = await env.DB.prepare(`with recursive ancestry(id, parent_revision_id) as (
      select id, parent_revision_id from creative_workflow_revisions
        where id = ? and workflow_id = ? and owner_id = ?
      union all
      select revision.id, revision.parent_revision_id from creative_workflow_revisions revision
        join ancestry on revision.id = ancestry.parent_revision_id
        where revision.workflow_id = ? and revision.owner_id = ?
    ) select id from ancestry where id = ? limit 1`)
      .bind(input.workflowRevisionId, input.workflowId, ownerId, input.workflowId, ownerId, row.workflowRevisionId)
      .first<{ id: string }>();
    if (!ancestor) throw new Error("story_recommendation_changed");
  }
  if (await digest(row.prompt) !== row.promptHash) throw new Error("story_recommendation_changed");
  const appliedPrompt = boundedText(input.prompt, 4_000);
  return {
    ...selection,
    storyTitle: row.storyTitle,
    recommendationTitle: row.title,
    recommendedPrompt: row.prompt,
    appliedPrompt,
    ownerEdited: appliedPrompt !== row.prompt,
    refreshId: row.refreshId,
    evidenceFingerprint: row.storyEvidenceFingerprint,
    plannerProvider: row.plannerProvider,
    plannerModel: row.plannerModel,
  };
}

export async function markStoryRecommendationUsed(env: Env, ownerId: string, selection: StoryRecommendationSelection) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`update creative_story_recommendations set status = case when status = 'ready' then 'used' else status end,
      updated_at = ? where id = ? and story_id = ? and owner_id = ?`)
      .bind(now, selection.recommendationId, selection.storyId, ownerId),
    env.DB.prepare(`update creative_story_threads set status = case when status = 'suggested' then 'developing' else status end,
      updated_at = ? where id = ? and owner_id = ?`)
      .bind(now, selection.storyId, ownerId),
  ]);
}
