import { afterEach, describe, expect, it, vi } from "vitest";
import type { StudioSnapshot } from "../../shared/contracts";
import { createHttpAdapter } from "../../src/adapters/httpAdapter";

const now = "2026-08-17T12:00:00.000Z";

const emptySnapshot: StudioSnapshot = {
  adapter: {
    id: "creative-studio-bff",
    label: "Creative Studio Worker",
    development: false,
    durableScope: "backend",
  },
  session: { status: "approved", userId: "owner@example.com", displayName: "Owner" },
  projects: [],
  dnaArtifacts: [],
  jobs: [],
  promptEnhancements: [],
  videoScriptDrafts: [],
  artifacts: [],
  mediaAssets: [],
  workflows: [],
  recipes: [],
  trainingExamples: [],
  trainingJobs: [],
  trainingReviews: [],
  modelTrainingJobs: [],
  modelAdapters: [],
  modelAdapterReviews: [],
  productionLoops: [],
  productionCockpit: {
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
      activeProjects: 0,
    },
    actions: [],
    runs: [],
    runners: [],
    computedAt: now,
  },
  runners: [],
  capabilities: [],
  acceptances: [],
  worlds: [],
  worldEntities: [],
  continuityRules: [],
  canonReferences: [],
  canonPromotions: [],
  overnightSessions: [],
  refreshedAt: now,
};

afterEach(() => vi.unstubAllGlobals());

describe("HTTP adapter request budget", () => {
  it("loads the application with one consolidated snapshot request", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, snapshot: emptySnapshot }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHttpAdapter().load()).resolves.toEqual(emptySnapshot);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/creative-studio/snapshot", expect.any(Object));
  });

  it("surfaces Cloudflare throttling without retrying into the limit", async () => {
    const fetchMock = vi.fn(async () => new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHttpAdapter().load()).rejects.toThrow("cloudflare_free_tier_temporarily_limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates and checks one explicit durable video-prompt enhancement", async () => {
    const promptEnhancement = {
      id: "prompt_enhancement_1",
      projectId: "project_1",
      workflowId: "workflow_h3",
      workflowRevisionId: "revision_h3_1",
      workflowName: "MiniMax H3",
      status: "waiting-for-runner",
      progress: 0,
      sourcePrompt: "The figure turns toward a distant light.",
      enhancedPrompt: null,
      provider: "local-comfyui",
      promptProfileId: "minimax-h3-i2v-motion/1.0",
      targetModel: "MiniMax H3",
      outputFormat: "minimax-h3-timeline",
      inputMode: "image-to-video",
      sourceId: "media_1",
      videoDurationSeconds: 10,
      model: null,
      comfyPromptId: null,
      runnerId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ ok: true, promptEnhancement });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createHttpAdapter();

    await adapter.createVideoPromptEnhancement({
      projectId: "project_1",
      workflowId: "workflow_h3",
      workflowRevisionId: "revision_h3_1",
      sourcePrompt: promptEnhancement.sourcePrompt,
      inputMode: "image-to-video",
      sourceId: "media_1",
      videoDurationSeconds: 10,
      idempotencyKey: "enhance_once_1",
    });
    await adapter.getVideoPromptEnhancement(promptEnhancement.id);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/creative-studio/prompt-enhancements",
      "/api/creative-studio/prompt-enhancements/prompt_enhancement_1",
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workflowId: "workflow_h3",
      inputMode: "image-to-video",
      sourceId: "media_1",
      videoDurationSeconds: 10,
    });
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined();
  });

  it("creates and checks one explicit durable video-script draft without polling the snapshot", async () => {
    const videoScriptDraft = {
      id: "video_script_1",
      scriptFormat: "full-script-v2" as const,
      projectId: "project_1",
      workflowId: "workflow_h3",
      workflowRevisionId: "workflowrev_h3",
      workflowName: "MiniMax H3",
      workflowVersion: 1,
      promptProfile: {
        id: "minimax-h3-i2v-motion/1.0" as const,
        label: "MiniMax H3 I2VA motion direction",
        targetModel: "MiniMax H3",
        outputFormat: "minimax-h3-timeline" as const,
        minimumWords: 60,
        maximumWords: 180,
      },
      inputMode: "image-to-video" as const,
      source: { id: "media_1", source: "upload" as const, kind: "image" as const, name: "Reference image" },
      status: "waiting-for-runner",
      progress: 0,
      mode: "build",
      seedPhrases: ["tired astronaut", "living blue flower"],
      sourceScript: null,
      sceneDirection: "The astronaut kneels while the flower opens.",
      videoDurationSeconds: 10,
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
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ ok: true, videoScriptDraft });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createHttpAdapter();

    await adapter.createVideoScriptDraft({
      scriptFormat: "full-script-v2",
      projectId: "project_1",
      workflowId: "workflow_h3",
      workflowRevisionId: "workflowrev_h3",
      inputMode: "image-to-video",
      sourceId: "media_1",
      mode: "build",
      seedPhrases: videoScriptDraft.seedPhrases,
      sceneDirection: videoScriptDraft.sceneDirection,
      videoDurationSeconds: 10,
      idempotencyKey: "video_script_once_1",
    });
    await adapter.getVideoScriptDraft(videoScriptDraft.id);
    const editedScript = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\nSHOT 1 (0.00s–10.00s): The astronaut moves through the moonlit station as the camera tracks close, then settles on the flower opening into blue light. The room and distant windows remain visible in soft shadow.\nAudio: A low electrical hum, measured footsteps, and a delicate crystalline bloom tone.";
    await adapter.updateVideoScriptDraft(videoScriptDraft.id, { scriptFormat: "full-script-v2", currentScript: editedScript, currentSpokenText: null, expectedRevision: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/creative-studio/video-scripts",
      "/api/creative-studio/video-scripts/video_script_1",
      "/api/creative-studio/video-scripts/video_script_1",
    ]);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      scriptFormat: "full-script-v2",
      workflowId: "workflow_h3",
      workflowRevisionId: "workflowrev_h3",
      inputMode: "image-to-video",
      sourceId: "media_1",
      mode: "build",
      seedPhrases: videoScriptDraft.seedPhrases,
      sceneDirection: videoScriptDraft.sceneDirection,
      videoDurationSeconds: 10,
    });
    expect(fetchMock.mock.calls[1][1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[2][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      scriptFormat: "full-script-v2",
      currentScript: editedScript,
      currentSpokenText: null,
      expectedRevision: 0,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/snapshot"))).toBe(false);
  });

  it("encodes stable artifact-history cursors and filters without extra requests", async () => {
    const page = { artifacts: [], jobs: [], acceptances: [], trainingExamples: [], nextCursor: null, hasMore: false, total: 0 };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ ok: true, page });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createHttpAdapter().listArtifactHistory({
      projectId: "project_1",
      limit: 2,
      cursor: { createdAt: "2026-08-27T12:34:56.000Z", artifactId: "artifact_2" },
      kinds: ["image", "video"],
      statuses: ["accepted"],
      includeArchived: true,
      search: "  opal face  ",
    })).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url), "https://creative-studio.test");
    expect(parsed.pathname).toBe("/api/creative-studio/artifacts");
    expect(parsed.searchParams.get("page")).toBe("true");
    expect(parsed.searchParams.get("projectId")).toBe("project_1");
    expect(parsed.searchParams.get("limit")).toBe("2");
    expect(parsed.searchParams.get("cursorCreatedAt")).toBe("2026-08-27T12:34:56.000Z");
    expect(parsed.searchParams.get("cursorArtifactId")).toBe("artifact_2");
    expect(parsed.searchParams.getAll("kind")).toEqual(["image", "video"]);
    expect(parsed.searchParams.getAll("status")).toEqual(["accepted"]);
    expect(parsed.searchParams.get("includeArchived")).toBe("true");
    expect(parsed.searchParams.get("q")).toBe("opal face");
    expect(init).toMatchObject({ credentials: "include", headers: { "content-type": "application/json" } });
  });

  it("uses only the exact World and explicit canon-promotion endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      const pathname = new URL(String(input), "https://creative-studio.test").pathname;
      if (pathname.endsWith("/promote-artifact")) return Response.json({ ok: true, promotion: { artifactId: "artifact_1" } });
      return Response.json({ ok: true, world: { id: "world_1" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createHttpAdapter();

    await adapter.createWorld({ projectId: "project_1", name: "Blue Archive", premise: "A floating archive" });
    await adapter.updateWorld("world_1", { expectedVersion: 1, premise: "A floating archive under blue stars" });
    await adapter.archiveWorld("world_1", 2);
    await adapter.promoteArtifactToCanon("world_1", {
      schemaVersion: "creative-studio-promote-to-canon/1.0",
      confirmation: "promote-artifact-to-canon",
      projectId: "project_1",
      worldId: "world_1",
      entityId: "entity_1",
      artifactId: "artifact_1",
      facets: ["face"],
      continuityNotes: [{ facet: "face", value: "Faceted opal cheeks" }],
      note: "Promote the accepted face.",
      expectedEntityVersion: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://creative-studio.test").pathname)).toEqual([
      "/api/creative-studio/worlds",
      "/api/creative-studio/worlds/world_1",
      "/api/creative-studio/worlds/world_1/archive",
      "/api/creative-studio/worlds/world_1/promote-artifact",
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "PATCH", "POST", "POST"]);
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toMatchObject({
      confirmation: "promote-artifact-to-canon",
      worldId: "world_1",
      artifactId: "artifact_1",
      expectedEntityVersion: 1,
    });
  });
});
