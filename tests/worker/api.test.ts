import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { CreativeDnaArtifact } from "../../shared/contracts";
import { backendMode } from "../../worker/config";
import { processJobMessage } from "../../worker/jobs";
import { createAfdfwJob, createDevelopmentJob, createLocalDna, createProject, reconcileDevelopmentJobs } from "../../worker/repository";
import { routeCreativeStudioApi } from "../../worker/routes/api";
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
    async put(key: string, value: ArrayBuffer, options?: R2PutOptions) {
      values.set(key, { bytes: value.slice(0), contentType: options?.httpMetadata && "contentType" in options.httpMetadata ? String(options.httpMetadata.contentType) : "application/octet-stream" });
      return {};
    },
    async get(key: string) {
      const value = values.get(key);
      if (!value) return null;
      return {
        body: value.bytes,
        writeHttpMetadata(headers: Headers) { headers.set("content-type", value.contentType); },
      };
    },
    async delete(key: string) { values.delete(key); },
  } as unknown as R2Bucket;
  return { bucket, values };
}

async function clearData() {
  await env.DB.batch([
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

    const rightOwner = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifact?.id}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Keep this direction." }),
    }), workerEnv("afdfw", afdfwFor(ownerA)));
    expect(rightOwner.status).toBe(200);
    expect(await result(rightOwner)).toMatchObject({ ok: true, artifact: { status: "accepted" }, acceptance: { decision: "accepted" } });
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
      body: JSON.stringify({ projectId: project.id, dnaArtifactId: dnaPayload.artifact.artifactId, modality: "image", idempotencyKey: "worker_test_submit_001" }),
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
    const historyPayload = await result(history) as { artifacts: Array<{ status: string }>; acceptances: Array<{ decision: string }> };
    expect(historyPayload.artifacts[0]?.status).toBe("rejected");
    expect(historyPayload.acceptances.map((item) => item.decision)).toEqual(expect.arrayContaining(["accepted", "rejected"]));
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
    const afdfw = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const upstream = new Request(input, init);
        const path = new URL(upstream.url).pathname;
        if (path === "/api/me") return Response.json({ status: "approved", user: { id: ownerId }, profile: { displayName: "Angelo" } });
        expect(upstream.headers.get("cf-access-authenticated-user-email")).toBe(accessEmail);
        if (path === "/api/profile-image/generate" && upstream.method === "POST") {
          submissions += 1;
          return Response.json({ generation: { id: "generation-background", prompt: dna.generationPrompts.image, status: "running", progress: 20, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        }
        if (path === "/api/profile-image/generations/generation-background") {
          statusReads += 1;
          return Response.json({ generation: { id: "generation-background", prompt: dna.generationPrompts.image, status: "completed", progress: 100, previewMediaId: "test-image", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
        }
        return Response.json({ ok: false, error: "unexpected_test_upstream" }, { status: 404 });
      },
    } as Fetcher;
    const { queue, messages } = memoryQueue();
    const production = { ...workerEnv("afdfw", afdfw), JOB_QUEUE: queue };
    const created = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-access-authenticated-user-email": accessEmail },
      body: JSON.stringify({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", idempotencyKey: "background_submit_001" }),
    }), production);
    const payload = await result(created) as { job: { id: string; status: string } };
    expect(created.status).toBe(202);
    expect(payload.job.status).toBe("queued");
    expect(submissions).toBe(0);
    expect(messages[0]?.body.jobId).toBe(payload.job.id);

    await processJobMessage(production, messages.shift()!.body);
    expect(submissions).toBe(1);
    expect(statusReads).toBe(0);
    await env.DB.prepare("update creative_jobs set next_reconcile_at = ? where id = ?").bind("2020-01-01T00:00:00.000Z", payload.job.id).run();
    await processJobMessage(production, { jobId: payload.job.id });
    expect(statusReads).toBe(1);
    const finished = await env.DB.prepare("select status, artifact_id as artifactId from creative_jobs where id = ?").bind(payload.job.id).first<{ status: string; artifactId: string }>();
    expect(finished).toMatchObject({ status: "completed" });
    expect(finished?.artifactId).toBeTruthy();
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
      body: JSON.stringify({ projectId: project.id, dnaArtifactId: dna.artifactId, modality: "image", idempotencyKey: "controls_submit_0001" }),
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

  it("retains accepted AFDFW media in owner-scoped Creative Studio storage", async () => {
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
    const artifact = await env.DB.prepare("select id from creative_artifacts where job_id = ? and owner_id = ?")
      .bind(job.id, ownerId).first<{ id: string }>();
    expect(artifact?.id).toBeTruthy();
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
    expect([...new Uint8Array(await media.arrayBuffer())]).toEqual([137, 80, 78, 71]);
  });

  it("does not expose a generic proxy route", async () => {
    const response = await routeCreativeStudioApi(request("/api/creative-studio/proxy/api/admin"), workerEnv("development"));
    expect(response.status).toBe(404);
    expect(await result(response)).toMatchObject({ error: "creative_studio_route_not_found" });
  });
});
