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
