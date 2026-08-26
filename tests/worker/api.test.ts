import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { CreativeDnaArtifact } from "../../shared/contracts";
import { backendMode } from "../../worker/config";
import { processJobMessage } from "../../worker/jobs";
import { attachAfdfwGeneration, cancelOwnedJob, createAfdfwJob, createDevelopmentJob, createLocalDna, createProject, createQueuedJob, reconcileDevelopmentJobs } from "../../worker/repository";
import { routeCreativeStudioApi } from "../../worker/routes/api";
import { claimLocalRunnerJob } from "../../worker/runner";
import type { Env } from "../../worker/types";

const BASE = "https://creative-studio.test";

function request(path: string, init?: RequestInit) {
  return new Request(`${BASE}${path}`, init);
}

async function result(response: Response) {
  return response.json<Record<string, unknown>>();
}

function afdfwFor(ownerId: string, dnaArtifacts: CreativeDnaArtifact[] = [], approved = true): Fetcher {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const upstream = new Request(input, init);
      const path = new URL(upstream.url).pathname;
      if (path === "/api/me") {
        if (!approved) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        return Response.json({ status: "approved", user: { id: ownerId }, profile: { displayName: ownerId } });
      }
      if (path === "/api/creative-dna" && upstream.method === "GET") return Response.json({ artifacts: dnaArtifacts });
      if (path === "/api/profile-song/generations" || path === "/api/profile-image/generations") return Response.json({ generations: [] });
      if (path === "/api/profile-image/media/test-image") return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      return Response.json({ ok: false, error: "unexpected_test_upstream" }, { status: 404 });
    },
  } as Fetcher;
}

function workerEnv(mode: "development" | "afdfw", afdfw?: Fetcher, artifacts?: R2Bucket): Env {
  return { DB: env.DB, BACKEND_MODE: mode, AFDFW: afdfw, ARTIFACTS: artifacts };
}

function memoryQueue() {
  const messages: Array<{ body: { jobId: string }; delaySeconds: number }> = [];
  const queue = {
    async send(body: { jobId: string }, options?: QueueSendOptions) {
      messages.push({ body, delaySeconds: options?.delaySeconds ?? 0 });
    },
  } as unknown as Queue<{ jobId: string }>;
  return { queue, messages };
}

function memoryBucket() {
  const values = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  const bucket = {
    async put(key: string, value: ArrayBuffer | ReadableStream, options?: R2PutOptions) {
      const bytes = value instanceof ArrayBuffer ? value.slice(0) : await new Response(value as BodyInit).arrayBuffer();
      values.set(key, { bytes, contentType: options?.httpMetadata && "contentType" in options.httpMetadata ? String(options.httpMetadata.contentType) : "application/octet-stream" });
      return { key, size: bytes.byteLength };
    },
    async head(key: string) {
      const value = values.get(key);
      return value ? { key, size: value.bytes.byteLength } : null;
    },
    async get(key: string, options?: R2GetOptions) {
      const value = values.get(key);
      if (!value) return null;
      const range = options?.range as { offset: number; length: number } | undefined;
      const bytes = range ? value.bytes.slice(range.offset, range.offset + range.length) : value.bytes;
      return {
        body: bytes,
        writeHttpMetadata(headers: Headers) { headers.set("content-type", value.contentType); },
      };
    },
    async delete(key: string) { values.delete(key); },
  } as unknown as R2Bucket;
  return { bucket, values };
}

async function clearData() {
  await env.DB.batch([
    env.DB.prepare("delete from creative_model_adapter_reviews"),
    env.DB.prepare("delete from creative_model_adapters"),
    env.DB.prepare("delete from creative_model_training_jobs"),
    env.DB.prepare("delete from creative_runners"),
    env.DB.prepare("delete from creative_dna_training_reviews"),
    env.DB.prepare("delete from creative_dna_training_evidence_reservations"),
    env.DB.prepare("delete from creative_dna_training_jobs"),
    env.DB.prepare("delete from creative_training_examples"),
    env.DB.prepare("delete from creative_workflow_revisions"),
    env.DB.prepare("delete from creative_workflows"),
    env.DB.prepare("delete from creative_media_assets"),
    env.DB.prepare("delete from creative_acceptances"),
    env.DB.prepare("delete from creative_artifacts"),
    env.DB.prepare("delete from creative_jobs"),
    env.DB.prepare("delete from creative_dna_artifacts"),
    env.DB.prepare("delete from creative_projects"),
  ]);
}

beforeEach(clearData);

async function testProject(ownerId: string, name = "Test Project") {
  return createProject(env, ownerId, { name, type: "Test System", hue: "#8b5cf6" });
}

describe("Creative Studio Worker API", () => {
  it("dispatches the production Worker entrypoint with configured bindings", async () => {
    const response = await exports.default.fetch(`${BASE}/api/creative-studio/session`);
    expect(response.status).toBe(200);
    expect(await result(response)).toMatchObject({ ok: true, session: { status: "development", userId: "development-angelo" } });
    const runnerShell = await exports.default.fetch("https://runner.cs.angelotoborg.com/");
    expect(runnerShell.status).toBe(404);
    expect(await result(runnerShell)).toMatchObject({ error: "runner_route_not_found" });
  });

  it("requires a protected AFDFW target outside development mode", () => {
    expect(backendMode({ DB: env.DB })).toBe("development");
    expect(() => backendMode({ DB: env.DB, BACKEND_MODE: "afdfw" })).toThrow("afdfw_backend_not_configured");
    expect(() => backendMode({ DB: env.DB, BACKEND_MODE: "afdfw", AFDFW_BASE_URL: "http://remote.example" })).toThrow("insecure_afdfw_base_url");
    expect(backendMode({ DB: env.DB, BACKEND_MODE: "afdfw", AFDFW_BASE_URL: "https://afdfw.example" })).toBe("afdfw");
    expect(backendMode({ DB: env.DB, BACKEND_MODE: "afdfw", AFDFW_BASE_URL: "http://127.0.0.1:8788" })).toBe("afdfw");
  });

  it("rejects unauthenticated AFDFW mode before touching owner data", async () => {
    const response = await routeCreativeStudioApi(request("/api/creative-studio/session"), workerEnv("afdfw", afdfwFor("owner-a", [], false)));
    expect(response.status).toBe(401);
    expect(await result(response)).toMatchObject({ ok: false, error: "approved_login_required" });
    const row = await env.DB.prepare("select count(*) as count from creative_projects").first<{ count: number }>();
    expect(Number(row?.count)).toBe(0);
  });

  it("relays Cloudflare Access identity only to the allowlisted AFDFW session capability", async () => {
    let relayedEmail = "";
    const afdfw = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const upstream = new Request(input, init);
        relayedEmail = upstream.headers.get("cf-access-authenticated-user-email") || "";
        return Response.json({ status: "approved", user: { id: "owner-access" }, profile: { displayName: "Angelo" } });
      },
    } as Fetcher;
    const response = await routeCreativeStudioApi(request("/api/creative-studio/session", {
      headers: { "cf-access-authenticated-user-email": "angelotoborg@gmail.com" },
    }), workerEnv("afdfw", afdfw));
    expect(response.status).toBe(200);
    expect(relayedEmail).toBe("angelotoborg@gmail.com");
  });

  it("loads the complete studio through one consolidated snapshot contract", async () => {
    const upstreamPaths: string[] = [];
    const afdfw = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const upstream = new Request(input, init);
        upstreamPaths.push(new URL(upstream.url).pathname);
        return Response.json({ status: "approved", user: { id: "owner-snapshot" }, profile: { displayName: "Angelo" } });
      },
    } as Fetcher;
    const response = await routeCreativeStudioApi(request("/api/creative-studio/snapshot"), workerEnv("afdfw", afdfw));
    expect(response.status).toBe(200);
    expect(await result(response)).toMatchObject({
      ok: true,
      snapshot: {
        adapter: { id: "creative-studio-bff", development: false },
        session: { userId: "owner-snapshot" },
        projects: [],
        jobs: [],
        artifacts: [],
        productionLoops: [],
        productionCockpit: { summary: { activeRuns: 0 } },
      },
    });
    expect(upstreamPaths).toEqual(["/api/me"]);
  });

  it("keeps the local BFF hardware-only and never falls back to development generation", async () => {
    const local = { ...workerEnv("development", undefined, memoryBucket().bucket), LOCAL_HARDWARE_ONLY: "true" as const };
    const project = await testProject("development-angelo", "Local Hardware Project");
    const dna = await createLocalDna(env, "development-angelo", {
      projectId: project.id,
      name: "Local hardware DNA",
      directive: "A precise local hardware study with restrained light.",
      targetModality: "image",
    });

    const snapshot = await result(await routeCreativeStudioApi(request("/api/creative-studio/snapshot"), local)) as {
      snapshot: { adapter: { label: string; development: boolean }; capabilities: Array<{ key: string; provider: string; detail: string }> };
    };
    expect(snapshot.snapshot.adapter).toMatchObject({ label: "Creative Studio Local BFF · hardware-only", development: true });
    expect(snapshot.snapshot.capabilities).toContainEqual(expect.objectContaining({ key: "image-generation", provider: "Local ComfyUI" }));
    expect(snapshot.snapshot.capabilities).toContainEqual(expect.objectContaining({ key: "afdfw-session", provider: "remote mode only" }));

    const response = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "image",
        idempotencyKey: "local_hardware_only_001",
      }),
    }), local);
    expect(response.status).toBe(400);
    expect(await result(response)).toMatchObject({ ok: false, error: "local_comfyui_workflow_required" });
    expect(await env.DB.prepare("select count(*) as count from creative_jobs").first<{ count: number }>()).toMatchObject({ count: 0 });
  });

  it("requires an explicit AFDFW provider instead of using it as a production fallback", async () => {
    const ownerId = "owner-explicit-provider";
    const project = await testProject(ownerId, "Explicit Provider");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Explicit route DNA",
      directive: "A controlled image study with a clear central subject.",
      targetModality: "image",
    });
    const production = workerEnv("afdfw", afdfwFor(ownerId), memoryBucket().bucket);
    const response = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "explicit@example.com" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "image",
        idempotencyKey: "explicit_provider_required_001",
      }),
    }), production);
    expect(response.status).toBe(400);
    expect(await result(response)).toMatchObject({ ok: false, error: "generation_provider_required" });
    expect(await env.DB.prepare("select count(*) as count from creative_jobs where owner_id = ?").bind(ownerId).first<{ count: number }>()).toMatchObject({ count: 0 });
  });

  it("starts empty and creates, edits, and archives an owned project", async () => {
    const local = workerEnv("development");
    const empty = await routeCreativeStudioApi(request("/api/creative-studio/projects"), local);
    expect(await result(empty)).toMatchObject({ ok: true, projects: [] });

    const created = await routeCreativeStudioApi(request("/api/creative-studio/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Owned Project", type: "Creative System", hue: "#22d3ee" }),
    }), local);
    expect(created.status).toBe(201);
    const createdPayload = await result(created) as { project: { id: string } };
    const projectId = createdPayload.project.id;

    const updated = await routeCreativeStudioApi(request(`/api/creative-studio/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Owned Project Revised", status: "paused" }),
    }), local);
    expect(await result(updated)).toMatchObject({ project: { name: "Owned Project Revised", status: "paused", initials: "OP" } });

    const archived = await routeCreativeStudioApi(request(`/api/creative-studio/projects/${projectId}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), local);
    expect(await result(archived)).toMatchObject({ project: { id: projectId, status: "archived" } });
  });

  it("validates JSON, project ownership, and commercial-reference provenance", async () => {
    const local = workerEnv("development");
    const project = await testProject("development-angelo");
    const invalidJson = await routeCreativeStudioApi(request("/api/creative-studio/dna", { method: "POST", body: "{}" }), local);
    expect(invalidJson.status).toBe(400);
    expect(await result(invalidJson)).toMatchObject({ error: "invalid_json" });

    const missingProject = await routeCreativeStudioApi(request("/api/creative-studio/dna", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "not-owned", directive: "A valid original direction.", targetModality: "image" }),
    }), local);
    expect(missingProject.status).toBe(404);
    expect(await result(missingProject)).toMatchObject({ error: "project_not_found" });

    const missingReference = await routeCreativeStudioApi(request("/api/creative-studio/dna", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, directive: "Use a reference safely.", targetModality: "music", sourceKind: "commercial_reference" }),
    }), local);
    expect(missingReference.status).toBe(400);
    expect(await result(missingReference)).toMatchObject({ error: "reference_label_required" });
  });

  it("keeps review decisions isolated to the authenticated owner", async () => {
    const ownerA = "owner-a";
    const project = await testProject(ownerA);
    const dna = await createLocalDna(env, ownerA, {
      projectId: project.id,
      name: "Owner A Study",
      directive: "A private luminous object with a quiet center.",
      targetModality: "image",
    });
    const job = await createDevelopmentJob(env, ownerA, project.id, dna, "image");
    await env.DB.prepare("update creative_jobs set created_at = ? where id = ?").bind("2020-01-01T00:00:00.000Z", job.id).run();
    await reconcileDevelopmentJobs(env, ownerA);
    const artifact = await env.DB.prepare("select id from creative_artifacts where owner_id = ?").bind(ownerA).first<{ id: string }>();
    expect(artifact?.id).toBeTruthy();

    const wrongOwner = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifact?.id}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Should not cross the boundary." }),
    }), workerEnv("afdfw", afdfwFor("owner-b")));
    expect(wrongOwner.status).toBe(404);
    expect(await result(wrongOwner)).toMatchObject({ error: "artifact_not_found" });

    const missingNote = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifact?.id}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "   " }),
    }), workerEnv("afdfw", afdfwFor(ownerA)));
    expect(missingNote.status).toBe(400);
    expect(await result(missingNote)).toMatchObject({ error: "review_note_required" });

    const rightOwner = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifact?.id}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Keep this direction." }),
    }), workerEnv("afdfw", afdfwFor(ownerA)));
    expect(rightOwner.status).toBe(200);
    expect(await result(rightOwner)).toMatchObject({ ok: true, artifact: { status: "accepted" }, acceptance: { decision: "accepted", note: "Keep this direction.", actor: "angelo" } });
  });

  it("uploads, verifies, lists, and serves owner-scoped project media", async () => {
    const ownerId = "owner-media";
    const project = await testProject(ownerId, "Media Study");
    const { bucket, values } = memoryBucket();
    const production = workerEnv("afdfw", afdfwFor(ownerId), bucket);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploaded = await routeCreativeStudioApi(request("/api/creative-studio/media", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("Owner Reference.png"),
        "x-cs-file-size": String(bytes.byteLength),
        "x-cs-training-eligible": "true",
      },
      body: bytes,
    }), production);
    expect(uploaded.status).toBe(201);
    const payload = await result(uploaded) as { asset: { id: string; projectId: string; trainingEligible: boolean; contentUrl: string; size: number } };
    expect(payload.asset).toMatchObject({ projectId: project.id, trainingEligible: true, size: bytes.byteLength });
    expect(values.size).toBe(1);

    const row = await env.DB.prepare("select r2_key as r2Key, training_eligible as trainingEligible from creative_media_assets where id = ?")
      .bind(payload.asset.id).first<{ r2Key: string; trainingEligible: number }>();
    expect(row?.r2Key).toContain(`owners/${ownerId}/projects/${project.id}/media/${payload.asset.id}/source`);
    expect(Number(row?.trainingEligible)).toBe(1);

    const listed = await result(await routeCreativeStudioApi(request("/api/creative-studio/media"), production)) as { assets: Array<{ id: string }> };
    expect(listed.assets).toEqual([{ ...payload.asset, kind: "image", name: "Owner Reference", originalFileName: "Owner Reference.png", mimeType: "image/png", source: "upload", status: "retained", provenance: expect.any(Object), createdAt: expect.any(String), updatedAt: expect.any(String) }]);

    const content = await routeCreativeStudioApi(request(payload.asset.contentUrl), production);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("image/png");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await content.arrayBuffer())]).toEqual([...bytes]);

    const ranged = await routeCreativeStudioApi(request(payload.asset.contentUrl, { headers: { range: "bytes=2-5" } }), production);
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe(`bytes 2-5/${bytes.byteLength}`);
    expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([78, 71, 13, 10]);

    const wrongOwner = await routeCreativeStudioApi(request(payload.asset.contentUrl), workerEnv("afdfw", afdfwFor("owner-other"), bucket));
    expect(wrongOwner.status).toBe(404);
    expect(await result(wrongOwner)).toMatchObject({ error: "media_not_found" });

    const referencedDna = await routeCreativeStudioApi(request("/api/creative-studio/dna", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        name: "Owner upload direction",
        directive: "A precise organic form suspended against a quiet field.",
        targetModality: "image",
        sourceKind: "owner_uploads",
        referenceAssetIds: [payload.asset.id],
      }),
    }), production);
    expect(referencedDna.status).toBe(201);
    expect(await result(referencedDna)).toMatchObject({
      artifact: { source: { kind: "owner_uploads", referenceLabel: null, referenceAssetIds: [payload.asset.id] } },
    });

    const otherProject = await testProject(ownerId, "Other Media Study");
    const crossProject = await routeCreativeStudioApi(request("/api/creative-studio/dna", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: otherProject.id,
        directive: "This must not cross a project boundary.",
        targetModality: "image",
        sourceKind: "owner_uploads",
        referenceAssetIds: [payload.asset.id],
      }),
    }), production);
    expect(crossProject.status).toBe(400);
    expect(await result(crossProject)).toMatchObject({ error: "reference_asset_project_mismatch" });
  });

  it("starts an upload-based CreativeDNA training run and preserves runner lineage", async () => {
    const ownerId = "owner-training";
    const project = await testProject(ownerId, "Training Study");
    const baseDna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Rights-safe base",
      directive: "Use only abstract composition and atmosphere from the labeled reference.",
      targetModality: "image",
      sourceKind: "commercial_reference",
      referenceLabel: "Labeled commercial reference",
    });
    const { bucket } = memoryBucket();
    const production = workerEnv("afdfw", afdfwFor(ownerId), bucket);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploaded = await result(await routeCreativeStudioApi(request("/api/creative-studio/media", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("Training Source.png"),
        "x-cs-file-size": String(bytes.byteLength),
        "x-cs-training-eligible": "true",
      },
      body: bytes,
    }), production)) as { asset: { id: string } };

    const started = await routeCreativeStudioApi(request("/api/creative-studio/training-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        baseDnaArtifactId: baseDna.artifactId,
        name: "Trained visual language",
        targetModality: "image",
        assetIds: [uploaded.asset.id],
        includeTrainingExamples: true,
        idempotencyKey: "training_test_start_001",
      }),
    }), production);
    expect(started.status).toBe(202);
    const startedPayload = await result(started) as { trainingJob: { id: string; status: string; assetIds: string[] } };
    expect(startedPayload.trainingJob).toMatchObject({ status: "waiting-for-runner", assetIds: [uploaded.asset.id] });

    const enrolled = await result(await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Training test runner" }),
    }), production)) as { runner: { id: string }; token: string };

    const runnerRequest = (path: string, body: object) => routeCreativeStudioApi(request(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${enrolled.token}` },
      body: JSON.stringify(body),
    }), production);
    const unsupportedClaim = await result(await runnerRequest("/api/creative-studio/runner/training/claim", {}));
    expect(unsupportedClaim).toMatchObject({ bundle: null });
    const claimed = await result(await runnerRequest("/api/creative-studio/runner/work/claim", {
      version: "1.2.0",
      comfyUrl: "http://127.0.0.1:8188",
      comfyVersion: "0.33.0",
      device: "Test GPU",
      activeJobId: null,
      error: null,
    })) as {
      kind: string;
      bundle: { trainingJob: { id: string; status: string; runnerId: string }; assets: Array<{ id: string; trainingEligible: boolean }> };
    };
    expect(claimed.kind).toBe("training");
    expect(claimed.bundle.trainingJob).toMatchObject({ id: startedPayload.trainingJob.id, status: "running", runnerId: enrolled.runner.id });
    expect(claimed.bundle.assets).toEqual([expect.objectContaining({ id: uploaded.asset.id, trainingEligible: true })]);

    const heartbeat = await result(await runnerRequest(`/api/creative-studio/runner/training/${startedPayload.trainingJob.id}/heartbeat`, { progress: 62 }));
    expect(heartbeat).toMatchObject({ continue: true, trainingJob: { progress: 62 } });

    const dimensionKeys = ["energy", "tension", "contrast", "warmth", "spaciousness", "rhythmicity", "organicity", "polish"];
    const dimensions = Object.fromEntries(dimensionKeys.map((key, index) => [key, {
      value: 48 + index,
      confidence: 0.86,
      sourceIds: [uploaded.asset.id],
    }]));

    const completed = await runnerRequest(`/api/creative-studio/runner/training/${startedPayload.trainingJob.id}/complete`, {
        dna: {
          directive: "A trained visual language with luminous structure and restrained warmth.",
          targetModality: "image",
          dimensions: { contrast: 72, warmth: 42, polish: 66 },
        },
        analysis: {
          schemaVersion: "creative-dna-training-analysis/1.1",
          createdAt: "2020-01-01T00:00:00.000Z",
          summary: "Measured one consented image source and synthesized its reusable visual dimensions.",
          sources: [{
            sourceId: uploaded.asset.id,
            mediaId: "untrusted-media-id",
            sourceType: "accepted-artifact",
            kind: "video",
            label: "Untrusted label",
            detailedDescription: {
              schemaVersion: "creative-dna-media-description/1.0",
              text: "A luminous abstract form occupies the center of a cool, open landscape with soft depth and controlled highlights.",
              provider: "local-comfyui",
              workflowId: "gemma4-multimodal-description",
              workflowVersion: 1,
              model: "gemma4_e4b_it_fp8_scaled.safetensors",
              prompt: "Describe this uploaded image as a detailed, reusable generation prompt with concrete visual observations.",
              comfyPromptId: "gemma-test-prompt-001",
              settings: { maxLength: 2048, temperature: 0.7, seed: 0 },
            },
            observations: ["Measured image pixels."],
            metrics: { width: 2048, warmth: 42.25 },
            dimensions: Object.fromEntries(dimensionKeys.map((key, index) => [key, 48 + index])),
            confidence: 0.86,
          }],
          dimensions,
        },
      });
    const completedPayload = await result(completed) as { trainingJob: { status: string; resultDnaArtifactId: string } };
    expect(completedPayload.trainingJob.status).toBe("completed");
    expect(completedPayload.trainingJob.resultDnaArtifactId).toBeTruthy();

    const dna = await result(await routeCreativeStudioApi(request("/api/creative-studio/dna"), production)) as {
      artifacts: Array<{ artifactId: string; source: { kind: string; directive: string; referenceLabel: string | null }; generationPrompts: { image: string }; rights: { policy: string }; lineage: { parentArtifactId: string | null }; training: null | { jobId: string; runnerId: string; assetIds: string[]; analysis: { sources: Array<{ mediaId: string; sourceType: string; kind: string; label: string }>; dimensions: Record<string, { confidence: number }> } }; evidence: Array<{ path: string; class: string }> }>;
    };
    expect(dna.artifacts[0]).toMatchObject({
      artifactId: completedPayload.trainingJob.resultDnaArtifactId,
      training: { jobId: startedPayload.trainingJob.id, runnerId: enrolled.runner.id, assetIds: [uploaded.asset.id] },
    });
    expect(dna.artifacts[0].training?.analysis.sources[0]).toMatchObject({
      mediaId: uploaded.asset.id,
      sourceType: "upload",
      kind: "image",
      label: "Training Source",
      detailedDescription: {
        schemaVersion: "creative-dna-media-description/1.1",
        provider: "local-comfyui",
        workflowId: "gemma4-multimodal-description",
        model: "gemma4_e4b_it_fp8_scaled.safetensors",
        longSummary: "A luminous abstract form occupies the center of a cool, open landscape with soft depth and controlled highlights.",
        shortSummary: "A luminous abstract form occupies the center of a cool, open landscape with soft depth and controlled highlights.",
      },
    });
    expect(dna.artifacts[0].evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "training.analysis.dimensions.warmth", class: "derived/translated" }),
    ]));
    expect(dna.artifacts[0]).toMatchObject({
      source: { kind: "commercial_reference", referenceLabel: "Labeled commercial reference" },
      rights: { policy: "abstract-attributes-only" },
      lineage: { parentArtifactId: baseDna.artifactId },
    });
    expect(dna.artifacts[0].source.directive).toBe("A luminous abstract form occupies the center of a cool, open landscape with soft depth and controlled highlights.");
    expect(dna.artifacts[0].generationPrompts.image).toBe(dna.artifacts[0].source.directive);
    expect(dna.artifacts[0].generationPrompts.image).not.toMatch(/Create an original image|Evidence-synthesized|CreativeDNA:/i);

    const trainedDnaArtifactId = completedPayload.trainingJob.resultDnaArtifactId;
    const postJson = (path: string, body: object) => routeCreativeStudioApi(request(path, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "training@example.com" },
      body: JSON.stringify(body),
    }), production);

    const pendingState = await result(await routeCreativeStudioApi(request("/api/creative-studio/training-jobs"), production)) as {
      trainingReviews: unknown[];
    };
    expect(pendingState.trainingReviews).toEqual([]);

    const pendingGeneration = await postJson("/api/creative-studio/jobs", {
      projectId: project.id,
      dnaArtifactId: trainedDnaArtifactId,
      modality: "image",
      provider: "afdfw",
      idempotencyKey: "training_review_pending_generation_001",
    });
    expect(pendingGeneration.status).toBe(409);
    expect(await result(pendingGeneration)).toMatchObject({ error: "training_review_required" });

    const pendingChild = await postJson("/api/creative-studio/dna", {
      projectId: project.id,
      parentArtifactId: trainedDnaArtifactId,
      name: "Blocked child",
      directive: "This derivative must wait for review.",
      targetModality: "image",
    });
    expect(pendingChild.status).toBe(409);
    expect(await result(pendingChild)).toMatchObject({ error: "training_review_required" });

    const pendingTraining = await postJson("/api/creative-studio/training-jobs", {
      projectId: project.id,
      baseDnaArtifactId: trainedDnaArtifactId,
      name: "Blocked training child",
      targetModality: "image",
      assetIds: [uploaded.asset.id],
      includeTrainingExamples: false,
      idempotencyKey: "training_review_pending_training_001",
    });
    expect(pendingTraining.status).toBe(409);
    expect(await result(pendingTraining)).toMatchObject({ error: "training_review_required" });

    const missingNote = await postJson(`/api/creative-studio/training-jobs/${startedPayload.trainingJob.id}/review`, {
      decision: "approved",
      note: "   ",
    });
    expect(missingNote.status).toBe(400);
    expect(await result(missingNote)).toMatchObject({ error: "training_review_note_required" });

    const approved = await postJson(`/api/creative-studio/training-jobs/${startedPayload.trainingJob.id}/review`, {
      decision: "approved",
      note: "The trained warmth and contrast match the consented source evidence.",
    });
    expect(approved.status).toBe(201);
    expect(await result(approved)).toMatchObject({
      review: {
        decision: "approved",
        note: "The trained warmth and contrast match the consented source evidence.",
        actor: "angelo",
        activeDnaArtifactId: trainedDnaArtifactId,
      },
      project: { activeDnaArtifactId: trainedDnaArtifactId },
    });

    const approvedGeneration = await postJson("/api/creative-studio/jobs", {
      projectId: project.id,
      dnaArtifactId: trainedDnaArtifactId,
      modality: "image",
      provider: "afdfw",
      idempotencyKey: "training_review_approved_generation_001",
    });
    expect(approvedGeneration.status).toBe(202);
    expect(await result(approvedGeneration)).toMatchObject({
      job: { prompt: "A luminous abstract form occupies the center of a cool, open landscape with soft depth and controlled highlights." },
    });

    const rejected = await postJson(`/api/creative-studio/training-jobs/${startedPayload.trainingJob.id}/review`, {
      decision: "rejected",
      note: "The measured direction now overstates polish; return to the prior baseline.",
    });
    expect(rejected.status).toBe(201);
    expect(await result(rejected)).toMatchObject({
      review: { decision: "rejected", actor: "angelo", activeDnaArtifactId: baseDna.artifactId },
      project: { activeDnaArtifactId: baseDna.artifactId },
    });

    const rejectedGeneration = await postJson("/api/creative-studio/jobs", {
      projectId: project.id,
      dnaArtifactId: trainedDnaArtifactId,
      modality: "image",
      provider: "afdfw",
      idempotencyKey: "training_review_rejected_generation_001",
    });
    expect(rejectedGeneration.status).toBe(409);
    expect(await result(rejectedGeneration)).toMatchObject({ error: "training_review_required" });

    const reviewedState = await result(await routeCreativeStudioApi(request("/api/creative-studio/training-jobs"), production)) as {
      trainingReviews: Array<{ decision: string; actor: string; note: string }>;
    };
    expect(reviewedState.trainingReviews).toHaveLength(2);
    expect(reviewedState.trainingReviews.map((review) => review.decision)).toEqual(["rejected", "approved"]);
  });

  it("imports API workflow JSON, detects safe controls, versions edits, and exports exact revisions", async () => {
    const ownerId = "owner-workflow";
    const project = await testProject(ownerId, "Workflow Study");
    const local = workerEnv("afdfw", afdfwFor(ownerId));
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }, _meta: { title: "Load model" } },
      "2": { class_type: "PrimitiveStringMultiline", inputs: { value: "A glass object in quiet light" }, _meta: { title: "Prompt" } },
      "3": { class_type: "KSampler", inputs: { seed: 42, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1, model: ["1", 0], positive: ["2", 0] }, _meta: { title: "Sampler" } },
      "4": { class_type: "SaveImage", inputs: { filename_prefix: "result", images: ["3", 0] }, _meta: { title: "Save image" } },
      "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 }, _meta: { title: "Image size" } },
    };
    const raw = JSON.stringify(graph, null, 2);
    const imported = await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-access-authenticated-user-email": "workflow@example.com",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("z-image-base.json"),
        "x-cs-file-size": String(new TextEncoder().encode(raw).byteLength),
        "x-cs-workflow-name": encodeURIComponent("Z Image Base"),
        "x-cs-workflow-description": encodeURIComponent("Owner-supplied working graph"),
      },
      body: raw,
    }), local);
    expect(imported.status).toBe(201);
    const importedPayload = await result(imported) as { workflow: { id: string; currentRevision: { id: string; version: number; format: string; contentHash: string; parameters: Array<{ id: string; value: unknown }>; models: string[] } } };
    expect(importedPayload.workflow.currentRevision).toMatchObject({ version: 1, format: "comfyui-api" });
    expect(importedPayload.workflow.currentRevision.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(importedPayload.workflow.currentRevision.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "2::value", value: "A glass object in quiet light" }),
      expect.objectContaining({ id: "3::seed", value: 42 }),
      expect.objectContaining({ id: "3::steps", value: 8 }),
    ]));
    expect(importedPayload.workflow.currentRevision.models).toContain("z_image_turbo_bf16.safetensors");

    const revised = await routeCreativeStudioApi(request(`/api/creative-studio/workflows/${importedPayload.workflow.id}/revisions`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "workflow@example.com" },
      body: JSON.stringify({ baseRevisionId: importedPayload.workflow.currentRevision.id, values: { "2::value": "A chrome object in warm light", "3::seed": 99 } }),
    }), local);
    expect(revised.status).toBe(201);
    const revisedPayload = await result(revised) as { workflow: { currentRevision: { id: string; version: number; parentRevisionId: string; contentHash: string } } };
    expect(revisedPayload.workflow.currentRevision).toMatchObject({ version: 2, parentRevisionId: importedPayload.workflow.currentRevision.id });
    expect(revisedPayload.workflow.currentRevision.contentHash).not.toBe(importedPayload.workflow.currentRevision.contentHash);

    const exported = await routeCreativeStudioApi(request(`/api/creative-studio/workflows/${importedPayload.workflow.id}/content?revision=${revisedPayload.workflow.currentRevision.id}`, {
      headers: { "cf-access-authenticated-user-email": "workflow@example.com" },
    }), local);
    expect(exported.status).toBe(200);
    expect(exported.headers.get("x-creative-studio-workflow-hash")).toBe(revisedPayload.workflow.currentRevision.contentHash);
    expect(await exported.json()).toMatchObject({ "2": { inputs: { value: "A chrome object in warm light" } }, "3": { inputs: { seed: 99 } } });

    const secondProject = await testProject(ownerId, "Second Workflow Study");
    const secondDna = await createLocalDna(env, ownerId, {
      projectId: secondProject.id,
      name: "Shared model direction",
      directive: "A precise silver object isolated against a dark studio background.",
      targetModality: "image",
    });
    const mismatchedPromptJob = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "workflow@example.com" },
      body: JSON.stringify({
        projectId: secondProject.id,
        dnaArtifactId: secondDna.artifactId,
        modality: "image",
        performanceMode: "explicit-custom",
        idempotencyKey: "shared_owner_prompt_guard_001",
        workflow: {
          workflowId: importedPayload.workflow.id,
          revisionId: revisedPayload.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: "A different authored direction",
        },
      }),
    }), local);
    expect(mismatchedPromptJob.status).toBe(400);
    expect(await result(mismatchedPromptJob)).toMatchObject({ error: "workflow_prompt_confirmation_mismatch" });

    const blockedFastJob = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "workflow@example.com" },
      body: JSON.stringify({
        projectId: secondProject.id,
        dnaArtifactId: secondDna.artifactId,
        modality: "image",
        idempotencyKey: "shared_owner_fast_guard_001",
        workflow: {
          workflowId: importedPayload.workflow.id,
          revisionId: revisedPayload.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: "A chrome object in warm light",
        },
      }),
    }), local);
    expect(blockedFastJob.status).toBe(409);
    expect(await result(blockedFastJob)).toMatchObject({ error: "image_custom_mode_required" });

    const sharedModelJob = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": "workflow@example.com" },
      body: JSON.stringify({
        projectId: secondProject.id,
        dnaArtifactId: secondDna.artifactId,
        modality: "image",
        performanceMode: "explicit-custom",
        idempotencyKey: "shared_owner_model_001",
        workflow: {
          workflowId: importedPayload.workflow.id,
          revisionId: revisedPayload.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: "A chrome object in warm light",
        },
      }),
    }), local);
    expect(sharedModelJob.status).toBe(202);
    expect(await result(sharedModelJob)).toMatchObject({
      job: {
        projectId: secondProject.id,
        provider: "local-comfyui",
        settingsStamp: { performanceMode: "explicit-custom", workflow: { workflowId: importedPayload.workflow.id, revisionId: revisedPayload.workflow.currentRevision.id } },
      },
    });
  });

  it("rejects unsupported media before writing R2", async () => {
    const ownerId = "owner-unsupported-media";
    const project = await testProject(ownerId, "Unsupported Media");
    const { bucket, values } = memoryBucket();
    const response = await routeCreativeStudioApi(request("/api/creative-studio/media", {
      method: "POST",
      headers: {
        "content-type": "text/html",
        "x-cs-project-id": project.id,
        "x-cs-file-name": "unsafe.html",
        "x-cs-file-size": "6",
        "x-cs-training-eligible": "false",
      },
      body: "unsafe",
    }), workerEnv("afdfw", afdfwFor(ownerId), bucket));
    expect(response.status).toBe(415);
    expect(await result(response)).toMatchObject({ error: "unsupported_media_type" });
    expect(values.size).toBe(0);
  });

  it("persists queued, running, completed, artifact, and append-only decision state", async () => {
    const local = workerEnv("development");
    const project = await testProject("development-angelo");
    const createDna = await routeCreativeStudioApi(request("/api/creative-studio/dna", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, name: "Durable API Study", directive: "A crisp nocturnal system that opens into warm space.", targetModality: "image" }),
    }), local);
    const dnaPayload = await result(createDna) as { artifact: CreativeDnaArtifact };

    const createJob = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, dnaArtifactId: dnaPayload.artifact.artifactId, modality: "image", provider: "development-preview", idempotencyKey: "worker_test_submit_001" }),
    }), local);
    const jobPayload = await result(createJob) as { job: { id: string; status: string } };
    expect(createJob.status).toBe(202);
    expect(jobPayload.job.status).toBe("queued");

    await env.DB.prepare("update creative_jobs set created_at = ? where id = ?").bind(new Date(Date.now() - 1_500).toISOString(), jobPayload.job.id).run();
    let jobsResponse = await routeCreativeStudioApi(request("/api/creative-studio/jobs"), local);
    let jobsPayload = await result(jobsResponse) as { jobs: Array<{ id: string; status: string; artifactId?: string | null }> };
    expect(jobsPayload.jobs.find((job) => job.id === jobPayload.job.id)?.status).toBe("running");

    await env.DB.prepare("update creative_jobs set created_at = ? where id = ?").bind(new Date(Date.now() - 4_000).toISOString(), jobPayload.job.id).run();
    jobsResponse = await routeCreativeStudioApi(request("/api/creative-studio/jobs"), local);
    jobsPayload = await result(jobsResponse) as { jobs: Array<{ id: string; status: string; artifactId?: string | null }> };
    const completed = jobsPayload.jobs.find((job) => job.id === jobPayload.job.id);
    expect(completed).toMatchObject({ status: "completed" });
    expect(completed?.artifactId).toBeTruthy();

    const accept = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${completed?.artifactId}/accepted`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "First decision" }),
    }), local);
    expect(accept.status).toBe(200);
    const reject = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${completed?.artifactId}/rejected`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "Reconsidered" }),
    }), local);
    expect(reject.status).toBe(200);

    const history = await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local);
    const historyPayload = await result(history) as { artifacts: Array<{ status: string; settingsStamp: { prompt: string; source: string } }>; acceptances: Array<{ decision: string; note: string; actor: string }>; trainingExamples: Array<{ status: string; prompt: string; settingsStamp: { source: string } }> };
    expect(historyPayload.artifacts[0]?.status).toBe("rejected");
    expect(historyPayload.artifacts[0]?.settingsStamp).toMatchObject({ source: "creative-dna", prompt: dnaPayload.artifact.generationPrompts.image });
    expect(historyPayload.acceptances.map((item) => item.decision)).toEqual(expect.arrayContaining(["accepted", "rejected"]));
    expect(historyPayload.acceptances).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "accepted", note: "First decision", actor: "angelo" }),
      expect.objectContaining({ decision: "rejected", note: "Reconsidered", actor: "angelo" }),
    ]));
    expect(historyPayload.trainingExamples[0]).toMatchObject({ status: "excluded", prompt: dnaPayload.artifact.generationPrompts.image, settingsStamp: { source: "creative-dna" } });
  });

  it("reuses an immutable settings stamp and records the source job", async () => {
    const local = workerEnv("development");
    const project = await testProject("development-angelo", "Settings Stamp");
    const dna = await createLocalDna(env, "development-angelo", {
      projectId: project.id,
      name: "Stamped Study",
      directive: "A precise iridescent object against deep shadow.",
      targetModality: "image",
    });
    const original = await createDevelopmentJob(env, "development-angelo", project.id, dna, "image", "stamp_original_0001");
    const reusedResponse = await routeCreativeStudioApi(request(`/api/creative-studio/jobs/${original.id}/reuse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "stamp_reuse_000001" }),
    }), local);
    expect(reusedResponse.status).toBe(202);
    expect(await result(reusedResponse)).toMatchObject({
      job: {
        prompt: original.prompt,
        settingsStamp: { source: "creative-dna", prompt: original.prompt, reusedFromJobId: original.id },
      },
    });
  });

  it("submits and reconciles production generation after the browser request has ended", async () => {
    const ownerId = "owner-background";
    const accessEmail = "angelo@example.com";
    const project = await testProject(ownerId, "Background Study");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Background Study",
      directive: "An original luminous portrait with a deliberate quiet center.",
      targetModality: "image",
    });
    let submissions = 0;
    let statusReads = 0;
    let mediaReads = 0;
    const afdfw = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const upstream = new Request(input, init);
        const path = new URL(upstream.url).pathname;
        if (path === "/api/me") return Response.json({ status: "approved", user: { id: ownerId }, profile: { displayName: "Angelo" } });
        expect(upstream.headers.get("cf-access-authenticated-user-email")).toBe(accessEmail);
        if (path === "/api/profile-image/generate" && upstream.method === "POST") {
          submissions += 1;
          return Response.json({ generation: { id: "generation-background", prompt: dna.generationPrompts.image, medium: "Digital Art", size: "portrait", width: 768, height: 1216, status: "running", progress: 20, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        }
        if (path === "/api/profile-image/generations/generation-background") {
          statusReads += 1;
          return Response.json({ generation: { id: "generation-background", prompt: dna.generationPrompts.image, medium: "Digital Art", size: "portrait", width: 768, height: 1216, status: "completed", progress: 100, previewMediaId: "test-image", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        }
        if (path === "/api/profile-image/media/test-image") {
          mediaReads += 1;
          return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png", "content-length": "4" } });
        }
        return Response.json({ ok: false, error: "unexpected_test_upstream" }, { status: 404 });
      },
    } as Fetcher;
    const { queue, messages } = memoryQueue();
    const { bucket, values } = memoryBucket();
    const production = { ...workerEnv("afdfw", afdfw, bucket), JOB_QUEUE: queue };
    const created = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": accessEmail },
      body: JSON.stringify({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", provider: "afdfw", idempotencyKey: "background_submit_001" }),
    }), production);
    const payload = await result(created) as { job: { id: string; status: string; settingsStamp: { parameters: Record<string, unknown>; models: string[]; workloadEvidence: { profileId: string } } } };
    expect(created.status).toBe(202);
    expect(payload.job.status).toBe("queued");
    expect(payload.job.settingsStamp).toMatchObject({
      parameters: { width: 768, height: 1216, steps: 32, frames: 1, batch_size: 1 },
      models: ["z_image_turbo_bf16.safetensors", "qwen_3_4b.safetensors", "ae.safetensors"],
      workloadEvidence: { profileId: "afdfw-z-image-bridge-v1" },
    });
    expect(submissions).toBe(0);
    expect(messages[0]?.body.jobId).toBe(payload.job.id);

    await processJobMessage(production, messages.shift()!.body);
    expect(submissions).toBe(1);
    expect(statusReads).toBe(0);
    await env.DB.prepare("update creative_jobs set next_reconcile_at = ? where id = ?").bind("2020-01-01T00:00:00.000Z", payload.job.id).run();
    await processJobMessage(production, { jobId: payload.job.id });
    expect(statusReads).toBe(1);
    expect(mediaReads).toBe(1);
    expect(values.size).toBe(1);
    const finished = await env.DB.prepare("select status, artifact_id as artifactId from creative_jobs where id = ?").bind(payload.job.id).first<{ status: string; artifactId: string }>();
    expect(finished).toMatchObject({ status: "completed" });
    expect(finished?.artifactId).toBeTruthy();
    const retained = await env.DB.prepare("select status, retained_key as retainedKey, retained_size as retainedSize from creative_artifacts where id = ?")
      .bind(finished?.artifactId).first<{ status: string; retainedKey: string; retainedSize: number }>();
    expect(retained).toMatchObject({ status: "ready", retainedSize: 4 });
    expect(retained?.retainedKey).toContain(`owners/${ownerId}/artifacts/${finished?.artifactId}/`);
    const accepted = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${finished?.artifactId}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": accessEmail },
      body: JSON.stringify({ note: "Decision after automatic retention." }),
    }), production);
    expect(accepted.status).toBe(200);
    expect(mediaReads).toBe(1);
    expect(values.size).toBe(1);
  });

  it("deduplicates submissions and exposes explicit cancel and retry controls", async () => {
    const ownerId = "owner-controls";
    const accessEmail = "controls@example.com";
    const project = await testProject(ownerId, "Control Study");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Control Study",
      directive: "A measured original image with a clear focal hierarchy.",
      targetModality: "image",
    });
    const { queue, messages } = memoryQueue();
    const production = { ...workerEnv("afdfw", afdfwFor(ownerId)), JOB_QUEUE: queue };
    const create = () => routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": accessEmail },
      body: JSON.stringify({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", provider: "afdfw", idempotencyKey: "controls_submit_0001" }),
    }), production);
    const first = await result(await create()) as { job: { id: string } };
    const duplicate = await result(await create()) as { job: { id: string } };
    expect(duplicate.job.id).toBe(first.job.id);
    const row = await env.DB.prepare("select count(*) as count from creative_jobs where owner_id = ?").bind(ownerId).first<{ count: number }>();
    expect(Number(row?.count)).toBe(1);

    const cancelled = await routeCreativeStudioApi(request(`/api/creative-studio/jobs/${first.job.id}/cancel`, {
      method: "POST",
      headers: { "cf-access-authenticated-user-email": accessEmail },
    }), production);
    expect(await result(cancelled)).toMatchObject({ job: { status: "cancelled" } });
    const retried = await routeCreativeStudioApi(request(`/api/creative-studio/jobs/${first.job.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": accessEmail },
      body: JSON.stringify({ idempotencyKey: "controls_retry_00001" }),
    }), production);
    expect(retried.status).toBe(202);
    expect(await result(retried)).toMatchObject({ job: { status: "queued", retryOfJobId: first.job.id } });
    expect(messages.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps a completed upstream result pending until retention verifies, then resumes without regenerating", async () => {
    const ownerId = "owner-retention-retry";
    const project = await testProject(ownerId, "Retention Retry");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Retention Retry",
      directive: "An original image with a precise bright edge and deep negative space.",
      targetModality: "image",
    });
    const queued = await createQueuedJob(env, ownerId, {
      projectId: project.id,
      dna,
      modality: "image",
      idempotencyKey: "retention_retry_0001",
      provider: "afdfw-z-image",
      reconcileEmail: "retention@example.com",
    });
    const pending = await attachAfdfwGeneration(env, queued.job.id, {
      id: "image_retention_retry",
      prompt: dna.generationPrompts.image,
      status: "completed",
      progress: 100,
      previewMediaId: "retry-image",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(pending.status).toBe("running");
    expect(pending.progress).toBe(95);
    await expect(cancelOwnedJob(env, ownerId, queued.job.id)).rejects.toThrow("job_not_cancellable");
    let mediaReads = 0;
    const afdfw = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const upstream = new Request(input, init);
        expect(new URL(upstream.url).pathname).toBe("/api/profile-image/media/retry-image");
        mediaReads += 1;
        if (mediaReads === 1) return new Response(new Uint8Array([1, 2, 3, 4, 5]), { headers: { "content-type": "image/png", "content-length": "6" } });
        return new Response(new Uint8Array([1, 2, 3, 4, 5]), { headers: { "content-type": "image/png", "content-length": "5" } });
      },
    } as Fetcher;
    const { bucket, values } = memoryBucket();
    const production = workerEnv("afdfw", afdfw, bucket);
    await processJobMessage(production, { jobId: queued.job.id });
    let stored = await env.DB.prepare("select status, progress from creative_jobs where id = ?").bind(queued.job.id).first<{ status: string; progress: number }>();
    expect(stored).toMatchObject({ status: "running", progress: 95 });
    expect(values.size).toBe(0);

    await env.DB.prepare("update creative_jobs set next_reconcile_at = ? where id = ?").bind("2020-01-01T00:00:00.000Z", queued.job.id).run();
    await processJobMessage(production, { jobId: queued.job.id });
    stored = await env.DB.prepare("select status, progress from creative_jobs where id = ?").bind(queued.job.id).first<{ status: string; progress: number }>();
    expect(stored).toMatchObject({ status: "completed", progress: 100 });
    expect(mediaReads).toBe(2);
    expect(values.size).toBe(1);
  });

  it("repairs pending retention before recording an artifact decision", async () => {
    const ownerId = "owner-retention";
    const project = await testProject(ownerId);
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Retained Study",
      directive: "A bright original portrait with a quiet geometric center.",
      targetModality: "image",
    });
    const job = await createAfdfwJob(env, ownerId, project.id, dna, "image", {
      id: "generation-retained",
      prompt: dna.generationPrompts.image,
      status: "completed",
      progress: 100,
      previewMediaId: "test-image",
      createdAt: "2026-08-16T12:00:00.000Z",
      updatedAt: "2026-08-16T12:01:00.000Z",
    });
    const artifact = await env.DB.prepare("select id, status from creative_artifacts where job_id = ? and owner_id = ?")
      .bind(job.id, ownerId).first<{ id: string; status: string }>();
    expect(artifact?.id).toBeTruthy();
    expect(artifact?.status).toBe("retaining");
    const artifactId = String(artifact?.id);
    const { bucket, values } = memoryBucket();
    const production = workerEnv("afdfw", afdfwFor(ownerId), bucket);
    const accepted = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifactId}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Retain this result." }),
    }), production);
    expect(accepted.status).toBe(200);
    expect(values.size).toBe(1);

    const retained = await env.DB.prepare("select retained_key as retainedKey, retained_content_type as contentType from creative_artifacts where id = ?")
      .bind(artifactId).first<{ retainedKey: string; contentType: string }>();
    expect(retained?.retainedKey).toContain(`owners/${ownerId}/artifacts/${artifactId}/`);
    expect(retained?.contentType).toBe("image/png");

    const media = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifactId}/media`), production);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toBe("image/png");
    expect(media.headers.get("accept-ranges")).toBe("bytes");
    expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([137, 80, 78, 71]);

    const ranged = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifactId}/media`, { headers: { range: "bytes=1-2" } }), production);
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-2/4");
    expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([80, 78]);
  });

  it("requires Local Runner 1.7 and retains model-profiled Gemma song prompts as reusable evidence", async () => {
    const ownerId = "development-angelo";
    const project = await testProject(ownerId, "Song Prompt Study");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Violet pulse",
      directive: "A patient violet atmosphere with fine internal motion and a deliberate human edge.",
      targetModality: "music",
    });
    const { bucket } = memoryBucket();
    const local = workerEnv("development", undefined, bucket);
    const musicPrompt = "Global Metadata: 112 BPM. Visual source translated into sound: patient violet light with fine internal motion. Vocal Details: If lyrics are supplied, use a close human vocal; otherwise remain instrumental. Arrangement: granular percussion, warm bass, suspended harmony, and a gradual final lift.";
    const graph = JSON.stringify({
      "1": { class_type: "MiniMaxMusic3TextEncode", inputs: {
        caption: musicPrompt,
        lyrics: "", seed: 17, max_duration: 60, cfg: 4, steps: 24,
      } },
      "2": { class_type: "SaveAudio", inputs: { audio: ["1", 0] } },
    });
    const imported = await result(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("minimax-music3-api.json"),
        "x-cs-file-size": String(new TextEncoder().encode(graph).byteLength),
        "x-cs-workflow-name": encodeURIComponent("MiniMax Music 3"),
      },
      body: graph,
    }), local)) as { workflow: { id: string; currentRevision: { id: string; parameters: Array<{ id: string; label: string }> } } };
    const caption = imported.workflow.currentRevision.parameters.find((parameter) => /caption/i.test(`${parameter.id} ${parameter.label}`));
    expect(caption).toBeTruthy();
    const created = await result(await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "music",
        idempotencyKey: "runner_music_enhance_001",
        workflow: { workflowId: imported.workflow.id, revisionId: imported.workflow.currentRevision.id, inputBindings: {}, expectedPrompt: musicPrompt },
      }),
    }), local)) as { job: { id: string; prompt: string; settingsStamp: { prompt: string; promptEnhancement?: unknown } } };

    const enrollment = await result(await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Song prompt runner" }),
    }), local)) as { token: string };
    const runnerHeaders = { authorization: `Bearer ${enrollment.token}`, "content-type": "application/json" };
    await routeCreativeStudioApi(request("/api/creative-studio/runner/heartbeat", {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ version: "1.5.0", comfyUrl: "http://127.0.0.1:8188" }),
    }), local);
    const unsupported = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: unknown };
    expect(unsupported.bundle).toBeNull();

    await routeCreativeStudioApi(request("/api/creative-studio/runner/heartbeat", {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ version: "1.7.0", comfyUrl: "http://127.0.0.1:8188" }),
    }), local);
    const claimed = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: { job: { id: string } } };
    expect(claimed.bundle.job.id).toBe(created.job.id);

    const section = (lead: string) => `${lead} ${Array.from({ length: 62 }, (_, index) => `musical${index + 1}`).join(" ")}.`;
    const enhancedPrompt = `### Global Metadata\n${section("A measured 112 BPM electronic instrumental")}

### Vocal Details\n${section("Instrumental lead texture with no singer")}

### Arrangement\n${section("The opening develops through contrast, peak, return, and ending")}`;
    const enhancement = {
      schemaVersion: "creative-studio-song-prompt-enhancement/1.1",
      sourcePrompt: created.job.prompt,
      enhancedPrompt,
      provider: "local-comfyui",
      workflowId: "gemma4-song-prompt-enhancer",
      workflowVersion: 1,
      model: "gemma4_e4b_it_fp8_scaled.safetensors",
      comfyPromptId: "comfy-gemma-song-001",
      sourceWordCount: created.job.prompt.split(/\s+/).length,
      enhancedWordCount: enhancedPrompt.split(/\s+/).length,
      createdAt: new Date().toISOString(),
      parameterId: caption!.id,
      promptProfileId: "minimax-music-3-structured-caption/1.0",
      targetModel: "MiniMax Music 3",
      outputFormat: "structured-caption",
    };
    const enhanced = await result(await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${created.job.id}/heartbeat`, {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ progress: 6, stage: "enhancing-prompt", promptEnhancement: enhancement }),
    }), local)) as { job: { prompt: string; executionStage: string; settingsStamp: { prompt: string; parameters: Record<string, string>; promptEnhancement: { sourcePrompt: string; enhancedPrompt: string; sourceWordCount: number; enhancedWordCount: number } } } };
    expect(enhanced.job).toMatchObject({ prompt: enhancedPrompt, executionStage: "enhancing-prompt" });
    expect(enhanced.job.settingsStamp.prompt).toBe(enhancedPrompt);
    expect(enhanced.job.settingsStamp.parameters[caption!.id]).toBe(enhancedPrompt);
    expect(enhanced.job.settingsStamp.promptEnhancement).toMatchObject({
      sourcePrompt: created.job.prompt,
      enhancedPrompt,
      sourceWordCount: created.job.prompt.split(/\s+/).length,
      enhancedWordCount: enhancedPrompt.split(/\s+/).length,
      promptProfileId: "minimax-music-3-structured-caption/1.0",
      targetModel: "MiniMax Music 3",
      outputFormat: "structured-caption",
    });

    const audioBytes = new Uint8Array([82, 73, 70, 70]);
    const completed = await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${created.job.id}/complete`, {
      method: "POST",
      headers: { ...runnerHeaders, "content-type": "audio/wav", "x-cs-file-size": String(audioBytes.byteLength) },
      body: audioBytes,
    }), local);
    expect(completed.status).toBe(200);
    const history = await result(await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local)) as {
      artifacts: Array<{ prompt: string; settingsStamp: { promptEnhancement?: { sourcePrompt: string; enhancedPrompt: string } } }>;
    };
    expect(history.artifacts[0]).toMatchObject({
      prompt: enhancedPrompt,
      settingsStamp: { promptEnhancement: { sourcePrompt: created.job.prompt, enhancedPrompt } },
    });
  });

  it("pairs a revocable runner and completes a browser-independent video workflow with exact provenance", async () => {
    const ownerId = "development-angelo";
    const project = await testProject(ownerId, "Runner Study");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "H3 Motion Study",
      directive: "A luminous figure moves through a quiet field of violet light.",
      targetModality: "image",
    });
    const { bucket, values } = memoryBucket();
    const local = workerEnv("development", undefined, bucket);
    const inputBytes = new Uint8Array([137, 80, 78, 71]);
    const uploaded = await result(await routeCreativeStudioApi(request("/api/creative-studio/media", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("h3-source.png"),
        "x-cs-file-size": String(inputBytes.byteLength),
        "x-cs-training-eligible": "true",
      },
      body: inputBytes,
    }), local)) as { asset: { id: string } };
    const graph = JSON.stringify({
      "1": { class_type: "LoadImage", inputs: { image: "source.png" } },
      "2": { class_type: "MiniMaxH3I2V", inputs: { prompt: "Original H3 motion prompt", image: ["1", 0], seed: 42, duration: 10 } },
      "3": { class_type: "SaveVideo", inputs: { video: ["2", 0] } },
    });
    const imported = await result(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("minimax-h3-api.json"),
        "x-cs-file-size": String(new TextEncoder().encode(graph).byteLength),
        "x-cs-workflow-name": encodeURIComponent("MiniMax H3 I2V"),
      },
      body: graph,
    }), local)) as { workflow: { id: string; currentRevision: { id: string; contentHash: string; parameters: Array<{ id: string; kind: string }> } } };
    const mediaParameter = imported.workflow.currentRevision.parameters.find((parameter) => parameter.kind === "media");
    expect(mediaParameter).toBeTruthy();
    const alignedVideoVariant = {
      schemaVersion: "creative-studio-video-variant/1.0",
      pairId: "video_pair_runner-test-001",
      role: "aligned",
      seed: null,
      personalStyleWeight: 100,
      randomDnaWeight: 0,
      baseDimensions: dna.shared,
      randomDimensions: null,
      effectiveDimensions: dna.shared,
    };

    const enrollmentResponse = await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "3090 test runner" }),
    }), local);
    expect(enrollmentResponse.status).toBe(201);
    const enrollment = await result(enrollmentResponse) as { runner: { id: string }; token: string };
    const runnerHeaders = { authorization: `Bearer ${enrollment.token}`, "content-type": "application/json" };
    const unauthorized = await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", { method: "POST" }), local);
    expect(unauthorized.status).toBe(401);

    const created = await result(await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "video",
        videoDurationSeconds: 10,
        idempotencyKey: "runner_video_submit_001",
        workflow: {
          workflowId: imported.workflow.id,
          revisionId: imported.workflow.currentRevision.id,
          inputBindings: { [mediaParameter!.id]: uploaded.asset.id },
          expectedPrompt: "Original H3 motion prompt",
        },
        videoVariant: alignedVideoVariant,
        evolution: {
          schemaVersion: "creative-studio-evolution-request/1.0",
          studyId: "evolve_runner-test-001",
          role: "refine",
          sourceId: uploaded.asset.id,
          source: "upload",
        },
      }),
    }), local)) as { job: { id: string; status: string; startedAt: string | null; executionStage: string; settingsStamp: { workflow: { contentHash: string }; videoDurationSeconds: number; inputBindings: Record<string, string>; workloadEvidence: { source: string; profileId: string; label: string }; videoVariant: typeof alignedVideoVariant; evolution: { studyId: string; role: string; sourceId: string; sourceKind: string; projectCanon: { identity: string; currentDirection: string } } } } };
    expect(created.job).toMatchObject({ status: "queued", startedAt: null, executionStage: "queued", settingsStamp: { workflow: { contentHash: imported.workflow.currentRevision.contentHash }, videoDurationSeconds: 10 } });
    expect(created.job.settingsStamp.workloadEvidence).toEqual({ source: "workflow-revision", profileId: imported.workflow.currentRevision.id, label: "MiniMax H3 I2V v1" });
    expect(created.job.settingsStamp.inputBindings[mediaParameter!.id]).toBe(uploaded.asset.id);
    expect(created.job.settingsStamp.videoVariant).toEqual(alignedVideoVariant);
    expect(created.job.settingsStamp.evolution).toMatchObject({ studyId: "evolve_runner-test-001", role: "refine", sourceId: uploaded.asset.id, sourceKind: "image" });
    expect(created.job.settingsStamp.evolution.projectCanon).toEqual({ identity: project.description, currentDirection: project.note });

    await routeCreativeStudioApi(request("/api/creative-studio/runner/heartbeat", {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ version: "1.0.0", comfyUrl: "http://127.0.0.1:8188", comfyVersion: "0.33.0", device: "RTX 3090" }),
    }), local);
    const claimed = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: { job: { id: string; startedAt: string; executionStage: string }; graph: Record<string, unknown>; inputs: Array<{ id: string }> } };
    expect(claimed.bundle.job.id).toBe(created.job.id);
    expect(claimed.bundle.job).toMatchObject({ executionStage: "preparing-inputs" });
    expect(claimed.bundle.job.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(claimed.bundle.inputs.map((asset) => asset.id)).toEqual([uploaded.asset.id]);
    expect(claimed.bundle.graph).toMatchObject({ "1": { class_type: "LoadImage" } });
    await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${created.job.id}/heartbeat`, {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ progress: 18, upstreamId: "comfy-prompt-h3-001", stage: "rendering" }),
    }), local);
    await env.DB.prepare("update creative_jobs set runner_lease_until = ? where id = ?").bind("2020-01-01T00:00:00.000Z", created.job.id).run();
    const resumed = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: { job: { upstreamId: string; executionStage: string } } };
    expect(resumed.bundle.job).toMatchObject({ upstreamId: "comfy-prompt-h3-001", executionStage: "preparing-inputs" });

    await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${created.job.id}/fail`, {
      method: "POST", headers: runnerHeaders, body: JSON.stringify({ error: "The operation was aborted due to timeout" }),
    }), local);
    const retried = await result(await routeCreativeStudioApi(request(`/api/creative-studio/jobs/${created.job.id}/retry`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: "runner_video_retry_001" }),
    }), local)) as { job: { id: string; upstreamId: string; retryOfJobId: string; settingsStamp: { videoVariant: typeof alignedVideoVariant } } };
    expect(retried.job).toMatchObject({ upstreamId: "comfy-prompt-h3-001", retryOfJobId: created.job.id, settingsStamp: { videoVariant: alignedVideoVariant } });
    const retriedClaim = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: { job: { id: string; upstreamId: string } } };
    expect(retriedClaim.bundle.job).toMatchObject({ id: retried.job.id, upstreamId: "comfy-prompt-h3-001" });

    const runnerMedia = await routeCreativeStudioApi(request(`/api/creative-studio/runner/media/${uploaded.asset.id}`, {
      headers: { authorization: `Bearer ${enrollment.token}` },
    }), local);
    expect([...new Uint8Array(await runnerMedia.arrayBuffer())]).toEqual([...inputBytes]);

    const outputBytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
    const completed = await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${retried.job.id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${enrollment.token}`, "content-type": "video/mp4", "x-cs-file-size": String(outputBytes.byteLength) },
      body: outputBytes,
    }), local);
    expect(completed.status).toBe(200);
    expect(await result(completed)).toMatchObject({ job: { status: "completed", modality: "video", provider: "local-comfyui", executionStage: "completed" } });
    const thumbnailBytes = new Uint8Array([255, 216, 255, 219, 0, 67, 0, 255, 217]);
    const retainedThumbnail = await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${retried.job.id}/thumbnail`, {
      method: "POST",
      headers: { authorization: `Bearer ${enrollment.token}`, "content-type": "image/jpeg", "x-cs-file-size": String(thumbnailBytes.byteLength) },
      body: thumbnailBytes,
    }), local);
    expect(retainedThumbnail.status).toBe(200);
    expect(values.size).toBe(3);
    const history = await result(await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local)) as { artifacts: Array<{ id: string; name: string; kind: string; preview: { posterUrl: string | null }; retention: { state: string; size: number } }>; trainingExamples: Array<{ kind: string; status: string }> };
    expect(history.artifacts[0]).toMatchObject({ name: "H3 Motion Study · Aligned", kind: "video", preview: { posterUrl: `/api/creative-studio/artifacts/artifact_${retried.job.id}/thumbnail` }, retention: { state: "retained", size: outputBytes.byteLength } });
    expect(history.trainingExamples[0]).toMatchObject({ kind: "video", status: "candidate" });
    const thumbnailResponse = await routeCreativeStudioApi(request(history.artifacts[0].preview.posterUrl!), local);
    expect(thumbnailResponse.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await thumbnailResponse.arrayBuffer())]).toEqual([...thumbnailBytes]);

    const extension = await result(await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "video",
        idempotencyKey: "runner_video_extension_001",
        workflow: {
          workflowId: imported.workflow.id,
          revisionId: imported.workflow.currentRevision.id,
          inputBindings: { [mediaParameter!.id]: history.artifacts[0].id },
          expectedPrompt: "Original H3 motion prompt",
        },
        videoOperation: {
          kind: "extend",
          sourceId: history.artifacts[0].id,
          source: "artifact",
          sourceFrame: "last",
          outputMode: "combined",
          transitionSeconds: 0.5,
          audioMode: "keep-source",
        },
      }),
    }), local)) as { job: { id: string; settingsStamp: { videoOperation: { sourceId: string; outputMode: string; transitionSeconds: number }; inputArtifactIds: string[] } } };
    expect(extension.job.settingsStamp).toMatchObject({
      inputArtifactIds: [history.artifacts[0].id],
      videoOperation: { sourceId: history.artifacts[0].id, outputMode: "combined", transitionSeconds: 0.5 },
    });
    const extensionClaim = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: { job: { id: string; settingsStamp: { videoOperation: { sourceFrame: string } } }; inputs: Array<{ id: string; kind: string; source: string }> } };
    expect(extensionClaim.bundle).toMatchObject({
      job: { id: extension.job.id, settingsStamp: { videoOperation: { sourceFrame: "last" } } },
      inputs: [{ id: history.artifacts[0].id, kind: "video", source: "artifact" }],
    });
    const extensionBytes = new Uint8Array([...outputBytes, 2]);
    const extensionComplete = await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${extension.job.id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${enrollment.token}`, "content-type": "video/mp4", "x-cs-file-size": String(extensionBytes.byteLength) },
      body: extensionBytes,
    }), local);
    expect(extensionComplete.status).toBe(200);
    const extendedHistory = await result(await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local)) as { artifacts: Array<{ lineage: { sourceArtifactIds: string[] }; settingsStamp: { videoOperation?: { kind: string } } }> };
    expect(extendedHistory.artifacts[0]).toMatchObject({
      lineage: { sourceArtifactIds: [history.artifacts[0].id] },
      settingsStamp: { videoOperation: { kind: "extend" } },
    });

    const remixGraph = JSON.stringify({
      "10": { class_type: "VHS_LoadVideo", inputs: { video: "prior.mp4" }, _meta: { title: "Prior generated video" } },
      "11": { class_type: "SaveVideo", inputs: { video: ["10", 0] } },
      "12": { class_type: "PrimitiveStringMultiline", inputs: { value: "Continue the retained motion study" }, _meta: { title: "Prompt" } },
    });
    const remixWorkflow = await result(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("video-remix-api.json"),
        "x-cs-file-size": String(new TextEncoder().encode(remixGraph).byteLength),
      },
      body: remixGraph,
    }), local)) as { workflow: { id: string; currentRevision: { id: string; parameters: Array<{ id: string; kind: string; mediaKind: string }> } } };
    const videoInput = remixWorkflow.workflow.currentRevision.parameters.find((parameter) => parameter.kind === "media");
    expect(videoInput).toMatchObject({ id: "10::video", mediaKind: "video" });

    const chained = await result(await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "video",
        idempotencyKey: "runner_video_chain_001",
        workflow: {
          workflowId: remixWorkflow.workflow.id,
          revisionId: remixWorkflow.workflow.currentRevision.id,
          inputBindings: { [videoInput!.id]: history.artifacts[0].id },
          expectedPrompt: "Continue the retained motion study",
        },
      }),
    }), local)) as { job: { id: string; settingsStamp: { inputAssetIds: string[]; inputArtifactIds: string[]; inputSources: Array<{ id: string; source: string }> } } };
    expect(chained.job.settingsStamp).toMatchObject({
      inputAssetIds: [],
      inputArtifactIds: [history.artifacts[0].id],
      inputSources: [{ id: history.artifacts[0].id, source: "artifact" }],
    });

    const chainedClaim = await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/jobs/claim", {
      method: "POST", headers: runnerHeaders, body: "{}",
    }), local)) as { bundle: { inputs: Array<{ id: string; source: string; kind: string }> } };
    expect(chainedClaim.bundle.inputs).toEqual([expect.objectContaining({ id: history.artifacts[0].id, source: "artifact", kind: "video" })]);
    const chainedInput = await routeCreativeStudioApi(request(`/api/creative-studio/runner/media/${history.artifacts[0].id}`, {
      headers: { authorization: `Bearer ${enrollment.token}` },
    }), local);
    expect(chainedInput.headers.get("content-type")).toBe("video/mp4");
    expect([...new Uint8Array(await chainedInput.arrayBuffer())]).toEqual([...outputBytes]);

    const chainedOutput = new Uint8Array([...outputBytes, 1]);
    const chainedComplete = await routeCreativeStudioApi(request(`/api/creative-studio/runner/jobs/${chained.job.id}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${enrollment.token}`, "content-type": "video/mp4", "x-cs-file-size": String(chainedOutput.byteLength) },
      body: chainedOutput,
    }), local);
    expect(chainedComplete.status).toBe(200);
    const chainedHistory = await result(await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local)) as { artifacts: Array<{ id: string; lineage: { sourceArtifactIds: string[] } }> };
    expect(chainedHistory.artifacts[0].lineage.sourceArtifactIds).toEqual([history.artifacts[0].id]);
  });

  it("derives the durable production loop and captures accepted evidence only once per live training run", async () => {
    const local = workerEnv("development");
    const project = await testProject("development-angelo", "Production Loop");
    const dna = await createLocalDna(env, "development-angelo", {
      projectId: project.id,
      name: "Production blueprint",
      directive: "An original luminous image with precise contrast and a tactile edge.",
      targetModality: "image",
    });
    const loop = async () => {
      const payload = await result(await routeCreativeStudioApi(request("/api/creative-studio/production-loops"), local)) as {
        productionLoops: Array<Record<string, unknown>>;
      };
      return payload.productionLoops[0];
    };

    expect(await loop()).toMatchObject({
      stage: "ready-to-generate",
      activeDnaArtifactId: dna.artifactId,
      nextAction: { surface: "generation" },
    });

    const generated = await result(await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "image",
        provider: "development-preview",
        idempotencyKey: "production_loop_generation_001",
      }),
    }), local)) as { job: { id: string } };
    expect(await loop()).toMatchObject({ stage: "generation-running", activeGenerationJobId: generated.job.id });

    await env.DB.prepare("update creative_jobs set created_at = ? where id = ?")
      .bind("2020-01-01T00:00:00.000Z", generated.job.id).run();
    expect(await loop()).toMatchObject({ stage: "review-output", counts: { outputsReadyForReview: 1 } });

    const artifacts = await result(await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local)) as {
      artifacts: Array<{ id: string }>;
    };
    const artifactId = artifacts.artifacts[0].id;
    const accepted = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifactId}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Carry the precise contrast and tactile edge into the next DNA version." }),
    }), local);
    expect(accepted.status).toBe(200);
    const evidenceReady = await loop();
    expect(evidenceReady).toMatchObject({ stage: "evidence-ready", counts: { evidenceFresh: 1, evidenceUsed: 0 } });
    const freshExampleId = (evidenceReady.freshTrainingExampleIds as string[])[0];

    const started = await result(await routeCreativeStudioApi(request("/api/creative-studio/training-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        baseDnaArtifactId: dna.artifactId,
        name: "Production blueprint evolved",
        targetModality: "image",
        assetIds: [],
        includeTrainingExamples: true,
        idempotencyKey: "production_loop_training_001",
      }),
    }), local)) as { trainingJob: { id: string; trainingExampleIds: string[] } };
    expect(started.trainingJob.trainingExampleIds).toEqual([freshExampleId]);
    expect(await loop()).toMatchObject({
      stage: "training-running",
      activeTrainingJobId: started.trainingJob.id,
      freshTrainingExampleIds: [],
      usedTrainingExampleIds: [freshExampleId],
    });

    const cancelled = await routeCreativeStudioApi(request(`/api/creative-studio/training-jobs/${started.trainingJob.id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }), local);
    expect(cancelled.status).toBe(200);
    expect(await loop()).toMatchObject({
      stage: "evidence-ready",
      freshTrainingExampleIds: [freshExampleId],
      usedTrainingExampleIds: [],
    });

    const competingRequest = (idempotencyKey: string) => routeCreativeStudioApi(request("/api/creative-studio/training-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        baseDnaArtifactId: dna.artifactId,
        name: "Concurrent evidence capture",
        targetModality: "image",
        assetIds: [],
        includeTrainingExamples: true,
        idempotencyKey,
      }),
    }), local);
    const competing = await Promise.all([
      competingRequest("production_loop_race_001"),
      competingRequest("production_loop_race_002"),
    ]);
    expect(competing.map((response) => response.status).sort()).toEqual([202, 409]);
    const conflict = competing.find((response) => response.status === 409)!;
    expect(await result(conflict)).toMatchObject({ error: "training_evidence_already_reserved" });
    const reservationCount = await env.DB.prepare("select count(*) as count from creative_dna_training_evidence_reservations where training_example_id = ?")
      .bind(freshExampleId).first<{ count: number }>();
    expect(Number(reservationCount?.count)).toBe(1);

    const cockpit = await result(await routeCreativeStudioApi(request("/api/creative-studio/production-cockpit"), local)) as {
      productionCockpit: {
        summary: Record<string, number>;
        actions: Array<{ kind: string }>;
        runs: Array<{ id: string; kind: string; queuePosition: number | null }>;
      };
    };
    expect(cockpit.productionCockpit.summary).toMatchObject({ activeRuns: 1, failedRuns: 0, activeProjects: 1 });
    expect(cockpit.productionCockpit.actions).toContainEqual(expect.objectContaining({ kind: "runner-offline" }));
    expect(cockpit.productionCockpit.runs).toContainEqual(expect.objectContaining({ id: generated.job.id, kind: "generation" }));
    expect(cockpit.productionCockpit.runs).toContainEqual(expect.objectContaining({ kind: "training", queuePosition: 1 }));
  });

  it("runs ACE-Step music LoRA preparation, owner review, completion, and activation as durable state", async () => {
    const ownerId = "owner-ace-training";
    const project = await testProject(ownerId, "ACE Music World");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "ACE music DNA",
      directive: "Cold synthetic detail interrupted by tactile organic rhythm and one controlled harmonic rupture.",
      targetModality: "music",
      sourceKind: "original",
    });
    const { bucket } = memoryBucket();
    const production = workerEnv("afdfw", afdfwFor(ownerId), bucket);
    const assetIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const bytes = new Uint8Array([73, 68, 51, index, 1, 2, 3, 4]);
      const uploaded = await result(await routeCreativeStudioApi(request("/api/creative-studio/media", {
        method: "POST",
        headers: {
          "content-type": "audio/mpeg",
          "x-cs-project-id": project.id,
          "x-cs-file-name": encodeURIComponent(`Training Track ${index + 1}.mp3`),
          "x-cs-file-size": String(bytes.byteLength),
          "x-cs-training-eligible": "true",
        },
        body: bytes,
      }), production)) as { asset: { id: string } };
      assetIds.push(uploaded.asset.id);
    }

    const startedResponse = await routeCreativeStudioApi(request("/api/creative-studio/model-training-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        name: "Nocturnal tactile electronics",
        target: "music-style",
        triggerToken: "cs_nocturnal_tactile",
        description: "Learn the recurring electronic percussion, tactile bass, vocal space, and controlled harmonic friction.",
        continuityRules: ["Brittle percussion over tactile sub bass"],
        preset: "proof",
        assetIds,
        instrumental: true,
        idempotencyKey: "ace_training_test_001",
      }),
    }), production);
    expect(startedResponse.status).toBe(202);
    const started = await result(startedResponse) as { modelTrainingJob: { id: string; status: string; stage: string } };
    expect(started.modelTrainingJob).toMatchObject({ status: "waiting-for-runner", stage: "queued" });

    const enrolled = await result(await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ACE test runner" }),
    }), production)) as { runner: { id: string }; token: string };
    const runnerPost = (path: string, body: object) => routeCreativeStudioApi(request(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${enrolled.token}` },
      body: JSON.stringify(body),
    }), production);
    const state = {
      version: "1.9.0", comfyUrl: "http://127.0.0.1:8188", comfyVersion: "0.33.0", device: "RTX 3090",
      activeJobId: null, error: null, modelTrainingProviders: ["ace-step-1.5-lora"],
    };
    const claimed = await result(await runnerPost("/api/creative-studio/runner/work/claim", state)) as {
      kind: string; bundle: { modelTrainingJob: { id: string; stage: string } };
    };
    expect(claimed).toMatchObject({ kind: "model-training", bundle: { modelTrainingJob: { id: started.modelTrainingJob.id, stage: "captioning" } } });

    const datasetItems = assetIds.map((assetId, index) => ({
      assetId,
      fileName: `Training Track ${index + 1}.mp3`,
      caption: "Measured electronic pulse with brittle hybrid percussion, tactile sub bass, processed keys, close stereo space, short decays, and a single suspended harmonic rupture before the groove returns.",
      lyrics: "[Instrumental]",
      isInstrumental: true,
      durationSeconds: 90,
      bpm: null,
      keyscale: null,
      captionSource: "gemma4-audio-description",
    }));
    const prepared = await runnerPost(`/api/creative-studio/runner/model-training/${started.modelTrainingJob.id}/dataset`, {
      dataset: { schemaVersion: "creative-studio-ace-step-dataset/1.0", items: datasetItems, preparedAt: new Date().toISOString(), reviewedAt: null, reviewNote: null },
    });
    expect(prepared.status).toBe(200);

    const reviewed = await routeCreativeStudioApi(request(`/api/creative-studio/model-training-jobs/${started.modelTrainingJob.id}/dataset-review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: datasetItems.map(({ assetId, caption, lyrics, isInstrumental }) => ({ assetId, caption, lyrics, isInstrumental })),
        note: "All three captions were checked against the source recordings.",
      }),
    }), production);
    expect(reviewed.status).toBe(200);
    expect(await result(reviewed)).toMatchObject({ modelTrainingJob: { status: "waiting-for-runner", stage: "preflight" } });

    const trainingClaim = await result(await runnerPost("/api/creative-studio/runner/work/claim", state)) as {
      bundle: { modelTrainingJob: { id: string; runnerId: string; dataset: { reviewedAt: string } } };
    };
    expect(trainingClaim.bundle.modelTrainingJob.dataset.reviewedAt).toBeTruthy();
    const completed = await runnerPost(`/api/creative-studio/runner/model-training/${started.modelTrainingJob.id}/complete`, {
      upstreamId: `ace-step:${started.modelTrainingJob.id}`,
      localFile: {
        runnerId: enrolled.runner.id,
        relativePath: `creative-studio/${started.modelTrainingJob.id}/adapter_model.safetensors`,
        format: "safetensors",
        sha256: "a".repeat(64),
        size: 4096,
      },
      evaluation: {
        schemaVersion: "creative-studio-model-adapter-evaluation/1.0",
        datasetItems: 3,
        captionedItems: 3,
        validationPromptCount: 0,
        notes: ["Corrected ACE-Step LoRA training completed."],
      },
    });
    expect(completed.status).toBe(200);
    const completedBody = await result(completed) as { adapter: { id: string; status: string } };
    expect(completedBody.adapter.status).toBe("review-required");

    const activated = await routeCreativeStudioApi(request(`/api/creative-studio/model-adapters/${completedBody.adapter.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved", note: "Checkpoint lineage is valid; activate it for controlled ACE-Step comparison renders." }),
    }), production);
    expect(activated.status).toBe(201);
    expect(await result(activated)).toMatchObject({ adapter: { id: completedBody.adapter.id, status: "active", dnaArtifactId: dna.artifactId }, review: { decision: "approved", actor: "angelo" } });
  });

  it("keeps LoRA-backed song jobs on the runner that owns the local checkpoint", async () => {
    const ownerId = "owner-adapter-affinity";
    const project = await testProject(ownerId, "Adapter Affinity");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Adapter affinity DNA",
      directive: "A controlled electronic music system with tactile percussion and sharply bounded harmonic contrast.",
      targetModality: "music",
      sourceKind: "original",
    });
    const queued = await createQueuedJob(env, ownerId, {
      projectId: project.id,
      dna,
      modality: "music",
      idempotencyKey: "adapter_affinity_0001",
      provider: "local-comfyui",
      reconcileEmail: null,
      executionTarget: "local-comfyui",
    });
    await env.DB.prepare("update creative_jobs set settings_stamp_json = ? where id = ? and owner_id = ?")
      .bind(JSON.stringify({ ...queued.job.settingsStamp, modelAdapters: [{
        schemaVersion: "creative-studio-generation-adapter/1.0",
        adapterId: "adapter_affinity",
        name: "Affinity LoRA",
        target: "music-style",
        provider: "ace-step-1.5-lora",
        baseModelId: "ace-step-1.5-base",
        triggerToken: "cs_affinity",
        relativePath: "creative-studio/modeltrain_affinity/adapter_model.safetensors",
        runnerId: "runner_checkpoint_owner",
        strength: 0.8,
      }] }), queued.job.id, ownerId).run();
    const claimed = await claimLocalRunnerJob(env, {
      id: "runner_without_checkpoint",
      ownerId,
      name: "Wrong machine",
      version: "1.9.0",
      comfyUrl: "http://127.0.0.1:8188",
      comfyVersion: "0.33.0",
      device: "RTX 3090",
      activeJobId: null,
      modelTrainingProvidersJson: "[]",
      lastError: null,
      lastHeartbeatAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      revokedAt: null,
    });
    expect(claimed).toBeNull();
  });

  it("does not expose a generic proxy route", async () => {
    const response = await routeCreativeStudioApi(request("/api/creative-studio/proxy/api/admin"), workerEnv("development"));
    expect(response.status).toBe(404);
    expect(await result(response)).toMatchObject({ error: "creative_studio_route_not_found" });
  });
});
