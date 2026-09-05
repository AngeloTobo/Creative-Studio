import { validatedGlbStream } from "./mesh";
import { putSizedStream } from "./sizedStream";
import {
  compileCreativeDna,
  creativeDnaReferenceAssetIds,
  creativeDnaGenerationPrompt,
  ARTIFACT_SNAPSHOT_LIMIT,
  PROJECT_HUES,
  resolveCreativeDnaGenerationArtifact,
  videoGenerationVariantLabel,
  withGenerationProviderWorkload,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type ArtifactHistoryPage,
  type ArtifactHistoryQuery,
  type CreateCreativeDnaRequest,
  type CreativeDnaArtifact,
  type CreativeTrainingExample,
  type CreateProjectRequest,
  type GenerationSettingsStamp,
  type CreateGenerationRecipeRequest,
  type GenerationRecipe,
  type GenerationRecipePromptProfile,
  type GenerationRecipeSourceKind,
  type Job,
  type MediaAsset,
  type MediaKind,
  type Project,
  type RecipeEvidence,
  type RecipeEvidenceAcceptance,
  type UpdateGenerationRecipeRequest,
  type WorkflowParameter,
  type WorkflowScalar,
  generationRecipePromptProfileForSettingsStamp,
  generationRecipeSourceKindsForWorkflow,
  summarizeRecipeEvidence,
  type RunnerMediaInput,
  type UpdateProjectRequest,
} from "../shared/contracts";
import type { AfdfwGeneration } from "./adapters/afdfw";
import { boundedText, id } from "./lib/http";
import type { Env } from "./types";

type ProjectRow = Project;

const PROJECT_HUE_SET = new Set<string>(PROJECT_HUES);

function projectInitials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const value = words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2);
  return (value || "CS").toUpperCase();
}

function generationArtifactName(name: string, settingsStamp: GenerationSettingsStamp) {
  if (settingsStamp.overnight?.taskTitle) return settingsStamp.overnight.taskTitle;
  if (settingsStamp.loveLoop?.title) return settingsStamp.loveLoop.title;
  return settingsStamp.videoVariant ? `${name} · ${videoGenerationVariantLabel(settingsStamp.videoVariant.role)}` : name;
}

function projectInput(input: CreateProjectRequest) {
  const name = boundedText(input.name, 80);
  const type = boundedText(input.type, 80);
  if (!name) throw new Error("project_name_required");
  if (!type) throw new Error("project_type_required");
  const hue = input.hue ?? PROJECT_HUES[0];
  if (!PROJECT_HUE_SET.has(hue)) throw new Error("invalid_project_hue");
  return {
    name,
    type,
    description: boundedText(input.description, 500),
    note: boundedText(input.note, 250),
    hue,
    initials: projectInitials(name),
  };
}

export async function projectById(env: Env, ownerId: string, projectId: string) {
  return env.DB.prepare(`select id, active_dna_artifact_id as activeDnaArtifactId, name, type, status, description, note, hue, initials, created_at as createdAt, updated_at as updatedAt from creative_projects where id = ? and owner_id = ?`)
    .bind(projectId, ownerId).first<ProjectRow>();
}

export async function listProjects(env: Env, ownerId: string): Promise<Project[]> {
  const result = await env.DB.prepare(`select id, active_dna_artifact_id as activeDnaArtifactId, name, type, status, description, note, hue, initials, created_at as createdAt, updated_at as updatedAt from creative_projects where owner_id = ? order by case when status = 'archived' then 1 else 0 end, created_at`).bind(ownerId).all<ProjectRow>();
  return (result.results ?? []) as Project[];
}

export async function createProject(env: Env, ownerId: string, input: CreateProjectRequest) {
  const values = projectInput(input);
  const now = new Date().toISOString();
  const project: Project = { id: id("project"), activeDnaArtifactId: null, status: "active", ...values, createdAt: now, updatedAt: now };
  await env.DB.prepare(`insert into creative_projects (id, owner_id, name, type, status, description, note, hue, initials, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(project.id, ownerId, project.name, project.type, project.status, project.description, project.note, project.hue, project.initials, now, now).run();
  return project;
}

type GenerationRecipeRow = {
  id: string;
  projectId: string | null;
  worldId: string | null;
  name: string;
  description: string;
  mediaKind: GenerationRecipe["mediaKind"];
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

type RecipeEvidenceRow = {
  id: string;
  recipeId: string;
  jobId: string;
  outcome: RecipeEvidence["outcome"];
  durationMs: number | null;
  failure: string | null;
  acceptance: RecipeEvidenceAcceptance;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
};

type RecipeWorkflowRow = {
  modality: string;
  executionState: string;
  format: string;
  parametersJson: string;
  modelsJson: string;
};

const GENERATION_RECIPE_LIST_LIMIT = 50;
const GENERATION_RECIPE_EVIDENCE_WINDOW = 10;
const GENERATION_RECIPE_DETAIL_EVIDENCE_LIMIT = 100;

const GENERATION_RECIPE_COLUMNS = `id, project_id as projectId, world_id as worldId, name, description,
  media_kind as mediaKind, workflow_id as workflowId, workflow_revision_id as workflowRevisionId,
  model_identifier as modelIdentifier, prompt_profile_json as promptProfileJson, parameters_json as parametersJson,
  source_kinds_json as sourceKindsJson, intent_tier as intentTier, created_at as createdAt,
  updated_at as updatedAt, archived_at as archivedAt`;

const RECIPE_EVIDENCE_COLUMNS = `id, recipe_id as recipeId, job_id as jobId, outcome,
  duration_ms as durationMs, failure, acceptance, observed_at as observedAt,
  created_at as createdAt, updated_at as updatedAt`;

function storedJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function recipeEvidenceFromRow(row: RecipeEvidenceRow): RecipeEvidence {
  return { ...row, durationMs: row.durationMs === null ? null : Number(row.durationMs) };
}

function generationRecipeFromRow(row: GenerationRecipeRow, evidenceRows: RecipeEvidenceRow[] = []): GenerationRecipe {
  const evidence = evidenceRows.map(recipeEvidenceFromRow);
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
    promptProfile: storedJson<GenerationRecipePromptProfile>(row.promptProfileJson, { id: "unknown", version: "unknown", targetModel: null }),
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

function normalizedRecipeParameter(value: unknown): WorkflowScalar | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length <= 100_000 ? value : null;
  return null;
}

function normalizedRecipeParameters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_recipe_parameters");
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error("invalid_recipe_parameters");
  const parameters: Record<string, WorkflowScalar> = {};
  for (const [rawId, rawValue] of entries) {
    const parameterValue = normalizedRecipeParameter(rawValue);
    if (!rawId || rawId.length > 180 || parameterValue === null) throw new Error("invalid_recipe_parameters");
    parameters[rawId] = parameterValue;
  }
  return parameters;
}

function normalizedRecipePromptProfile(value: unknown): GenerationRecipePromptProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_recipe_prompt_profile");
  const profile = value as Partial<GenerationRecipePromptProfile>;
  const idValue = boundedText(profile.id, 120);
  const version = boundedText(profile.version, 40);
  if (!idValue || !version) throw new Error("invalid_recipe_prompt_profile");
  return { id: idValue, version, targetModel: boundedText(profile.targetModel, 200) || null };
}

function recipeMediaKind(modality: string): GenerationRecipe["mediaKind"] | null {
  if (modality === "audio" || modality === "music") return "music";
  if (modality === "image" || modality === "video") return modality;
  return null;
}

async function recipeWorkflowRevision(env: Env, ownerId: string, workflowId: string, workflowRevisionId: string) {
  return env.DB.prepare(`select w.modality, w.execution_state as executionState, r.format,
    r.parameters_json as parametersJson, r.models_json as modelsJson
    from creative_workflows w join creative_workflow_revisions r on r.workflow_id = w.id
    where w.id = ? and w.owner_id = ? and r.id = ? and r.owner_id = ?`)
    .bind(workflowId, ownerId, workflowRevisionId, ownerId).first<RecipeWorkflowRow>();
}

async function generationRecipeValues(env: Env, ownerId: string, input: CreateGenerationRecipeRequest) {
  const name = boundedText(input.name, 100);
  if (!name) throw new Error("recipe_name_required");
  if (!(["music", "image", "video"] as string[]).includes(input.mediaKind)) throw new Error("invalid_recipe_media_kind");
  if (!(["scout", "explore", "master"] as string[]).includes(input.intentTier)) throw new Error("invalid_recipe_intent_tier");
  const workflowId = boundedText(input.workflowId, 100);
  const workflowRevisionId = boundedText(input.workflowRevisionId, 100);
  if (!workflowId || !workflowRevisionId) throw new Error("recipe_workflow_required");
  const workflow = await recipeWorkflowRevision(env, ownerId, workflowId, workflowRevisionId);
  if (!workflow) throw new Error("recipe_workflow_revision_not_found");
  if (workflow.executionState !== "ready" || workflow.format !== "comfyui-api") throw new Error("recipe_workflow_not_executable");
  if (recipeMediaKind(workflow.modality) !== input.mediaKind) throw new Error("recipe_workflow_media_kind_mismatch");

  const projectId = boundedText(input.projectId, 100) || null;
  if (projectId) {
    const project = await projectById(env, ownerId, projectId);
    if (!project) throw new Error("project_not_found");
    if (project.status === "archived") throw new Error("project_archived");
  }

  const workflowParameters = storedJson<WorkflowParameter[]>(workflow.parametersJson, []);
  const suppliedParameters = normalizedRecipeParameters(input.parameters);
  const knownParameterIds = new Set(workflowParameters.map((parameter) => parameter.id));
  if (Object.keys(suppliedParameters).some((parameterId) => !knownParameterIds.has(parameterId))) {
    throw new Error("recipe_parameter_not_in_workflow");
  }
  const parameters = Object.fromEntries(workflowParameters.map((parameter) => [parameter.id, parameter.value])) as Record<string, WorkflowScalar>;
  Object.assign(parameters, suppliedParameters);

  if (!Array.isArray(input.sourceKinds)) throw new Error("invalid_recipe_source_kinds");
  const allowedSourceKinds = new Set<GenerationRecipeSourceKind>(["prompt", "image", "audio", "video"]);
  const requestedSourceKinds = new Set(input.sourceKinds);
  const sourceKinds = [...requestedSourceKinds].filter((kind): kind is GenerationRecipeSourceKind => allowedSourceKinds.has(kind as GenerationRecipeSourceKind));
  if (!sourceKinds.length || sourceKinds.length !== requestedSourceKinds.size) throw new Error("invalid_recipe_source_kinds");
  const workflowSourceKinds = new Set(generationRecipeSourceKindsForWorkflow(workflowParameters));
  if (sourceKinds.length !== workflowSourceKinds.size || sourceKinds.some((kind) => !workflowSourceKinds.has(kind))) {
    throw new Error("recipe_source_kind_not_in_workflow");
  }

  const models = storedJson<string[]>(workflow.modelsJson, []);
  const requestedModel = boundedText(input.modelIdentifier, 240) || null;
  if (requestedModel && models.length && !models.includes(requestedModel)) throw new Error("recipe_model_not_in_workflow");
  return {
    name,
    description: boundedText(input.description, 800),
    projectId,
    worldId: boundedText(input.worldId, 100) || null,
    mediaKind: input.mediaKind,
    workflowId,
    workflowRevisionId,
    modelIdentifier: requestedModel ?? (models.length === 1 ? models[0] : null),
    promptProfile: normalizedRecipePromptProfile(input.promptProfile),
    parameters,
    sourceKinds,
    intentTier: input.intentTier,
  };
}

export async function listGenerationRecipes(env: Env, ownerId: string, includeArchived = false): Promise<GenerationRecipe[]> {
  const archiveFilter = includeArchived ? "" : "and archived_at is null";
  const [recipeResult, evidenceResult] = await Promise.all([
    env.DB.prepare(`select ${GENERATION_RECIPE_COLUMNS} from creative_generation_recipes
      where owner_id = ? ${archiveFilter}
      order by updated_at desc, id desc limit ${GENERATION_RECIPE_LIST_LIMIT}`).bind(ownerId).all<GenerationRecipeRow>(),
    env.DB.prepare(`select ${RECIPE_EVIDENCE_COLUMNS.replaceAll(/\b(?:id|recipe_id|job_id|outcome|duration_ms|failure|acceptance|observed_at|created_at|updated_at)\b/g, (column) => `e.${column}`)}
      from (
        select id from creative_generation_recipes
        where owner_id = ? ${archiveFilter}
        order by updated_at desc, id desc limit ${GENERATION_RECIPE_LIST_LIMIT}
      ) selected
      join creative_generation_recipe_evidence e on e.owner_id = ? and e.recipe_id = selected.id
        and e.id in (
          select recent.id from creative_generation_recipe_evidence recent
          where recent.owner_id = ? and recent.recipe_id = selected.id
          order by recent.observed_at desc, recent.id desc limit ${GENERATION_RECIPE_EVIDENCE_WINDOW}
        )
      order by e.observed_at desc, e.id desc
      limit ${GENERATION_RECIPE_LIST_LIMIT * GENERATION_RECIPE_EVIDENCE_WINDOW}`)
      .bind(ownerId, ownerId, ownerId).all<RecipeEvidenceRow>(),
  ]);
  const evidenceByRecipe = new Map<string, RecipeEvidenceRow[]>();
  for (const evidence of evidenceResult.results ?? []) {
    const values = evidenceByRecipe.get(evidence.recipeId) ?? [];
    values.push(evidence);
    evidenceByRecipe.set(evidence.recipeId, values);
  }
  return (recipeResult.results ?? []).map((row) => generationRecipeFromRow(row, evidenceByRecipe.get(row.id) ?? []));
}

export async function generationRecipeById(env: Env, ownerId: string, recipeId: string): Promise<GenerationRecipe | null> {
  const row = await env.DB.prepare(`select ${GENERATION_RECIPE_COLUMNS} from creative_generation_recipes where id = ? and owner_id = ?`)
    .bind(recipeId, ownerId).first<GenerationRecipeRow>();
  if (!row) return null;
  const evidence = await env.DB.prepare(`select ${RECIPE_EVIDENCE_COLUMNS} from creative_generation_recipe_evidence
    where owner_id = ? and recipe_id = ? order by observed_at desc, id desc limit ${GENERATION_RECIPE_DETAIL_EVIDENCE_LIMIT}`)
    .bind(ownerId, recipeId).all<RecipeEvidenceRow>();
  return generationRecipeFromRow(row, evidence.results ?? []);
}

export async function createGenerationRecipe(env: Env, ownerId: string, input: CreateGenerationRecipeRequest) {
  const values = await generationRecipeValues(env, ownerId, input);
  const now = new Date().toISOString();
  const recipeId = id("recipe");
  await env.DB.prepare(`insert into creative_generation_recipes (
    id, owner_id, project_id, world_id, name, description, media_kind, workflow_id, workflow_revision_id,
    model_identifier, prompt_profile_json, parameters_json, source_kinds_json, intent_tier,
    created_at, updated_at, archived_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`)
    .bind(recipeId, ownerId, values.projectId, values.worldId, values.name, values.description, values.mediaKind,
      values.workflowId, values.workflowRevisionId, values.modelIdentifier, JSON.stringify(values.promptProfile),
      JSON.stringify(values.parameters), JSON.stringify(values.sourceKinds), values.intentTier, now, now).run();
  return (await generationRecipeById(env, ownerId, recipeId))!;
}

export async function updateGenerationRecipe(env: Env, ownerId: string, recipeId: string, input: UpdateGenerationRecipeRequest) {
  const current = await generationRecipeById(env, ownerId, recipeId);
  if (!current) throw new Error("generation_recipe_not_found");
  if (current.archivedAt) throw new Error("generation_recipe_archived");
  const values = await generationRecipeValues(env, ownerId, {
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    projectId: input.projectId === undefined ? current.projectId : input.projectId,
    worldId: input.worldId === undefined ? current.worldId : input.worldId,
    mediaKind: input.mediaKind ?? current.mediaKind,
    workflowId: input.workflowId ?? current.workflowId,
    workflowRevisionId: input.workflowRevisionId ?? current.workflowRevisionId,
    modelIdentifier: input.modelIdentifier === undefined ? current.modelIdentifier : input.modelIdentifier,
    promptProfile: input.promptProfile ?? current.promptProfile,
    parameters: input.parameters ?? current.parameters,
    sourceKinds: input.sourceKinds ?? current.sourceKinds,
    intentTier: input.intentTier ?? current.intentTier,
  });
  const executionChanged = values.mediaKind !== current.mediaKind
    || values.workflowId !== current.workflowId
    || values.workflowRevisionId !== current.workflowRevisionId
    || values.modelIdentifier !== current.modelIdentifier
    || values.intentTier !== current.intentTier
    || JSON.stringify(values.promptProfile) !== JSON.stringify(current.promptProfile)
    || canonicalRecipeParameters(values.parameters) !== canonicalRecipeParameters(current.parameters)
    || [...values.sourceKinds].sort().join("|") !== [...current.sourceKinds].sort().join("|");
  if (current.evidence.length && executionChanged) throw new Error("recipe_evidence_settings_immutable");
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_generation_recipes set project_id = ?, world_id = ?, name = ?, description = ?,
    media_kind = ?, workflow_id = ?, workflow_revision_id = ?, model_identifier = ?, prompt_profile_json = ?,
    parameters_json = ?, source_kinds_json = ?, intent_tier = ?, updated_at = ? where id = ? and owner_id = ? and archived_at is null`)
    .bind(values.projectId, values.worldId, values.name, values.description, values.mediaKind, values.workflowId,
      values.workflowRevisionId, values.modelIdentifier, JSON.stringify(values.promptProfile), JSON.stringify(values.parameters),
      JSON.stringify(values.sourceKinds), values.intentTier, now, recipeId, ownerId).run();
  return (await generationRecipeById(env, ownerId, recipeId))!;
}

/** Soft deletion keeps the recipe and its observed evidence available for audit and reproducibility. */
export async function deleteGenerationRecipe(env: Env, ownerId: string, recipeId: string) {
  const current = await generationRecipeById(env, ownerId, recipeId);
  if (!current) throw new Error("generation_recipe_not_found");
  if (!current.archivedAt) {
    const now = new Date().toISOString();
    await env.DB.prepare(`update creative_generation_recipes set archived_at = ?, updated_at = ? where id = ? and owner_id = ? and archived_at is null`)
      .bind(now, now, recipeId, ownerId).run();
  }
  return (await generationRecipeById(env, ownerId, recipeId))!;
}

function canonicalRecipeParameters(parameters: Record<string, WorkflowScalar>) {
  return JSON.stringify(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)));
}

export async function recordGenerationRecipeEvidence(env: Env, ownerId: string, recipeId: string, jobId: string) {
  const recipe = await generationRecipeById(env, ownerId, recipeId);
  if (!recipe) throw new Error("generation_recipe_not_found");
  if (recipe.archivedAt) throw new Error("generation_recipe_archived");
  const job = await jobById(env, ownerId, boundedText(jobId, 100));
  if (!job) throw new Error("job_not_found");
  if (!(["completed", "failed", "cancelled"] as string[]).includes(job.status)) throw new Error("recipe_evidence_job_not_terminal");
  if (recipe.projectId && recipe.projectId !== job.projectId) throw new Error("recipe_evidence_project_mismatch");
  if (job.modality !== recipe.mediaKind
    || job.settingsStamp.workflow?.workflowId !== recipe.workflowId
    || job.settingsStamp.workflow?.revisionId !== recipe.workflowRevisionId) throw new Error("recipe_evidence_workflow_mismatch");
  if (canonicalRecipeParameters(job.settingsStamp.parameters) !== canonicalRecipeParameters(recipe.parameters)) {
    throw new Error("recipe_evidence_parameters_mismatch");
  }
  if (recipe.modelIdentifier && !job.settingsStamp.models.includes(recipe.modelIdentifier)) throw new Error("recipe_evidence_model_mismatch");
  const expectedPromptProfile = generationRecipePromptProfileForSettingsStamp(job.settingsStamp, job.modality);
  if (!expectedPromptProfile
    || expectedPromptProfile.id !== recipe.promptProfile.id
    || expectedPromptProfile.version !== recipe.promptProfile.version
    || expectedPromptProfile.targetModel !== recipe.promptProfile.targetModel) {
    throw new Error("recipe_evidence_prompt_profile_mismatch");
  }
  const workflow = await recipeWorkflowRevision(env, ownerId, recipe.workflowId, recipe.workflowRevisionId);
  if (!workflow) throw new Error("recipe_evidence_workflow_mismatch");
  const executableSourceKinds = generationRecipeSourceKindsForWorkflow(storedJson<WorkflowParameter[]>(workflow.parametersJson, []));
  if ([...executableSourceKinds].sort().join("|") !== [...recipe.sourceKinds].sort().join("|")) {
    throw new Error("recipe_evidence_source_kind_mismatch");
  }

  const latestAcceptance = job.artifactId
    ? await env.DB.prepare(`select decision from creative_acceptances where owner_id = ? and artifact_id = ? order by created_at desc limit 1`)
      .bind(ownerId, job.artifactId).first<{ decision: RecipeEvidenceAcceptance }>()
    : null;
  const acceptance = latestAcceptance?.decision ?? "unreviewed";
  const startedAt = Date.parse(job.startedAt ?? job.createdAt);
  const finishedAt = Date.parse(job.completedAt ?? job.updatedAt);
  const durationMs = Number.isFinite(startedAt) && Number.isFinite(finishedAt) && finishedAt >= startedAt ? finishedAt - startedAt : null;
  const observedAt = job.completedAt ?? job.updatedAt;
  const now = new Date().toISOString();
  const evidenceId = id("recipeevidence");
  await env.DB.prepare(`insert into creative_generation_recipe_evidence (
    id, owner_id, recipe_id, job_id, outcome, duration_ms, failure, acceptance, observed_at, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  on conflict(owner_id, recipe_id, job_id) do update set outcome = excluded.outcome, duration_ms = excluded.duration_ms,
    failure = excluded.failure, acceptance = excluded.acceptance, observed_at = excluded.observed_at, updated_at = excluded.updated_at`)
    .bind(evidenceId, ownerId, recipeId, job.id, job.status, durationMs, boundedText(job.error, 500) || null,
      acceptance, observedAt, now, now).run();
  const evidenceRow = await env.DB.prepare(`select ${RECIPE_EVIDENCE_COLUMNS} from creative_generation_recipe_evidence
    where owner_id = ? and recipe_id = ? and job_id = ?`).bind(ownerId, recipeId, job.id).first<RecipeEvidenceRow>();
  if (!evidenceRow) throw new Error("recipe_evidence_not_found");
  return { recipe: (await generationRecipeById(env, ownerId, recipeId))!, evidence: recipeEvidenceFromRow(evidenceRow) };
}

type MediaRow = {
  id: string;
  projectId: string;
  kind: MediaKind;
  name: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  source: "upload" | "archive-index";
  status: "retained";
  trainingEligible: number;
  provenanceJson: string | null;
  createdAt: string;
  updatedAt: string;
};

const MEDIA_COLUMNS = `id, project_id as projectId, kind, name, original_file_name as originalFileName,
  mime_type as mimeType, size, source, status, training_eligible as trainingEligible,
  provenance_json as provenanceJson, created_at as createdAt, updated_at as updatedAt`;

function mediaProvenance(row: MediaRow): MediaAsset["provenance"] {
  if (row.source === "upload") return { uploadedByOwner: true, uploadedAt: row.createdAt, parentAssetIds: [] };
  let value: unknown;
  try { value = JSON.parse(row.provenanceJson ?? ""); } catch { throw new Error("media_provenance_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("media_provenance_invalid");
  const provenance = value as Record<string, unknown>;
  if (provenance.materializedFromArchive !== true || provenance.provider !== "angelo-art-index"
    || provenance.requestedByOwner !== true || provenance.verification !== "size-match"
    || typeof provenance.catalogId !== "string" || typeof provenance.archiveEntryId !== "string"
    || typeof provenance.materializationId !== "string" || typeof provenance.materializedAt !== "string"
    || typeof provenance.sourceVersion !== "string" || typeof provenance.sourceFingerprint !== "string"
    || typeof provenance.sourceRecordType !== "string" || typeof provenance.sourceRecordId !== "string"
    || (provenance.inventoryRecordId !== null && typeof provenance.inventoryRecordId !== "string")
    || !Array.isArray(provenance.parentAssetIds) || provenance.parentAssetIds.some((parent) => typeof parent !== "string")) {
    throw new Error("media_provenance_invalid");
  }
  return {
    materializedFromArchive: true,
    provider: "angelo-art-index",
    catalogId: provenance.catalogId,
    archiveEntryId: provenance.archiveEntryId,
    materializationId: provenance.materializationId,
    sourceVersion: provenance.sourceVersion,
    sourceFingerprint: provenance.sourceFingerprint,
    sourceRecordType: provenance.sourceRecordType,
    sourceRecordId: provenance.sourceRecordId,
    inventoryRecordId: provenance.inventoryRecordId,
    requestedByOwner: true,
    materializedAt: provenance.materializedAt,
    verification: "size-match",
    parentAssetIds: provenance.parentAssetIds,
  };
}

function mapMedia(row: MediaRow): MediaAsset {
  const media = { ...row };
  Reflect.deleteProperty(media, "provenanceJson");
  return {
    ...media,
    size: Number(row.size),
    trainingEligible: Boolean(row.trainingEligible),
    contentUrl: `/api/creative-studio/media/${row.id}/content`,
    provenance: mediaProvenance(row),
  };
}

export async function listMediaAssets(env: Env, ownerId: string): Promise<MediaAsset[]> {
  const result = await env.DB.prepare(`select ${MEDIA_COLUMNS} from creative_media_assets where owner_id = ? order by created_at desc limit 250`)
    .bind(ownerId).all<MediaRow>();
  return (result.results ?? []).map(mapMedia);
}

export async function mediaAssetsByIds(env: Env, ownerId: string, mediaIds: string[]): Promise<MediaAsset[]> {
  const ids = [...new Set(mediaIds.filter(Boolean))];
  if (!ids.length) return [];
  const result = await env.DB.prepare(`select ${MEDIA_COLUMNS} from creative_media_assets
    where owner_id = ? and id in (select value from json_each(?)) order by created_at desc, id desc`)
    .bind(ownerId, JSON.stringify(ids)).all<MediaRow>();
  return (result.results ?? []).map(mapMedia);
}

export async function mediaAssetById(env: Env, ownerId: string, mediaId: string): Promise<MediaAsset | null> {
  const row = await env.DB.prepare(`select ${MEDIA_COLUMNS} from creative_media_assets where owner_id = ? and id = ?`)
    .bind(ownerId, mediaId).first<MediaRow>();
  return row ? mapMedia(row) : null;
}

export async function createMediaAsset(
  env: Env,
  ownerId: string,
  input: {
    id: string;
    projectId: string;
    kind: MediaKind;
    name: string;
    originalFileName: string;
    mimeType: string;
    size: number;
    r2Key: string;
    trainingEligible: boolean;
    source?: "upload" | "archive-index";
    provenance?: MediaAsset["provenance"] | null;
  },
) {
  const now = new Date().toISOString();
  const source = input.source ?? "upload";
  const provenanceJson = source === "archive-index" ? JSON.stringify(input.provenance) : null;
  await env.DB.prepare(`insert into creative_media_assets (
    id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
    source, status, training_eligible, provenance_json, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'retained', ?, ?, ?, ?)`)
    .bind(input.id, ownerId, input.projectId, input.kind, input.name, input.originalFileName,
      input.mimeType, input.size, input.r2Key, source, input.trainingEligible ? 1 : 0, provenanceJson, now, now).run();
  return mapMedia({
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    name: input.name,
    originalFileName: input.originalFileName,
    mimeType: input.mimeType,
    size: input.size,
    source,
    status: "retained",
    trainingEligible: input.trainingEligible ? 1 : 0,
    provenanceJson,
    createdAt: now,
    updatedAt: now,
  });
}

export async function mediaObjectById(env: Env, ownerId: string, mediaId: string) {
  return env.DB.prepare(`select r2_key as r2Key, mime_type as mimeType, size, original_file_name as originalFileName
    from creative_media_assets where id = ? and owner_id = ?`)
    .bind(mediaId, ownerId).first<{ r2Key: string; mimeType: string; size: number; originalFileName: string }>();
}

export type RunnerInputObject = RunnerMediaInput & { r2Key: string };

function retainedFileName(idValue: string, mimeType: string) {
  const extension = ({
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac", "audio/ogg": "ogg",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  } as Record<string, string>)[mimeType] ?? "bin";
  return `creative-studio-${idValue}.${extension}`;
}

export async function runnerInputById(env: Env, ownerId: string, inputId: string): Promise<RunnerInputObject | null> {
  const upload = await env.DB.prepare(`select id, project_id as projectId, kind, name,
    original_file_name as originalFileName, mime_type as mimeType, size, r2_key as r2Key
    from creative_media_assets where id = ? and owner_id = ? and status = 'retained'`)
    .bind(inputId, ownerId).first<Omit<RunnerInputObject, "source">>();
  if (upload) return { ...upload, size: Number(upload.size), source: "upload" };

  const artifact = await env.DB.prepare(`select id, project_id as projectId, kind, name,
    retained_content_type as mimeType, retained_size as size, retained_key as r2Key
    from creative_artifacts where id = ? and owner_id = ? and retained_key is not null and retained_size > 0`)
    .bind(inputId, ownerId).first<{
      id: string; projectId: string; kind: Artifact["kind"]; name: string;
      mimeType: string; size: number; r2Key: string;
    }>();
  if (!artifact || artifact.kind === "3d") return null;
  const kind: RunnerMediaInput["kind"] = artifact.kind === "music" ? "audio" : artifact.kind;
  return {
    ...artifact,
    kind,
    size: Number(artifact.size),
    originalFileName: retainedFileName(artifact.id, artifact.mimeType),
    source: "artifact",
  };
}

export async function updateProject(env: Env, ownerId: string, projectId: string, input: UpdateProjectRequest) {
  const current = await projectById(env, ownerId, projectId);
  if (!current) throw new Error("project_not_found");
  if (current.status === "archived") throw new Error("project_archived");
  const merged = projectInput({
    name: input.name ?? current.name,
    type: input.type ?? current.type,
    description: input.description ?? current.description,
    note: input.note ?? current.note,
    hue: input.hue ?? (current.hue as CreateProjectRequest["hue"]),
  });
  const status = input.status ?? current.status;
  if (status !== "active" && status !== "paused") throw new Error("invalid_project_status");
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`update creative_projects set name = ?, type = ?, status = ?, description = ?, note = ?, hue = ?, initials = ?, updated_at = ? where id = ? and owner_id = ?`)
    .bind(merged.name, merged.type, status, merged.description, merged.note, merged.hue, merged.initials, updatedAt, projectId, ownerId).run();
  return { ...current, ...merged, status, updatedAt } satisfies Project;
}

export async function archiveProject(env: Env, ownerId: string, projectId: string) {
  const current = await projectById(env, ownerId, projectId);
  if (!current) throw new Error("project_not_found");
  if (current.status === "archived") return current;
  const updatedAt = new Date().toISOString();
  await env.DB.prepare("update creative_projects set status = 'archived', updated_at = ? where id = ? and owner_id = ?")
    .bind(updatedAt, projectId, ownerId).run();
  return { ...current, status: "archived", updatedAt } satisfies Project;
}

type DnaRow = { id: string; rootArtifactId: string; parentArtifactId: string | null; version: number; dnaJson: string };

function parseDna(row: DnaRow) {
  try { return resolveCreativeDnaGenerationArtifact(JSON.parse(row.dnaJson) as CreativeDnaArtifact); } catch { return null; }
}

export async function listLocalDna(env: Env, ownerId: string): Promise<CreativeDnaArtifact[]> {
  const result = await env.DB.prepare(`select id, root_artifact_id as rootArtifactId, parent_artifact_id as parentArtifactId, version, dna_json as dnaJson from creative_dna_artifacts where owner_id = ? order by created_at desc limit 100`).bind(ownerId).all<DnaRow>();
  return (result.results ?? []).map(parseDna).filter((item): item is CreativeDnaArtifact => Boolean(item));
}

export async function localDnaByIds(env: Env, ownerId: string, dnaArtifactIds: string[]): Promise<CreativeDnaArtifact[]> {
  const ids = [...new Set(dnaArtifactIds.filter(Boolean))];
  if (!ids.length) return [];
  const result = await env.DB.prepare(`select id, root_artifact_id as rootArtifactId,
    parent_artifact_id as parentArtifactId, version, dna_json as dnaJson from creative_dna_artifacts
    where owner_id = ? and id in (select value from json_each(?)) order by created_at desc, id desc`)
    .bind(ownerId, JSON.stringify(ids)).all<DnaRow>();
  return (result.results ?? []).map(parseDna).filter((item): item is CreativeDnaArtifact => Boolean(item));
}

export async function createLocalDna(env: Env, ownerId: string, input: CreateCreativeDnaRequest) {
  const project = await env.DB.prepare("select id, status from creative_projects where id = ? and owner_id = ?").bind(input.projectId, ownerId).first<{ id: string; status: Project["status"] }>();
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  if (input.sourceKind === "owner_uploads") {
    const referenceAssetIds = creativeDnaReferenceAssetIds(input.referenceAssetIds);
    if (!referenceAssetIds.length) throw new Error("reference_assets_required");
    const placeholders = referenceAssetIds.map(() => "?").join(", ");
    const result = await env.DB.prepare(`select id, project_id as projectId from creative_media_assets
      where owner_id = ? and status = 'retained' and id in (${placeholders})`)
      .bind(ownerId, ...referenceAssetIds).all<{ id: string; projectId: string }>();
    const assets = result.results ?? [];
    if (assets.length !== referenceAssetIds.length) throw new Error("reference_asset_not_found");
    if (assets.some((asset) => asset.projectId !== input.projectId)) throw new Error("reference_asset_project_mismatch");
  }
  let parent: DnaRow | null = null;
  if (input.parentArtifactId) {
    parent = await env.DB.prepare(`select id, root_artifact_id as rootArtifactId, parent_artifact_id as parentArtifactId, version, dna_json as dnaJson from creative_dna_artifacts where id = ? and owner_id = ?`).bind(input.parentArtifactId, ownerId).first<DnaRow>();
    if (!parent) throw new Error("parent_artifact_not_found");
    const parentArtifact = parseDna(parent);
    if (!parentArtifact || parentArtifact.projectId !== input.projectId) throw new Error("parent_project_mismatch");
  }
  const artifactId = id("dna");
  const createdAt = new Date().toISOString();
  const artifact = compileCreativeDna(input, {
    artifactId,
    projectId: input.projectId,
    version: parent ? parent.version + 1 : 1,
    rootArtifactId: parent?.rootArtifactId ?? artifactId,
    parentArtifactId: parent?.id ?? null,
    createdAt,
  });
  await env.DB.batch([
    env.DB.prepare(`insert into creative_dna_artifacts (id, owner_id, project_id, root_artifact_id, parent_artifact_id, version, dna_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(artifactId, ownerId, input.projectId, artifact.lineage.rootArtifactId, artifact.lineage.parentArtifactId, artifact.version, JSON.stringify(artifact), createdAt),
    env.DB.prepare("update creative_projects set active_dna_artifact_id = ?, updated_at = ? where id = ? and owner_id = ?")
      .bind(artifactId, createdAt, input.projectId, ownerId),
  ]);
  return artifact;
}

type JobRow = {
  id: string; projectId: string; dnaArtifactId: string; capability: Job["capability"]; modality: Job["modality"];
  status: Job["status"]; progress: number; prompt: string; provider: string; upstreamId: string | null;
  artifactId: string | null; retryOfJobId: string | null; error: string | null; createdAt: string; updatedAt: string;
  startedAt: string | null; executionStage: Job["executionStage"]; stageUpdatedAt: string | null; completedAt: string | null;
  settingsStampJson: string;
};

export type BackgroundJob = JobRow & {
  ownerId: string;
  upstreamMediaPath: string | null;
  reconcileEmail: string | null;
  idempotencyKey: string | null;
  reconcileAttempts: number;
  nextReconcileAt: string | null;
  timeoutAt: string | null;
  reconcileLeaseUntil: string | null;
  lastReconcileError: string | null;
  cancelledAt: string | null;
  executionTarget: "afdfw" | "local-comfyui";
  workflowId: string | null;
  workflowRevisionId: string | null;
  runnerId: string | null;
  runnerLeaseUntil: string | null;
  automationSessionId: string | null;
};

const PUBLIC_JOB_COLUMNS = `id, project_id as projectId, dna_artifact_id as dnaArtifactId, capability, modality,
  status, progress, prompt, provider, upstream_id as upstreamId, artifact_id as artifactId,
  retry_of_job_id as retryOfJobId, error, created_at as createdAt, updated_at as updatedAt,
  started_at as startedAt, execution_stage as executionStage, stage_updated_at as stageUpdatedAt, completed_at as completedAt,
  settings_stamp_json as settingsStampJson`;

const BACKGROUND_JOB_COLUMNS = `${PUBLIC_JOB_COLUMNS}, owner_id as ownerId, upstream_media_path as upstreamMediaPath,
  reconcile_email as reconcileEmail, idempotency_key as idempotencyKey, reconcile_attempts as reconcileAttempts,
  next_reconcile_at as nextReconcileAt, timeout_at as timeoutAt, reconcile_lease_until as reconcileLeaseUntil,
  last_reconcile_error as lastReconcileError, cancelled_at as cancelledAt, execution_target as executionTarget,
  workflow_id as workflowId, workflow_revision_id as workflowRevisionId, runner_id as runnerId,
  runner_lease_until as runnerLeaseUntil, automation_session_id as automationSessionId`;

function parseSettingsStamp(value: string, fallback: Omit<GenerationSettingsStamp, "schemaVersion">): GenerationSettingsStamp {
  try {
    const parsed = JSON.parse(value) as GenerationSettingsStamp;
    if (parsed?.schemaVersion === 1) return withGenerationProviderWorkload(parsed);
  } catch {
    // Older rows are represented by a truthful, minimal fallback.
  }
  return withGenerationProviderWorkload({ schemaVersion: 1, ...fallback });
}

function mapJob(row: JobRow): Job {
  const settingsStamp = parseSettingsStamp(row.settingsStampJson, {
    source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
    provider: row.provider, modality: row.modality, workflow: null, parameters: { prompt: row.prompt },
    models: [], inputAssetIds: [],
  });
  const { settingsStampJson: _settingsStampJson, ...job } = row;
  void _settingsStampJson;
  return { ...job, progress: Number(row.progress || 0), settingsStamp };
}

export async function listJobs(env: Env, ownerId: string): Promise<Job[]> {
  const result = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? order by created_at desc, id desc limit 100`).bind(ownerId).all<JobRow>();
  return (result.results ?? []).map(mapJob);
}

export async function listJobRuntime(env: Env, ownerId: string) {
  const result = await env.DB.prepare(`select id, runner_id as runnerId from creative_jobs where owner_id = ? order by created_at desc, id desc limit 100`)
    .bind(ownerId).all<{ id: string; runnerId: string | null }>();
  return Object.fromEntries((result.results ?? []).map((row) => [row.id, { runnerId: row.runnerId }]));
}

export async function jobById(env: Env, ownerId: string, jobId: string) {
  const row = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where id = ? and owner_id = ?`)
    .bind(jobId, ownerId).first<JobRow>();
  return row ? mapJob(row) : null;
}

export async function jobByIdempotencyKey(env: Env, ownerId: string, key: string) {
  const row = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, key).first<JobRow>();
  return row ? mapJob(row) : null;
}

export async function backgroundJobById(env: Env, jobId: string) {
  const row = await env.DB.prepare(`select ${BACKGROUND_JOB_COLUMNS} from creative_jobs where id = ?`)
    .bind(jobId).first<BackgroundJob>();
  return row ? { ...row, progress: Number(row.progress || 0), reconcileAttempts: Number(row.reconcileAttempts || 0) } : null;
}

export async function createQueuedJob(
  env: Env,
  ownerId: string,
  input: {
    projectId: string;
    dna: CreativeDnaArtifact;
    modality: Job["modality"];
    idempotencyKey: string;
    provider: string;
    reconcileEmail: string | null;
    retryOfJobId?: string | null;
    promptOverride?: string;
    settingsStampOverride?: GenerationSettingsStamp;
    executionTarget?: "afdfw" | "local-comfyui";
    workflowId?: string | null;
    workflowRevisionId?: string | null;
    upstreamId?: string | null;
    priority?: number;
    notBefore?: string | null;
    automationSessionId?: string | null;
  },
) {
  const existing = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? and idempotency_key = ?`)
    .bind(ownerId, input.idempotencyKey).first<JobRow>();
  if (existing) return { job: mapJob(existing), created: false };

  const jobId = id("job");
  const now = new Date().toISOString();
  const timeoutAt = input.executionTarget === "local-comfyui" ? null : new Date(Date.now() + 30 * 60_000).toISOString();
  const prompt = input.promptOverride ?? creativeDnaGenerationPrompt(input.dna, (input.modality === "video" || input.modality === "3d") ? "image" : input.modality);
  const settingsStamp = withGenerationProviderWorkload(input.settingsStampOverride ?? {
    schemaVersion: 1,
    source: "creative-dna",
    createdAt: now,
    reusedFromJobId: input.retryOfJobId ?? null,
    prompt,
    provider: input.provider,
    modality: input.modality,
    workflow: null,
    parameters: { prompt },
    models: [],
    inputAssetIds: [],
  });
  const job: Job = {
    id: jobId,
    projectId: input.projectId,
    dnaArtifactId: input.dna.artifactId,
    capability: input.modality === "music" ? "MUSIC_GENERATE" : input.modality === "video" ? "VIDEO_GENERATE" : "IMAGE_GENERATE",
    modality: input.modality,
    status: "queued",
    progress: 1,
    prompt,
    provider: input.provider,
    upstreamId: input.upstreamId ?? null,
    artifactId: null,
    retryOfJobId: input.retryOfJobId ?? null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    executionStage: "queued",
    stageUpdatedAt: now,
    completedAt: null,
    settingsStamp,
  };
  try {
    const automationSessionId = input.automationSessionId ? boundedText(input.automationSessionId, 100) : null;
    const inserted = await env.DB.prepare(`insert into creative_jobs (
      id, owner_id, project_id, dna_artifact_id, capability, modality, status, progress, prompt, provider,
      upstream_id, artifact_id, retry_of_job_id, error, created_at, updated_at, started_at, execution_stage, stage_updated_at, completed_at,
      reconcile_email, idempotency_key, reconcile_attempts, next_reconcile_at, timeout_at, settings_stamp_json,
      execution_target, workflow_id, workflow_revision_id, priority, not_before, automation_session_id
    ) select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, null, ?, ?, null, ?, ?, null, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?
      where ? is null or exists (
        select 1 from creative_overnight_sessions s where s.id = ? and s.owner_id = ? and s.project_id = ?
          and s.status = 'running' and s.cutoff_at > ?
      )`)
      .bind(job.id, ownerId, input.projectId, job.dnaArtifactId, job.capability, job.modality, job.status, job.progress,
        job.prompt, job.provider, job.upstreamId, job.retryOfJobId, now, now, job.executionStage, now,
        input.reconcileEmail, input.idempotencyKey, now, timeoutAt,
        JSON.stringify(job.settingsStamp), input.executionTarget ?? "afdfw", input.workflowId ?? null, input.workflowRevisionId ?? null,
        Math.max(0, Math.min(1_000, Math.round(input.priority ?? 100))), input.notBefore ?? null,
        automationSessionId, automationSessionId, automationSessionId, ownerId, input.projectId, now).run();
    if (!inserted.meta.changes) throw new Error("overnight_session_not_running");
    return { job, created: true };
  } catch (error) {
    const winner = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs where owner_id = ? and idempotency_key = ?`)
      .bind(ownerId, input.idempotencyKey).first<JobRow>();
    if (winner) return { job: mapJob(winner), created: false };
    throw error;
  }
}

export async function createDevelopmentJob(env: Env, ownerId: string, projectId: string, dna: CreativeDnaArtifact, modality: Job["modality"], idempotencyKey = id("idem")) {
  return (await createQueuedJob(env, ownerId, {
    projectId, dna, modality, idempotencyKey, reconcileEmail: null, provider: "development-worker",
  })).job;
}

export async function createAfdfwJob(env: Env, ownerId: string, projectId: string, dna: CreativeDnaArtifact, modality: Job["modality"], generation: AfdfwGeneration) {
  const created = await createQueuedJob(env, ownerId, {
    projectId,
    dna,
    modality,
    idempotencyKey: id("idem"),
    reconcileEmail: null,
    provider: modality === "music" ? "afdfw-stable-audio-3" : "afdfw-z-image",
  });
  return attachAfdfwGeneration(env, created.job.id, generation);
}

function upstreamStatus(status: string): Job["status"] {
  if (status === "completed" || status === "accepted") return "completed";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "pending" || status === "queued") return "queued";
  return "running";
}

async function ensureArtifactForJob(env: Env, ownerId: string, job: Job, name: string, mediaPath: string | null) {
  const existing = await env.DB.prepare("select id, retained_key as retainedKey from creative_artifacts where job_id = ? and owner_id = ?")
    .bind(job.id, ownerId).first<{ id: string; retainedKey: string | null }>();
  const now = new Date().toISOString();
  if (existing) {
    await ensureTrainingExample(env, ownerId, job, existing.id);
    if (mediaPath && !existing.retainedKey) {
      await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'running', progress = 95, execution_stage = 'retaining', stage_updated_at = ?, updated_at = ? where id = ? and owner_id = ? and status in ('queued', 'running')")
        .bind(existing.id, now, now, job.id, ownerId).run();
    } else {
      await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'completed', progress = 100, execution_stage = 'completed', stage_updated_at = ?, completed_at = coalesce(completed_at, ?), updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ?")
        .bind(existing.id, now, now, now, job.id, ownerId).run();
    }
    return existing.id;
  }
  const artifactId = id("artifact");
  const colors = job.modality === "music" ? ["#9d174d", "#7c3aed"] : ["#0e7490", "#a21caf"];
  const previewUrl = mediaPath ? `/api/creative-studio/artifacts/${artifactId}/media` : null;
  const artifactStatus: Artifact["status"] = mediaPath ? "retaining" : "ready";
  await env.DB.prepare(`insert or ignore into creative_artifacts (id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt, preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id, created_at, updated_at, settings_stamp_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?)`)
    .bind(artifactId, ownerId, job.projectId, job.id, job.dnaArtifactId, job.modality, generationArtifactName(name, job.settingsStamp), artifactStatus, job.provider, job.prompt, mediaPath ? "remote-media" : "development-gradient", previewUrl, colors[0], colors[1], mediaPath, now, now, JSON.stringify(job.settingsStamp)).run();
  const winner = await env.DB.prepare("select id from creative_artifacts where job_id = ? and owner_id = ?")
    .bind(job.id, ownerId).first<{ id: string }>();
  if (!winner) throw new Error("artifact_create_failed");
  await ensureTrainingExample(env, ownerId, job, winner.id);
  if (mediaPath) {
    await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'running', progress = 95, execution_stage = 'retaining', stage_updated_at = ?, updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ? and status in ('queued', 'running')")
      .bind(winner.id, now, now, job.id, ownerId).run();
  } else {
    await env.DB.prepare("update creative_jobs set artifact_id = ?, status = 'completed', progress = 100, execution_stage = 'completed', stage_updated_at = ?, completed_at = coalesce(completed_at, ?), updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ?")
      .bind(winner.id, now, now, now, job.id, ownerId).run();
  }
  return winner.id;
}

async function ensureTrainingExample(env: Env, ownerId: string, job: Job, artifactId: string) {
  if (job.modality === "3d") return;
  const now = new Date().toISOString();
  await env.DB.prepare(`insert or ignore into creative_training_examples (
    id, owner_id, project_id, dna_artifact_id, artifact_id, kind, status, prompt, settings_stamp_json, created_at, updated_at
  ) values (?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?)`)
    .bind(id("trainingexample"), ownerId, job.projectId, job.dnaArtifactId, artifactId, job.modality,
      job.prompt, JSON.stringify(job.settingsStamp), now, now).run();
}

export async function attachAfdfwGeneration(env: Env, jobId: string, generation: AfdfwGeneration) {
  const current = await backgroundJobById(env, jobId);
  if (!current) throw new Error("job_not_found");
  if (["completed", "failed", "cancelled"].includes(current.status)) return mapJob(current);
  const upstream = upstreamStatus(generation.status);
  const status: Job["status"] = upstream === "completed" ? "running" : upstream;
  const now = generation.updatedAt || new Date().toISOString();
  const executionStage: NonNullable<Job["executionStage"]> = upstream === "completed" ? "retaining" : upstream === "failed" ? "failed" : upstream === "queued" ? "provider-queued" : "rendering";
  const progress = upstream === "completed" ? 95 : Math.max(current.progress, Number(generation.progress || (status === "running" ? 10 : 2)));
  const mediaPath = generation.mediaUrl || (generation.previewMediaId ? `/api/profile-${current.modality === "music" ? "song" : "image"}/media/${generation.previewMediaId}` : null);
  const nextAt = upstream === "completed" ? null : status === "queued" || status === "running" ? new Date(Date.now() + 60_000).toISOString() : null;
  const retentionTimeout = upstream === "completed" ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : current.timeoutAt;
  const currentJob = mapJob(current);
  const responseParameters = current.modality === "image" ? Object.fromEntries([
    ["medium", generation.medium], ["size", generation.size], ["width", generation.width], ["height", generation.height],
  ].filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || (typeof entry[1] === "number" && Number.isFinite(entry[1])))) : {};
  const settingsStamp = withGenerationProviderWorkload({
    ...currentJob.settingsStamp,
    parameters: { ...currentJob.settingsStamp.parameters, ...responseParameters },
  });
  const changed = await env.DB.prepare(`update creative_jobs set upstream_id = ?, upstream_media_path = coalesce(?, upstream_media_path), status = ?, progress = ?,
      error = ?, last_reconcile_error = null, started_at = coalesce(started_at, ?), execution_stage = ?, stage_updated_at = ?,
      updated_at = ?, completed_at = case when ? = 'failed' then ? else completed_at end,
      next_reconcile_at = ?, timeout_at = ?, settings_stamp_json = ? where id = ? and status in ('queued', 'running')`)
    .bind(generation.id, mediaPath, status, progress, generation.error ?? null, now, executionStage, now, now, upstream, now, nextAt, retentionTimeout,
      JSON.stringify(settingsStamp), jobId).run();
  if (!changed.meta.changes) {
    const unchanged = await jobById(env, current.ownerId, jobId);
    if (!unchanged) throw new Error("job_not_found");
    return unchanged;
  }
  if (upstream === "completed") {
    if (!mediaPath) throw new Error("generation_media_missing");
    const dna = (await listLocalDna(env, current.ownerId)).find((item) => item.artifactId === current.dnaArtifactId);
    await ensureArtifactForJob(env, current.ownerId, mapJob({ ...current, settingsStampJson: JSON.stringify(settingsStamp), upstreamId: generation.id, status, progress, updatedAt: now, completedAt: null }), dna?.name ?? `${current.modality} artifact`, mediaPath);
  }
  const updated = await jobById(env, current.ownerId, jobId);
  if (!updated) throw new Error("job_not_found");
  return updated;
}

export async function claimBackgroundJob(env: Env, jobId: string, leaseMs = 12 * 60_000) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs).toISOString();
  const claimed = await env.DB.prepare(`update creative_jobs set reconcile_lease_until = ?, reconcile_attempts = reconcile_attempts + 1,
    started_at = coalesce(started_at, ?), execution_stage = case when upstream_id is null then 'submitting' else 'rendering' end,
    stage_updated_at = ?, updated_at = ?
    where id = ? and execution_target = 'afdfw' and status in ('queued', 'running')
      and (next_reconcile_at is null or next_reconcile_at <= ?)
      and (reconcile_lease_until is null or reconcile_lease_until <= ?)`)
    .bind(leaseUntil, now.toISOString(), now.toISOString(), now.toISOString(), jobId, now.toISOString(), now.toISOString()).run();
  return claimed.meta.changes ? backgroundJobById(env, jobId) : null;
}

export async function markBackgroundJobPending(env: Env, jobId: string, error: string, delaySeconds: number) {
  const now = new Date();
  await env.DB.prepare(`update creative_jobs set status = case when upstream_id is null then 'queued' else 'running' end,
    last_reconcile_error = ?, error = null, next_reconcile_at = ?, reconcile_lease_until = null, updated_at = ?
    where id = ? and status in ('queued', 'running')`)
    .bind(error.slice(0, 500), new Date(now.getTime() + delaySeconds * 1000).toISOString(), now.toISOString(), jobId).run();
}

export async function failBackgroundJob(env: Env, jobId: string, error: string) {
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_jobs set status = 'failed', error = ?, last_reconcile_error = ?, execution_stage = 'failed',
    stage_updated_at = ?, completed_at = ?, next_reconcile_at = null, reconcile_lease_until = null, updated_at = ?
    where id = ? and status in ('queued', 'running')`)
    .bind(error.slice(0, 500), error.slice(0, 500), now, now, now, jobId).run();
}

export async function releaseBackgroundJob(env: Env, jobId: string) {
  await env.DB.prepare("update creative_jobs set reconcile_lease_until = null where id = ?").bind(jobId).run();
}

export async function dueBackgroundJobIds(env: Env, limit = 50) {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(`select id from creative_jobs where execution_target = 'afdfw' and status in ('queued', 'running')
    and (next_reconcile_at is null or next_reconcile_at <= ?)
    and (reconcile_lease_until is null or reconcile_lease_until <= ?)
    order by coalesce(next_reconcile_at, created_at) limit ?`).bind(now, now, limit).all<{ id: string }>();
  return (rows.results ?? []).map((row) => row.id);
}

const RUNNER_OUTPUT_TYPES: Record<string, { kind: Job["modality"]; extension: string }> = {
  "model/gltf-binary": { kind: "3d", extension: "glb" },
  "image/png": { kind: "image", extension: "png" },
  "image/jpeg": { kind: "image", extension: "jpg" },
  "image/webp": { kind: "image", extension: "webp" },
  "audio/wav": { kind: "music", extension: "wav" },
  "audio/mpeg": { kind: "music", extension: "mp3" },
  "audio/flac": { kind: "music", extension: "flac" },
  "audio/ogg": { kind: "music", extension: "ogg" },
  "video/mp4": { kind: "video", extension: "mp4" },
  "video/webm": { kind: "video", extension: "webm" },
  "video/quicktime": { kind: "video", extension: "mov" },
};

export const MAX_RUNNER_OUTPUT_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_THUMBNAIL_BYTES = 2 * 1024 * 1024;

async function assertAutomationJobMayComplete(env: Env, background: BackgroundJob, now: string) {
  if (!background.automationSessionId) return;
  const session = await env.DB.prepare(`select status, cutoff_at as cutoffAt from creative_overnight_sessions
    where id = ? and owner_id = ?`).bind(background.automationSessionId, background.ownerId)
    .first<{ status: string; cutoffAt: string }>();
  if (session?.status === "running" && session.cutoffAt > now) return;
  const error = session && session.cutoffAt <= now ? "overnight_window_ended" : "overnight_session_not_running";
  await env.DB.prepare(`update creative_jobs set status = 'cancelled', error = ?, execution_stage = 'cancelled',
    stage_updated_at = ?, cancelled_at = ?, completed_at = ?, runner_lease_until = null, next_reconcile_at = null, updated_at = ?
    where id = ? and owner_id = ? and status in ('queued', 'running')`)
    .bind(error, now, now, now, now, background.id, background.ownerId).run();
  throw new Error("runner_job_not_completable");
}

export async function completeLocalRunnerJob(
  env: Env,
  ownerId: string,
  runnerId: string,
  jobId: string,
  body: ReadableStream,
  contentTypeValue: string,
  declaredSize: number,
) {
  if (!env.ARTIFACTS) throw new Error("artifact_storage_not_configured");
  const contentType = contentTypeValue.toLowerCase().split(";", 1)[0].trim();
  const output = RUNNER_OUTPUT_TYPES[contentType];
  if (!output) throw new Error("unsupported_runner_output_type");
  if (!Number.isInteger(declaredSize) || declaredSize <= 0) throw new Error("empty_runner_output");
  if (declaredSize > MAX_RUNNER_OUTPUT_BYTES) throw new Error("runner_output_too_large");
  const background = await backgroundJobById(env, jobId);
  if (!background || background.ownerId !== ownerId) throw new Error("job_not_found");
  if (background.executionTarget !== "local-comfyui" || background.runnerId !== runnerId) throw new Error("runner_job_not_completable");
  if (background.modality !== output.kind) throw new Error("runner_output_modality_mismatch");
  if (background.status === "completed") {
    const completed = await jobById(env, ownerId, jobId);
    if (!completed) throw new Error("job_not_found");
    return completed;
  }
  if (background.status !== "running") throw new Error("runner_job_not_completable");

  const completionStartedAt = new Date().toISOString();
  await assertAutomationJobMayComplete(env, background, completionStartedAt);

  const artifactId = `artifact_${jobId}`;
  const safeOwner = ownerId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const key = `owners/${safeOwner}/artifacts/${artifactId}/result.${output.extension}`;
  const retainedBody = output.kind === "3d" ? await validatedGlbStream(body, declaredSize) : body;
  const created = await putSizedStream(env.ARTIFACTS, key, retainedBody, declaredSize, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType },
    customMetadata: { ownerId, artifactId, jobId, runnerId, retainedAt: new Date().toISOString() },
  });
  const retained = await env.ARTIFACTS.head(key);
  if (!retained || retained.size !== declaredSize) {
    if (created) await env.ARTIFACTS.delete(key);
    throw new Error("artifact_retention_verification_failed");
  }

  const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === background.dnaArtifactId);
  const completedSettings = mapJob(background).settingsStamp;
  const now = new Date().toISOString();
  const colors = background.modality === "music" ? ["#9d174d", "#7c3aed"] : background.modality === "video" ? ["#312e81", "#db2777"] : ["#0e7490", "#a21caf"];
  const [artifactWrite, jobWrite] = await env.DB.batch([
    env.DB.prepare(`insert or ignore into creative_artifacts (
      id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
      preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id,
      created_at, updated_at, retained_key, retained_content_type, retained_size, settings_stamp_json
    ) select ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, 'remote-media', ?, ?, ?, null, null, ?, ?, ?, ?, ?, ?
      where exists (select 1 from creative_jobs j where j.id = ? and j.owner_id = ? and j.runner_id = ? and j.status = 'running'
        and (j.automation_session_id is null or exists (
          select 1 from creative_overnight_sessions s where s.id = j.automation_session_id and s.owner_id = j.owner_id
            and s.status = 'running' and s.cutoff_at > ?
        )))`)
      .bind(artifactId, ownerId, background.projectId, jobId, background.dnaArtifactId, background.modality,
        generationArtifactName(dna?.name ?? `${background.modality} artifact`, completedSettings), background.provider, background.prompt,
        `/api/creative-studio/artifacts/${artifactId}/media`, colors[0], colors[1], now, now, key, contentType,
        retained.size, background.settingsStampJson, jobId, ownerId, runnerId, now),
    env.DB.prepare(`update creative_jobs set status = 'completed', progress = 100, artifact_id = ?, error = null,
      execution_stage = 'completed', stage_updated_at = ?, completed_at = coalesce(completed_at, ?), updated_at = ?, runner_lease_until = null, next_reconcile_at = null
      where id = ? and owner_id = ? and execution_target = 'local-comfyui' and runner_id = ? and status = 'running'
        and (automation_session_id is null or exists (
          select 1 from creative_overnight_sessions s where s.id = creative_jobs.automation_session_id and s.owner_id = creative_jobs.owner_id
            and s.status = 'running' and s.cutoff_at > ?
        ))`)
      .bind(artifactId, now, now, now, jobId, ownerId, runnerId, now),
    env.DB.prepare("update creative_runners set active_job_id = null, last_error = null, last_heartbeat_at = ? where id = ? and owner_id = ?")
      .bind(now, runnerId, ownerId),
  ]);
  if (!jobWrite.meta.changes) {
    if (created) await env.ARTIFACTS.delete(key);
    if (artifactWrite.meta.changes) {
      await env.DB.prepare("delete from creative_artifacts where id = ? and owner_id = ? and job_id = ?")
        .bind(artifactId, ownerId, jobId).run();
    }
    const latest = await backgroundJobById(env, jobId);
    if (latest?.status === "running") await assertAutomationJobMayComplete(env, latest, now);
    throw new Error("runner_job_not_completable");
  }
  const completed = await jobById(env, ownerId, jobId);
  if (!completed || completed.status !== "completed") throw new Error("runner_job_not_completable");
  await ensureTrainingExample(env, ownerId, completed, artifactId);
  return completed;
}

export async function retainLocalRunnerVideoThumbnail(
  env: Env,
  ownerId: string,
  runnerId: string,
  jobId: string,
  body: ReadableStream,
  contentTypeValue: string,
  declaredSize: number,
) {
  if (!env.ARTIFACTS) throw new Error("artifact_storage_not_configured");
  const contentType = contentTypeValue.toLowerCase().split(";", 1)[0].trim();
  if (contentType !== "image/jpeg") throw new Error("unsupported_video_thumbnail_type");
  if (!Number.isInteger(declaredSize) || declaredSize <= 0) throw new Error("empty_video_thumbnail");
  if (declaredSize > MAX_VIDEO_THUMBNAIL_BYTES) throw new Error("video_thumbnail_too_large");
  const background = await backgroundJobById(env, jobId);
  if (!background || background.ownerId !== ownerId) throw new Error("job_not_found");
  if (background.executionTarget !== "local-comfyui" || background.runnerId !== runnerId || background.modality !== "video") {
    throw new Error("runner_job_not_completable");
  }
  if (background.status !== "completed" || !background.artifactId) throw new Error("video_thumbnail_artifact_not_ready");

  const safeOwner = ownerId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const key = `owners/${safeOwner}/artifacts/${background.artifactId}/thumbnail.jpg`;
  const created = await putSizedStream(env.ARTIFACTS, key, body, declaredSize, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType },
    customMetadata: { ownerId, artifactId: background.artifactId, jobId, runnerId, frame: "first", retainedAt: new Date().toISOString() },
  });
  const retained = await env.ARTIFACTS.head(key);
  if (!retained || retained.size !== declaredSize) {
    if (created) await env.ARTIFACTS.delete(key);
    throw new Error("video_thumbnail_retention_verification_failed");
  }
  const updated = await env.DB.prepare(`update creative_artifacts set thumbnail_key = ?, thumbnail_content_type = ?, thumbnail_size = ?, updated_at = ?
    where id = ? and owner_id = ? and kind = 'video'`)
    .bind(key, contentType, retained.size, new Date().toISOString(), background.artifactId, ownerId).run();
  if (!updated.meta.changes) {
    if (created) await env.ARTIFACTS.delete(key);
    throw new Error("artifact_not_found");
  }
  return { artifactId: background.artifactId, key, size: retained.size, contentType };
}

export async function cancelOwnedJob(env: Env, ownerId: string, jobId: string) {
  const current = await jobById(env, ownerId, jobId);
  if (!current) throw new Error("job_not_found");
  if (current.status === "completed" || current.status === "failed") throw new Error("job_not_cancellable");
  if (current.artifactId) throw new Error("job_not_cancellable");
  if (current.status === "cancelled") return current;
  const now = new Date().toISOString();
  await env.DB.prepare(`update creative_jobs set status = 'cancelled', error = 'cancelled_by_user', execution_stage = 'cancelled',
    stage_updated_at = ?, cancelled_at = ?, completed_at = ?, next_reconcile_at = null, reconcile_lease_until = null, updated_at = ?
    where id = ? and owner_id = ? and status in ('queued', 'running')`)
    .bind(now, now, now, now, jobId, ownerId).run();
  const updated = await jobById(env, ownerId, jobId);
  if (!updated) throw new Error("job_not_found");
  return updated;
}

export async function reconcileDevelopmentJobs(env: Env, ownerId: string) {
  const jobs = await listJobs(env, ownerId);
  const now = new Date();
  for (const job of jobs) {
    if (job.provider !== "development-worker" || job.settingsStamp.source !== "creative-dna") continue;
    if (job.status !== "queued" && job.status !== "running") continue;
    const age = now.getTime() - new Date(job.createdAt).getTime();
    if (age >= 3_200) {
      const dna = (await listLocalDna(env, ownerId)).find((item) => item.artifactId === job.dnaArtifactId);
      await ensureArtifactForJob(env, ownerId, job, dna?.name ?? `${job.modality} artifact`, null);
    } else if (age >= 1_000 && job.status === "queued") {
      await env.DB.prepare("update creative_jobs set status = 'running', progress = 42, started_at = coalesce(started_at, ?), execution_stage = 'rendering', stage_updated_at = ?, updated_at = ? where id = ? and owner_id = ?")
        .bind(now.toISOString(), now.toISOString(), now.toISOString(), job.id, ownerId).run();
    }
  }
}

type ArtifactRow = {
  id: string; projectId: string; jobId: string; dnaArtifactId: string; kind: Artifact["kind"]; name: string;
  status: Artifact["status"]; provider: string; prompt: string; previewKind: Artifact["preview"]["kind"];
  previewUrl: string | null; previewFrom: string; previewTo: string; parentArtifactId: string | null;
  retainedKey: string | null; retainedSize: number | null; thumbnailKey: string | null; createdAt: string; updatedAt: string; settingsStampJson: string;
};

const ARTIFACT_COLUMNS = `id, project_id as projectId, job_id as jobId, dna_artifact_id as dnaArtifactId,
  kind, name, status, provider, prompt, preview_kind as previewKind, preview_url as previewUrl,
  preview_from as previewFrom, preview_to as previewTo, parent_artifact_id as parentArtifactId,
  retained_key as retainedKey, retained_size as retainedSize, thumbnail_key as thumbnailKey,
  created_at as createdAt, updated_at as updatedAt, settings_stamp_json as settingsStampJson`;

function mapArtifact(row: ArtifactRow): Artifact {
  const settingsStamp = parseSettingsStamp(row.settingsStampJson, {
    source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
    provider: row.provider, modality: row.kind, workflow: null, parameters: { prompt: row.prompt }, models: [], inputAssetIds: [],
  });
  return {
    id: row.id, projectId: row.projectId, jobId: row.jobId, dnaArtifactId: row.dnaArtifactId, kind: row.kind,
    name: row.name, status: row.status, provider: row.provider, prompt: row.prompt,
    preview: { kind: row.previewKind, url: row.previewUrl, posterUrl: row.thumbnailKey ? `/api/creative-studio/artifacts/${row.id}/thumbnail` : null, colors: [row.previewFrom, row.previewTo] },
    lineage: { sourceArtifactIds: settingsStamp.inputArtifactIds ?? [], parentArtifactId: row.parentArtifactId },
    retention: { state: row.previewKind === "development-gradient" ? "development-only" : row.retainedKey ? "retained" : "pending", size: row.retainedSize === null ? null : Number(row.retainedSize) },
    settingsStamp,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export async function listArtifacts(env: Env, ownerId: string): Promise<Artifact[]> {
  const result = await env.DB.prepare(`select ${ARTIFACT_COLUMNS} from creative_artifacts where owner_id = ? order by created_at desc, id desc limit ?`).bind(ownerId, ARTIFACT_SNAPSHOT_LIMIT).all<ArtifactRow>();
  return (result.results ?? []).map(mapArtifact);
}

export async function artifactsByIds(env: Env, ownerId: string, artifactIds: string[]): Promise<Artifact[]> {
  const ids = [...new Set(artifactIds.filter(Boolean))];
  if (!ids.length) return [];
  const result = await env.DB.prepare(`select ${ARTIFACT_COLUMNS} from creative_artifacts
    where owner_id = ? and id in (select value from json_each(?)) order by created_at desc, id desc`)
    .bind(ownerId, JSON.stringify(ids)).all<ArtifactRow>();
  return (result.results ?? []).map(mapArtifact);
}

export async function artifactById(env: Env, ownerId: string, artifactId: string) {
  const row = await env.DB.prepare(`select ${ARTIFACT_COLUMNS} from creative_artifacts where id = ? and owner_id = ?`)
    .bind(artifactId, ownerId).first<ArtifactRow>();
  return row ? mapArtifact(row) : null;
}

const ARTIFACT_STATUSES = new Set<Artifact["status"]>(["retaining", "ready", "accepted", "rejected", "archived"]);
const ARTIFACT_KINDS = new Set<Artifact["kind"]>(["music", "image", "video", "3d"]);

/** Stable, owner-scoped history pages. The live snapshot remains a bounded operational window. */
export async function listArtifactHistoryPage(env: Env, ownerId: string, query: ArtifactHistoryQuery = {}): Promise<ArtifactHistoryPage> {
  const limit = Math.max(1, Math.min(50, Math.round(Number(query.limit) || 24)));
  const projectId = boundedText(query.projectId, 100);
  const search = boundedText(query.search, 120).toLocaleLowerCase();
  const kinds = [...new Set(query.kinds ?? [])];
  const statuses = [...new Set(query.statuses ?? [])];
  if (kinds.some((kind) => !ARTIFACT_KINDS.has(kind))) throw new Error("invalid_artifact_history_kind");
  if (statuses.some((status) => !ARTIFACT_STATUSES.has(status))) throw new Error("invalid_artifact_history_status");
  const cursor = query.cursor ?? null;
  if (cursor && (!/^\d{4}-\d{2}-\d{2}T/.test(cursor.createdAt)
    || !Number.isFinite(Date.parse(cursor.createdAt))
    || !/^[a-z0-9_]{2,100}$/i.test(cursor.artifactId))) throw new Error("invalid_artifact_history_cursor");

  const clauses = ["owner_id = ?"];
  const bindings: unknown[] = [ownerId];
  if (projectId) {
    clauses.push("project_id = ?");
    bindings.push(projectId);
  }
  if (kinds.length) {
    clauses.push(`kind in (${kinds.map(() => "?").join(", ")})`);
    bindings.push(...kinds);
  }
  if (statuses.length) {
    clauses.push(`status in (${statuses.map(() => "?").join(", ")})`);
    bindings.push(...statuses);
  } else if (!query.includeArchived) {
    clauses.push("status <> 'archived'");
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(lower(name) like ? escape '\\' or lower(prompt) like ? escape '\\')");
    bindings.push(like, like);
  }
  const unpagedWhere = clauses.join(" and ");
  const pageClauses = [...clauses];
  const pageBindings = [...bindings];
  if (cursor) {
    pageClauses.push("(created_at < ? or (created_at = ? and id < ?))");
    pageBindings.push(cursor.createdAt, cursor.createdAt, cursor.artifactId);
  }
  const [rows, count] = await Promise.all([
    env.DB.prepare(`select ${ARTIFACT_COLUMNS} from creative_artifacts where ${pageClauses.join(" and ")}
      order by created_at desc, id desc limit ?`).bind(...pageBindings, limit + 1).all<ArtifactRow>(),
    env.DB.prepare(`select count(*) as total from creative_artifacts where ${unpagedWhere}`)
      .bind(...bindings).first<{ total: number }>(),
  ]);
  const availableRows = rows.results ?? [];
  const hasMore = availableRows.length > limit;
  const pageRows = availableRows.slice(0, limit);
  const artifacts = pageRows.map(mapArtifact);
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const jobIds = [...new Set(artifacts.map((artifact) => artifact.jobId))];
  let jobs: Job[] = [];
  let acceptances: Acceptance[] = [];
  let trainingExamples: CreativeTrainingExample[] = [];
  if (jobIds.length) {
    const jobRows = await env.DB.prepare(`select ${PUBLIC_JOB_COLUMNS} from creative_jobs
      where owner_id = ? and id in (${jobIds.map(() => "?").join(", ")})`)
      .bind(ownerId, ...jobIds).all<JobRow>();
    jobs = (jobRows.results ?? []).map(mapJob);
  }
  if (artifactIds.length) {
    const [acceptanceRows, exampleRows] = await Promise.all([
      env.DB.prepare(`select id, artifact_id as artifactId, decision, note, actor, created_at as createdAt
        from creative_acceptances where owner_id = ? and artifact_id in (${artifactIds.map(() => "?").join(", ")})
        order by created_at desc, id desc`).bind(ownerId, ...artifactIds).all<Acceptance>(),
      env.DB.prepare(`select id, project_id as projectId, dna_artifact_id as dnaArtifactId,
        artifact_id as artifactId, kind, status, prompt, settings_stamp_json as settingsStampJson,
        created_at as createdAt, updated_at as updatedAt from creative_training_examples
        where owner_id = ? and artifact_id in (${artifactIds.map(() => "?").join(", ")})
        order by created_at desc, id desc`).bind(ownerId, ...artifactIds).all<TrainingExampleRow>(),
    ]);
    acceptances = (acceptanceRows.results ?? []) as Acceptance[];
    trainingExamples = (exampleRows.results ?? []).map((row) => {
      const { settingsStampJson, ...example } = row;
      return {
        ...example,
        settingsStamp: parseSettingsStamp(settingsStampJson, {
          source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
          provider: "unknown", modality: row.kind, workflow: null, parameters: { prompt: row.prompt }, models: [], inputAssetIds: [],
        }),
      };
    });
  }
  const last = artifacts.at(-1);
  return {
    artifacts,
    jobs,
    acceptances,
    trainingExamples,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, artifactId: last.id } : null,
    hasMore,
    total: Number(count?.total ?? 0),
  };
}

export async function listAcceptances(env: Env, ownerId: string): Promise<Acceptance[]> {
  const result = await env.DB.prepare(`select id, artifact_id as artifactId, decision, note, actor, created_at as createdAt from creative_acceptances where owner_id = ? order by created_at desc, id desc limit 200`).bind(ownerId).all<Acceptance>();
  return (result.results ?? []) as Acceptance[];
}

type TrainingExampleRow = Omit<CreativeTrainingExample, "settingsStamp"> & { settingsStampJson: string };

export async function listTrainingExamples(env: Env, ownerId: string): Promise<CreativeTrainingExample[]> {
  const result = await env.DB.prepare(`select id, project_id as projectId, dna_artifact_id as dnaArtifactId,
    artifact_id as artifactId, kind, status, prompt, settings_stamp_json as settingsStampJson,
    created_at as createdAt, updated_at as updatedAt
    from creative_training_examples where owner_id = ? order by created_at desc limit 500`)
    .bind(ownerId).all<TrainingExampleRow>();
  return (result.results ?? []).map((row) => {
    const { settingsStampJson, ...example } = row;
    return {
      ...example,
      settingsStamp: parseSettingsStamp(settingsStampJson, {
        source: "creative-dna", createdAt: row.createdAt, reusedFromJobId: null, prompt: row.prompt,
        provider: "unknown", modality: row.kind, workflow: null, parameters: { prompt: row.prompt }, models: [], inputAssetIds: [],
      }),
    };
  });
}

export async function reviewArtifact(env: Env, ownerId: string, artifactId: string, decision: AcceptanceDecision, note: string) {
  const current = await env.DB.prepare("select id, status, preview_kind as previewKind, retained_key as retainedKey from creative_artifacts where id = ? and owner_id = ?").bind(artifactId, ownerId).first<{ id: string; status: Artifact["status"]; previewKind: Artifact["preview"]["kind"]; retainedKey: string | null }>();
  if (!current) throw new Error("artifact_not_found");
  if (current.status === "retaining") throw new Error("artifact_not_ready");
  if (current.previewKind === "remote-media" && !current.retainedKey) throw new Error("artifact_not_retained");
  const reviewNote = note.trim().slice(0, 500);
  if ((decision === "accepted" || decision === "rejected") && !reviewNote) throw new Error("review_note_required");
  const now = new Date().toISOString();
  const acceptance: Acceptance = { id: id("acceptance"), artifactId, decision, note: reviewNote, actor: "angelo", createdAt: now };
  const status = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "archived";
  await env.DB.batch([
    env.DB.prepare("update creative_artifacts set status = ?, updated_at = ? where id = ? and owner_id = ?").bind(status, now, artifactId, ownerId),
    env.DB.prepare("insert into creative_acceptances (id, owner_id, artifact_id, decision, note, actor, created_at) values (?, ?, ?, ?, ?, ?, ?)").bind(acceptance.id, ownerId, artifactId, decision, acceptance.note, acceptance.actor, now),
    env.DB.prepare(`update creative_training_examples set status = case
      when ? = 'accepted' then 'training-ready'
      when ? = 'rejected' then 'excluded'
      else status end, updated_at = ? where artifact_id = ? and owner_id = ?`)
      .bind(decision, decision, now, artifactId, ownerId),
  ]);
  const artifact = await artifactById(env, ownerId, artifactId);
  if (!artifact) throw new Error("artifact_not_found");
  return { artifact, acceptance };
}

export async function artifactMediaPath(env: Env, ownerId: string, artifactId: string) {
  return env.DB.prepare(`select upstream_media_path as mediaPath, retained_key as retainedKey,
    retained_content_type as retainedContentType, retained_size as retainedSize
    from creative_artifacts where id = ? and owner_id = ?`)
    .bind(artifactId, ownerId)
    .first<{ mediaPath: string | null; retainedKey: string | null; retainedContentType: string | null; retainedSize: number | null }>();
}

export async function artifactThumbnailPath(env: Env, ownerId: string, artifactId: string) {
  return env.DB.prepare(`select thumbnail_key as thumbnailKey, thumbnail_content_type as thumbnailContentType,
    thumbnail_size as thumbnailSize from creative_artifacts where id = ? and owner_id = ? and kind = 'video'`)
    .bind(artifactId, ownerId)
    .first<{ thumbnailKey: string | null; thumbnailContentType: string | null; thumbnailSize: number | null }>();
}

export async function retainArtifactMedia(
  env: Env,
  ownerId: string,
  artifactId: string,
  media: { body: ArrayBuffer | ReadableStream; contentType: string; extension: string; declaredSize?: number | null } | null,
) {
  if (!env.ARTIFACTS) throw new Error("artifact_retention_not_configured");
  const current = await artifactMediaPath(env, ownerId, artifactId);
  if (!current) throw new Error("artifact_not_found");
  if (current.retainedKey) {
    const retained = await env.ARTIFACTS.head(current.retainedKey);
    if (!retained || (current.retainedSize !== null && retained.size !== Number(current.retainedSize))) {
      throw new Error("artifact_retention_verification_failed");
    }
    return current.retainedKey;
  }
  if (!media) throw new Error("artifact_media_not_found");
  const safeOwner = ownerId.replace(/[^a-z0-9_-]/gi, "_").slice(0, 120);
  const key = `owners/${safeOwner}/artifacts/${artifactId}/result`;
  const created = await env.ARTIFACTS.put(key, media.body, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: media.contentType },
    customMetadata: { ownerId, artifactId, extension: media.extension, retainedAt: new Date().toISOString() },
  });
  const retained = await env.ARTIFACTS.head(key);
  const declaredSize = Number(media.declaredSize || 0);
  if (!retained || retained.size <= 0 || (declaredSize > 0 && retained.size !== declaredSize)) {
    if (created) await env.ARTIFACTS.delete(key);
    throw new Error("artifact_retention_verification_failed");
  }
  let updated: D1Result;
  try {
    updated = await env.DB.prepare(`update creative_artifacts set retained_key = ?, retained_content_type = ?, retained_size = ?, updated_at = ?
      where id = ? and owner_id = ? and retained_key is null`)
      .bind(key, media.contentType, retained.size, new Date().toISOString(), artifactId, ownerId).run();
  } catch (error) {
    if (created) await env.ARTIFACTS.delete(key);
    throw error;
  }
  if (!updated.meta.changes) {
    const winner = await artifactMediaPath(env, ownerId, artifactId);
    if (winner?.retainedKey === key) return key;
    if (created) await env.ARTIFACTS.delete(key);
    if (winner?.retainedKey) return winner.retainedKey;
    throw new Error("artifact_not_found");
  }
  return key;
}

export async function finalizeRetainedArtifact(env: Env, ownerId: string, artifactId: string) {
  const artifact = await env.DB.prepare(`select job_id as jobId, retained_key as retainedKey, retained_size as retainedSize
    from creative_artifacts where id = ? and owner_id = ?`)
    .bind(artifactId, ownerId).first<{ jobId: string; retainedKey: string | null; retainedSize: number | null }>();
  if (!artifact) throw new Error("artifact_not_found");
  if (!artifact.retainedKey || !Number(artifact.retainedSize || 0)) throw new Error("artifact_not_retained");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("update creative_artifacts set status = case when status = 'retaining' then 'ready' else status end, updated_at = ? where id = ? and owner_id = ?")
      .bind(now, artifactId, ownerId),
    env.DB.prepare("update creative_jobs set status = 'completed', progress = 100, artifact_id = ?, error = null, last_reconcile_error = null, execution_stage = 'completed', stage_updated_at = ?, completed_at = coalesce(completed_at, ?), updated_at = ?, next_reconcile_at = null where id = ? and owner_id = ? and status != 'cancelled'")
      .bind(artifactId, now, now, now, artifact.jobId, ownerId),
  ]);
  const job = await jobById(env, ownerId, artifact.jobId);
  if (!job) throw new Error("job_not_found");
  return job;
}
