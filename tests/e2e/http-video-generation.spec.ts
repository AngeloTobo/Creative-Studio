import { expect, test, type Page, type Route } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import type {
  CreateCreativeDnaRequest,
  CreateVideoPromptEnhancementRequest,
  CreateVideoScriptDraftRequest,
  CreativeDnaArtifact,
  Job,
  MediaAsset,
  StudioSnapshot,
  SubmitJobBatchRequest,
  SubmitJobRequest,
  VideoPromptEnhancement,
  VideoScriptDraft,
  WorkflowDefinition,
  WorkflowScalar,
} from "../../shared/contracts";
import {
  TRUSTED_LTX_25_I2V_PORTRAIT_30S,
  inspectWorkflowGraph,
  trustedVideoPresetStamp,
  videoWorkflowDurationParameters,
} from "../../shared/contracts";
import { TRUSTED_LTX_25_I2V_GRAPH_FIXTURE } from "../worker/fixtures/trustedLtx25I2vGraph";

const HTTP_STUDIO = "http://127.0.0.1:4174";
const NOW = "2026-08-28T22:00:00.000Z";
const SOURCE_ID = "media_retained_frame";
const IMAGE_PARAMETER_ID = "395::image";
const SEED_PARAMETER_ID = "398:339::noise_seed";
const MEGAPIXELS_PARAMETER_ID = "403::megapixels";

async function openRetainedWork(page: Page) {
  await page.getByRole("button", { name: /^(Retained work|Change)$/ }).click();
}

async function openCreativeControls(page: Page) {
  const control = page.getByRole("button", { name: /creative controls/i });
  if (await control.getAttribute("aria-expanded") !== "true") await control.click();
}

async function openCreatePlan(page: Page) {
  const plan = page.locator("details.quick-create-plan");
  if (await plan.getAttribute("open") === null) await plan.locator(":scope > summary").click();
}

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
  const inspection = inspectWorkflowGraph(structuredClone(TRUSTED_LTX_25_I2V_GRAPH_FIXTURE));
  return {
    id: "workflow_ltx_i2v_e2e",
    projectId: "project_model_library_origin",
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
      nodeCount: inspection.nodeCount,
      models: inspection.models,
      createdAt: NOW,
      parameters: inspection.parameters.map((parameter) => (
        parameter.id === MEGAPIXELS_PARAMETER_ID ? { ...parameter, value: 0.5 } : parameter
      )),
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
    projects: [
      { id: "project_video_e2e", activeDnaArtifactId: "dna_video_e2e", name: "Animation proof", type: "Video", status: "active", description: "", note: "", hue: "#d946ef", initials: "AP", createdAt: NOW, updatedAt: NOW },
      { id: "project_video_other", activeDnaArtifactId: null, name: "Second project", type: "Video", status: "active", description: "", note: "", hue: "#0ea5e9", initials: "SP", createdAt: NOW, updatedAt: NOW },
    ],
    dnaArtifacts: createdDna ? [createdDna, initialDna()] : [initialDna()],
    jobs,
    generationBatches: [],
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
    }, {
      key: "script-builder",
      label: "Full video script",
      state: "available",
      provider: "Local ComfyUI + Gemma 4",
      detail: "Gemma Script Builder is available for this local test fixture.",
      checkedAt: NOW,
    }, {
      key: "afdfw-image-generation",
      label: "AFDFW image generation",
      state: "available",
      provider: "AFDFW Z-Image adapter",
      detail: "The optional remote image route is available for this local test fixture.",
      checkedAt: NOW,
    }],
    acceptances: [],
    worlds: [],
    worldEntities: [],
    continuityRules: [],
    canonReferences: [],
    canonPromotions: [],
    overnightSessions: [],
    loveLoop: null,
    storyThreads: [],
    storyBankRefreshes: [],
    refreshedAt: NOW,
  };
}

type MockVideoBackend = {
  jobs: SubmitJobRequest[];
  batchRequests: SubmitJobBatchRequest[];
  enhancementRequests: CreateVideoPromptEnhancementRequest[];
  videoScriptRequests: CreateVideoScriptDraftRequest[];
  revisionRequests: Array<{
    baseRevisionId: string;
    values: Record<string, WorkflowScalar>;
    scope?: "library-current" | "execution-only";
  }>;
  uploads: Array<{ fileName: string; contentType: string; size: number }>;
  workflow: () => WorkflowDefinition;
  workflowByRevision: (revisionId: string) => WorkflowDefinition | null;
  releaseRevision: () => void;
  releaseEnhancement: () => void;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: status < 400, ...body as object }) });
}

async function installVideoBackend(
  page: Page,
  withEnhancement: boolean,
  options: { delayFirstRevision?: boolean; delayEnhancementCompletion?: boolean } = {},
): Promise<MockVideoBackend> {
  let workflow = initialWorkflow();
  let revision = 1;
  const workflowRevisions = new Map<string, WorkflowDefinition>([[workflow.currentRevision.id, workflow]]);
  const jobs: Job[] = [];
  const jobRequests: SubmitJobRequest[] = [];
  const batchRequests: SubmitJobBatchRequest[] = [];
  const enhancementRequests: CreateVideoPromptEnhancementRequest[] = [];
  const videoScriptRequests: CreateVideoScriptDraftRequest[] = [];
  const revisionRequests: MockVideoBackend["revisionRequests"] = [];
  const uploads: MockVideoBackend["uploads"] = [];
  const uploadedAssets: MediaAsset[] = [];
  let promptEnhancement: VideoPromptEnhancement | null = null;
  let videoScriptDraft: VideoScriptDraft | null = null;
  let createdDna: CreativeDnaArtifact | null = null;
  let releaseRevision = () => undefined;
  let releaseEnhancement = () => undefined;
  const revisionGate = options.delayFirstRevision
    ? new Promise<void>((resolveRevision) => { releaseRevision = resolveRevision; })
    : null;
  const enhancementGate = options.delayEnhancementCompletion
    ? new Promise<void>((resolveEnhancement) => { releaseEnhancement = resolveEnhancement; })
    : null;

  const materializeJob = (input: SubmitJobRequest): Job => {
    jobRequests.push(input);
    const submittedWorkflow = input.workflow?.revisionId
      ? workflowRevisions.get(input.workflow.revisionId) ?? workflow
      : workflow;
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
        videoPerformance: input.videoPerformanceMode ? {
          schemaVersion: "creative-studio-video-performance/1.0",
          mode: input.videoPerformanceMode,
            workflowRevisionId: input.workflow?.revisionId ?? submittedWorkflow.currentRevision.id,
          trustedPreset: input.trustedVideoPresetId ? trustedVideoPresetStamp() : undefined,
          workload: {
            durationSeconds: input.videoDurationSeconds ?? null,
            width: null,
            height: null,
            megapixels: Number(submittedWorkflow.currentRevision.parameters.find((parameter) => parameter.id === MEGAPIXELS_PARAMETER_ID)?.value ?? 0),
            frames: null,
            fps: 24,
            requiresExplicitHeavy: input.videoPerformanceMode === "explicit-heavy",
            reasons: [],
          },
        } : undefined,
        videoDurationSeconds: input.videoDurationSeconds,
        workflow: {
          workflowId: submittedWorkflow.id,
          revisionId: input.workflow?.revisionId ?? submittedWorkflow.currentRevision.id,
          version: submittedWorkflow.currentRevision.version,
          name: submittedWorkflow.name,
          format: submittedWorkflow.currentRevision.format,
          contentHash: submittedWorkflow.currentRevision.contentHash,
        },
        parameters: Object.fromEntries(submittedWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])),
        models: submittedWorkflow.currentRevision.models,
        inputAssetIds: [SOURCE_ID],
        inputBindings: input.workflow?.inputBindings,
        videoVariant: input.videoVariant,
        videoSpeech: input.videoSpeech,
        outputBatch: input.outputBatch,
      },
    };
    jobs.unshift(job);
    return job;
  };

  await page.route(`${HTTP_STUDIO}/api/creative-studio/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === "GET" && pathname === "/api/creative-studio/snapshot") {
      const snapshot = baseSnapshot(workflow, jobs, promptEnhancement, withEnhancement, createdDna);
      snapshot.mediaAssets.push(...uploadedAssets);
      await json(route, { snapshot });
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/media") {
      const fileName = decodeURIComponent(request.headers()["x-cs-file-name"] ?? "uploaded-source.png");
      const contentType = request.headers()["content-type"] ?? "application/octet-stream";
      const size = Number(request.headers()["x-cs-file-size"] ?? request.postDataBuffer()?.length ?? 0);
      uploads.push({ fileName, contentType, size });
      const createdAt = new Date(Date.parse(NOW) + 15_000 + uploadedAssets.length * 1_000).toISOString();
      const asset: MediaAsset = {
        id: `media_uploaded_e2e_${uploadedAssets.length + 1}`,
        projectId: "project_video_e2e",
        kind: "image",
        name: fileName.replace(/\.[^.]+$/, ""),
        originalFileName: fileName,
        mimeType: contentType,
        size,
        source: "upload",
        status: "retained",
        contentUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        trainingEligible: request.headers()["x-cs-training-eligible"] === "true",
        provenance: { uploadedByOwner: true, uploadedAt: createdAt, parentAssetIds: [] },
        createdAt,
        updatedAt: createdAt,
      };
      uploadedAssets.push(asset);
      await json(route, { asset }, 201);
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
      const input = request.postDataJSON() as MockVideoBackend["revisionRequests"][number];
      revisionRequests.push(input);
      if (revisionGate && revisionRequests.length === 1) await revisionGate;
      const previousWorkflow = workflowRevisions.get(input.baseRevisionId) ?? workflow;
      const previous = previousWorkflow.currentRevision;
      revision += 1;
      const preparedWorkflow: WorkflowDefinition = {
        ...previousWorkflow,
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
      workflowRevisions.set(preparedWorkflow.currentRevision.id, preparedWorkflow);
      if (input.scope !== "execution-only") workflow = preparedWorkflow;
      await json(route, { workflow: preparedWorkflow });
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/jobs") {
      const input = request.postDataJSON() as SubmitJobRequest;
      const job = materializeJob(input);
      await json(route, { job }, 202);
      return;
    }

    if (request.method() === "POST" && pathname === "/api/creative-studio/jobs/batches") {
      const input = request.postDataJSON() as SubmitJobBatchRequest;
      batchRequests.push(input);
      const createdJobs = input.jobs.map(materializeJob);
      await json(route, {
        batch: {
          batchId: input.batchId,
          status: "completed",
          completedLanes: createdJobs.length,
          laneCount: createdJobs.length,
        },
        jobs: createdJobs,
      }, 202);
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

    if (request.method() === "POST" && pathname === "/api/creative-studio/video-scripts") {
      const input = request.postDataJSON() as CreateVideoScriptDraftRequest;
      videoScriptRequests.push(input);
      videoScriptDraft = {
        id: "videoscript_e2e_waiting",
        projectId: input.projectId,
        scriptFormat: "full-script-v2",
        status: "waiting-for-runner",
        progress: 0,
        mode: input.mode,
        seedPhrases: input.mode === "build" ? input.seedPhrases : [],
        sourceScript: input.mode === "tighten" ? input.sourceScript : null,
        sceneDirection: input.sceneDirection ?? "",
        videoDurationSeconds: input.videoDurationSeconds,
        workflowId: input.workflowId,
        workflowRevisionId: input.workflowRevisionId,
        workflowName: workflow.name,
        workflowVersion: workflowRevisions.get(input.workflowRevisionId)?.currentRevision.version ?? 1,
        promptProfile: {
          id: "ltx-2.5-i2v",
          targetModel: "ltx-2.5",
          outputFormat: "ltx-natural-sequence",
          inputMode: input.inputMode,
        },
        inputMode: input.inputMode,
        source: input.sourceId ? { id: input.sourceId, source: "upload", kind: "image", name: "Retained city frame" } : null,
        generatedScript: null,
        currentScript: null,
        generatedSpokenText: null,
        currentSpokenText: null,
        editRevision: 0,
        provider: "local-comfyui",
        model: null,
        comfyPromptId: null,
        runnerId: null,
        error: null,
        createdAt: NOW,
        updatedAt: NOW,
        startedAt: null,
        completedAt: null,
      };
      await json(route, { videoScriptDraft }, 202);
      return;
    }

    if (request.method() === "GET" && pathname === "/api/creative-studio/video-scripts/videoscript_e2e_waiting" && videoScriptDraft) {
      await json(route, { videoScriptDraft });
      return;
    }

    if (request.method() === "GET" && pathname === "/api/creative-studio/prompt-enhancements/promptenh_e2e_four_way" && promptEnhancement) {
      if (enhancementGate) await enhancementGate;
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

  return {
    jobs: jobRequests,
    batchRequests,
    enhancementRequests,
    videoScriptRequests,
    revisionRequests,
    uploads,
    workflow: () => workflow,
    workflowByRevision: (revisionId) => workflowRevisions.get(revisionId) ?? null,
    releaseRevision,
    releaseEnhancement,
  };
}

async function openRetainedMedia(page: Page) {
  await page.goto(`${HTTP_STUDIO}/#/media`);
  await expect(page.getByRole("heading", { name: "Source media" })).toBeVisible();
  await expect(page.getByText("Retained city frame", { exact: true })).toBeVisible();
}

test("an AFDFW draft stays remote after leaving and resuming Create", async ({ page }) => {
  await installVideoBackend(page, false);
  await page.addInitScript(({ now }) => {
    localStorage.setItem("creative-studio:create-sessions", JSON.stringify({
      schemaVersion: 2,
      sessions: [{
        schemaVersion: 2,
        id: "session_afdfw_image",
        projectId: "project_video_e2e",
        sourceAssetIds: [],
        retainedArtifactId: null,
        direction: "A luminous figure crosses a mirrored garden at night.",
        mediaKind: "image",
        workflowId: null,
        graphicalSettings: { generationRoute: "afdfw", workflowSelectionMode: "automatic" },
        intentTier: "explore",
        updatedAt: now,
      }],
    }));
  }, { now: NOW });
  await page.goto(`${HTTP_STUDIO}/#/dna`);
  await expect(page.getByRole("heading", { name: "What do you want to make?" })).toBeVisible();
  await expect(page.getByLabel("Describe the image")).toHaveValue("A luminous figure crosses a mirrored garden at night.");
  await expect(page.locator(".quick-generate-dock")).toContainText("AFDFW remote route");
  await expect(page.getByRole("button", { name: /creative controls/i })).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: "Ideas", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.locator(".quick-generate-dock")).toContainText("AFDFW remote route");
  await expect(page.getByLabel("Describe the image")).toHaveValue("A luminous figure crosses a mirrored garden at night.");
});

test("Standard animate prefills the speed-safe workload and waits for Generate", async ({ page }) => {
  const backend = await installVideoBackend(page, false);
  await page.addInitScript(({ now, sourceId, workflowId, revisionId, megapixelsParameterId }) => {
    localStorage.setItem("creative-studio:create-sessions", JSON.stringify({
      schemaVersion: 2,
      sessions: [{
        schemaVersion: 2,
        id: "session_previous_heavy_video",
        projectId: "project_video_e2e",
        sourceAssetIds: [sourceId],
        retainedArtifactId: null,
        direction: "A previous intentionally slow video draft.",
        mediaKind: "video",
        workflowId,
        graphicalSettings: {
          workflowRevisionId: revisionId,
          videoDurationSeconds: 30,
          canvasMegapixels: 0.5,
          outputCount: 4,
          [`value:${megapixelsParameterId}`]: 0.5,
        },
        intentTier: "explore",
        updatedAt: now,
      }],
    }));
  }, {
    now: NOW,
    sourceId: SOURCE_ID,
    workflowId: "workflow_ltx_i2v_e2e",
    revisionId: "workflowrev_ltx_i2v_e2e_1",
    megapixelsParameterId: MEGAPIXELS_PARAMETER_ID,
  });
  await openRetainedMedia(page);

  await page.locator(".media-action-menu > summary").click();
  await page.getByRole("menuitem", { name: "Animate", exact: true }).click();

  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.getByRole("button", { name: "Video", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".quick-compose-source > summary")).toContainText("Retained city frame");
  await expect(page.locator(".quick-primary")).toHaveText(/Generate/);
  await page.waitForTimeout(500);
  expect(backend.jobs).toHaveLength(0);
  await page.locator(".quick-primary").click();
  await expect.poll(() => backend.jobs.length, { timeout: 15_000 }).toBe(2);

  expect(backend.jobs.map((job) => job.videoVariant?.role)).toEqual(["aligned", "discovery"]);
  expect(backend.batchRequests).toHaveLength(1);
  expect(backend.batchRequests[0].jobs).toHaveLength(2);
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
  expect(backend.jobs.every((job) => job.videoDurationSeconds === 5)).toBe(true);
  expect(backend.jobs.every((job) => job.videoPerformanceMode === "fast-default")).toBe(true);
  expect(backend.revisionRequests.some((request) => request.values[MEGAPIXELS_PARAMETER_ID] === 0.2)).toBe(true);
  expect(backend.revisionRequests.every((request) => request.scope === "execution-only")).toBe(true);
  expect(backend.workflow().currentRevision.id).toBe("workflowrev_ltx_i2v_e2e_1");
  await expect(page.getByText(/Invalid video variant/i)).toHaveCount(0);
  await expect(page.getByText(/could not prepare this video batch/i)).toHaveCount(0);
});

test("Animate x4 waits for Generate, then completes Gemma enhancement and queues four valid board lanes", async ({ page }) => {
  test.setTimeout(30_000);
  const backend = await installVideoBackend(page, true);
  await openRetainedMedia(page);

  await page.locator(".media-action-menu > summary").click();
  await page.getByRole("menuitem", { name: "Animate 4 ways" }).click();

  await expect(page).toHaveURL(/#\/dna$/);
  await expect(page.locator(".quick-primary")).toHaveText(/Generate/);
  await page.waitForTimeout(500);
  expect(backend.enhancementRequests).toHaveLength(0);
  expect(backend.jobs).toHaveLength(0);
  await page.locator(".quick-primary").click();
  await expect.poll(() => backend.enhancementRequests.length, { timeout: 10_000 }).toBe(1);
  await expect.poll(() => backend.jobs.length, { timeout: 20_000 }).toBe(4);

  expect(backend.enhancementRequests[0]).toMatchObject({
    projectId: "project_video_e2e",
    workflowId: "workflow_ltx_i2v_e2e",
    inputMode: "image-to-video",
    sourceId: SOURCE_ID,
    videoDurationSeconds: 5,
  });
  expect(backend.enhancementRequests[0].workflowRevisionId).not.toBe("workflowrev_ltx_i2v_e2e_1");
  expect(backend.workflow().projectId).toBe("project_model_library_origin");
  expect(backend.workflow().currentRevision.id).toBe("workflowrev_ltx_i2v_e2e_1");
  expect(backend.jobs.map((job) => job.videoVariant?.role)).toEqual(["exact", "enhanced", "left-field", "awe"]);
  expect(backend.batchRequests).toHaveLength(1);
  expect(backend.batchRequests[0].jobs).toHaveLength(4);
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
  expect(backend.jobs.every((job) => job.videoDurationSeconds === 5)).toBe(true);
  expect(backend.jobs.every((job) => job.videoPerformanceMode === "fast-default")).toBe(true);
  expect(backend.revisionRequests.some((request) => request.values[MEGAPIXELS_PARAMETER_ID] === 0.2)).toBe(true);
  expect(backend.revisionRequests.every((request) => request.scope === "execution-only")).toBe(true);
  await expect(page.getByText(/Invalid video variant/i)).toHaveCount(0);
  await expect(page.getByText(/could not prepare this video batch/i)).toHaveCount(0);
});

test("changing the creation type while x4 preparation is pending cancels the submitted setup", async ({ page }) => {
  const backend = await installVideoBackend(page, true, { delayEnhancementCompletion: true });
  await openRetainedMedia(page);

  await page.locator(".media-action-menu > summary").click();
  await page.getByRole("menuitem", { name: "Animate 4 ways" }).click();
  await page.locator(".quick-primary").click();
  await expect.poll(() => backend.enhancementRequests.length, { timeout: 10_000 }).toBe(1);

  await page.getByRole("button", { name: "Image", exact: true }).click();
  backend.releaseEnhancement();

  await expect(page.getByRole("button", { name: "Image", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1_000);
  expect(backend.jobs).toHaveLength(0);
  expect(backend.batchRequests).toHaveLength(0);
});

test("Full Script prepares changed run settings without project-locking the reusable model", async ({ page }) => {
  const backend = await installVideoBackend(page, false);
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  await page.getByRole("button", { name: "Video", exact: true }).click();
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Retained city frame upload" }).click();
  await page.getByLabel("Describe the video").fill("The figure crosses the glass atrium and ends beneath a violet spotlight.");
  await openCreatePlan(page);
  await page.getByRole("group", { name: "Video duration" }).getByRole("button", { name: "10s" }).click();
  await openCreativeControls(page);
  await page.getByRole("button", { name: "Write full script" }).click();

  const scriptBuilder = page.getByRole("dialog", { name: "Full Video Script" });
  await scriptBuilder.getByRole("textbox", { name: /What should happen/ }).fill("A precise fashion walk through the atrium");
  await scriptBuilder.getByRole("button", { name: "Write full video script" }).click();
  await expect.poll(() => backend.videoScriptRequests.length, { timeout: 10_000 }).toBe(1);

  const [request] = backend.videoScriptRequests;
  expect(request).toMatchObject({
    projectId: "project_video_e2e",
    workflowId: "workflow_ltx_i2v_e2e",
    inputMode: "image-to-video",
    sourceId: SOURCE_ID,
    videoDurationSeconds: 10,
  });
  expect(request.workflowRevisionId).not.toBe("workflowrev_ltx_i2v_e2e_1");
  const preparedWorkflow = backend.workflowByRevision(request.workflowRevisionId);
  expect(preparedWorkflow).not.toBeNull();
  expect(videoWorkflowDurationParameters(preparedWorkflow!.currentRevision.parameters)
    .map((parameter) => Number(parameter.value))).toEqual(expect.arrayContaining([10]));
  expect(backend.workflow().projectId).toBe("project_model_library_origin");
  expect(backend.workflow().currentRevision.id).toBe("workflowrev_ltx_i2v_e2e_1");
  expect(backend.revisionRequests.every((revisionRequest) => revisionRequest.scope === "execution-only")).toBe(true);
  await expect(scriptBuilder).toContainText("Waiting for your Local Runner");
});

test("Project switching is locked during preparation and an unmounted Create cannot submit stale work", async ({ page }) => {
  const backend = await installVideoBackend(page, false, { delayFirstRevision: true });
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  await page.getByRole("button", { name: "Video", exact: true }).click();
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Retained city frame upload" }).click();
  await page.getByLabel("Describe the video").fill("The figure crosses the glass atrium and ends beneath a violet spotlight.");
  await openCreatePlan(page);
  await page.getByRole("group", { name: "Video duration" }).getByRole("button", { name: "10s" }).click();
  await openCreativeControls(page);
  await page.getByRole("button", { name: "Write full script" }).click();
  const scriptBuilder = page.getByRole("dialog", { name: "Full Video Script" });
  await scriptBuilder.getByRole("textbox", { name: /What should happen/ }).fill("A precise fashion walk through the atrium");
  await scriptBuilder.getByRole("button", { name: "Write full video script" }).click();
  await expect.poll(() => backend.revisionRequests.length, { timeout: 10_000 }).toBe(1);

  const projectSelect = page.getByLabel("Active project");
  await expect(projectSelect).toBeDisabled();
  try {
    await projectSelect.evaluate((element) => {
      const select = element as HTMLSelectElement;
      select.disabled = false;
      select.value = "project_video_other";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(projectSelect).toHaveValue("project_video_other");
  } finally {
    backend.releaseRevision();
  }

  await expect(projectSelect).toBeEnabled({ timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(backend.videoScriptRequests).toHaveLength(0);
  expect(backend.jobs).toHaveLength(0);
  expect(backend.workflow().currentRevision.id).toBe("workflowrev_ltx_i2v_e2e_1");
});

test("Mobile video creation keeps prompt and Generate ahead of optional controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installVideoBackend(page, false);
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  const preservedPrompt = await page.getByLabel("Describe the image").inputValue();
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await expect(page.getByLabel("Describe the video")).toHaveValue(preservedPrompt);
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Retained city frame upload" }).click();
  const composerOrder = await page.locator(".quick-create-card").evaluate((card) => {
    const selectors = [
      ".quick-create-stage",
      ":scope > .quick-compose-source",
      ":scope > .quick-direction",
      ":scope > .quick-create-plan",
      ":scope > .quick-generate-dock",
      ":scope > .quick-more-toggle",
    ];
    return selectors.map((selector) => Array.from(card.children).indexOf(card.querySelector(selector)!));
  });
  expect(composerOrder).toEqual([...composerOrder].sort((left, right) => left - right));
  await expect(page.locator("details.quick-create-plan")).toBeVisible();
  await expect(page.getByRole("group", { name: "Video duration" })).toBeHidden();
  await expect(page.getByRole("region", { name: "Source and creation type" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Retained city frame source" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change", exact: true })).toHaveCount(1);
  await expect(page.locator(".quick-video-speech")).toBeHidden();
  await expect(page.locator(".quick-compose-model")).toBeHidden();
  await expect(page.getByRole("button", { name: /More creative controls/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".quick-generate-dock")).toHaveCSS("position", "relative");
  await expect(page.locator(".quick-generation-blocker")).toHaveCount(0);
  await expect(page.locator(".quick-primary")).toHaveText(/Generate/);
  await expect(page.locator(".quick-primary")).toBeEnabled();
  await page.getByRole("button", { name: /More creative controls/ }).click();
  await expect(page.locator("#creative-studio-power-tools")).toBeVisible();
  await expect(page.getByRole("button", { name: /Hide creative controls/ })).toHaveAttribute("aria-controls", "creative-studio-power-tools");
  const secondaryModes = page.getByRole("group", { name: "Secondary creation modes" });
  await expect(secondaryModes.getByRole("button")).toHaveText(["Song", "Train"]);
  await expect(secondaryModes.getByRole("button", { name: "Song", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Creation goal" })).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: /Hide creative controls/ }).click();
  await page.getByLabel("Describe the video").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("details.quick-create-plan > summary")).toBeFocused();
  await openCreatePlan(page);
  await expect(page.getByRole("group", { name: "Video duration" })).toBeVisible();
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }]) {
    await page.setViewportSize(viewport);
    const [promptBounds, setupBounds, generateBounds] = await Promise.all([
      page.locator(".quick-direction").boundingBox(),
      page.locator(".quick-create-plan").boundingBox(),
      page.locator(".quick-generate-dock").boundingBox(),
    ]);
    expect(promptBounds).not.toBeNull();
    expect(setupBounds).not.toBeNull();
    expect(generateBounds).not.toBeNull();
    expect(promptBounds!.y + promptBounds!.height).toBeLessThanOrEqual(setupBounds!.y + 1);
    expect(setupBounds!.y + setupBounds!.height).toBeLessThanOrEqual(generateBounds!.y + 1);
    const sourceNameSizing = await page.locator(".quick-orb-copy strong").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(sourceNameSizing.whiteSpace).toBe("nowrap");
    expect(sourceNameSizing.scrollWidth).toBeGreaterThanOrEqual(sourceNameSizing.clientWidth);
    if (viewport.width === 320) {
      const [sourceNameBounds, sourceActionsBounds] = await Promise.all([
        page.locator(".quick-create-stage > footer > span").boundingBox(),
        page.locator(".quick-create-stage > footer > div").boundingBox(),
      ]);
      expect(sourceNameBounds).not.toBeNull();
      expect(sourceActionsBounds).not.toBeNull();
      expect(sourceNameBounds!.width).toBeGreaterThan(120);
      expect(sourceNameBounds!.y + sourceNameBounds!.height).toBeLessThanOrEqual(sourceActionsBounds!.y + 1);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Restored non-default video settings open Creative controls before generation", async ({ page }) => {
  await installVideoBackend(page, false);
  await page.addInitScript(({ now, sourceId, workflowId, revisionId }) => {
    localStorage.setItem("creative-studio:create-sessions", JSON.stringify({
      schemaVersion: 2,
      sessions: [{
        schemaVersion: 2,
        id: "session_restored_exact_dialogue",
        projectId: "project_video_e2e",
        sourceAssetIds: [sourceId],
        retainedArtifactId: null,
        direction: "The figure catches a ribbon of rain while the camera circles once.",
        mediaKind: "video",
        workflowId,
        graphicalSettings: {
          workflowSelectionMode: "explicit",
          workflowRevisionId: revisionId,
          videoDurationSeconds: 5,
          outputCount: 2,
          videoSpeechMode: "exact-script",
          videoSpeechText: "We return together.",
        },
        intentTier: "explore",
        updatedAt: now,
      }],
    }));
  }, {
    now: NOW,
    sourceId: SOURCE_ID,
    workflowId: "workflow_ltx_i2v_e2e",
    revisionId: "workflowrev_ltx_i2v_e2e_1",
  });

  await page.goto(`${HTTP_STUDIO}/#/dna`);
  await expect(page.getByRole("button", { name: /Hide creative controls/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".quick-video-speech")).toBeVisible();
  await expect(page.getByRole("button", { name: "Exact script", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByPlaceholder("I remember this place.")).toHaveValue("We return together.");
  await expect(page.getByText(/every restored non-default setting is visible/i)).toBeVisible();
});

test("Restored exact workflow overrides cannot remain hidden behind Simple Create", async ({ page }) => {
  await installVideoBackend(page, false);
  await page.addInitScript(({ now, sourceId, workflowId, revisionId, seedParameterId }) => {
    localStorage.setItem("creative-studio:create-sessions", JSON.stringify({
      schemaVersion: 2,
      sessions: [{
        schemaVersion: 2,
        id: "session_restored_exact_seed",
        projectId: "project_video_e2e",
        sourceAssetIds: [sourceId],
        retainedArtifactId: null,
        direction: "The figure turns as a luminous storm folds into a narrow ribbon above the street.",
        mediaKind: "video",
        workflowId: null,
        graphicalSettings: {
          workflowSelectionMode: "automatic",
          automaticWorkflowId: workflowId,
          workflowRevisionId: revisionId,
          videoDurationSeconds: 5,
          outputCount: 2,
          videoSpeechMode: "no-speech",
          [`value:${seedParameterId}`]: 246813579,
        },
        intentTier: "explore",
        updatedAt: now,
      }],
    }));
  }, {
    now: NOW,
    sourceId: SOURCE_ID,
    workflowId: "workflow_ltx_i2v_e2e",
    revisionId: "workflowrev_ltx_i2v_e2e_1",
    seedParameterId: SEED_PARAMETER_ID,
  });

  await page.goto(`${HTTP_STUDIO}/#/dna`);
  await expect(page.getByRole("button", { name: /Hide creative controls/ })).toHaveAttribute("aria-expanded", "true");
  await page.locator("details.quick-render-panel > summary").click();
  await page.locator("details.quick-render-more > summary").click();
  await expect(page.locator(".quick-seed-control button small")).toHaveText("246813579");
  await expect(page.getByText(/every restored non-default setting is visible/i)).toBeVisible();
});

test("Simple Create uploads a source in place and preserves the authored prompt through generation", async ({ page }) => {
  const backend = await installVideoBackend(page, false);
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  await page.getByRole("button", { name: "Video", exact: true }).click();
  const direction = page.getByLabel("Describe the video");
  const authoredPrompt = "The glass figure catches a falling star and the street folds upward behind them.";
  await direction.fill(authoredPrompt);

  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("region", { name: "Source and creation type" }).getByRole("button", { name: "Upload an optional source" }).click();
  await (await fileChooser).setFiles({
    name: "new-sculpt.png",
    mimeType: "image/png",
    buffer: Buffer.from("creative-studio-upload-proof"),
  });

  await expect.poll(() => backend.uploads.length).toBe(1);
  expect(backend.uploads[0]).toMatchObject({ fileName: "new-sculpt.png", contentType: "image/png" });
  await expect(page.getByRole("region", { name: "Source and creation type" }).getByRole("img", { name: "new-sculpt source" })).toBeVisible();
  await expect(direction).toHaveValue(authoredPrompt);
  await expect(page).toHaveURL(/#\/dna$/);

  await page.locator(".quick-primary").click();
  await expect.poll(() => backend.jobs.length, { timeout: 15_000 }).toBe(2);
  expect(backend.jobs.every((job) => job.workflow?.inputBindings[IMAGE_PARAMETER_ID] === "media_uploaded_e2e_1")).toBe(true);
  expect(backend.jobs.map((job) => job.videoVariant?.role)).toEqual(["aligned", "discovery"]);
});

test("Longer video settings require an explicit workload confirmation", async ({ page }) => {
  const backend = await installVideoBackend(page, false);
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  await page.getByRole("button", { name: "Video", exact: true }).click();
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Retained city frame upload" }).click();
  await page.getByLabel("Describe the video").fill("The figure turns toward the moving skyline as rain rises around them.");
  await openCreatePlan(page);
  await page.getByRole("group", { name: "Video duration" }).getByRole("button", { name: "10s" }).click();

  await page.locator(".quick-primary").click();
  await expect.poll(() => backend.jobs.length).toBe(0);
  const confirmation = page.getByRole("alert", { name: "Confirm heavy video render" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("10s");
  await expect(confirmation).toContainText("241 @ 24 fps");
  await expect(confirmation).toContainText("0.20 MP");
  await expect(confirmation).toContainText("2");
  await expect(confirmation).toContainText("one after another");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await confirmation.getByRole("button", { name: "Confirm & queue" }).click();
  await expect.poll(() => backend.jobs.length, { timeout: 15_000 }).toBe(2);
  expect(backend.batchRequests).toHaveLength(1);
  expect(backend.jobs.every((job) => job.videoDurationSeconds === 10)).toBe(true);
  expect(backend.jobs.every((job) => job.videoPerformanceMode === "explicit-heavy")).toBe(true);
  expect(backend.revisionRequests.some((request) => request.values[MEGAPIXELS_PARAMETER_ID] === 0.2)).toBe(true);
});

test("Retained-image Fast 30s remains an explicit single-render choice and queues one proven render", async ({ page }) => {
  const backend = await installVideoBackend(page, false);
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  await page.getByRole("button", { name: "Video", exact: true }).click();
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Retained city frame upload" }).click();
  const authoredDirection = "A glass-robed figure turns toward a luminous storm gathering above the city.";
  await page.getByLabel("Describe the video").fill(authoredDirection);

  // Choose an unsaved seed before selecting Fast 30s. The explicit recipe must
  // retain the authored source, direction, and seed.
  await openCreatePlan(page);
  await openCreativeControls(page);
  await page.locator("details.quick-create-advanced > summary").click();
  await page.locator("details.quick-render-panel > summary").click();
  await page.locator("details.quick-render-more > summary").click();
  const newSeed = page.locator(".quick-seed-control button");
  await newSeed.click();
  const preservedSeed = Number(await newSeed.locator("small").textContent());
  expect(Number.isInteger(preservedSeed)).toBe(true);

  const trustedPreset = page.getByRole("region", { name: "Fast 30 second single-render option" });
  await expect(trustedPreset).toBeVisible();
  await expect(trustedPreset).toContainText("Fast 30s");
  await expect(trustedPreset).toContainText("6/6 portrait");
  await trustedPreset.locator("details > summary").click();
  await expect(trustedPreset.locator(".quick-video-simulations")).toContainText("One native 30s render");
  await expect(trustedPreset.locator(".quick-video-simulations")).toContainText("2m 3s");
  await expect(trustedPreset.locator(".quick-video-simulations")).toContainText("8 measured samples");

  await page.getByRole("group", { name: "Video duration" }).getByRole("button", { name: "30s" }).click();
  await expect(trustedPreset.getByRole("button", { name: /Use Fast 30s/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", { name: "Number of video outputs" }).getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await trustedPreset.getByRole("button", { name: /Use Fast 30s/ }).click();
  await expect(trustedPreset.getByRole("button", { name: "Return to Standard Pair" })).toBeVisible();
  await expect(page.locator(".quick-video-essentials > header")).toContainText("LTX 2.5 Image to Video");
  await expect(page.getByRole("group", { name: "Canvas shape" }).getByRole("button", { name: "9:16 Portrait" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Number of video outputs" }).getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Describe the video")).toHaveValue(authoredDirection);
  await expect(newSeed.locator("small")).toHaveText(String(preservedSeed));
  await expect.poll(() => page.evaluate((presetId) => (
    window.localStorage.getItem("creative-studio:create-sessions")?.includes(presetId) ?? false
  ), TRUSTED_LTX_25_I2V_PORTRAIT_30S.id)).toBe(true);
  const savedSession = await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem("creative-studio:create-sessions") ?? "{}") as {
      sessions?: Array<{ sourceAssetIds?: string[]; graphicalSettings?: Record<string, string | number | boolean | null> }>;
    };
    return stored.sessions?.[0] ?? null;
  });
  expect(savedSession?.sourceAssetIds).toContain(SOURCE_ID);
  expect(savedSession?.graphicalSettings?.[`value:${SEED_PARAMETER_ID}`]).toBe(preservedSeed);
  await page.reload();
  await openCreativeControls(page);
  await expect(page.getByRole("region", { name: "Fast 30 second single-render option" })
    .getByRole("button", { name: "Return to Standard Pair" })).toBeVisible();
  await expect(page.getByLabel("Describe the video")).toHaveValue(authoredDirection);

  await expect(page.getByRole("alert", { name: "Confirm heavy video render" })).toHaveCount(0);
  await page.locator(".quick-primary").click();
  await expect.poll(() => backend.jobs.length, { timeout: 15_000 }).toBe(1);

  const [request] = backend.jobs;
  expect(backend.batchRequests).toHaveLength(0);
  expect(backend.enhancementRequests).toHaveLength(0);
  expect(request).toMatchObject({
    modality: "video",
    videoDurationSeconds: 30,
    videoPerformanceMode: "explicit-heavy",
    trustedVideoPresetId: TRUSTED_LTX_25_I2V_PORTRAIT_30S.id,
    outputBatch: { index: 1, count: 1 },
    workflow: { inputBindings: { [IMAGE_PARAMETER_ID]: SOURCE_ID } },
  });
  expect(request.workflow?.expectedPrompt).toContain(authoredDirection);
  const submittedWorkflow = backend.workflowByRevision(request.workflow?.revisionId ?? "");
  expect(submittedWorkflow).not.toBeNull();
  const submittedParameters = Object.fromEntries(submittedWorkflow!.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));
  expect(submittedParameters).toMatchObject({
    "398:362::value": 30,
    "398:361::value": 24,
    [MEGAPIXELS_PARAMETER_ID]: 0.2,
    "403::aspect_ratio": "9:16 (Portrait Widescreen)",
    "398:352::sampler_name": "euler_ancestral",
    "398:341::sampler_name": "euler_ancestral",
    "398:388::video_cfg": 1,
    "398:391::video_cfg": 1,
    "398:388::audio_cfg": 1,
    "398:391::audio_cfg": 1,
    "398:366::batch_size": 1,
    "398:356::batch_size": 1,
    [SEED_PARAMETER_ID]: preservedSeed,
  });
  expect(submittedParameters["398:357::strength"]).toBe(0.7);
  expect(submittedParameters["398:349::strength"]).toBe(1);
  expect(backend.workflow().currentRevision.id).toBe("workflowrev_ltx_i2v_e2e_1");
  expect(backend.revisionRequests.every((revisionRequest) => revisionRequest.scope === "execution-only")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Fast 30s exits cleanly to the standard Aligned and Discovery pair", async ({ page }) => {
  await installVideoBackend(page, false);
  await page.goto(`${HTTP_STUDIO}/#/dna`);

  await page.getByRole("button", { name: "Video", exact: true }).click();
  await openRetainedWork(page);
  await page.getByRole("button", { name: "Use Retained city frame upload" }).click();
  await page.getByLabel("Describe the video").fill("A glass figure discovers a ribbon of light and follows it through the upright city.");

  await openCreatePlan(page);
  await openCreativeControls(page);
  await page.locator("details.quick-create-advanced > summary").click();
  await page.locator("details.quick-render-panel > summary").click();
  await page.locator("details.quick-render-more > summary").click();
  const seedControl = page.locator(".quick-seed-control button");
  await seedControl.click();
  const ownerSeed = await seedControl.locator("small").textContent();

  const trustedPreset = page.getByRole("region", { name: "Fast 30 second single-render option" });
  await trustedPreset.getByRole("button", { name: /Use Fast 30s/ }).click();
  await expect(trustedPreset.getByRole("button", { name: "Return to Standard Pair" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Number of video outputs" }).getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Changing a render-defining setting exits the single-render recipe, keeps
  // the owner's seed, and restores the normal paired semantics.
  await page.getByRole("group", { name: "Video duration" }).getByRole("button", { name: "10s" }).click();
  await expect(trustedPreset.getByRole("button", { name: /Use Fast 30s/ })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("group", { name: "Number of video outputs" }).getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Video length")).toContainText("Aligned follows your direction; Discovery uses 70% random DNA.");
  await expect(seedControl.locator("small")).toHaveText(ownerSeed ?? "");

  // The selected recipe itself also presents an obvious, single-action return
  // to the fast 5s standard pair.
  await trustedPreset.getByRole("button", { name: /Use Fast 30s/ }).click();
  await trustedPreset.getByRole("button", { name: "Return to Standard Pair" }).click();
  await expect(page.getByRole("group", { name: "Video duration" }).getByRole("button", { name: "5s", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Number of video outputs" }).getByRole("button", { name: "2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(trustedPreset.getByRole("button", { name: /Use Fast 30s/ })).toBeVisible();
  await expect(page.getByText("Standard Pair restored: Aligned + Discovery will render with trusted overrides cleared.")).toBeVisible();
  await expect(seedControl.locator("small")).toHaveText(ownerSeed ?? "");
});
