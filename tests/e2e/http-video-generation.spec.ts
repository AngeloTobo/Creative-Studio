import { expect, test, type Page, type Route } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type {
  CreateCreativeDnaRequest,
  CreateVideoPromptEnhancementRequest,
  CreativeDnaArtifact,
  Job,
  StudioSnapshot,
  SubmitJobRequest,
  VideoPromptEnhancement,
  WorkflowDefinition,
  WorkflowScalar,
} from "../../shared/contracts";

const HTTP_STUDIO = "http://127.0.0.1:4174";
const NOW = "2026-08-28T22:00:00.000Z";
const SOURCE_ID = "media_retained_frame";
const IMAGE_PARAMETER_ID = "398:350::image";
const PROMPT_PARAMETER_ID = "398:376::prompt";
const SEED_PARAMETER_ID = "398:365::seed";

let httpAdapterServer: ChildProcess | null = null;

test.beforeAll(async () => {
  const output: string[] = [];
  httpAdapterServer = spawn(process.execPath, [
    resolve(process.cwd(), "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1",
    "--port", "4174",
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
      throw new Error(`HTTP-adapter Vite server exited early.\n${output.join("")}`);
    }
    try {
      const response = await fetch(HTTP_STUDIO);
      if (response.ok) return;
    } catch {
      // The local test server has not bound its port yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`HTTP-adapter Vite server did not become ready.\n${output.join("")}`);
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

const DIMENSIONS = {
  energy: 72,
  tension: 61,
  contrast: 84,
  warmth: 38,
  spaciousness: 70,
  rhythmicity: 57,
  organicity: 46,
  polish: 82,
};

const EMPTY_COCKPIT: StudioSnapshot["productionCockpit"] = {
  summary: {
    actionRequired: 0,
    activeRuns: 0,
    queuedRuns: 0,
    runningRuns: 0,
    completedRuns: 0,
    generationRuns: 0,
    trainingRuns: 0,
    outputsAwaitingReview: 0,
    trainingAwaitingReview: 0,
    retainedOutputs: 0,
    acceptedOutputs: 0,
    rejectedOutputs: 0,
    failedRuns: 0,
    offlineRunners: 0,
    storedBytes: 0,
    retainedFiles: 0,
    activeProjects: 1,
  },
  actions: [],
  runs: [],
  runners: [],
  computedAt: NOW,
};

function initialWorkflow(): WorkflowDefinition {
  return {
    id: "workflow_ltx_i2v_e2e",
    projectId: "project_video_e2e",
    name: "LTX 2.5 Image to Video",
    description: "Local LTX image-to-video workflow",
    sourceFileName: "video_ltx2_5_i2v.json",
    modality: "video",
    executionState: "ready",
    currentRevision: {
      id: "workflowrev_ltx_i2v_e2e_1",
      workflowId: "workflow_ltx_i2v_e2e",
      version: 1,
      parentRevisionId: null,
      format: "comfyui-api",
      contentHash: "e2e-ltx-revision-1",
      nodeCount: 5,
      models: ["ltx-2.5-22b.safetensors"],
      createdAt: NOW,
      parameters: [
        { id: IMAGE_PARAMETER_ID, label: "Load Image", kind: "media", value: "source.png", mediaKind: "image", binding: { format: "comfyui-api", nodeId: "398:350", inputName: "image" } },
        { id: PROMPT_PARAMETER_ID, label: "LTX Positive Prompt", kind: "text", promptRole: "positive", value: "Initial prompt", mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:376", inputName: "prompt" } },
        { id: "398:362::value", label: "Duration", kind: "number", value: 5, mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:362", inputName: "value" } },
        { id: "398:361::value", label: "Frame Rate", kind: "number", value: 24, mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:361", inputName: "value" } },
        { id: SEED_PARAMETER_ID, label: "Noise Seed", kind: "number", value: 42, mediaKind: null, binding: { format: "comfyui-api", nodeId: "398:365", inputName: "seed" } },
      ],
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function initialDna(): CreativeDnaArtifact {
  return {
    schemaVersion: "creative-dna/1.0",
    artifactId: "dna_video_e2e",
    projectId: "project_video_e2e",
    version: 1,
    rootArtifactId: "dna_video_e2e",
    name: "Retained frame DNA",
    createdAt: NOW,
    targetModality: "image",
    capability: "IMAGE_GENERATE",
    source: { kind: "owner_uploads", directive: "A luminous figure waits beneath a glass city canopy.", referenceLabel: null, referenceAssetIds: [SOURCE_ID] },
    shared: DIMENSIONS,
    native: {},
    influence: { angeloCore: 75, currentProject: 15, reference: 50 },
    evidence: [],
    rights: { policy: "original-input", referenceStoredAsProvenanceOnly: false, allowedDownstream: [], blockedDownstream: [] },
    translations: [],
    generationPrompts: { image: "A luminous figure waits beneath a glass city canopy.", music: "A bright nocturnal pulse." },
    lineage: { rootArtifactId: "dna_video_e2e", parentArtifactId: null },
    training: null,
  };
}

function baseSnapshot(
  workflow: WorkflowDefinition,
  jobs: Job[],
  promptEnhancement: VideoPromptEnhancement | null,
  enhancementAvailable: boolean,
  createdDna: CreativeDnaArtifact | null,
): StudioSnapshot {
  return {
    adapter: { id: "creative-studio-bff", label: "Creative Studio Worker", development: false, durableScope: "backend" },
    session: { status: "approved", userId: "angelo-e2e", displayName: "Angelo" },
    projects: [{ id: "project_video_e2e", activeDnaArtifactId: "dna_video_e2e", name: "Animation proof", type: "Video", status: "active", description: "", note: "", hue: "#d946ef", initials: "AP", createdAt: NOW, updatedAt: NOW }],
    dnaArtifacts: createdDna ? [createdDna, initialDna()] : [initialDna()],
    jobs,
    promptEnhancements: promptEnhancement ? [promptEnhancement] : [],
    videoScriptDrafts: [],
    artifacts: [],
    mediaAssets: [{
      id: SOURCE_ID,
      projectId: "project_video_e2e",
      kind: "image",
      name: "Retained city frame",
      originalFileName: "retained-city-frame.png",
      mimeType: "image/png",
      size: 68,
      source: "upload",
      status: "retained",
      contentUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      trainingEligible: true,
      provenance: { uploadedByOwner: true, uploadedAt: NOW, parentAssetIds: [] },
      createdAt: NOW,
      updatedAt: NOW,
    }],
    workflows: [workflow],
    recipes: [],
    trainingExamples: [],
    trainingJobs: [],
    trainingReviews: [],
    modelTrainingJobs: [],
    modelAdapters: [],
    modelAdapterReviews: [],
    productionLoops: [],
    productionCockpit: EMPTY_COCKPIT,
    runners: [],
    capabilities: [{
      key: "prompt-enhancement",
      label: "Video prompt enhancement",
      state: enhancementAvailable ? "available" : "unavailable",
      provider: "Local ComfyUI + Gemma 4",
      detail: enhancementAvailable ? "Gemma is available for this local test fixture." : "Not needed for standard animation.",
      checkedAt: NOW,
    }],
    acceptances: [],
    worlds: [],
    worldEntities: [],
    continuityRules: [],
    canonReferences: [],
    canonPromotions: [],
    refreshedAt: NOW,
  };
}

type MockVideoBackend = {
  jobs: SubmitJobRequest[];
  enhancementRequests: CreateVideoPromptEnhancementRequest[];
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: status < 400, ...body as object }) });
}

async function installVideoBackend(page: Page, withEnhancement: boolean): Promise<MockVideoBackend> {
  let workflow = initialWorkflow();
  let revision = 1;
  const jobs: Job[] = [];
  const jobRequests: SubmitJobRequest[] = [];
  const enhancementRequests: CreateVideoPromptEnhancementRequest[] = [];
  let promptEnhancement: VideoPromptEnhancement | null = null;
  let createdDna: CreativeDnaArtifact | null = null;

  await page.route(`${HTTP_STUDIO}/api/creative-studio/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "GET" && pathname === "/api/creative-studio/snapshot") {
      await json(route, { snapshot: baseSnapshot(workflow, jobs, promptEnhancement, withEnhancement, createdDna) });
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/dna") {
      const input = request.postDataJSON() as CreateCreativeDnaRequest;
      const parent = initialDna();
      createdDna = {
        ...parent,
        artifactId: "dna_video_e2e_generated",
        version: 2,
        name: input.name?.trim() || "Animation direction",
        createdAt: new Date(Date.parse(NOW) + 10_000).toISOString(),
        targetModality: input.targetModality,
        capability: input.targetModality === "music" ? "MUSIC_GENERATE" : "IMAGE_GENERATE",
        source: {
          kind: input.sourceKind ?? "original",
          directive: input.directive,
          referenceLabel: input.referenceLabel?.trim() || null,
          referenceAssetIds: input.referenceAssetIds ?? [],
        },
        shared: { ...parent.shared, ...input.dimensions },
        influence: { ...parent.influence, ...input.influence },
        generationPrompts: { image: input.directive, music: input.directive },
        lineage: { rootArtifactId: parent.rootArtifactId, parentArtifactId: parent.artifactId },
      };
      await json(route, { artifact: createdDna }, 201);
      return;
    }

    if (request.method() === "POST" && /^\/api\/creative-studio\/workflows\/[^/]+\/revisions$/.test(pathname)) {
      const input = request.postDataJSON() as { baseRevisionId: string; values: Record<string, WorkflowScalar> };
      const previous = workflow.currentRevision;
      revision += 1;
      workflow = {
        ...workflow,
        updatedAt: new Date(Date.parse(NOW) + revision * 1_000).toISOString(),
        currentRevision: {
          ...previous,
          id: `workflowrev_ltx_i2v_e2e_${revision}`,
          version: revision,
          parentRevisionId: previous.id,
          contentHash: `e2e-ltx-revision-${revision}`,
          createdAt: new Date(Date.parse(NOW) + revision * 1_000).toISOString(),
          parameters: previous.parameters.map((parameter) => Object.prototype.hasOwnProperty.call(input.values, parameter.id)
            ? { ...parameter, value: input.values[parameter.id] }
            : parameter),
        },
      };
      await json(route, { workflow });
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/jobs") {
      const input = request.postDataJSON() as SubmitJobRequest;
      jobRequests.push(input);
      const createdAt = new Date(Date.parse(NOW) + (20 + jobRequests.length) * 1_000).toISOString();
      const prompt = input.workflow?.expectedPrompt ?? "";
      const job: Job = {
        id: `job_video_e2e_${jobRequests.length}`,
        projectId: input.projectId,
        dnaArtifactId: input.dnaArtifactId,
        capability: "VIDEO_GENERATE",
        modality: "video",
        status: "queued",
        progress: 0,
        prompt,
        provider: "local-comfyui",
        upstreamId: null,
        artifactId: null,
        retryOfJobId: null,
        error: null,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        executionStage: "queued",
        stageUpdatedAt: createdAt,
        completedAt: null,
        settingsStamp: {
          schemaVersion: 1,
          source: "comfyui-workflow",
          createdAt,
          reusedFromJobId: null,
          prompt,
          provider: "local-comfyui",
          modality: "video",
          videoDurationSeconds: input.videoDurationSeconds,
          workflow: {
            workflowId: workflow.id,
            revisionId: input.workflow?.revisionId ?? workflow.currentRevision.id,
            version: workflow.currentRevision.version,
            name: workflow.name,
            format: workflow.currentRevision.format,
            contentHash: workflow.currentRevision.contentHash,
          },
          parameters: Object.fromEntries(workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])),
          models: workflow.currentRevision.models,
          inputAssetIds: [SOURCE_ID],
          inputBindings: input.workflow?.inputBindings,
          videoVariant: input.videoVariant,
          videoSpeech: input.videoSpeech,
          outputBatch: input.outputBatch,
        },
      };
      jobs.unshift(job);
      await json(route, { job }, 202);
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/prompt-enhancements") {
      const input = request.postDataJSON() as CreateVideoPromptEnhancementRequest;
      enhancementRequests.push(input);
      promptEnhancement = {
        id: "promptenh_e2e_four_way",
        projectId: input.projectId,
        workflowId: input.workflowId,
        workflowRevisionId: input.workflowRevisionId,
        workflowName: workflow.name,
        status: "waiting-for-runner",
        progress: 0,
        sourcePrompt: input.sourcePrompt,
        enhancedPrompt: null,
        provider: "local-comfyui",
        promptProfileId: "ltx-2.5-motion/1.0",
        targetModel: "LTX 2.5",
        outputFormat: "natural-language",
        inputMode: input.inputMode,
        sourceId: input.sourceId ?? null,
        videoDurationSeconds: input.videoDurationSeconds,
        model: null,
        comfyPromptId: null,
        runnerId: null,
        error: null,
        createdAt: NOW,
        updatedAt: NOW,
        startedAt: null,
        completedAt: null,
      };
      await json(route, { promptEnhancement }, 202);
      return;
    }

    if (request.method() === "GET" && pathname === "/api/creative-studio/prompt-enhancements/promptenh_e2e_four_way" && promptEnhancement) {
      promptEnhancement = {
        ...promptEnhancement,
        status: "completed",
        progress: 100,
        enhancedPrompt: "The figure slowly raises one hand as rain beads slide upward across the glass canopy. The camera drifts in a precise half circle, revealing reflections that bloom into moving constellations. Fabric, hair, and distant signs respond to a soft crosswind. Light ripples through the street, then settles as the figure meets the lens and the city holds one luminous final beat.",
        model: "gemma4_e4b_it_fp8_scaled.safetensors",
        comfyPromptId: "comfy_prompt_e2e_four_way",
        runnerId: "runner_e2e",
        updatedAt: new Date(Date.parse(NOW) + 5_000).toISOString(),
        startedAt: new Date(Date.parse(NOW) + 1_000).toISOString(),
        completedAt: new Date(Date.parse(NOW) + 5_000).toISOString(),
      };
      await json(route, { promptEnhancement });
      return;
    }

    await json(route, { error: `unhandled_e2e_api_route:${request.method()}:${pathname}` }, 500);
  });

  return { jobs: jobRequests, enhancementRequests };
}

async function openRetainedMedia(page: Page) {
  await page.goto(`${HTTP_STUDIO}/#/media`);
  await expect(page.getByRole("heading", { name: "Source media" })).toBeVisible();
  await expect(page.getByText("Retained city frame", { exact: true })).toBeVisible();
}

test("Standard animate queues two durable video variants from one retained image", async ({ page }) => {
  const backend = await installVideoBackend(page, false);
  await openRetainedMedia(page);

  await page.locator(".media-action-menu > summary").click();
  await page.getByRole("menuitem", { name: "Standard animate" }).click();

  await expect.poll(() => backend.jobs.length, { timeout: 15_000 }).toBe(2);
  await expect(page).toHaveURL(/#\/queue$/);

  expect(backend.jobs.map((job) => job.videoVariant?.role)).toEqual(["aligned", "discovery"]);
  const pairIds = backend.jobs.map((job) => job.videoVariant?.pairId ?? "");
  expect(new Set(pairIds).size).toBe(1);
  expect(pairIds[0]).toMatch(/^video_pair_[a-z0-9-]{8,80}$/i);
  expect(pairIds[0]).toMatch(/-pair-1$/);
  expect(backend.jobs.map((job) => job.outputBatch)).toEqual([
    expect.objectContaining({ index: 1, count: 2 }),
    expect.objectContaining({ index: 2, count: 2 }),
  ]);
  expect(new Set(backend.jobs.map((job) => job.outputBatch?.batchId)).size).toBe(1);
  expect(backend.jobs.every((job) => job.workflow?.inputBindings[IMAGE_PARAMETER_ID] === SOURCE_ID)).toBe(true);
  await expect(page.getByText(/Invalid video variant/i)).toHaveCount(0);
  await expect(page.getByText(/could not prepare this video batch/i)).toHaveCount(0);
});

test("Animate x4 waits for completed Gemma enhancement and queues four valid board lanes", async ({ page }) => {
  test.setTimeout(30_000);
  const backend = await installVideoBackend(page, true);
  await openRetainedMedia(page);

  await page.locator(".media-animate-four").click();

  await expect.poll(() => backend.enhancementRequests.length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => backend.jobs.length, { timeout: 20_000 }).toBe(4);
  await expect(page).toHaveURL(/#\/queue$/);

  expect(backend.enhancementRequests[0]).toMatchObject({
    workflowId: "workflow_ltx_i2v_e2e",
    workflowRevisionId: "workflowrev_ltx_i2v_e2e_1",
    inputMode: "image-to-video",
    sourceId: SOURCE_ID,
    videoDurationSeconds: 5,
  });
  expect(backend.jobs.map((job) => job.videoVariant?.role)).toEqual(["exact", "enhanced", "left-field", "awe"]);
  const pairIds = backend.jobs.map((job) => job.videoVariant?.pairId ?? "");
  expect(new Set(pairIds).size).toBe(1);
  expect(pairIds[0]).toMatch(/^video_pair_[a-z0-9-]{8,80}$/i);
  expect(pairIds[0]).toMatch(/-board$/);
  expect(backend.jobs.map((job) => job.outputBatch?.index)).toEqual([1, 2, 3, 4]);
  expect(backend.jobs.every((job) => job.outputBatch?.count === 4)).toBe(true);
  expect(backend.jobs.filter((job) => job.promptEnhancement?.requestId === "promptenh_e2e_four_way")).toHaveLength(1);
  expect(backend.jobs.find((job) => job.videoVariant?.role === "enhanced")?.promptEnhancement).toMatchObject({
    requestId: "promptenh_e2e_four_way",
  });
  expect(backend.jobs.every((job) => job.workflow?.inputBindings[IMAGE_PARAMETER_ID] === SOURCE_ID)).toBe(true);
  await expect(page.getByText(/Invalid video variant/i)).toHaveCount(0);
  await expect(page.getByText(/could not prepare this video batch/i)).toHaveCount(0);
});
