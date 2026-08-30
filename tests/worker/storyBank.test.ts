import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  STORY_PLAN_SCHEMA_VERSION,
  storyRecommendationSelection,
  type CreativeDnaArtifact,
  type CreativeDnaTrainingAnalysis,
  type StoryPlan,
  type StoryPromptRecommendation,
  type StoryThread,
  type StudioSnapshot,
} from "../../shared/contracts";
import { createLocalDna, createProject } from "../../worker/repository";
import { routeCreativeStudioApi } from "../../worker/routes/api";
import { supportsStoryPlanning } from "../../worker/runner";
import { completeStoryPlan, ensureAutomaticStoryRefresh } from "../../worker/stories";
import type { Env } from "../../worker/types";

const BASE = "https://creative-studio.test";
const OWNER = "story-bank-owner";
const OTHER_OWNER = "story-bank-other-owner";

function request(path: string, init: RequestInit = {}) {
  return new Request(`${BASE}${path}`, init);
}

async function payload<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

function afdfwFor(ownerId: string): Fetcher {
  return {
    async fetch(input: RequestInfo | URL) {
      const path = new URL(new Request(input).url).pathname;
      if (path === "/api/me") {
        return Response.json({ status: "approved", user: { id: ownerId }, profile: { displayName: ownerId } });
      }
      if (path === "/api/creative-dna") return Response.json({ artifacts: [] });
      if (path === "/api/profile-song/generations" || path === "/api/profile-image/generations") {
        return Response.json({ generations: [] });
      }
      return Response.json({ ok: false, error: "unexpected_test_upstream" }, { status: 404 });
    },
  } as Fetcher;
}

function workerEnv(ownerId = OWNER): Env {
  return { DB: env.DB, BACKEND_MODE: "afdfw", AFDFW: afdfwFor(ownerId) };
}

async function clearData() {
  await env.DB.batch([
    env.DB.prepare("delete from creative_story_scheduler_state"),
    env.DB.prepare("delete from creative_story_recommendations"),
    env.DB.prepare("delete from creative_story_threads"),
    env.DB.prepare("delete from creative_story_refreshes"),
    env.DB.prepare("delete from creative_canon_promotions"),
    env.DB.prepare("delete from creative_canon_references"),
    env.DB.prepare("delete from creative_continuity_rules"),
    env.DB.prepare("delete from creative_world_entities"),
    env.DB.prepare("delete from creative_worlds"),
    env.DB.prepare("delete from creative_model_adapter_reviews"),
    env.DB.prepare("delete from creative_model_adapters"),
    env.DB.prepare("delete from creative_model_training_jobs"),
    env.DB.prepare("delete from creative_dna_training_reviews"),
    env.DB.prepare("delete from creative_dna_training_evidence_reservations"),
    env.DB.prepare("delete from creative_dna_training_jobs"),
    env.DB.prepare("delete from creative_training_examples"),
    env.DB.prepare("delete from creative_generation_recipe_evidence"),
    env.DB.prepare("delete from creative_generation_recipes"),
    env.DB.prepare("delete from creative_workflow_revisions"),
    env.DB.prepare("delete from creative_workflows"),
    env.DB.prepare("delete from creative_acceptances"),
    env.DB.prepare("delete from creative_artifacts"),
    env.DB.prepare("delete from creative_jobs"),
    env.DB.prepare("delete from creative_media_assets"),
    env.DB.prepare("delete from creative_dna_artifacts"),
    env.DB.prepare("delete from creative_runners"),
    env.DB.prepare("delete from creative_projects"),
  ]);
}

beforeEach(clearData);

async function runBatches(statements: D1PreparedStatement[], size = 50) {
  for (let index = 0; index < statements.length; index += size) {
    await env.DB.batch(statements.slice(index, index + size));
  }
}

async function importWorkflow(local: Env, projectId: string, name: string, fileName: string, graph: unknown) {
  const body = JSON.stringify(graph);
  const response = await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cs-project-id": projectId,
      "x-cs-file-name": encodeURIComponent(fileName),
      "x-cs-file-size": String(new TextEncoder().encode(body).byteLength),
      "x-cs-workflow-name": encodeURIComponent(name),
    },
    body,
  }), local);
  expect(response.status).toBe(201);
  return payload<{ workflow: {
    id: string;
    modality: string;
    currentRevision: { id: string; version: number; parameters: Array<{ id: string; value: unknown }> };
  } }>(response);
}

const dimensionKeys = ["energy", "tension", "contrast", "warmth", "spaciousness", "rhythmicity", "organicity", "polish"] as const;

async function storyFixture() {
  const local = workerEnv();
  const project = await createProject(env, OWNER, { name: "Living Story World", type: "Narrative system" });
  const sourceId = "media_story_source_001";
  const now = new Date().toISOString();
  await env.DB.prepare(`insert into creative_media_assets (
    id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
    source, status, training_eligible, created_at, updated_at
  ) values (?, ?, ?, 'image', ?, ?, 'image/png', 8, ?, 'upload', 'retained', 1, ?, ?)`)
    .bind(sourceId, OWNER, project.id, "Luminous source", "luminous-source.png",
      `owners/${OWNER}/uploads/${sourceId}/luminous-source.png`, now, now).run();

  const dna = await createLocalDna(env, OWNER, {
    projectId: project.id,
    name: "Luminous Story DNA",
    directive: "Tactile nocturnal worlds where one precise source becomes emotionally legible through light and motion.",
    targetModality: "image",
    sourceKind: "owner_uploads",
    referenceAssetIds: [sourceId],
  });
  const trainingJobId = "dnatraining_story_fixture_001";
  const trainedDna: CreativeDnaArtifact = {
    ...dna,
    training: {
      jobId: trainingJobId,
      runnerId: "runner_story_fixture",
      assetIds: [sourceId],
      trainingExampleIds: [],
      analysis: {
        schemaVersion: "creative-dna-training-analysis/1.1",
        createdAt: now,
        summary: "One consented luminous image was observed and translated into reusable visual and sonic direction.",
        sources: [{
          sourceId,
          mediaId: sourceId,
          sourceType: "upload",
          kind: "image",
          label: "Luminous source",
          detailedDescription: {
            schemaVersion: "creative-dna-media-description/1.1",
            longSummary: "A translucent amber figure occupies the lower center of a deep blue chamber while fine suspended particles catch a narrow beam and reveal tactile mineral walls.",
            shortSummary: "A translucent amber figure inside a deep blue mineral chamber.",
            provider: "local-comfyui",
            workflowId: "gemma4-multimodal-description",
            workflowVersion: 1,
            model: "gemma4_e4b_it_fp8_scaled.safetensors",
            prompt: "Describe the retained source as reusable concrete visual evidence.",
            comfyPromptId: "comfy_story_source_001",
            settings: { temperature: 0.2, seed: 7 },
          },
          observations: ["Amber translucency contrasts with a deep blue mineral enclosure."],
          metrics: { width: 1024, height: 1024 },
          dimensions: Object.fromEntries(dimensionKeys.map((key, index) => [key, 58 + index])),
          confidence: 0.92,
        }],
        dimensions: Object.fromEntries(dimensionKeys.map((key, index) => [key, {
          value: 58 + index,
          confidence: 0.92,
          sourceIds: [sourceId],
        }])) as CreativeDnaTrainingAnalysis["dimensions"],
      },
    },
  };
  await env.DB.batch([
    env.DB.prepare("update creative_dna_artifacts set dna_json = ? where id = ? and owner_id = ?")
      .bind(JSON.stringify(trainedDna), dna.artifactId, OWNER),
    env.DB.prepare(`insert into creative_dna_training_jobs (
      id, owner_id, project_id, base_dna_artifact_id, result_dna_artifact_id, name, target_modality,
      status, progress, provider, asset_ids_json, training_example_ids_json, idempotency_key, runner_id,
      error, created_at, updated_at, started_at, completed_at
    ) values (?, ?, ?, null, ?, 'Story DNA evidence', 'image', 'completed', 100,
      'local-creative-dna-runner', ?, '[]', 'story_fixture_training_001', 'runner_story_fixture', null, ?, ?, ?, ?)`)
      .bind(trainingJobId, OWNER, project.id, dna.artifactId, JSON.stringify([sourceId]), now, now, now, now),
    env.DB.prepare(`insert into creative_dna_training_reviews (
      id, owner_id, project_id, training_job_id, dna_artifact_id, decision, note, actor,
      active_dna_artifact_id, created_at
    ) values ('dnareview_story_fixture_001', ?, ?, ?, ?, 'approved', ?, 'angelo', ?, ?)`)
      .bind(OWNER, project.id, trainingJobId, dna.artifactId,
        "The source summary and reusable direction match the consented upload.", dna.artifactId, now),
  ]);

  const image = await importWorkflow(local, project.id, "Fast story image", "story-image-api.json", {
    "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "A luminous amber form in a deep blue chamber." }, _meta: { title: "Positive Prompt" } },
    "2": { class_type: "KSampler", inputs: { seed: 7, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1, positive: ["1", 0] }, _meta: { title: "Fast sampler" } },
    "3": { class_type: "EmptySD3LatentImage", inputs: { width: 512, height: 512, batch_size: 1 }, _meta: { title: "1:1 image size" } },
    "4": { class_type: "SaveImage", inputs: { images: ["2", 0] } },
  });
  const video = await importWorkflow(local, project.id, "Story motion", "story-video-api.json", {
    "1": { class_type: "LoadImage", inputs: { image: "source.png" } },
    "2": { class_type: "PrimitiveStringMultiline", inputs: { value: "The luminous form turns as the chamber opens." }, _meta: { title: "Positive Prompt" } },
    "3": { class_type: "MiniMaxH3I2V", inputs: { prompt: ["2", 0], image: ["1", 0], duration: 10 } },
    "4": { class_type: "SaveVideo", inputs: { video: ["3", 0] } },
  });
  const music = await importWorkflow(local, project.id, "Story score", "story-music-api.json", {
    "1": { class_type: "MiniMaxMusic3TextEncode", inputs: {
      caption: "Warm bass and glass percussion move beneath suspended harmony before one decisive release.",
      lyrics: "", seed: 17, max_duration: 60, cfg: 4, steps: 24,
    } },
    "2": { class_type: "SaveAudio", inputs: { audio: ["1", 0] } },
  });
  return { local, project, dna: trainedDna, sourceId, image: image.workflow, video: video.workflow, music: music.workflow };
}

async function insertOwnerHistoryBeyondPlanningSnapshotCaps(fixture: Awaited<ReturnType<typeof storyFixture>>) {
  const noiseProject = await createProject(env, OWNER, { name: "Catalog noise", type: "Historical material" });
  const later = new Date(Date.now() + 60_000).toISOString();
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < 100; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const artifactId = `dna_story_noise_${suffix}`;
    const artifact: CreativeDnaArtifact = {
      ...fixture.dna,
      artifactId,
      projectId: noiseProject.id,
      rootArtifactId: artifactId,
      name: `Noise DNA ${suffix}`,
      version: 1,
      createdAt: later,
      source: { ...fixture.dna.source, kind: "original", referenceLabel: null, referenceAssetIds: [] },
      rights: {
        policy: "original-input",
        referenceStoredAsProvenanceOnly: false,
        allowedDownstream: ["generation"],
        blockedDownstream: [],
      },
      lineage: { rootArtifactId: artifactId, parentArtifactId: null },
      training: null,
    };
    statements.push(env.DB.prepare(`insert into creative_dna_artifacts
      (id, owner_id, project_id, root_artifact_id, parent_artifact_id, version, dna_json, created_at)
      values (?, ?, ?, ?, null, 1, ?, ?)`)
      .bind(artifactId, OWNER, noiseProject.id, artifactId, JSON.stringify(artifact), later));
  }
  for (let index = 0; index < 250; index += 1) {
    const suffix = String(index).padStart(3, "0");
    statements.push(env.DB.prepare(`insert into creative_dna_training_reviews (
      id, owner_id, project_id, training_job_id, dna_artifact_id, decision, note, actor,
      active_dna_artifact_id, created_at
    ) values (?, ?, ?, 'dnatraining_story_fixture_001', ?, 'approved', 'Historical noise review',
      'angelo', null, ?)`)
      .bind(`dnareview_story_noise_${suffix}`, OWNER, noiseProject.id,
        `dna_story_noise_${String(index % 100).padStart(3, "0")}`, later));
  }
  for (let index = 0; index < 250; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const mediaId = `media_story_noise_${suffix}`;
    statements.push(env.DB.prepare(`insert into creative_media_assets (
      id, owner_id, project_id, kind, name, original_file_name, mime_type, size, r2_key,
      source, status, training_eligible, created_at, updated_at
    ) values (?, ?, ?, 'image', ?, ?, 'image/png', 8, ?, 'upload', 'retained', 0, ?, ?)`)
      .bind(mediaId, OWNER, noiseProject.id, `Noise upload ${suffix}`, `${mediaId}.png`,
        `owners/${OWNER}/uploads/${mediaId}/${mediaId}.png`, later, later));
  }
  const noiseParameters = JSON.stringify([{
    id: "1::value",
    label: "Positive Prompt",
    kind: "text",
    value: "Historical noise prompt",
    mediaKind: null,
    promptRole: "positive",
    binding: { format: "comfyui-api", nodeId: "1", inputName: "value" },
  }]);
  const noiseGraph = JSON.stringify({
    "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "Historical noise prompt" } },
    "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
  });
  for (let index = 0; index < 100; index += 1) {
    const suffix = String(index).padStart(3, "0");
    const workflowId = `workflow_story_noise_${suffix}`;
    const revisionId = `workflowrev_story_noise_${suffix}`;
    statements.push(
      env.DB.prepare(`insert into creative_workflows (
        id, owner_id, project_id, name, description, source_file_name, modality, execution_state,
        current_revision_id, created_at, updated_at
      ) values (?, ?, ?, ?, '', ?, 'image', 'ready', ?, ?, ?)`)
        .bind(workflowId, OWNER, noiseProject.id, `Noise workflow ${suffix}`, `${workflowId}.json`, revisionId, later, later),
      env.DB.prepare(`insert into creative_workflow_revisions (
        id, owner_id, workflow_id, version, parent_revision_id, format, content_hash, graph_json,
        node_count, parameters_json, models_json, created_at
      ) values (?, ?, ?, 1, null, 'comfyui-api', ?, ?, 2, ?, '[]', ?)`)
        .bind(revisionId, OWNER, workflowId, `noise_hash_${suffix}`, noiseGraph, noiseParameters, later),
    );
  }
  const selectedRecipeId = "recipe_story_complete_image_001";
  statements.push(env.DB.prepare(`insert into creative_generation_recipes (
    id, owner_id, project_id, world_id, name, description, media_kind, workflow_id, workflow_revision_id,
    model_identifier, prompt_profile_json, parameters_json, source_kinds_json, intent_tier,
    created_at, updated_at, archived_at
  ) values (?, ?, ?, null, 'Complete-history image recipe', '', 'image', ?, ?, null, ?, '{}', '["prompt"]',
    'scout', ?, ?, null)`)
    .bind(selectedRecipeId, OWNER, fixture.project.id, fixture.image.id, fixture.image.currentRevision.id,
      JSON.stringify({ id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: null }),
      fixture.dna.createdAt, fixture.dna.createdAt));
  for (let index = 0; index < 50; index += 1) {
    const suffix = String(index).padStart(3, "0");
    statements.push(env.DB.prepare(`insert into creative_generation_recipes (
      id, owner_id, project_id, world_id, name, description, media_kind, workflow_id, workflow_revision_id,
      model_identifier, prompt_profile_json, parameters_json, source_kinds_json, intent_tier,
      created_at, updated_at, archived_at
    ) values (?, ?, ?, null, ?, '', 'image', ?, ?, null, ?, '{}', '["prompt"]', 'scout', ?, ?, null)`)
      .bind(`recipe_story_noise_${suffix}`, OWNER, noiseProject.id, `Noise recipe ${suffix}`,
        `workflow_story_noise_${suffix}`, `workflowrev_story_noise_${suffix}`,
        JSON.stringify({ id: "noise-direct", version: "1.0", targetModel: null }), later, later));
  }
  await runBatches(statements);
  return { noiseProject, selectedRecipeId };
}

function storyPlan(): StoryPlan {
  const roles = ["faithful", "signature", "frontier", "awe"] as const;
  return {
    schemaVersion: STORY_PLAN_SCHEMA_VERSION,
    stories: roles.map((role, index) => ({
      index: index + 1,
      role,
      title: `${role} chamber`,
      logline: `The ${role} path follows an amber figure as a mineral chamber learns to answer its changing light.`,
      image: {
        title: `${role} chamber still`,
        prompt: `A ${role} translucent amber figure in a deep blue mineral chamber, narrow light, suspended particles, tactile detail, decisive composition, no text.`,
      },
      video: {
        title: `${role} chamber motion`,
        prompt: `SHOT 1 (0.00s-3.00s): The ${role} amber figure turns toward a moving seam of light while the opening-frame anatomy and chamber remain continuous.\nSHOT 2 (3.00s-7.00s): The seam crosses the mineral walls and suspended particles gather into a visible current as the camera advances.\nSHOT 3 (7.00s-10.00s): The chamber opens into deeper blue space and the camera settles on one illuminated internal detail.\nAudio: Mineral resonance, moving particles, low chamber ambience, and restrained original instrumental tones; no dialogue or lyrics.`,
      },
      music: {
        title: `${role} chamber score`,
        prompt: `### Global Metadata\nInstrumental ${role} nocturnal electronic score at ${100 + index * 4} BPM, moving from suspended attention toward a luminous release through tactile mineral resonance.\n### Vocal Details\nNo vocals or lyrics; a glassy lead texture carries the expressive contour without imitating a singer.\n### Arrangement\nOpen with isolated glass percussion and warm sub bass, introduce suspended synthetic harmony and intimate chamber reflections, tighten the pulse around one controlled rupture, then clear the low mids and resolve into a wide luminous final chord with precise transients and deep spatial detail.`,
      },
    })),
  };
}

async function counts() {
  const tables = [
    "creative_acceptances",
    "creative_training_examples",
    "creative_dna_training_jobs",
    "creative_dna_training_reviews",
    "creative_model_training_jobs",
    "creative_model_adapters",
    "creative_canon_references",
    "creative_canon_promotions",
  ] as const;
  return Object.fromEntries(await Promise.all(tables.map(async (table) => {
    const row = await env.DB.prepare(`select count(*) as count from ${table}`).first<{ count: number }>();
    return [table, Number(row?.count ?? 0)] as const;
  }))) as Record<(typeof tables)[number], number>;
}

describe("durable Story Bank", () => {
  it("requires the runner version that actually implements Story planning", () => {
    expect(supportsStoryPlanning("1.16.0")).toBe(false);
    expect(supportsStoryPlanning("1.17.0")).toBe(true);
    expect(supportsStoryPlanning("2.0.0")).toBe(true);
    expect(supportsStoryPlanning(null)).toBe(false);
  });

  it("plans from every active project's selected evidence after unrelated owner history exceeds UI snapshot caps", async () => {
    const fixture = await storyFixture();
    const { selectedRecipeId } = await insertOwnerHistoryBeyondPlanningSnapshotCaps(fixture);
    const response = await routeCreativeStudioApi(request("/api/creative-studio/story-bank/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: fixture.project.id, idempotencyKey: "story_complete_catalog_001" }),
    }), fixture.local);
    expect(response.status).toBe(202);
    const created = await payload<{ storyBankRefresh: { id: string; dnaArtifactId: string } }>(response);
    expect(created.storyBankRefresh.dnaArtifactId).toBe(fixture.dna.artifactId);
    const stored = await env.DB.prepare(`select source_refs_json as sourceRefsJson,
      planner_context_json as plannerContextJson, workflows_json as workflowsJson
      from creative_story_refreshes where id = ? and owner_id = ?`)
      .bind(created.storyBankRefresh.id, OWNER).first<{
        sourceRefsJson: string;
        plannerContextJson: string;
        workflowsJson: string;
      }>();
    expect(JSON.parse(stored!.sourceRefsJson)).toEqual([
      { id: fixture.sourceId, sourceType: "upload", kind: "image" },
    ]);
    expect(JSON.parse(stored!.plannerContextJson)).toMatchObject({
      sources: [expect.objectContaining({ id: fixture.sourceId, sourceType: "upload", kind: "image" })],
    });
    expect(JSON.parse(stored!.workflowsJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modality: "image",
        workflowId: fixture.image.id,
        workflowRevisionId: fixture.image.currentRevision.id,
        recipeId: selectedRecipeId,
      }),
      expect.objectContaining({ modality: "video", workflowId: fixture.video.id }),
      expect.objectContaining({ modality: "music", workflowId: fixture.music.id }),
    ]));
    const runningAt = new Date(Date.now() + 120_000).toISOString();
    await env.DB.prepare(`update creative_story_refreshes set status = 'running', runner_id = 'runner_complete_catalog',
      runner_lease_until = ?, started_at = ?, updated_at = ? where id = ? and owner_id = ?`)
      .bind(runningAt, runningAt, runningAt, created.storyBankRefresh.id, OWNER).run();
    await completeStoryPlan(fixture.local, {
      id: "runner_complete_catalog",
      ownerId: OWNER,
      version: "1.17.0",
    }, created.storyBankRefresh.id, {
      plan: storyPlan(),
      comfyPromptId: "comfy_complete_catalog_001",
      plannerModel: "gemma4-local-test",
    });
    const snapshotResponse = await routeCreativeStudioApi(request("/api/creative-studio/snapshot"), fixture.local);
    expect(snapshotResponse.status).toBe(200);
    const snapshot = (await payload<{ snapshot: StudioSnapshot }>(snapshotResponse)).snapshot;
    expect(snapshot.dnaArtifacts.some((artifact) => artifact.artifactId === fixture.dna.artifactId)).toBe(true);
    expect(snapshot.trainingReviews.some((review) => review.dnaArtifactId === fixture.dna.artifactId
      && review.decision === "approved")).toBe(true);
    expect(snapshot.mediaAssets.some((asset) => asset.id === fixture.sourceId)).toBe(true);
    expect(snapshot.workflows.map((workflow) => workflow.id)).toEqual(expect.arrayContaining([
      fixture.image.id,
      fixture.video.id,
      fixture.music.id,
    ]));
  });

  it("hydrates an exact retained artifact source for a visible recommendation beyond the artifact snapshot cap", async () => {
    const fixture = await storyFixture();
    const noiseProject = await createProject(env, OWNER, { name: "Artifact history noise", type: "Historical material" });
    const sourceArtifactId = "artifact_story_source_exact_001";
    const oldAt = "2000-01-01T00:00:00.000Z";
    const later = new Date(Date.now() + 60_000).toISOString();
    const sourceAnalysis = fixture.dna.training!.analysis.sources[0];
    const artifactDna: CreativeDnaArtifact = {
      ...fixture.dna,
      training: {
        ...fixture.dna.training!,
        analysis: {
          ...fixture.dna.training!.analysis,
          sources: [{
            ...sourceAnalysis,
            sourceId: "trainingexample_story_source_exact_001",
            mediaId: sourceArtifactId,
            sourceType: "accepted-artifact",
            label: "Accepted exact-history source",
          }],
        },
      },
    };
    const artifacts: D1PreparedStatement[] = [
      env.DB.prepare(`insert into creative_artifacts (
        id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
        preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id,
        created_at, updated_at, retained_key, retained_content_type, retained_size
      ) values (?, ?, ?, 'job_story_source_exact_001', ?, 'image', 'Exact retained source', 'accepted',
        'local-comfyui', 'Retained source prompt', 'remote-media', ?, '#111827', '#f59e0b', null, null,
        ?, ?, ?, 'image/png', 8)`)
        .bind(sourceArtifactId, OWNER, fixture.project.id, fixture.dna.artifactId,
          `/api/creative-studio/artifacts/${sourceArtifactId}/content`, oldAt, oldAt,
          `owners/${OWNER}/artifacts/${sourceArtifactId}/result.png`),
      env.DB.prepare("update creative_dna_artifacts set dna_json = ? where id = ? and owner_id = ?")
        .bind(JSON.stringify(artifactDna), fixture.dna.artifactId, OWNER),
    ];
    for (let index = 0; index < 100; index += 1) {
      const suffix = String(index).padStart(3, "0");
      const artifactId = `artifact_story_noise_${suffix}`;
      artifacts.push(env.DB.prepare(`insert into creative_artifacts (
        id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
        preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id,
        created_at, updated_at, retained_key, retained_content_type, retained_size
      ) values (?, ?, ?, ?, ?, 'image', ?, 'accepted', 'local-comfyui', 'Noise prompt',
        'remote-media', ?, '#111827', '#334155', null, null, ?, ?, ?, 'image/png', 8)`)
        .bind(artifactId, OWNER, noiseProject.id, `job_story_noise_${suffix}`, fixture.dna.artifactId,
          `Noise artifact ${suffix}`, `/api/creative-studio/artifacts/${artifactId}/content`, later, later,
          `owners/${OWNER}/artifacts/${artifactId}/result.png`));
    }
    await runBatches(artifacts);
    const refreshResponse = await routeCreativeStudioApi(request("/api/creative-studio/story-bank/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: fixture.project.id, idempotencyKey: "story_exact_artifact_001" }),
    }), fixture.local);
    expect(refreshResponse.status).toBe(202);
    const refresh = await payload<{ storyBankRefresh: { id: string } }>(refreshResponse);
    await env.DB.prepare(`update creative_story_refreshes set status = 'running', runner_id = 'runner_exact_artifact',
      runner_lease_until = ?, started_at = ?, updated_at = ? where id = ? and owner_id = ?`)
      .bind(later, later, later, refresh.storyBankRefresh.id, OWNER).run();
    await completeStoryPlan(fixture.local, {
      id: "runner_exact_artifact",
      ownerId: OWNER,
      version: "1.17.0",
    }, refresh.storyBankRefresh.id, {
      plan: storyPlan(),
      comfyPromptId: "comfy_exact_artifact_001",
      plannerModel: "gemma4-local-test",
    });
    const snapshot = (await payload<{ snapshot: StudioSnapshot }>(
      await routeCreativeStudioApi(request("/api/creative-studio/snapshot"), fixture.local),
    )).snapshot;
    expect(snapshot.storyThreads.flatMap((story) => story.recommendations)
      .some((recommendation) => recommendation.sourceId === sourceArtifactId && recommendation.sourceType === "artifact")).toBe(true);
    expect(snapshot.artifacts.some((artifact) => artifact.id === sourceArtifactId)).toBe(true);
  });

  it("retries only due current-fingerprint failures without starvation or obsolete-failure scan poisoning", async () => {
    const fixture = await storyFixture();
    const refreshResponse = await routeCreativeStudioApi(request("/api/creative-studio/story-bank/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: fixture.project.id, idempotencyKey: "story_retry_current_001" }),
    }), fixture.local);
    const refresh = await payload<{ storyBankRefresh: { id: string; evidenceFingerprint: string } }>(refreshResponse);
    const enrollmentResponse = await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Retry scheduler runner" }),
    }), fixture.local);
    const enrollment = await payload<{ runner: { id: string }; token: string }>(enrollmentResponse);
    const runnerHeaders = { authorization: `Bearer ${enrollment.token}`, "content-type": "application/json" };
    const claim = await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({
        version: "1.17.0",
        comfyUrl: "http://127.0.0.1:8188",
        comfyReady: true,
        comfyVersion: "0.33.0",
        device: "Test GPU",
        activeJobId: null,
        error: null,
        modelTrainingProviders: [],
      }),
    }), fixture.local);
    expect(await payload(claim)).toMatchObject({ kind: "story-plan", bundle: { refresh: { id: refresh.storyBankRefresh.id } } });
    const failed = await routeCreativeStudioApi(request(`/api/creative-studio/runner/story-plans/${refresh.storyBankRefresh.id}/fail`, {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ error: "story_planning_timed_out" }),
    }), fixture.local);
    expect(failed.status).toBe(200);
    const scheduled = await env.DB.prepare(`select next_scan_at as nextScanAt, transient_retry_at as transientRetryAt
      from creative_story_scheduler_state where owner_id = ?`).bind(OWNER).first<{
        nextScanAt: string;
        transientRetryAt: string | null;
      }>();
    expect(scheduled?.transientRetryAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(scheduled?.nextScanAt).toBe(scheduled?.transientRetryAt);

    const permanentFailures = Array.from({ length: 60 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return env.DB.prepare(`insert into creative_story_refreshes (
        id, owner_id, project_id, dna_artifact_id, world_id, evidence_fingerprint, trigger,
        source_refs_json, planner_context_json, workflows_json, status, planner_provider,
        error, idempotency_key, created_at, updated_at
      ) values (?, ?, ?, ?, null, ?, 'automatic', '[]', '{}', '[]', 'failed', 'local-comfyui',
        'story_plan_output_invalid', ?, ?, ?)`)
        .bind(`storyplan_permanent_${suffix}`, OWNER, fixture.project.id, fixture.dna.artifactId,
          `permanent_fingerprint_${suffix}`, `story_permanent_${suffix}`,
          `1999-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
          `1999-01-01T00:${String(index).padStart(2, "0")}:00.000Z`);
    });
    await runBatches(permanentFailures);
    await env.DB.batch([
      env.DB.prepare("update creative_story_refreshes set updated_at = ? where id = ? and owner_id = ?")
        .bind("2000-01-01T00:00:00.000Z", refresh.storyBankRefresh.id, OWNER),
      env.DB.prepare(`update creative_story_scheduler_state set next_scan_at = ?, transient_retry_at = ?
        where owner_id = ?`).bind("2001-01-01T00:00:00.000Z", "2001-01-01T00:00:00.000Z", OWNER),
    ]);
    expect(await ensureAutomaticStoryRefresh(fixture.local, OWNER)).toMatchObject({ id: refresh.storyBankRefresh.id, status: "waiting-for-runner" });
    expect(await env.DB.prepare("select status from creative_story_refreshes where id = ? and owner_id = ?")
      .bind(refresh.storyBankRefresh.id, OWNER).first<{ status: string }>()).toEqual({ status: "waiting-for-runner" });

    await env.DB.batch([
      env.DB.prepare(`update creative_story_refreshes set status = 'completed', completed_at = ?, updated_at = ?
        where id = ? and owner_id = ?`).bind("2002-01-01T00:00:00.000Z", "2002-01-01T00:00:00.000Z", refresh.storyBankRefresh.id, OWNER),
      env.DB.prepare(`insert into creative_story_refreshes (
        id, owner_id, project_id, dna_artifact_id, world_id, evidence_fingerprint, trigger,
        source_refs_json, planner_context_json, workflows_json, status, planner_provider,
        error, idempotency_key, created_at, updated_at
      ) values ('storyplan_obsolete_transient', ?, ?, ?, null, 'obsolete_fingerprint', 'automatic',
        '[]', '{}', '[]', 'failed', 'local-comfyui', 'story_planning_timed_out',
        'story_obsolete_transient_001', '2001-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z')`)
        .bind(OWNER, fixture.project.id, fixture.dna.artifactId),
      env.DB.prepare(`update creative_story_scheduler_state set next_scan_at = ?, transient_retry_at = ?
        where owner_id = ?`).bind("2003-01-01T00:00:00.000Z", "2003-01-01T00:00:00.000Z", OWNER),
    ]);
    expect(await ensureAutomaticStoryRefresh(fixture.local, OWNER)).toBeNull();
    const afterObsolete = await env.DB.prepare(`select transient_retry_at as transientRetryAt
      from creative_story_scheduler_state where owner_id = ?`).bind(OWNER).first<{ transientRetryAt: string | null }>();
    expect(afterObsolete?.transientRetryAt).toBeNull();
    expect(await env.DB.prepare("select status from creative_story_refreshes where id = 'storyplan_obsolete_transient'")
      .first<{ status: string }>()).toEqual({ status: "failed" });

    await env.DB.prepare("update creative_story_scheduler_state set next_scan_at = ? where owner_id = ?")
      .bind("2004-01-01T00:00:00.000Z", OWNER).run();
    const observedSql: string[] = [];
    const observedDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") return (sql: string) => {
          observedSql.push(sql.replace(/\s+/g, " ").trim());
          return target.prepare(sql);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    expect(await ensureAutomaticStoryRefresh({ ...fixture.local, DB: observedDb }, OWNER)).toBeNull();
    expect(observedSql).toHaveLength(4);
    expect(observedSql.some((sql) => sql.includes("from creative_story_threads"))).toBe(false);
    expect(observedSql.some((sql) => sql.includes("from creative_media_assets") && !sql.includes("max(updated_at)"))).toBe(false);

    const changedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`update creative_workflows set execution_state = 'api-export-required', updated_at = ?
        where id = ? and owner_id = ?`).bind(changedAt, fixture.image.id, OWNER),
      env.DB.prepare(`update creative_story_scheduler_state set next_scan_at = ?, transient_retry_at = ?
        where owner_id = ?`).bind("2005-01-01T00:00:00.000Z", "2005-01-01T00:00:00.000Z", OWNER),
    ]);
    expect(await ensureAutomaticStoryRefresh(fixture.local, OWNER)).toBeNull();
    const invalidCurrentEvidence = await env.DB.prepare(`select next_scan_at as nextScanAt,
      transient_retry_at as transientRetryAt from creative_story_scheduler_state where owner_id = ?`)
      .bind(OWNER).first<{ nextScanAt: string; transientRetryAt: string | null }>();
    expect(invalidCurrentEvidence?.transientRetryAt).toBeNull();
    expect(new Date(invalidCurrentEvidence!.nextScanAt).getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 60_000);
  });

  it("protects exact commercial DNA identity even when owner history exceeds the DNA snapshot cap", async () => {
    const fixture = await storyFixture();
    const response = await routeCreativeStudioApi(request("/api/creative-studio/story-bank/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: fixture.project.id, idempotencyKey: "story_identity_lookup_001" }),
    }), fixture.local);
    const refresh = await payload<{ storyBankRefresh: { id: string } }>(response);
    const protectedIdentity = "Hidden Commercial Muse";
    const commercialDna: CreativeDnaArtifact = {
      ...fixture.dna,
      source: {
        ...fixture.dna.source,
        kind: "commercial_reference",
        referenceLabel: protectedIdentity,
      },
      rights: {
        ...fixture.dna.rights,
        policy: "abstract-attributes-only",
        referenceStoredAsProvenanceOnly: true,
      },
    };
    const later = new Date(Date.now() + 60_000).toISOString();
    const noiseRows = Array.from({ length: 100 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      const artifactId = `dna_identity_noise_${suffix}`;
      return env.DB.prepare(`insert into creative_dna_artifacts
        (id, owner_id, project_id, root_artifact_id, parent_artifact_id, version, dna_json, created_at)
        values (?, ?, ?, ?, null, 1, '{}', ?)`)
        .bind(artifactId, OWNER, fixture.project.id, artifactId, later);
    });
    await env.DB.batch([
      env.DB.prepare("update creative_dna_artifacts set dna_json = ? where id = ? and owner_id = ?")
        .bind(JSON.stringify(commercialDna), fixture.dna.artifactId, OWNER),
      env.DB.prepare(`update creative_story_refreshes set status = 'running', runner_id = 'runner_identity_exact',
        runner_lease_until = ?, started_at = ?, updated_at = ? where id = ? and owner_id = ?`)
        .bind(later, later, later, refresh.storyBankRefresh.id, OWNER),
    ]);
    await runBatches(noiseRows);
    const invalidPlan = structuredClone(storyPlan());
    invalidPlan.stories[0].title = `${protectedIdentity} chamber`;
    await expect(completeStoryPlan(fixture.local, {
      id: "runner_identity_exact",
      ownerId: OWNER,
      version: "1.17.0",
    }, refresh.storyBankRefresh.id, {
      plan: invalidPlan,
      comfyPromptId: "comfy_identity_exact_001",
      plannerModel: "gemma4-local-test",
    })).rejects.toThrow("continuity_commercial_identity_in_prompt");
  });

  it("stays empty until planned, then refreshes, claims, completes, scopes, versions, and stamps exact reusable recommendations", async () => {
    const fixture = await storyFixture();
    const empty = await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local);
    expect(empty.status).toBe(200);
    expect(await payload(empty)).toMatchObject({ ok: true, storyThreads: [], storyBankRefreshes: [] });

    const refreshInput = { projectId: fixture.project.id, idempotencyKey: "story_refresh_manual_001" };
    const createRefresh = () => routeCreativeStudioApi(request("/api/creative-studio/story-bank/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(refreshInput),
    }), fixture.local);
    const firstRefreshResponse = await createRefresh();
    expect(firstRefreshResponse.status).toBe(202);
    const firstRefresh = await payload<{ storyBankRefresh: { id: string; status: string; trigger: string; evidenceFingerprint: string } }>(firstRefreshResponse);
    const duplicateRefresh = await payload<{ storyBankRefresh: { id: string } }>(await createRefresh());
    expect(duplicateRefresh.storyBankRefresh.id).toBe(firstRefresh.storyBankRefresh.id);
    expect(firstRefresh.storyBankRefresh).toMatchObject({ status: "waiting-for-runner", trigger: "manual" });
    expect(firstRefresh.storyBankRefresh.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const enrollmentResponse = await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Story planner runner" }),
    }), fixture.local);
    expect(enrollmentResponse.status).toBe(201);
    const enrollment = await payload<{ runner: { id: string }; token: string }>(enrollmentResponse);
    const runnerHeaders = { authorization: `Bearer ${enrollment.token}`, "content-type": "application/json" };
    const claim = await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({
        version: "1.17.0",
        comfyUrl: "http://127.0.0.1:8188",
        comfyReady: true,
        comfyVersion: "0.33.0",
        device: "Test GPU",
        activeJobId: null,
        error: null,
        modelTrainingProviders: [],
      }),
    }), fixture.local);
    expect(claim.status).toBe(200);
    const claimed = await payload<{ kind: string; bundle: {
      refresh: { id: string; status: string; runnerId: string };
      context: { sources: Array<{ id: string; longSummary: string }>; recentStories: unknown[] };
      workflows: Array<{ modality: string; workflowId: string; workflowRevisionId: string; sourceId: string | null }>;
    } }>(claim);
    expect(claimed.kind).toBe("story-plan");
    expect(claimed.bundle.refresh).toMatchObject({ id: firstRefresh.storyBankRefresh.id, status: "running", runnerId: enrollment.runner.id });
    expect(claimed.bundle.context.sources).toEqual([
      expect.objectContaining({ id: fixture.sourceId, longSummary: expect.stringContaining("translucent amber figure") }),
    ]);
    expect(claimed.bundle.context.recentStories).toEqual([]);
    expect(claimed.bundle.workflows.map((workflow) => [workflow.modality, workflow.workflowRevisionId])).toEqual([
      ["image", fixture.image.currentRevision.id],
      ["video", fixture.video.currentRevision.id],
      ["music", fixture.music.currentRevision.id],
    ]);

    const scheduler = await env.DB.prepare(`select next_scan_at as nextScanAt,
      evidence_high_watermark as evidenceHighWatermark from creative_story_scheduler_state where owner_id = ?`)
      .bind(OWNER).first<{ nextScanAt: string; evidenceHighWatermark: string | null }>();
    expect(new Date(scheduler!.nextScanAt).getTime()).toBeGreaterThan(Date.now() + 7 * 60 * 60_000);
    expect(scheduler?.evidenceHighWatermark).toMatch(/^[a-f0-9]{64}$/);

    const observedSql: string[] = [];
    const observedDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") return (sql: string) => {
          observedSql.push(sql.replace(/\s+/g, " ").trim());
          return target.prepare(sql);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    expect(await ensureAutomaticStoryRefresh({ ...fixture.local, DB: observedDb }, OWNER)).toBeNull();
    expect(observedSql).toHaveLength(1);
    expect(observedSql[0]).toContain("from creative_story_scheduler_state");

    await env.DB.prepare("update creative_story_scheduler_state set next_scan_at = ? where owner_id = ?")
      .bind("2000-01-01T00:00:00.000Z", OWNER).run();
    observedSql.length = 0;
    expect(await ensureAutomaticStoryRefresh({ ...fixture.local, DB: observedDb }, OWNER)).toBeNull();
    expect(observedSql).toHaveLength(4);
    expect(observedSql.some((sql) => sql.includes("from creative_story_threads"))).toBe(false);
    expect(observedSql.some((sql) => sql.includes("from creative_media_assets") && !sql.includes("max(updated_at)"))).toBe(false);

    const planned = storyPlan();
    const invalidVideoPlan = structuredClone(planned);
    invalidVideoPlan.stories[0].video.prompt = "The amber figure turns while the chamber opens in one continuous move with atmospheric sound.";
    const invalidVideo = await routeCreativeStudioApi(request(`/api/creative-studio/runner/story-plans/${firstRefresh.storyBankRefresh.id}/complete`, {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ plan: invalidVideoPlan, comfyPromptId: "comfy_story_plan_invalid_video", plannerModel: "gemma4-local-test" }),
    }), fixture.local);
    expect({ status: invalidVideo.status, body: await payload(invalidVideo) }).toMatchObject({
      status: 400,
      body: { error: "story_plan_video_format_invalid" },
    });
    const invalidMusicPlan = structuredClone(planned);
    invalidMusicPlan.stories[0].music.prompt = "Glass percussion and warm bass move toward a luminous instrumental release.";
    const invalidMusic = await routeCreativeStudioApi(request(`/api/creative-studio/runner/story-plans/${firstRefresh.storyBankRefresh.id}/complete`, {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ plan: invalidMusicPlan, comfyPromptId: "comfy_story_plan_invalid_music", plannerModel: "gemma4-local-test" }),
    }), fixture.local);
    expect({ status: invalidMusic.status, body: await payload(invalidMusic) }).toMatchObject({
      status: 400,
      body: { error: "story_plan_music_format_invalid" },
    });
    const completeRequest = () => routeCreativeStudioApi(request(`/api/creative-studio/runner/story-plans/${firstRefresh.storyBankRefresh.id}/complete`, {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ plan: planned, comfyPromptId: "comfy_story_plan_001", plannerModel: "gemma4-local-test" }),
    }), fixture.local);
    const completed = await completeRequest();
    expect(completed.status).toBe(200);
    expect(await payload(completed)).toMatchObject({ storyBankRefresh: { status: "completed", comfyPromptId: "comfy_story_plan_001", plannerModel: "gemma4-local-test" } });
    expect((await completeRequest()).status).toBe(200);

    const bankResponse = await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local);
    const bank = await payload<{ storyThreads: StoryThread[]; storyBankRefreshes: Array<{ id: string; status: string }> }>(bankResponse);
    expect(bank.storyThreads).toHaveLength(4);
    expect(bank.storyThreads.map((story) => story.title).sort()).toEqual(planned.stories.map((story) => story.title).sort());
    expect(bank.storyThreads.map((story) => story.updatedAt)).toEqual(
      [...bank.storyThreads].map((story) => story.updatedAt).sort((left, right) => right.localeCompare(left)),
    );
    expect(bank.storyThreads.every((story) => story.recommendations.length === 3)).toBe(true);
    expect(bank.storyThreads.flatMap((story) => [story.title, story.logline, ...story.recommendations.map((item) => item.prompt)]).join(" "))
      .not.toMatch(/placeholder|sample story|lorem ipsum|development preview/i);
    expect(bank.storyBankRefreshes).toEqual([expect.objectContaining({ id: firstRefresh.storyBankRefresh.id, status: "completed" })]);

    const otherProject = await createProject(env, OWNER, { name: "Other story world", type: "Narrative system" });
    const otherProjectList = await payload<{ storyThreads: unknown[]; storyBankRefreshes: unknown[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${otherProject.id}`), fixture.local),
    );
    expect(otherProjectList).toMatchObject({ storyThreads: [], storyBankRefreshes: [] });
    const otherOwnerList = await payload<{ storyThreads: unknown[]; storyBankRefreshes: unknown[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), workerEnv(OTHER_OWNER)),
    );
    expect(otherOwnerList).toMatchObject({ storyThreads: [], storyBankRefreshes: [] });

    const originalStory = bank.storyThreads[0];
    const pinnedResponse = await routeCreativeStudioApi(request(`/api/creative-studio/story-bank/stories/${originalStory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: originalStory.version, pinned: true }),
    }), fixture.local);
    expect(pinnedResponse.status).toBe(200);
    const pinned = await payload<{ storyThread: StoryThread }>(pinnedResponse);
    expect(pinned.storyThread).toMatchObject({ id: originalStory.id, pinned: true, version: originalStory.version + 1 });
    const staleUpdate = await routeCreativeStudioApi(request(`/api/creative-studio/story-bank/stories/${originalStory.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: originalStory.version, status: "parked" }),
    }), fixture.local);
    expect(staleUpdate.status).toBe(409);
    expect(await payload(staleUpdate)).toMatchObject({ error: "story_thread_version_conflict" });

    const imageRecommendation = pinned.storyThread.recommendations.find((item) => item.modality === "image") as StoryPromptRecommendation;
    expect(imageRecommendation.workflowRevisionId).toBe(fixture.image.currentRevision.id);
    const childRevisionResponse = await routeCreativeStudioApi(request(`/api/creative-studio/workflows/${fixture.image.id}/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseRevisionId: fixture.image.currentRevision.id,
        values: { "1::value": imageRecommendation.prompt, "2::seed": 101 },
      }),
    }), fixture.local);
    expect(childRevisionResponse.status).toBe(201);
    const child = await payload<{ workflow: { currentRevision: { id: string; version: number; parentRevisionId: string } } }>(childRevisionResponse);
    expect(child.workflow.currentRevision).toMatchObject({ version: 2, parentRevisionId: fixture.image.currentRevision.id });

    const createDna = async (body: Record<string, unknown>) => {
      const response = await routeCreativeStudioApi(request("/api/creative-studio/dna", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }), fixture.local);
      expect(response.status).toBe(201);
      return payload<{ artifact: CreativeDnaArtifact }>(response);
    };
    const childDna = await createDna({
      projectId: fixture.project.id,
      parentArtifactId: fixture.dna.artifactId,
      name: "Evolved luminous Story DNA",
      directive: "Preserve the luminous source language while widening its nocturnal spatial tension.",
      targetModality: "image",
    });
    const unrelatedDna = await createDna({
      projectId: fixture.project.id,
      name: "Unrelated root DNA",
      directive: "A separate root direction with dry daylight, flat paper geometry, and no inherited nocturnal lineage.",
      targetModality: "image",
    });
    expect(childDna.artifact.lineage.parentArtifactId).toBe(fixture.dna.artifactId);
    expect(unrelatedDna.artifact.lineage.parentArtifactId).toBeNull();

    const dnaStaleBank = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    expect(dnaStaleBank.storyThreads.find((story) => story.id === pinned.storyThread.id)?.recommendations
      .map((recommendation) => recommendation.status)).toEqual(["stale", "stale", "stale"]);
    await env.DB.prepare(`update creative_projects set active_dna_artifact_id = ?, updated_at = ?
      where id = ? and owner_id = ?`)
      .bind(childDna.artifact.artifactId, new Date().toISOString(), fixture.project.id, OWNER).run();
    const dnaRestoredBank = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    expect(dnaRestoredBank.storyThreads.find((story) => story.id === pinned.storyThread.id)?.recommendations
      .map((recommendation) => recommendation.status)).toEqual(["ready", "ready", "ready"]);

    const safetyBefore = await counts();
    const staleSelection = storyRecommendationSelection(originalStory, imageRecommendation);
    const staleJob = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: fixture.project.id,
        dnaArtifactId: fixture.dna.artifactId,
        modality: "image",
        idempotencyKey: "story_job_stale_selection_001",
        workflow: {
          workflowId: fixture.image.id,
          revisionId: child.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: imageRecommendation.prompt,
        },
        storyRecommendation: staleSelection,
      }),
    }), fixture.local);
    const staleJobPayload = await payload<{ error: string }>(staleJob);
    expect({ status: staleJob.status, error: staleJobPayload.error }).toEqual({ status: 409, error: "story_recommendation_changed" });

    const selection = storyRecommendationSelection(pinned.storyThread, imageRecommendation);
    const unrelatedJob = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: fixture.project.id,
        dnaArtifactId: unrelatedDna.artifact.artifactId,
        modality: "image",
        idempotencyKey: "story_job_unrelated_dna_001",
        workflow: {
          workflowId: fixture.image.id,
          revisionId: child.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: imageRecommendation.prompt,
        },
        storyRecommendation: selection,
      }),
    }), fixture.local);
    const unrelatedJobPayload = await payload<{ error: string }>(unrelatedJob);
    expect({ status: unrelatedJob.status, error: unrelatedJobPayload.error }).toEqual({ status: 409, error: "story_recommendation_changed" });

    const jobResponse = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: fixture.project.id,
        dnaArtifactId: childDna.artifact.artifactId,
        modality: "image",
        idempotencyKey: "story_job_child_revision_001",
        workflow: {
          workflowId: fixture.image.id,
          revisionId: child.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: imageRecommendation.prompt,
        },
        storyRecommendation: selection,
      }),
    }), fixture.local);
    expect(jobResponse.status).toBe(202);
    const created = await payload<{ job: {
      id: string;
      dnaArtifactId: string;
      settingsStamp: {
        workflow: { workflowId: string; revisionId: string; version: number };
        storyRecommendation: {
          storyId: string;
          recommendationId: string;
          recommendedPrompt: string;
          appliedPrompt: string;
          ownerEdited: boolean;
          plannerModel: string;
        };
      };
    } }>(jobResponse);
    expect(created.job.settingsStamp.workflow).toMatchObject({
      workflowId: fixture.image.id,
      revisionId: child.workflow.currentRevision.id,
      version: 2,
    });
    expect(created.job.dnaArtifactId).toBe(childDna.artifact.artifactId);
    expect(created.job.settingsStamp.storyRecommendation).toMatchObject({
      storyId: pinned.storyThread.id,
      recommendationId: imageRecommendation.id,
      recommendedPrompt: imageRecommendation.prompt,
      appliedPrompt: imageRecommendation.prompt,
      ownerEdited: false,
      plannerModel: "gemma4-local-test",
    });
    expect(child.workflow.currentRevision.id).not.toBe(imageRecommendation.workflowRevisionId);

    const afterUse = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    const usedStory = afterUse.storyThreads.find((story) => story.id === pinned.storyThread.id)!;
    expect(usedStory.status).toBe("developing");
    expect(usedStory.recommendations.find((item) => item.id === imageRecommendation.id)?.status).toBe("used");
    const evolvedRefresh = await routeCreativeStudioApi(request("/api/creative-studio/story-bank/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: fixture.project.id, idempotencyKey: "story_refresh_after_child_dna_001" }),
    }), fixture.local);
    expect(evolvedRefresh.status).toBe(202);
    expect(await payload(evolvedRefresh)).toMatchObject({
      storyBankRefresh: {
        dnaArtifactId: childDna.artifact.artifactId,
        status: "waiting-for-runner",
      },
    });

    await env.DB.prepare(`update creative_workflows set execution_state = 'api-export-required', updated_at = ?
      where id = ? and owner_id = ?`)
      .bind(new Date().toISOString(), fixture.image.id, OWNER).run();
    const workflowStaleBank = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    expect(workflowStaleBank.storyThreads.find((story) => story.id === pinned.storyThread.id)?.recommendations
      .map((recommendation) => [recommendation.modality, recommendation.status])).toEqual([
      ["image", "stale"],
      ["video", "ready"],
      ["music", "ready"],
    ]);
    await env.DB.prepare(`update creative_workflows set execution_state = 'ready', updated_at = ?
      where id = ? and owner_id = ?`)
      .bind(new Date().toISOString(), fixture.image.id, OWNER).run();

    await env.DB.prepare(`update creative_media_assets set project_id = ?, updated_at = ?
      where id = ? and owner_id = ?`)
      .bind(otherProject.id, new Date().toISOString(), fixture.sourceId, OWNER).run();
    const sourceStaleBank = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    expect(sourceStaleBank.storyThreads.find((story) => story.id === pinned.storyThread.id)?.recommendations
      .map((recommendation) => [recommendation.modality, recommendation.status])).toEqual([
      ["image", "used"],
      ["video", "stale"],
      ["music", "stale"],
    ]);
    await env.DB.prepare(`update creative_media_assets set project_id = ?, updated_at = ?
      where id = ? and owner_id = ?`)
      .bind(fixture.project.id, new Date().toISOString(), fixture.sourceId, OWNER).run();
    const compatibilityRestoredBank = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    expect(compatibilityRestoredBank.storyThreads.find((story) => story.id === pinned.storyThread.id)?.recommendations
      .map((recommendation) => [recommendation.modality, recommendation.status])).toEqual([
      ["image", "used"],
      ["video", "ready"],
      ["music", "ready"],
    ]);
    const storedRecommendationStatuses = await env.DB.prepare(`select modality, status from creative_story_recommendations
      where owner_id = ? and story_id = ? order by case modality when 'image' then 0 when 'video' then 1 else 2 end`)
      .bind(OWNER, pinned.storyThread.id).all<{ modality: string; status: string }>();
    expect(storedRecommendationStatuses.results).toEqual([
      { modality: "image", status: "used" },
      { modality: "video", status: "ready" },
      { modality: "music", status: "ready" },
    ]);

    const archiveResponse = await routeCreativeStudioApi(request(`/api/creative-studio/story-bank/stories/${pinned.storyThread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: pinned.storyThread.version, status: "archived" }),
    }), fixture.local);
    expect(archiveResponse.status).toBe(200);
    expect(await payload(archiveResponse)).toMatchObject({ storyThread: { id: pinned.storyThread.id, status: "archived" } });
    const afterArchive = await payload<{ storyThreads: StoryThread[] }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/story-bank?projectId=${fixture.project.id}`), fixture.local),
    );
    expect(afterArchive.storyThreads.some((story) => story.id === pinned.storyThread.id)).toBe(false);
    expect(await counts()).toEqual(safetyBefore);
    expect(safetyBefore).toMatchObject({
      creative_acceptances: 0,
      creative_training_examples: 0,
      creative_dna_training_jobs: 1,
      creative_dna_training_reviews: 1,
      creative_model_training_jobs: 0,
      creative_model_adapters: 0,
      creative_canon_references: 0,
      creative_canon_promotions: 0,
    });
  });
});
