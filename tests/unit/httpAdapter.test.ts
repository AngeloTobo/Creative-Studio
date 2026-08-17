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
  trainingExamples: [],
  trainingJobs: [],
  trainingReviews: [],
  productionLoops: [],
  productionCockpit: {
    summary: {
      actionRequired: 0,
      activeRuns: 0,
      outputsAwaitingReview: 0,
      retainedOutputs: 0,
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
});
