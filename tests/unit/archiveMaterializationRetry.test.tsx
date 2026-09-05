import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveMaterializationResponse, MediaAsset, StudioSnapshot } from "../../shared/contracts";

const adapter = vi.hoisted(() => ({
  activePollIntervalMs: 60_000,
  load: vi.fn(),
  refresh: vi.fn(),
  createArchiveMaterialization: vi.fn(),
  getArchiveMaterialization: vi.fn(),
}));

vi.mock("../../src/adapters", () => ({
  createStudioAdapter: () => adapter,
}));

import { StudioProvider, useStudio } from "../../src/app/StudioProvider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-09-03T15:00:00.000Z";

function snapshot(): StudioSnapshot {
  return {
    adapter: { id: "creative-studio-bff", label: "PC host", development: false, durableScope: "backend" },
    session: { status: "approved", userId: "user_owner", displayName: "Angelo" },
    projects: [{
      id: "project_local",
      activeDnaArtifactId: null,
      name: "Local project",
      type: "art",
      status: "active",
      description: "",
      note: "",
      hue: "#d946ef",
      initials: "LP",
      createdAt: NOW,
      updatedAt: NOW,
    }],
    dnaArtifacts: [],
    jobs: [],
    generationBatches: [],
    promptEnhancements: [],
    videoScriptDrafts: [],
    artifacts: [],
    mediaAssets: [],
    workflows: [],
    recipes: [],
    overnightSessions: [],
    loveLoop: null,
    storyThreads: [],
    storyBankRefreshes: [],
    trainingExamples: [],
    trainingJobs: [],
    trainingReviews: [],
    modelTrainingJobs: [],
    modelAdapters: [],
    modelAdapterReviews: [],
    productionLoops: [],
    productionCockpit: {} as StudioSnapshot["productionCockpit"],
    runners: [],
    capabilities: [],
    acceptances: [],
    refreshedAt: NOW,
  };
}

function response(status: "completed" | "failed", id: string): ArchiveMaterializationResponse {
  const asset: MediaAsset = {
    id: `media_${id}`,
    projectId: "project_local",
    kind: "image",
    name: "Archive study",
    originalFileName: "Archive study.png",
    mimeType: "image/png",
    size: 1024,
    source: "archive-index",
    status: "retained",
    contentUrl: `/api/creative-studio/media/media_${id}/content`,
    trainingEligible: false,
    provenance: {
      materializedFromArchive: true,
      provider: "angelo-art-index",
      catalogId: "archivecatalog_local",
      archiveEntryId: "archiveentry_retry",
      materializationId: id,
      sourceVersion: "angelo-art-index-version",
      sourceFingerprint: "a".repeat(64),
      sourceRecordType: "AUTHORED_ART",
      sourceRecordId: "ART-1",
      inventoryRecordId: null,
      requestedByOwner: true,
      materializedAt: NOW,
      verification: "size-match",
      parentAssetIds: [],
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
  return {
    materialization: {
      schemaVersion: "creative-studio-archive-materialization/1.0",
      id,
      catalogId: "archivecatalog_local",
      entryId: "archiveentry_retry",
      projectId: "project_local",
      runnerId: "creative-studio-pc-host",
      status,
      trainingEligible: false,
      mediaAssetId: status === "completed" ? asset.id : null,
      error: status === "failed" ? "archive_materialization_retention_failed" : null,
      createdAt: NOW,
      updatedAt: NOW,
      startedAt: NOW,
      completedAt: status === "completed" ? NOW : null,
    },
    ...(status === "completed" ? { asset } : {}),
  };
}

describe("archive materialization retry identity", () => {
  let container: HTMLDivElement;
  let root: Root;
  let studio: ReturnType<typeof useStudio>;

  function Harness() {
    studio = useStudio();
    return null;
  }

  beforeEach(async () => {
    adapter.load.mockReset().mockResolvedValue(snapshot());
    adapter.refresh.mockReset().mockResolvedValue(snapshot());
    adapter.createArchiveMaterialization.mockReset();
    adapter.getArchiveMaterialization.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<StudioProvider><Harness /></StudioProvider>);
      await Promise.resolve();
    });
    expect(studio.activeProjectId).toBe("project_local");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("uses a fresh key after an explicit terminal failure", async () => {
    adapter.createArchiveMaterialization
      .mockResolvedValueOnce(response("failed", "archivemat_failed"))
      .mockResolvedValueOnce(response("completed", "archivemat_completed"));

    await act(async () => {
      await expect(studio.addArchiveEntryToProject("archiveentry_retry"))
        .rejects.toThrow("archive_materialization_retention_failed");
      await Promise.resolve();
    });
    await act(async () => {
      await expect(studio.addArchiveEntryToProject("archiveentry_retry"))
        .resolves.toMatchObject({ id: "media_archivemat_completed" });
    });

    const firstKey = adapter.createArchiveMaterialization.mock.calls[0][1].idempotencyKey;
    const retryKey = adapter.createArchiveMaterialization.mock.calls[1][1].idempotencyKey;
    expect(retryKey).not.toBe(firstKey);
  });

  it("keeps the key when the outcome is unknown after a transport failure", async () => {
    adapter.createArchiveMaterialization
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(response("completed", "archivemat_recovered"));

    await act(async () => {
      await expect(studio.addArchiveEntryToProject("archiveentry_retry"))
        .rejects.toThrow("fetch failed");
      await Promise.resolve();
    });
    await act(async () => {
      await expect(studio.addArchiveEntryToProject("archiveentry_retry"))
        .resolves.toMatchObject({ id: "media_archivemat_recovered" });
    });

    const firstKey = adapter.createArchiveMaterialization.mock.calls[0][1].idempotencyKey;
    const retryKey = adapter.createArchiveMaterialization.mock.calls[1][1].idempotencyKey;
    expect(retryKey).toBe(firstKey);
  });
});
