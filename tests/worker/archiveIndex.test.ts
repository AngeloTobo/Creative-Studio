import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ARCHIVE_SYNC_SCHEMA_VERSION, type ArchiveCatalogSyncEntry } from "../../shared/contracts";
import { archiveMaterializationById } from "../../worker/archiveIndex";
import { routeCreativeStudioApi } from "../../worker/routes/api";

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://cs.angelotoborg.com${path}`, init);
}

async function payload<T>(response: Response) {
  return await response.json() as { ok: boolean; error?: string } & T;
}

async function result<T>(response: Response): Promise<T> {
  const value = await payload<T>(response);
  if (!value.ok) throw new Error(value.error ?? "request_failed");
  return value;
}

async function clearArchiveData() {
  await env.DB.batch([
    env.DB.prepare("delete from creative_archive_materializations"),
    env.DB.prepare("delete from creative_archive_entries"),
    env.DB.prepare("delete from creative_archive_sync_batches"),
    env.DB.prepare("delete from creative_archive_catalogs"),
    env.DB.prepare("delete from creative_runners"),
    env.DB.prepare("delete from creative_media_assets"),
    env.DB.prepare("delete from creative_projects"),
  ]);
}

beforeEach(clearArchiveData);

async function enroll(name = "Archive connector") {
  return result<{ token: string; runner: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }), env));
}

async function project(name = "Archive project") {
  return result<{ project: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, type: "visual" }),
  }), env));
}

function observation(sourceVersion: string, sourceFingerprint: string, entryCount: number, verifiedCount = entryCount, unavailableCount = 0) {
  return {
    schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION,
    state: "ready" as const,
    sourceVersion,
    sourceFingerprint,
    expectedEntryCount: entryCount,
    expectedVerifiedCount: verifiedCount,
    expectedUnavailableCount: unavailableCount,
  };
}

function startRequest(value: ReturnType<typeof observation>) {
  return {
    schemaVersion: value.schemaVersion,
    sourceVersion: value.sourceVersion,
    sourceFingerprint: value.sourceFingerprint,
    expectedEntryCount: value.expectedEntryCount,
    expectedVerifiedCount: value.expectedVerifiedCount,
    expectedUnavailableCount: value.expectedUnavailableCount,
  };
}

function entry(overrides: Partial<ArchiveCatalogSyncEntry> = {}): ArchiveCatalogSyncEntry {
  return {
    sourceRecordType: "INVENTORY",
    sourceRecordId: "record_001",
    inventoryRecordId: "inventory_001",
    displayName: "Blue study",
    extension: ".png",
    technicalCategory: "IMAGE",
    workBucket: "AUTHORED_PROJECT_AREA",
    archiveDisposition: "KEEP_VERIFIED",
    observedYear: 2024,
    size: 4,
    sourceStatus: "VERIFIED",
    verificationStatus: "size-match",
    ...overrides,
  };
}

async function publish(token: string, sourceVersion: string, sourceFingerprint: string, entries: ArchiveCatalogSyncEntry[]) {
  const verified = entries.filter((item) => item.verificationStatus === "size-match").length;
  const unavailable = entries.length - verified;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const started = await result<{ catalog: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/archive-index/syncs", {
    method: "POST",
    headers,
    body: JSON.stringify(startRequest(observation(sourceVersion, sourceFingerprint, entries.length, verified, unavailable))),
  }), env));
  await result(await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/entries`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, batchKey: "batch_000001", entries }),
  }), env));
  const completed = await result<{ catalog: { id: string; status: string; materializableEntryCount: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION }),
  }), env));
  return completed.catalog;
}

describe("Angelo Art Index backend seam", () => {
  it("publishes only complete staged catalogs and rejects path-bearing or unknown fields", async () => {
    const runner = await enroll();
    const sourceVersion = "archive-2026-09-02";
    const sourceFingerprint = "a".repeat(64);
    const items = [
      entry(),
      entry({ sourceRecordId: "record_002", displayName: "Amber study", extension: ".jpg" }),
      entry({ sourceRecordId: "record_003", displayName: "Blocked app icon", workBucket: "BLOCKED_TECHNICAL" }),
      entry({ sourceRecordId: "record_004", displayName: "Unresolved still", archiveDisposition: "PARK_UNRESOLVED" }),
      entry({ sourceRecordId: "record_005", displayName: "Incremental review", sourceStatus: "REVIEW_REQUIRED" }),
      entry({ sourceRecordId: "record_006", displayName: "Movie", extension: ".mp4" }),
      entry({ sourceRecordId: "record_007", displayName: "Empty model", extension: ".obj", size: 0 }),
      entry({ sourceRecordId: "record_008", displayName: "Missing image", verificationStatus: "unavailable", size: 0 }),
    ];
    const observed = observation(sourceVersion, sourceFingerprint, items.length, 7, 1);
    const runnerHeaders = { authorization: `Bearer ${runner.token}`, "content-type": "application/json" };

    const noAuth = await routeCreativeStudioApi(request("/api/creative-studio/runner/archive-index/syncs", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(observed),
    }), env);
    expect(noAuth.status).toBe(401);

    const requested = await result<{ kind: string; bundle: { reason: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ version: "1.21.0", comfyReady: false, archiveIndex: observed }),
    }), env));
    expect(requested).toMatchObject({ kind: "archive-sync", bundle: { reason: "catalog-missing" } });

    const started = await result<{ catalog: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/archive-index/syncs", {
      method: "POST", headers: runnerHeaders, body: JSON.stringify(startRequest(observed)),
    }), env));
    const invalid = await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/entries`, {
      method: "PUT",
      headers: runnerHeaders,
      body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, batchKey: "batch_private_001",
        entries: [{ ...items[0], DestinationPath: "D:\\CreativeArchive\\private.png" }] }),
    }), env);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ ok: false, error: "invalid_archive_entry" });
    expect(await env.DB.prepare("select count(*) as count from creative_archive_entries").first<{ count: number }>()).toMatchObject({ count: 0 });

    const staged = await result<{ catalog: { receivedEntryCount: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/entries`, {
      method: "PUT",
      headers: runnerHeaders,
      body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, batchKey: "batch_valid_001", entries: items }),
    }), env));
    expect(staged.catalog.receivedEntryCount).toBe(items.length);
    const retry = await result<{ catalog: { receivedEntryCount: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/entries`, {
      method: "PUT", headers: runnerHeaders,
      body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, batchKey: "batch_valid_001", entries: items }),
    }), env));
    expect(retry.catalog.receivedEntryCount).toBe(items.length);

    const beforePublication = await result<{ page: { catalog: null; entries: unknown[] } }>(await routeCreativeStudioApi(request("/api/creative-studio/archive-index/entries"), env));
    expect(beforePublication.page).toMatchObject({ catalog: null, entries: [] });
    const incompleteWork = await result<{ kind: string; bundle: { reason: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST", headers: runnerHeaders,
      body: JSON.stringify({ version: "1.21.0", comfyReady: false, archiveIndex: observed }),
    }), env));
    expect(incompleteWork).toMatchObject({ kind: "archive-sync", bundle: { reason: "sync-incomplete" } });

    const published = await result<{ catalog: { status: string; materializableEntryCount: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/complete`, {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION }),
    }), env));
    expect(published.catalog).toMatchObject({ status: "active", materializableEntryCount: 2 });

    const first = await result<{ page: { entries: Array<{ id: string; materializable: boolean }>; nextCursor: { catalogId: string; sortName: string; entryId: string }; hasMore: boolean; total: number } }>(
      await routeCreativeStudioApi(request("/api/creative-studio/archive-index/entries?limit=2"), env));
    expect(first.page).toMatchObject({ hasMore: true, total: items.length });
    const cursor = new URLSearchParams({
      cursorCatalogId: first.page.nextCursor.catalogId,
      cursorSortName: first.page.nextCursor.sortName,
      cursorEntryId: first.page.nextCursor.entryId,
      limit: "2",
    });
    const second = await result<{ page: { entries: Array<{ id: string }> } }>(await routeCreativeStudioApi(request(`/api/creative-studio/archive-index/entries?${cursor}`), env));
    expect(second.page.entries.map((item) => item.id)).not.toContain(first.page.entries[0].id);
    expect(second.page.entries.map((item) => item.id)).not.toContain(first.page.entries[1].id);

    const eligible = await result<{ page: { entries: Array<{ displayName: string }>; total: number } }>(
      await routeCreativeStudioApi(request("/api/creative-studio/archive-index/entries?materializable=true"), env));
    expect(eligible.page.total).toBe(2);
    expect(eligible.page.entries.map((item) => item.displayName)).toEqual(["Amber study", "Blue study"]);
    expect(JSON.stringify(eligible)).not.toMatch(/DestinationPath|SourcePath|D:\\\\/);
  });

  it("keeps the prior catalog active when a replacement cannot satisfy its declared counts", async () => {
    const runner = await enroll();
    const prior = await publish(runner.token, "archive-prior", "b".repeat(64), [entry()]);
    const headers = { authorization: `Bearer ${runner.token}`, "content-type": "application/json" };
    const nextObservation = observation("archive-next", "c".repeat(64), 2);
    const started = await result<{ catalog: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/archive-index/syncs", {
      method: "POST", headers, body: JSON.stringify(startRequest(nextObservation)),
    }), env));
    await result(await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/entries`, {
      method: "PUT", headers,
      body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION, batchKey: "batch_partial_001", entries: [entry()] }),
    }), env));
    const completion = await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-index/syncs/${started.catalog.id}/complete`, {
      method: "POST", headers, body: JSON.stringify({ schemaVersion: ARCHIVE_SYNC_SCHEMA_VERSION }),
    }), env);
    expect(completion.status).toBe(409);
    expect(await completion.json()).toMatchObject({ ok: false, error: "archive_sync_count_mismatch" });
    const status = await result<{ activeCatalog: { id: string }; latestSync: { id: string; status: string } }>(
      await routeCreativeStudioApi(request("/api/creative-studio/archive-index/status"), env));
    expect(status.activeCatalog.id).toBe(prior.id);
    expect(status.latestSync).toMatchObject({ id: started.catalog.id, status: "staging" });
  });

  it("materializes owner-approved media idempotently with provenance and before GPU work", async () => {
    const runner = await enroll();
    const sourceVersion = "archive-materialize";
    const sourceFingerprint = "d".repeat(64);
    await publish(runner.token, sourceVersion, sourceFingerprint, [entry()]);
    const archive = await result<{ page: { entries: Array<{ id: string }> } }>(await routeCreativeStudioApi(
      request("/api/creative-studio/archive-index/entries?materializable=true"), env));
    const targetProject = await project();
    const createBody = { projectId: targetProject.project.id, idempotencyKey: "archive_materialize_0001" };
    const created = await result<{ materialization: { id: string; trainingEligible: boolean; status: string } }>(await routeCreativeStudioApi(
      request(`/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody),
      }), env));
    expect(created.materialization).toMatchObject({ trainingEligible: false, status: "waiting-for-runner" });
    const repeated = await result<{ materialization: { id: string } }>(await routeCreativeStudioApi(
      request(`/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody),
      }), env));
    expect(repeated.materialization.id).toBe(created.materialization.id);
    const repeatedWithNewKey = await result<{ materialization: { id: string } }>(await routeCreativeStudioApi(
      request(`/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...createBody, idempotencyKey: "archive_materialize_reloaded_0001" }),
      }), env));
    expect(repeatedWithNewKey.materialization.id).toBe(created.materialization.id);

    const headers = { authorization: `Bearer ${runner.token}`, "content-type": "application/json" };
    const claimed = await result<{ kind: string; bundle: { materialization: { id: string }; claimToken: string; source: Record<string, unknown> } }>(
      await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
        method: "POST", headers,
        body: JSON.stringify({ version: "1.21.0", comfyReady: false, archiveIndex: observation(sourceVersion, sourceFingerprint, 1) }),
      }), env));
    expect(claimed).toMatchObject({ kind: "archive-materialization", bundle: { materialization: { id: created.materialization.id } } });
    expect(JSON.stringify(claimed.bundle.source)).not.toMatch(/[a-z]:[\\/]|\\\\|DestinationPath|SourcePath/i);
    const runningRepeat = await result<{ materialization: { id: string; status: string } }>(await routeCreativeStudioApi(
      request(`/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...createBody, idempotencyKey: "archive_materialize_running_0001" }),
      }), env));
    expect(runningRepeat.materialization).toMatchObject({ id: created.materialization.id, status: "running" });

    const wrongToken = await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-materializations/${created.materialization.id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${runner.token}`, "content-type": "image/png", "x-cs-file-size": "4", "x-cs-claim-token": "x".repeat(50) },
      body: new Uint8Array([1, 2, 3, 4]),
    }), env);
    expect(wrongToken.status).toBe(409);

    const completed = await result<{ materialization: { status: string; mediaAssetId: string }; asset: { source: string; trainingEligible: boolean; provenance: Record<string, unknown> } }>(
      await routeCreativeStudioApi(request(`/api/creative-studio/runner/archive-materializations/${created.materialization.id}/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${runner.token}`, "content-type": "image/png", "x-cs-file-size": "4", "x-cs-claim-token": claimed.bundle.claimToken },
        body: new Uint8Array([1, 2, 3, 4]),
      }), env));
    expect(completed.materialization).toMatchObject({ status: "completed" });
    expect(completed.asset).toMatchObject({
      source: "archive-index",
      trainingEligible: false,
      provenance: { materializedFromArchive: true, provider: "angelo-art-index", requestedByOwner: true, verification: "size-match" },
    });
    const completedRepeat = await result<{ materialization: { id: string; status: string }; asset: { id: string } }>(await routeCreativeStudioApi(
      request(`/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...createBody, idempotencyKey: "archive_materialize_completed_0001" }),
      }), env));
    expect(completedRepeat).toMatchObject({
      materialization: { id: created.materialization.id, status: "completed" },
      asset: { id: completed.materialization.mediaAssetId },
    });
    expect(await env.DB.prepare(`select count(*) as count from creative_archive_materializations
      where catalog_id = ? and entry_id = ? and project_id = ? and status != 'failed'`)
      .bind(claimed.bundle.source.catalogId, archive.page.entries[0].id, targetProject.project.id)
      .first<{ count: number }>()).toMatchObject({ count: 1 });
    if (!env.ARTIFACTS) throw new Error("test_artifact_bucket_missing");
    const stored = await env.ARTIFACTS.get(`owners/${encodeURIComponent("development-angelo")}/projects/${targetProject.project.id}/media/${completed.materialization.mediaAssetId}/source`);
    expect(stored?.size).toBe(4);

    const conflict = await routeCreativeStudioApi(request(`/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...createBody, trainingEligible: true }),
    }), env);
    expect(conflict.status).toBe(409);
    await expect(archiveMaterializationById(env, "other-owner", created.materialization.id)).rejects.toThrow("archive_materialization_not_found");
  });

  it("reuses one project copy across racing keys and requeues a definitive failed attempt", async () => {
    const runner = await enroll();
    const sourceVersion = "archive-materialize-retry";
    const sourceFingerprint = "e".repeat(64);
    await publish(runner.token, sourceVersion, sourceFingerprint, [entry()]);
    const archive = await result<{ page: { entries: Array<{ id: string }> } }>(await routeCreativeStudioApi(
      request("/api/creative-studio/archive-index/entries?materializable=true"), env));
    const targetProject = await project("Archive retry project");
    const path = `/api/creative-studio/archive-index/entries/${archive.page.entries[0].id}/materializations`;
    const requestMaterialization = (idempotencyKey: string) => routeCreativeStudioApi(request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: targetProject.project.id, idempotencyKey }),
    }), env);

    const [firstResponse, racingResponse] = await Promise.all([
      requestMaterialization("archive_materialize_race_0001"),
      requestMaterialization("archive_materialize_race_0002"),
    ]);
    const first = await result<{ materialization: { id: string; status: string } }>(firstResponse);
    const racing = await result<{ materialization: { id: string; status: string } }>(racingResponse);
    expect(first.materialization).toMatchObject({ status: "waiting-for-runner" });
    expect(racing.materialization.id).toBe(first.materialization.id);
    expect(await env.DB.prepare("select count(*) as count from creative_archive_materializations").first<{ count: number }>())
      .toMatchObject({ count: 1 });

    const runnerHeaders = { authorization: `Bearer ${runner.token}`, "content-type": "application/json" };
    const claimed = await result<{ kind: string; bundle: { materialization: { id: string }; claimToken: string } }>(
      await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
        method: "POST", headers: runnerHeaders,
        body: JSON.stringify({ version: "1.23.0", comfyReady: false, archiveIndex: observation(sourceVersion, sourceFingerprint, 1) }),
      }), env));
    const failed = await result<{ materialization: { id: string; status: string; error: string } }>(await routeCreativeStudioApi(
      request(`/api/creative-studio/runner/archive-materializations/${claimed.bundle.materialization.id}/fail`, {
        method: "POST",
        headers: { ...runnerHeaders, "x-cs-claim-token": claimed.bundle.claimToken },
        body: JSON.stringify({ error: "archive_materialization_source_unavailable" }),
      }), env));
    expect(failed.materialization).toMatchObject({ id: first.materialization.id, status: "failed", error: "archive_materialization_source_unavailable" });

    const retried = await result<{ materialization: { id: string; status: string; error: null } }>(
      await requestMaterialization("archive_materialize_race_0001"));
    expect(retried.materialization).toMatchObject({ id: first.materialization.id, status: "waiting-for-runner", error: null });
    const retryWithOtherKey = await result<{ materialization: { id: string } }>(
      await requestMaterialization("archive_materialize_after_failure_0001"));
    expect(retryWithOtherKey.materialization.id).toBe(first.materialization.id);
    expect(await env.DB.prepare("select count(*) as count from creative_archive_materializations").first<{ count: number }>())
      .toMatchObject({ count: 1 });

    const reclaimed = await result<{ kind: string; bundle: { materialization: { id: string }; claimToken: string } }>(
      await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
        method: "POST", headers: runnerHeaders,
        body: JSON.stringify({ version: "1.23.0", comfyReady: false, archiveIndex: observation(sourceVersion, sourceFingerprint, 1) }),
      }), env));
    expect(reclaimed.bundle.materialization.id).toBe(first.materialization.id);
    expect(reclaimed.bundle.claimToken).not.toBe(claimed.bundle.claimToken);
  });
});
