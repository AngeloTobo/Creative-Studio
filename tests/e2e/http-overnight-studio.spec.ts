import { expect, test, type Page, type Route } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import {
  deriveProductionCockpit,
  loveLoopDailyBlueprints,
  loveLoopLocalDate,
  type Acceptance,
  type Artifact,
  type ConfigureLoveLoopRequest,
  type CreateOvernightSessionRequest,
  type CreativeDnaArtifact,
  type GenerationModality,
  type Job,
  type LoveLoop,
  type OvernightSession,
  type OvernightSessionStatus,
  type OvernightTask,
  type StudioSnapshot,
  type WorkflowDefinition,
} from "../../shared/contracts";

const HTTP_STUDIO = "http://127.0.0.1:4175";
const PROJECT_ID = "project_overnight_e2e";
const DNA_ID = "dna_overnight_e2e";
const IMAGE_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let httpAdapterServer: ChildProcess | null = null;

test.beforeAll(async () => {
  const output: string[] = [];
  httpAdapterServer = spawn(process.execPath, [
    resolve(process.cwd(), "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1",
    "--port", "4175",
    "--strictPort",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_CREATIVE_STUDIO_ADAPTER: "http" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  httpAdapterServer.stdout?.on("data", (chunk) => output.push(String(chunk)));
  httpAdapterServer.stderr?.on("data", (chunk) => output.push(String(chunk)));

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (httpAdapterServer.exitCode !== null) {
      throw new Error(`Overnight HTTP-adapter Vite server exited early.\n${output.join("")}`);
    }
    try {
      const response = await fetch(HTTP_STUDIO);
      if (response.ok) return;
    } catch {
      // The local test server has not bound its port yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Overnight HTTP-adapter Vite server did not become ready.\n${output.join("")}`);
});

test.afterAll(async () => {
  const server = httpAdapterServer;
  httpAdapterServer = null;
  if (!server || server.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => server.once("exit", () => resolveExit()));
  server.kill();
  await Promise.race([exited, new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 2_000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
});

const EMPTY_PROGRESS: OvernightSession["progress"] = {
  planned: 0,
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  readyForReview: 0,
  decided: 0,
  retainedBytes: 0,
};

function now(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function workflow(modality: GenerationModality): WorkflowDefinition {
  const identity = modality === "image" ? "z-image-turbo" : modality === "video" ? "ltx-2.5" : "minimax-music-3";
  const workflowKey = identity.replaceAll("-", "_").replaceAll(".", "_");
  const parameters: WorkflowDefinition["currentRevision"]["parameters"] = [{
    id: `${modality}:prompt`,
    label: modality === "music" ? "Caption" : "Positive prompt",
    kind: "text",
    promptRole: "positive",
    value: `Initial ${modality} direction`,
    mediaKind: null,
    binding: { format: "comfyui-api", nodeId: `${modality}:prompt`, inputName: modality === "music" ? "caption" : "prompt" },
  }];
  if (modality === "image") {
    parameters.push(
      { id: "image::width", label: "Width", kind: "number", value: 512, mediaKind: null, binding: { format: "comfyui-api", nodeId: "image:width", inputName: "width" } },
      { id: "image::height", label: "Height", kind: "number", value: 512, mediaKind: null, binding: { format: "comfyui-api", nodeId: "image:height", inputName: "height" } },
      { id: "image::steps", label: "Steps", kind: "number", value: 8, mediaKind: null, binding: { format: "comfyui-api", nodeId: "image:steps", inputName: "steps" } },
    );
  }
  if (modality === "video") {
    parameters.push(
      { id: "video:duration", label: "Video duration", kind: "number", value: 5, mediaKind: null, binding: { format: "comfyui-api", nodeId: "video:duration", inputName: "duration" } },
      { id: "video:megapixels", label: "Megapixels", kind: "number", value: 0.2, mediaKind: null, binding: { format: "comfyui-api", nodeId: "video:megapixels", inputName: "megapixels" } },
      { id: "video:fps", label: "Frame rate", kind: "number", value: 24, mediaKind: null, binding: { format: "comfyui-api", nodeId: "video:fps", inputName: "fps" } },
      { id: "video:frames", label: "Frames", kind: "number", value: 121, mediaKind: null, binding: { format: "comfyui-api", nodeId: "video:frames", inputName: "frames" } },
    );
  }
  return {
    id: `workflow_${workflowKey}`,
    projectId: PROJECT_ID,
    name: modality === "image" ? "Z Image Turbo" : modality === "video" ? "LTX 2.5 Text to Video" : "MiniMax Music 3",
    description: `Prompt-only ${modality} workflow`,
    sourceFileName: `${identity}.json`,
    modality,
    executionState: "ready",
    currentRevision: {
      id: `workflowrev_${workflowKey}_1`,
      workflowId: `workflow_${workflowKey}`,
      version: 1,
      parentRevisionId: null,
      format: "comfyui-api",
      contentHash: `${identity}-hash-1`,
      nodeCount: parameters.length,
      parameters,
      models: [`${identity}.safetensors`],
      createdAt: now(-60_000),
    },
    createdAt: now(-60_000),
    updatedAt: now(-60_000),
  };
}

const WORKFLOWS = (["image", "video", "music"] as GenerationModality[]).map(workflow);

function creativeDna(): CreativeDnaArtifact {
  return {
    schemaVersion: "creative-dna/1.0",
    artifactId: DNA_ID,
    projectId: PROJECT_ID,
    version: 1,
    rootArtifactId: DNA_ID,
    name: "Night world DNA",
    createdAt: now(-120_000),
    targetModality: "image",
    capability: "IMAGE_GENERATE",
    source: {
      kind: "original",
      directive: "Luminous biological architecture, quiet wonder, and precise tactile detail.",
      referenceLabel: null,
      referenceAssetIds: [],
    },
    shared: { energy: 66, tension: 48, contrast: 72, warmth: 44, spaciousness: 78, rhythmicity: 58, organicity: 76, polish: 82 },
    native: {},
    influence: { angeloCore: 75, currentProject: 15, reference: 50 },
    evidence: [],
    rights: { policy: "original-input", referenceStoredAsProvenanceOnly: false, allowedDownstream: [], blockedDownstream: [] },
    translations: [],
    generationPrompts: { image: "A luminous biological city at night.", music: "Nocturnal glass harmonics and warm pulse." },
    lineage: { rootArtifactId: DNA_ID, parentArtifactId: null },
    training: null,
  };
}

function runner(): StudioSnapshot["runners"][number] {
  return {
    id: "runner_overnight_e2e",
    name: "Studio RTX 3090",
    state: "online",
    version: "1.13.0",
    comfyUrl: "http://127.0.0.1:8188",
    comfyVersion: "0.3.60",
    device: "NVIDIA RTX 3090",
    activeJobId: null,
    modelTrainingProviders: [],
    lastError: null,
    lastHeartbeatAt: now(-5_000),
    createdAt: now(-86_400_000),
    revokedAt: null,
  };
}

function workflowSelection(modality: GenerationModality): OvernightSession["workflowSelections"][number] {
  const selected = WORKFLOWS.find((item) => item.modality === modality);
  if (!selected) throw new Error(`missing_${modality}_workflow`);
  return {
    modality,
    recipeId: null,
    recipeUpdatedAt: null,
    workflowId: selected.id,
    workflowRevisionId: selected.currentRevision.id,
    workflowName: selected.name,
    workflowVersion: selected.currentRevision.version,
    targetModel: selected.currentRevision.models[0] ?? null,
    promptProfileId: modality === "video" ? "ltx-2.5-motion/1.0" : modality === "music" ? "minimax-music-3-structured-caption/1.0" : "creative-studio-image-direct-prompt/1.0",
    promptOutputFormat: modality === "music" ? "structured-caption" : "natural-language",
    videoDurationSeconds: modality === "video" ? 5 : null,
    estimatedDurationMs: modality === "image" ? 45_000 : modality === "music" ? 180_000 : 300_000,
  };
}

function task(ordinal: number, status: OvernightTask["status"], artifactId: string | null = null): OvernightTask {
  const modality: GenerationModality = ordinal === 3 ? "music" : "image";
  return {
    id: `overnighttask_${ordinal}`,
    sessionId: "overnightsession_active",
    ordinal,
    storyId: "story_1",
    storyTitle: "The Orchard Above the Clouds",
    sceneId: modality === "music" ? null : `scene_${ordinal}`,
    sceneTitle: modality === "music" ? null : ordinal === 1 ? "First retained scene" : ordinal === 2 ? "Second active scene" : "Third hidden scene",
    role: modality === "music" ? "soundtrack" : "scene-image",
    modality,
    prompt: `Durable overnight task ${ordinal} prompt with enough detail for the local model.`,
    seed: 1000 + ordinal,
    status,
    jobId: `job_overnight_child_${ordinal}`,
    artifactId,
    recipeId: null,
    error: null,
    createdAt: now(-30_000 + ordinal * 1_000),
    updatedAt: now(-20_000 + ordinal * 1_000),
  };
}

function session(
  status: OvernightSessionStatus,
  tasks: OvernightTask[] = [],
  overrides: Partial<OvernightSession> = {},
): OvernightSession {
  const completed = tasks.filter((item) => item.status === "completed").length;
  const failed = tasks.filter((item) => item.status === "failed").length;
  const cancelled = tasks.filter((item) => item.status === "cancelled").length;
  return {
    id: "overnightsession_active",
    projectId: PROJECT_ID,
    dnaArtifactId: DNA_ID,
    worldId: null,
    name: status === "completed" ? "Cloud Orchard morning set" : "Cloud Orchard overnight",
    storySeed: "A city grows an orchard above the clouds.",
    storyCount: 1,
    outputCount: Math.max(4, tasks.length),
    modalities: ["image", "music"],
    exploration: "exploratory",
    workflowSelections: [workflowSelection("image"), workflowSelection("music")],
    status,
    scheduledFor: now(-3_600_000),
    cutoffAt: now(4 * 3_600_000),
    maxFailures: 2,
    maxBytes: 512 * 1024 * 1024,
    plan: tasks.length ? {
      schemaVersion: "creative-studio-overnight-plan/1.0",
      title: "Cloud Orchard",
      logline: "A suspended orchard learns to sing as its first storm arrives.",
      stories: [{ index: 1, title: "The Orchard Above the Clouds", premise: "A caretaker follows a pulse through a suspended biome before the storm changes its memory." }],
      outputs: tasks.map((item) => ({
        ordinal: item.ordinal,
        storyIndex: 1,
        sceneIndex: item.sceneId ? item.ordinal : null,
        title: item.sceneTitle ?? "Orchard soundtrack",
        role: item.role,
        modality: item.modality,
        prompt: item.prompt,
      })),
    } : null,
    planHash: tasks.length ? "plan-hash-cloud-orchard" : null,
    tasks,
    progress: {
      ...EMPTY_PROGRESS,
      planned: tasks.length,
      queued: tasks.filter((item) => item.status === "queued" || item.status === "planned").length,
      running: tasks.filter((item) => item.status === "running").length,
      completed,
      failed,
      cancelled,
      readyForReview: completed,
      retainedBytes: completed * 2_048,
    },
    runnerId: status === "armed" ? null : "runner_overnight_e2e",
    error: status === "needs-attention" ? "overnight_failure_limit_reached" : null,
    createdAt: now(-3_700_000),
    updatedAt: now(-10_000),
    startedAt: status === "armed" ? null : now(-3_600_000),
    completedAt: status === "completed" || status === "failed" || status === "cancelled" ? now(-10_000) : null,
    ...overrides,
  };
}

function childJob(sourceTask: OvernightTask): Job {
  const selection = workflowSelection(sourceTask.modality);
  return {
    id: sourceTask.jobId ?? `job_overnight_child_${sourceTask.ordinal}`,
    projectId: PROJECT_ID,
    dnaArtifactId: DNA_ID,
    capability: sourceTask.modality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
    modality: sourceTask.modality,
    status: sourceTask.status === "planned" ? "queued" : sourceTask.status === "skipped" ? "cancelled" : sourceTask.status,
    progress: sourceTask.status === "completed" ? 100 : sourceTask.status === "running" ? 47 : 0,
    prompt: `CHILD JOB SPAM SENTINEL ${sourceTask.ordinal}`,
    provider: "local-comfyui",
    upstreamId: null,
    artifactId: sourceTask.artifactId,
    retryOfJobId: null,
    error: null,
    createdAt: sourceTask.createdAt,
    updatedAt: sourceTask.updatedAt,
    startedAt: sourceTask.status === "running" || sourceTask.status === "completed" ? sourceTask.createdAt : null,
    executionStage: sourceTask.status === "completed" ? "completed" : sourceTask.status === "running" ? "rendering" : "queued",
    stageUpdatedAt: sourceTask.updatedAt,
    completedAt: sourceTask.status === "completed" ? sourceTask.updatedAt : null,
    settingsStamp: {
      schemaVersion: 1,
      source: "comfyui-workflow",
      createdAt: sourceTask.createdAt,
      reusedFromJobId: null,
      prompt: sourceTask.prompt,
      provider: "local-comfyui",
      modality: sourceTask.modality,
      workflow: {
        workflowId: selection.workflowId,
        revisionId: selection.workflowRevisionId,
        version: selection.workflowVersion,
        name: selection.workflowName,
        format: "comfyui-api",
        contentHash: `${selection.workflowId}-hash`,
      },
      parameters: {},
      models: selection.targetModel ? [selection.targetModel] : [],
      inputAssetIds: [],
      overnight: {
        schemaVersion: "creative-studio-overnight-generation/1.0",
        sessionId: sourceTask.sessionId,
        taskId: sourceTask.id,
        storyId: sourceTask.storyId,
        storyTitle: sourceTask.storyTitle,
        sceneId: sourceTask.sceneId,
        taskTitle: sourceTask.sceneTitle ?? sourceTask.storyTitle,
        role: sourceTask.role,
        recipeId: null,
        recipeUpdatedAt: null,
        planHash: "plan-hash-cloud-orchard",
        seed: sourceTask.seed,
      },
    },
  };
}

function unrelatedFailedJob(): Job {
  const base = childJob(task(9, "failed"));
  return {
    ...base,
    id: "job_unrelated_failed_e2e",
    status: "failed",
    progress: 100,
    prompt: "An unrelated daytime image run used only to populate the needs-action inbox.",
    error: "unrelated_test_failure",
    executionStage: "failed",
    completedAt: now(-15_000),
    settingsStamp: { ...base.settingsStamp, overnight: undefined },
  };
}

function artifact(index: number): Artifact {
  const sourceTask = task(index, "completed", `artifact_overnight_${index}`);
  const job = childJob(sourceTask);
  return {
    id: `artifact_overnight_${index}`,
    projectId: PROJECT_ID,
    jobId: job.id,
    dnaArtifactId: DNA_ID,
    kind: "image",
    name: index === 1 ? "Storm seed" : "Cloud orchard keeper",
    status: "ready",
    provider: "local-comfyui",
    prompt: sourceTask.prompt,
    preview: { kind: "remote-media", url: IMAGE_DATA_URL, posterUrl: null, colors: ["#d946ef", "#22d3ee"] },
    lineage: { sourceArtifactIds: [], parentArtifactId: null },
    retention: { state: "retained", size: 2_048 },
    settingsStamp: job.settingsStamp,
    createdAt: sourceTask.createdAt,
    updatedAt: sourceTask.updatedAt,
  };
}

function dailyLoveLoop(status: LoveLoop["status"] = "active"): LoveLoop {
  const timezone = "America/Chicago";
  const localDate = loveLoopLocalDate(new Date(), timezone);
  const createdAt = now(-60_000);
  return {
    schemaVersion: "creative-studio-love-loop/1.0",
    id: "love_e2e",
    projectId: PROJECT_ID,
    dnaArtifactId: DNA_ID,
    timezone,
    dailyCount: 3,
    status,
    workflowSelections: [workflowSelection("image"), workflowSelection("video")],
    drops: loveLoopDailyBlueprints("love_e2e", localDate, timezone, creativeDna().shared).map((drop) => ({
      ...drop,
      id: `lovedrop_e2e_${drop.ordinal}`,
      loopId: "love_e2e",
      status: "planned",
      jobId: null,
      artifactId: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
    })),
    lastError: null,
    createdAt,
    updatedAt: createdAt,
  };
}

type BackendInput = {
  sessions?: OvernightSession[];
  jobs?: Job[];
  artifacts?: Artifact[];
  loveLoop?: LoveLoop | null;
  runnerOnline?: boolean;
};

type BackendState = {
  sessions: OvernightSession[];
  jobs: Job[];
  artifacts: Artifact[];
  loveLoop: LoveLoop | null;
  runnerOnline: boolean;
};

type MockOvernightBackend = {
  createRequests: CreateOvernightSessionRequest[];
  reviewRequests: Array<{ artifactId: string; decision: "accepted" | "rejected"; note: string }>;
  loveLoopRequests: ConfigureLoveLoopRequest[];
  loveLoopControls: string[];
};

function snapshot(input: BackendState, acceptances: Acceptance[]): StudioSnapshot {
  const project: StudioSnapshot["projects"][number] = {
    id: PROJECT_ID,
    activeDnaArtifactId: DNA_ID,
    name: "Night Worlds",
    type: "Worldbuilding",
    status: "active",
    description: "A living collection of nocturnal worlds.",
    note: "Keep the emotional logic precise.",
    hue: "#d946ef",
    initials: "NW",
    createdAt: now(-86_400_000),
    updatedAt: now(-60_000),
  };
  const localRunner = input.runnerOnline ? runner() : null;
  const productionCockpit = deriveProductionCockpit({
    projects: [project],
    dnaArtifacts: [creativeDna()],
    jobs: input.jobs,
    artifacts: input.artifacts,
    mediaAssets: [],
    acceptances,
    trainingJobs: [],
    trainingReviews: [],
    runners: localRunner ? [localRunner] : [],
    computedAt: now(),
  });
  return {
    adapter: { id: "creative-studio-bff", label: "Creative Studio Worker", development: false, durableScope: "backend" },
    session: { status: "approved", userId: "angelo-e2e", displayName: "Angelo" },
    projects: [project],
    worlds: [],
    worldEntities: [],
    continuityRules: [],
    canonReferences: [],
    canonPromotions: [],
    dnaArtifacts: [creativeDna()],
    jobs: input.jobs,
    promptEnhancements: [],
    videoScriptDrafts: [],
    artifacts: input.artifacts,
    mediaAssets: [],
    workflows: WORKFLOWS,
    recipes: [],
    overnightSessions: input.sessions,
    loveLoop: input.loveLoop,
    trainingExamples: [],
    trainingJobs: [],
    trainingReviews: [],
    modelTrainingJobs: [],
    modelAdapters: [],
    modelAdapterReviews: [],
    productionLoops: [],
    productionCockpit,
    runners: localRunner ? [localRunner] : [],
    capabilities: [],
    acceptances,
    refreshedAt: now(),
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: status < 400, ...body as object }) });
}

async function installOvernightBackend(page: Page, initial: BackendInput = {}): Promise<MockOvernightBackend> {
  const state: BackendState = {
    sessions: [...(initial.sessions ?? [])],
    jobs: [...(initial.jobs ?? [])],
    artifacts: [...(initial.artifacts ?? [])],
    loveLoop: initial.loveLoop ?? null,
    runnerOnline: initial.runnerOnline ?? true,
  };
  const createRequests: CreateOvernightSessionRequest[] = [];
  const reviewRequests: MockOvernightBackend["reviewRequests"] = [];
  const loveLoopRequests: ConfigureLoveLoopRequest[] = [];
  const loveLoopControls: string[] = [];
  const acceptances: Acceptance[] = [];

  await page.route(`${HTTP_STUDIO}/api/creative-studio/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "GET" && pathname === "/api/creative-studio/snapshot") {
      await json(route, { snapshot: snapshot(state, acceptances) });
      return;
    }

    if (request.method() === "GET" && pathname === "/api/creative-studio/artifacts") {
      await json(route, {
        page: {
          artifacts: state.artifacts,
          jobs: state.jobs,
          acceptances,
          trainingExamples: [],
          nextCursor: null,
          hasMore: false,
          total: state.artifacts.length,
        },
      });
      return;
    }

    if (request.method() === "PUT" && pathname === "/api/creative-studio/love-loop") {
      loveLoopRequests.push(request.postDataJSON() as ConfigureLoveLoopRequest);
      state.loveLoop = dailyLoveLoop("active");
      await json(route, { loveLoop: state.loveLoop }, 201);
      return;
    }

    const loveLoopControl = pathname.match(/^\/api\/creative-studio\/love-loop\/(pause|resume|disable)$/);
    if (request.method() === "POST" && loveLoopControl) {
      const action = loveLoopControl[1];
      loveLoopControls.push(action);
      state.loveLoop = { ...(state.loveLoop ?? dailyLoveLoop()), status: action === "pause" ? "paused" : action === "disable" ? "disabled" : "active", updatedAt: now() };
      await json(route, { loveLoop: state.loveLoop });
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/overnight") {
      const input = request.postDataJSON() as CreateOvernightSessionRequest;
      createRequests.push(input);
      const created = session("armed", [], {
        id: "overnightsession_armed_e2e",
        name: input.name?.trim() || "Armed overnight session",
        storySeed: input.storySeed,
        storyCount: input.storyCount,
        outputCount: input.outputCount,
        modalities: input.modalities,
        exploration: input.exploration,
        workflowSelections: input.modalities.map(workflowSelection),
        scheduledFor: input.scheduledFor,
        cutoffAt: input.cutoffAt,
        maxFailures: input.maxFailures,
        maxBytes: input.maxBytes,
      });
      state.sessions = [created, ...state.sessions];
      await json(route, { overnightSession: created }, 201);
      return;
    }

    const reviewMatch = pathname.match(/^\/api\/creative-studio\/artifacts\/([^/]+)\/(accepted|rejected)$/);
    if (request.method() === "POST" && reviewMatch) {
      const input = request.postDataJSON() as { note: string };
      const artifactId = reviewMatch[1];
      const decision = reviewMatch[2] as "accepted" | "rejected";
      reviewRequests.push({ artifactId, decision, note: input.note });
      const acceptance: Acceptance = {
        id: `acceptance_${artifactId}_${decision}`,
        artifactId,
        decision,
        note: input.note,
        actor: "angelo",
        createdAt: now(),
      };
      acceptances.unshift(acceptance);
      const reviewedArtifact = state.artifacts.find((item) => item.id === artifactId);
      if (!reviewedArtifact) {
        await json(route, { error: "artifact_not_found" }, 404);
        return;
      }
      reviewedArtifact.status = decision;
      reviewedArtifact.updatedAt = acceptance.createdAt;
      state.sessions = state.sessions.map((item) => item.tasks.some((entry) => entry.artifactId === artifactId)
        ? {
          ...item,
          progress: {
            ...item.progress,
            readyForReview: Math.max(0, item.progress.readyForReview - 1),
            decided: item.progress.decided + 1,
          },
          updatedAt: acceptance.createdAt,
        }
        : item);
      await json(route, { artifact: reviewedArtifact, acceptance });
      return;
    }

    await json(route, { error: `unhandled_overnight_e2e_route:${request.method()}:${pathname}` }, 500);
  });

  return { createRequests, reviewRequests, loveLoopRequests, loveLoopControls };
}

test("Home enables three private daily creations in one click and preserves visible controls", async ({ page }) => {
  const backend = await installOvernightBackend(page, { runnerOnline: false });
  await page.goto(`${HTTP_STUDIO}/#/portal`);

  const autopilot = page.getByRole("region", { name: "Home Autopilot" });
  await expect(autopilot).toBeVisible();
  await expect(autopilot.getByText("Angelo, adored", { exact: true })).toBeVisible();
  await expect(autopilot.getByText(/Local Runner offline - schedule will wait/)).toBeVisible();
  await expect(autopilot.getByRole("button", { name: "Enable 3/day" })).toBeEnabled();
  await autopilot.getByRole("button", { name: "Enable 3/day" }).click();

  await expect.poll(() => backend.loveLoopRequests.length).toBe(1);
  expect(backend.loveLoopRequests[0]).toMatchObject({
    projectId: PROJECT_ID,
    dnaArtifactId: DNA_ID,
    timezone: expect.any(String),
    workflowSelections: [
      expect.objectContaining({ modality: "image", workflowId: "workflow_z_image_turbo" }),
      expect.objectContaining({ modality: "video", workflowId: "workflow_ltx_2_5" }),
    ],
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(autopilot.getByRole("list", { name: "Three daily Love Loop windows" }).getByRole("listitem")).toHaveCount(3);
  await expect(autopilot.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(autopilot.getByRole("button", { name: "Turn off" })).toBeVisible();
  await expect(autopilot.getByRole("button", { name: "History" })).toBeVisible();

  await autopilot.getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => backend.loveLoopControls).toEqual(["pause"]);
  await expect(autopilot.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width);
});

test("Overnight setup explains its effective media allocation and arms a bounded durable run", async ({ page }) => {
  const backend = await installOvernightBackend(page);
  await page.goto(`${HTTP_STUDIO}/#/portal`);

  await page.getByRole("button", { name: "Plan tonight" }).click();
  const dialog = page.getByRole("dialog", { name: "Overnight Studio" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Stories" }).getByText("1", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Total creations" }).getByText("4", { exact: true })).toBeVisible();
  await expect(dialog.getByText("4 total", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Scenes/ })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: /Sound/ })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: /Motion/ })).toHaveAttribute("aria-pressed", "false");

  await dialog.getByRole("button", { name: "Increase Stories" }).click();
  await dialog.getByRole("button", { name: "Increase Stories" }).click();
  await dialog.getByRole("button", { name: /Motion/ }).click();
  await expect(dialog.getByRole("group", { name: "Stories" }).getByText("3", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Total creations" }).getByText("5", { exact: true })).toBeVisible();
  await expect(dialog.getByText("5 total", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Motion/ })).toHaveAttribute("aria-pressed", "true");

  await dialog.getByRole("radio", { name: "Start now" }).click();
  await dialog.getByRole("button", { name: "Start overnight run" }).click();
  await expect.poll(() => backend.createRequests.length).toBe(1);
  await expect(dialog).toHaveCount(0);

  const input = backend.createRequests[0];
  expect(input).toMatchObject({
    projectId: PROJECT_ID,
    dnaArtifactId: DNA_ID,
    storySeed: "Surprise me",
    storyCount: 3,
    outputCount: 5,
    modalities: ["image", "music", "video"],
    exploration: "exploratory",
    maxFailures: 2,
    maxBytes: 512 * 1024 * 1024,
  });
  expect(input.idempotencyKey).toMatch(/^overnight_[0-9a-f-]{36}$/i);
  expect(input.workflowSelections).toEqual([
    expect.objectContaining({ modality: "image", workflowId: "workflow_z_image_turbo", workflowRevisionId: "workflowrev_z_image_turbo_1" }),
    expect.objectContaining({ modality: "music", workflowId: "workflow_minimax_music_3", workflowRevisionId: "workflowrev_minimax_music_3_1" }),
    expect.objectContaining({ modality: "video", workflowId: "workflow_ltx_2_5", workflowRevisionId: "workflowrev_ltx_2_5_1" }),
  ]);
  expect(Date.parse(input.cutoffAt) - Date.parse(input.scheduledFor)).toBeGreaterThanOrEqual(7 * 60 * 60 * 1_000);
  expect(Date.parse(input.cutoffAt) - Date.parse(input.scheduledFor)).toBeLessThanOrEqual(8 * 60 * 60 * 1_000 + 60_000);
});

test("An active Home run routes to Work and stays one grouped run instead of child-job spam", async ({ page }) => {
  const tasks = [task(1, "completed", "artifact_overnight_1"), task(2, "running"), task(3, "planned")];
  const active = session("running", tasks, {
    progress: { ...EMPTY_PROGRESS, planned: 3, running: 1, completed: 1, readyForReview: 0, retainedBytes: 2_048 },
  });
  await installOvernightBackend(page, { sessions: [active], jobs: [...tasks.map(childJob), unrelatedFailedJob()], artifacts: [artifact(1)] });
  await page.goto(`${HTTP_STUDIO}/#/portal`);

  await page.getByRole("button", { name: /Manage run/ }).click();
  await expect(page).toHaveURL(/#\/work$/);
  await expect(page.getByRole("region", { name: "Work", exact: true })).toBeVisible();
  // Active overnight work takes precedence over unrelated needs-action inbox items.
  await expect(page.locator(".overnight-run-group")).toHaveCount(1);
  await expect(page.getByText("Cloud Orchard overnight", { exact: true })).toBeVisible();
  await expect(page.locator(".cockpit-run")).toHaveCount(0);
  await expect(page.getByText(/CHILD JOB SPAM SENTINEL/)).toHaveCount(0);
  const taskList = page.locator(".overnight-task-list");
  await expect(taskList).not.toHaveAttribute("open", "");
  await expect(taskList.getByText("A suspended orchard learns to sing as its first storm arrives.", { exact: true })).not.toBeVisible();
  await taskList.locator(":scope > summary").click();
  await expect(taskList.getByText("A suspended orchard learns to sing as its first storm arrives.", { exact: true })).toBeVisible();
});

test("A needs-attention run can be inspected or stopped but cannot be resumed", async ({ page }) => {
  const blockedTask = task(1, "failed");
  const blocked = session("needs-attention", [blockedTask], {
    progress: { ...EMPTY_PROGRESS, planned: 1, failed: 1 },
    error: "overnight_failure_limit_reached",
  });
  await installOvernightBackend(page, { sessions: [blocked], jobs: [childJob(blockedTask)] });
  await page.goto(`${HTTP_STUDIO}/#/queue`);

  const run = page.locator(".overnight-run-group");
  await expect(run).toBeVisible();
  await expect(run.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(run.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await expect(run.getByRole("button", { name: "Stop run" })).toBeVisible();
});

test("Morning review requires a note for Keep or Pass while Skip preserves an undecided result", async ({ page }) => {
  const reviewTasks = [
    task(1, "completed", "artifact_overnight_1"),
    { ...task(2, "completed", "artifact_overnight_2"), sceneTitle: "Already reviewed scene" },
    { ...task(4, "completed", "artifact_overnight_4"), sceneTitle: "Second retained scene" },
  ];
  const completed = session("completed", reviewTasks, {
    id: "overnightsession_review",
    progress: { ...EMPTY_PROGRESS, planned: 3, completed: 3, readyForReview: 2, decided: 1, retainedBytes: 6_144 },
  });
  const artifacts = [artifact(1), { ...artifact(2), status: "accepted" as const }, artifact(4)];
  const backend = await installOvernightBackend(page, {
    sessions: [completed],
    jobs: reviewTasks.map(childJob),
    artifacts,
  });
  await page.goto(`${HTTP_STUDIO}/#/portal`);

  await page.getByRole("button", { name: /2 to review/ }).click();
  const dialog = page.getByRole("dialog", { name: "Cloud Orchard morning set" });
  await expect(dialog).toBeVisible();
  const keep = dialog.locator(".morning-keep");
  const pass = dialog.locator(".morning-pass");
  await expect(keep).toBeDisabled();
  await expect(pass).toBeDisabled();

  await dialog.getByLabel(/Your note/).fill("Keep the suspended weather and precise luminous texture.");
  await expect(keep).toBeEnabled();
  await expect(pass).toBeEnabled();
  await keep.click();
  await expect.poll(() => backend.reviewRequests.length).toBe(1);
  expect(backend.reviewRequests[0]).toEqual({
    artifactId: "artifact_overnight_1",
    decision: "accepted",
    note: "Keep the suspended weather and precise luminous texture.",
  });

  await expect(dialog.getByText("Second retained scene", { exact: true })).toBeVisible();
  await expect(keep).toBeDisabled();
  await expect(pass).toBeDisabled();
  await dialog.getByRole("button", { name: /Skip for now/ }).click();
  await expect(dialog.getByText("Skipped work is still waiting", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Review skipped work/ })).toBeVisible();
  expect(backend.reviewRequests).toHaveLength(1);
});
