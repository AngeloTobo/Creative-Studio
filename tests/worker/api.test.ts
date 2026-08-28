import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  compileVideoPromptWithSpeech,
  compileContinuityDirective,
  videoPromptProfileForIdentity,
  type CanonReference,
  type ContinuityRule,
  type CreativeDnaArtifact,
  type GenerationContinuitySelection,
  type World,
  type WorldEntity,
} from "../../shared/contracts";
import { backendMode } from "../../worker/config";
import { processJobMessage } from "../../worker/jobs";
import { attachAfdfwGeneration, cancelOwnedJob, createAfdfwJob, createDevelopmentJob, createLocalDna, createProject, createQueuedJob, reconcileDevelopmentJobs } from "../../worker/repository";
import { routeCreativeStudioApi } from "../../worker/routes/api";
import { claimLocalRunnerJob } from "../../worker/runner";
import { generationContinuityStamp, promoteArtifactToCanon } from "../../worker/worlds";
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
    env.DB.prepare("delete from creative_canon_promotions"),
    env.DB.prepare("delete from creative_canon_references"),
    env.DB.prepare("delete from creative_continuity_rules"),
    env.DB.prepare("delete from creative_world_entities"),
    env.DB.prepare("delete from creative_worlds"),
    env.DB.prepare("delete from creative_model_adapter_reviews"),
    env.DB.prepare("delete from creative_model_adapters"),
    env.DB.prepare("delete from creative_model_training_jobs"),
    env.DB.prepare("delete from creative_runners"),
    env.DB.prepare("delete from creative_dna_training_reviews"),
    env.DB.prepare("delete from creative_dna_training_evidence_reservations"),
    env.DB.prepare("delete from creative_dna_training_jobs"),
    env.DB.prepare("delete from creative_training_examples"),
    env.DB.prepare("delete from creative_generation_recipe_evidence"),
    env.DB.prepare("delete from creative_generation_recipes"),
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

  it("persists owned Worlds and rejects stale entity, rule, and reference writes", async () => {
    const ownerId = "owner-worlds";
    const project = await testProject(ownerId, "Glass Moon");
    const owned = workerEnv("afdfw", afdfwFor(ownerId));
    const otherOwner = workerEnv("afdfw", afdfwFor("owner-worlds-other"));

    const createdResponse = await routeCreativeStudioApi(request("/api/creative-studio/worlds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, name: "Glass Moon", premise: "A low-gravity city grown from translucent stone." }),
    }), owned);
    expect(createdResponse.status).toBe(201);
    const created = await result(createdResponse) as { world: World };
    expect(created.world).toMatchObject({ projectId: project.id, name: "Glass Moon", status: "active", version: 1 });

    const invisible = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}`), otherOwner);
    expect(invisible.status).toBe(404);
    expect(await result(invisible)).toMatchObject({ error: "world_not_found" });
    expect(await result(await routeCreativeStudioApi(request(`/api/creative-studio/worlds?projectId=${project.id}`), otherOwner)))
      .toMatchObject({ worlds: [], worldEntities: [], continuityRules: [], canonReferences: [], canonPromotions: [] });

    const updatedResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, premise: "A low-gravity city grown from translucent stone and blue vapor." }),
    }), owned);
    expect(updatedResponse.status).toBe(200);
    const updated = await result(updatedResponse) as { world: World };
    expect(updated.world).toMatchObject({ version: 2, premise: expect.stringContaining("blue vapor") });

    const staleWorld = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, name: "Stale rewrite" }),
    }), owned);
    expect(staleWorld.status).toBe(409);
    expect(await result(staleWorld)).toMatchObject({ error: "world_version_conflict" });

    const entityResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        kind: "character",
        name: "Iria",
        summary: "A cartographer with a translucent mineral face.",
        aliases: ["The Moon Mapper"],
        attributes: [{ facet: "face", value: "Translucent opal planes around bright blue eyes" }],
      }),
    }), owned);
    expect(entityResponse.status).toBe(201);
    const entity = (await result(entityResponse) as { entity: WorldEntity }).entity;

    const staleEntity = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/entities/${entity.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 9, summary: "Stale entity rewrite" }),
    }), owned);
    expect(staleEntity.status).toBe(409);
    expect(await result(staleEntity)).toMatchObject({ error: "world_entity_version_conflict" });

    const ruleResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityIds: [entity.id],
        facet: "face",
        strength: "must",
        instruction: "Keep the translucent mineral face and bright blue eyes.",
        modalities: ["image", "video"],
      }),
    }), owned);
    expect(ruleResponse.status).toBe(201);
    const rule = (await result(ruleResponse) as { rule: ContinuityRule }).rule;
    const staleRule = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 4, instruction: "Stale rule rewrite" }),
    }), owned);
    expect(staleRule.status).toBe(409);
    expect(await result(staleRule)).toMatchObject({ error: "continuity_rule_version_conflict" });

    const referenceResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/references`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityId: entity.id,
        source: { kind: "commercial-reference", identity: "Protected Franchise Name", lineageOnly: true },
        continuityNotes: [{ facet: "material", value: "Layered translucent mineral with softly lit inclusions" }],
      }),
    }), owned);
    expect(referenceResponse.status).toBe(201);
    const reference = (await result(referenceResponse) as { reference: CanonReference }).reference;
    expect(reference).toMatchObject({ status: "candidate", version: 1, rights: { policy: "abstract-attributes-only" } });
    const staleReference = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/references/${reference.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 8, continuityNotes: [{ facet: "material", value: "Stale reference rewrite" }] }),
    }), owned);
    expect(staleReference.status).toBe(409);
    expect(await result(staleReference)).toMatchObject({ error: "canon_reference_version_conflict" });

    const listed = await result(await routeCreativeStudioApi(request(`/api/creative-studio/worlds?projectId=${project.id}`), owned));
    expect(listed).toMatchObject({
      worlds: [expect.objectContaining({ id: created.world.id, version: 2 })],
      worldEntities: [expect.objectContaining({ id: entity.id })],
      continuityRules: [expect.objectContaining({ id: rule.id })],
      canonReferences: [expect.objectContaining({ id: reference.id, status: "candidate" })],
    });

    const promotionBody = {
      schemaVersion: "creative-studio-promote-to-canon/1.0",
      confirmation: "promote-to-canon",
      worldId: created.world.id,
      entityId: entity.id,
      referenceId: reference.id,
      facets: ["material"],
      note: "Keep only the reviewed abstract material quality.",
      expectedReferenceVersion: reference.version,
    };
    const forgedEvidence = await routeCreativeStudioApi(request(
      `/api/creative-studio/worlds/${created.world.id}/references/${reference.id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...promotionBody, evidenceReviewId: "acceptance_forged" }),
      },
    ), owned);
    expect(forgedEvidence.status).toBe(400);
    expect(await result(forgedEvidence)).toMatchObject({ error: "canon_promotion_evidence_not_applicable" });

    const competingPromotions = await Promise.all([
      routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/references/${reference.id}/promote`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(promotionBody),
      }), owned),
      routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/references/${reference.id}/promote`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(promotionBody),
      }), owned),
    ]);
    expect(competingPromotions.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare("select count(*) as count from creative_canon_promotions where reference_id = ?")
      .bind(reference.id).first<{ count: number }>()).toMatchObject({ count: 1 });
    expect(await env.DB.prepare("select version, status, promotion_token as promotionToken from creative_canon_references where id = ?")
      .bind(reference.id).first<{ version: number; status: string; promotionToken: string | null }>())
      .toMatchObject({ version: 2, status: "canonical", promotionToken: expect.stringMatching(/^promotion_/) });

    const retiredEntity = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/entities/${entity.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: entity.version, status: "retired" }),
    }), owned);
    expect(retiredEntity.status).toBe(200);
    const retiredRule = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: rule.version, status: "retired" }),
    }), owned);
    expect(retiredRule.status).toBe(200);
    expect(await result(retiredRule)).toMatchObject({ rule: { id: rule.id, status: "retired", version: 2 } });

    const archived = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${created.world.id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 2 }),
    }), owned);
    expect(archived.status).toBe(200);
    expect(await result(archived)).toMatchObject({ world: { status: "archived", version: 3 } });
  });

  it("keeps acceptance separate from explicit artifact-to-canon promotion", async () => {
    const ownerId = "development-angelo";
    const local = workerEnv("development");
    const project = await testProject(ownerId, "Retained Canon Study");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Retained Canon Study",
      directive: "A luminous mineral portrait with a precise facial silhouette.",
      targetModality: "image",
    });
    const worldResponse = await routeCreativeStudioApi(request("/api/creative-studio/worlds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, name: "Mineral City", premise: "Living minerals preserve memory as light." }),
    }), local);
    const world = (await result(worldResponse) as { world: World }).world;
    const entityResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        kind: "character",
        name: "Iria",
        summary: "A mineral archivist whose face carries stored light.",
        attributes: [{ facet: "face", value: "Faceted opal cheeks and a narrow luminous brow" }],
      }),
    }), local);
    const entity = (await result(entityResponse) as { entity: WorldEntity }).entity;

    const job = await createDevelopmentJob(env, ownerId, project.id, dna, "image", "canon_artifact_test_001");
    await env.DB.prepare("update creative_jobs set created_at = ? where id = ?")
      .bind("2020-01-01T00:00:00.000Z", job.id).run();
    await reconcileDevelopmentJobs(env, ownerId);
    const artifact = await env.DB.prepare("select id from creative_artifacts where owner_id = ? and job_id = ?")
      .bind(ownerId, job.id).first<{ id: string }>();
    expect(artifact?.id).toBeTruthy();
    await env.DB.prepare("update creative_artifacts set retained_key = ?, retained_content_type = ?, retained_size = ? where id = ?")
      .bind(`owners/${ownerId}/artifacts/${artifact!.id}/output.png`, "image/png", 128, artifact!.id).run();

    const unreviewedCandidate = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/references`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityId: entity.id,
        source: { kind: "retained-artifact", artifactId: artifact!.id, label: "Unreviewed portrait" },
        continuityNotes: [{ facet: "face", value: "Faceted opal cheeks and a narrow luminous brow" }],
      }),
    }), local);
    expect(unreviewedCandidate.status).toBe(409);
    expect(await result(unreviewedCandidate)).toMatchObject({ error: "canon_reference_artifact_acceptance_required" });

    const acceptedResponse = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifact!.id}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "This is the definitive facial material." }),
    }), local);
    expect(acceptedResponse.status).toBe(200);
    const accepted = await result(acceptedResponse) as { acceptance: { id: string } };
    expect(await env.DB.prepare("select count(*) as count from creative_canon_references").first<{ count: number }>()).toMatchObject({ count: 0 });
    expect(await env.DB.prepare("select count(*) as count from creative_canon_promotions").first<{ count: number }>()).toMatchObject({ count: 0 });

    const reviewedCandidateResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/references`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityId: entity.id,
        source: { kind: "retained-artifact", artifactId: artifact!.id, label: "Reviewed portrait" },
        continuityNotes: [{ facet: "face", value: "Faceted opal cheeks and a narrow luminous brow" }],
      }),
    }), local);
    expect(reviewedCandidateResponse.status).toBe(201);
    const reviewedCandidate = (await result(reviewedCandidateResponse) as { reference: CanonReference }).reference;
    expect(reviewedCandidate).toMatchObject({ status: "candidate", source: { artifactId: artifact!.id } });
    const forgedReviewPromotion = await routeCreativeStudioApi(request(
      `/api/creative-studio/worlds/${world.id}/references/${reviewedCandidate.id}/promote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: "creative-studio-promote-to-canon/1.0",
          confirmation: "promote-to-canon",
          worldId: world.id,
          entityId: entity.id,
          referenceId: reviewedCandidate.id,
          facets: ["face"],
          note: "Promote only with the real accepted review.",
          expectedReferenceVersion: reviewedCandidate.version,
          evidenceReviewId: "acceptance_forged",
        }),
      },
    ), local);
    expect(forgedReviewPromotion.status).toBe(409);
    expect(await result(forgedReviewPromotion)).toMatchObject({ error: "artifact_acceptance_mismatch" });
    expect(await env.DB.prepare("select count(*) as count from creative_canon_promotions").first<{ count: number }>()).toMatchObject({ count: 0 });

    const raceDatabase = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") return async (statements: D1PreparedStatement[]) => {
          await target.prepare("update creative_artifacts set status = 'rejected' where id = ? and owner_id = ?")
            .bind(artifact!.id, ownerId).run();
          return target.batch(statements);
        };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as D1Database;
    await expect(promoteArtifactToCanon({ ...local, DB: raceDatabase }, ownerId, artifact!.id, {
      schemaVersion: "creative-studio-promote-to-canon/1.0",
      confirmation: "promote-artifact-to-canon",
      projectId: project.id,
      worldId: world.id,
      entityId: entity.id,
      artifactId: artifact!.id,
      facets: ["face", "material"],
      continuityNotes: [
        { facet: "face", value: "Faceted opal cheeks and a narrow luminous brow" },
        { facet: "material", value: "Translucent mineral with light held beneath the surface" },
      ],
      note: "This promotion must lose the concurrent review race.",
      expectedEntityVersion: entity.version,
      acceptanceId: accepted.acceptance.id,
    })).rejects.toThrow("canon_promotion_prerequisite_changed");
    expect(await env.DB.prepare("select count(*) as count from creative_canon_references").first<{ count: number }>()).toMatchObject({ count: 1 });
    expect(await env.DB.prepare("select count(*) as count from creative_canon_promotions").first<{ count: number }>()).toMatchObject({ count: 0 });

    const reacceptedResponse = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts/${artifact!.id}/accepted`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Reconfirm this definitive facial material after the race test." }),
    }), local);
    expect(reacceptedResponse.status).toBe(200);
    const reaccepted = await result(reacceptedResponse) as { acceptance: { id: string } };

    const missingConfirmation = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/promote-artifact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "creative-studio-promote-to-canon/1.0",
        confirmation: "accept-only",
        projectId: project.id,
        worldId: world.id,
        entityId: entity.id,
        artifactId: artifact!.id,
        facets: ["face", "material"],
        continuityNotes: [
          { facet: "face", value: "Faceted opal cheeks and a narrow luminous brow" },
          { facet: "material", value: "Translucent mineral with light held beneath the surface" },
        ],
        note: "Promote the accepted portrait as facial canon.",
        expectedEntityVersion: entity.version,
        acceptanceId: reaccepted.acceptance.id,
      }),
    }), local);
    expect(missingConfirmation.status).toBe(400);
    expect(await result(missingConfirmation)).toMatchObject({ error: "canon_promotion_confirmation_required" });

    const promotedResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/promote-artifact`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "creative-studio-promote-to-canon/1.0",
        confirmation: "promote-artifact-to-canon",
        projectId: project.id,
        worldId: world.id,
        entityId: entity.id,
        artifactId: artifact!.id,
        facets: ["face", "material"],
        continuityNotes: [
          { facet: "face", value: "Faceted opal cheeks and a narrow luminous brow" },
          { facet: "material", value: "Translucent mineral with light held beneath the surface" },
        ],
        note: "Promote the accepted portrait as facial canon.",
        expectedEntityVersion: entity.version,
        acceptanceId: reaccepted.acceptance.id,
      }),
    }), local);
    expect(promotedResponse.status).toBe(201);
    expect(await result(promotedResponse)).toMatchObject({
      promotion: {
        artifactId: artifact!.id,
        promotion: {
          actor: "angelo",
          evidenceReviewId: reaccepted.acceptance.id,
          reference: { status: "canonical", version: 2, source: { kind: "retained-artifact", artifactId: artifact!.id } },
        },
      },
    });
    expect(await env.DB.prepare("select count(*) as count from creative_canon_references").first<{ count: number }>()).toMatchObject({ count: 2 });
    expect(await env.DB.prepare("select count(*) as count from creative_canon_promotions").first<{ count: number }>()).toMatchObject({ count: 1 });
  });

  it("stores a Worker-compiled, versioned continuity stamp on a workflow job", async () => {
    const ownerId = "development-angelo";
    const local = workerEnv("development");
    const project = await testProject(ownerId, "Continuity Workflow");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Continuity Workflow",
      directive: "A controlled portrait in an unfamiliar luminous environment.",
      targetModality: "image",
    });
    const world = (await result(await routeCreativeStudioApi(request("/api/creative-studio/worlds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, name: "Blue Archive", premise: "A floating archive lit by slow blue stars" }),
    }), local)) as { world: World }).world;
    const entity = (await result(await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/entities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        kind: "character",
        name: "Iria",
        summary: "A mineral archivist with a translucent face",
        attributes: [{ facet: "palette", value: "Opal white, midnight blue, and one amber signal" }],
      }),
    }), local)) as { entity: WorldEntity }).entity;
    const rule = (await result(await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityIds: [entity.id],
        facet: "silhouette",
        strength: "must",
        instruction: "Keep the tall narrow silhouette and halo-shaped collar",
        modalities: ["image", "video"],
      }),
    }), local)) as { rule: ContinuityRule }).rule;
    const videoOnlyRule = (await result(await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityIds: [entity.id],
        facet: "motion",
        strength: "prefer",
        instruction: "Use one slow head turn in motion work",
        modalities: ["video"],
      }),
    }), local)) as { rule: ContinuityRule }).rule;
    await expect(generationContinuityStamp(env, ownerId, project.id, "image", {
      schemaVersion: "creative-studio-generation-continuity-selection/1.0",
      modality: "image",
      world: { id: world.id, version: world.version },
      entities: [{ id: entity.id, version: entity.version }],
      rules: [{ id: videoOnlyRule.id, version: videoOnlyRule.version }],
      references: [],
    })).rejects.toThrow("continuity_rule_modality_mismatch");
    const oversizedRules: ContinuityRule[] = [];
    for (let index = 0; index < 5; index += 1) {
      const response = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          entityIds: [entity.id],
          facet: "material",
          strength: "must",
          instruction: `${String(index + 1).padStart(2, "0")} ${"Preserve the exact reviewed translucent mineral rhythm across every visible surface. ".repeat(7)}`,
          modalities: ["image"],
        }),
      }), local);
      oversizedRules.push((await result(response) as { rule: ContinuityRule }).rule);
    }
    await expect(generationContinuityStamp(env, ownerId, project.id, "image", {
      schemaVersion: "creative-studio-generation-continuity-selection/1.0",
      modality: "image",
      world: { id: world.id, version: world.version },
      entities: [{ id: entity.id, version: entity.version }],
      rules: oversizedRules.map((item) => ({ id: item.id, version: item.version })),
      references: [],
    })).rejects.toThrow("continuity_directive_too_large");
    const candidate = (await result(await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/references`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        entityId: entity.id,
        source: { kind: "commercial-reference", identity: "Protected Franchise Name", lineageOnly: true },
        continuityNotes: [{ facet: "material", value: "Translucent mineral skin with subtle internal light" }],
      }),
    }), local)) as { reference: CanonReference }).reference;
    const canonicalResponse = await routeCreativeStudioApi(request(`/api/creative-studio/worlds/${world.id}/references/${candidate.id}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "creative-studio-promote-to-canon/1.0",
        confirmation: "promote-to-canon",
        worldId: world.id,
        entityId: entity.id,
        referenceId: candidate.id,
        facets: ["material"],
        note: "Keep only the abstract material quality.",
        expectedReferenceVersion: candidate.version,
      }),
    }), local);
    expect(canonicalResponse.status).toBe(200);
    const canonical = (await result(canonicalResponse) as { promotion: { reference: CanonReference } }).promotion.reference;

    const directive = compileContinuityDirective({
      world,
      entities: [entity],
      rules: [rule],
      references: [canonical],
      selectedEntityIds: [entity.id],
      selectedRuleIds: [rule.id],
      selectedReferenceIds: [canonical.id],
      modality: "image",
    });
    expect(directive.text).not.toContain("Protected Franchise Name");
    const authoredPrompt = "Portrait of Iria standing beneath the archive's slow blue stars.";
    const workflowPrompt = `${authoredPrompt} ${directive.text}`;
    const graph = JSON.stringify({
      "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
      "2": { class_type: "PrimitiveStringMultiline", inputs: { value: workflowPrompt }, _meta: { title: "Prompt" } },
      "3": { class_type: "KSampler", inputs: { seed: 42, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1, model: ["1", 0], positive: ["2", 0] } },
      "4": { class_type: "SaveImage", inputs: { filename_prefix: "result", images: ["3", 0] } },
      "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    });
    const imported = await result(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("continuity-image.json"),
        "x-cs-file-size": String(new TextEncoder().encode(graph).byteLength),
        "x-cs-workflow-name": encodeURIComponent("Continuity Image"),
      },
      body: graph,
    }), local)) as { workflow: { id: string; currentRevision: { id: string } } };
    const selection = {
      schemaVersion: "creative-studio-generation-continuity-selection/1.0",
      modality: "image",
      world: { id: world.id, version: world.version },
      entities: [{ id: entity.id, version: entity.version }],
      rules: [{ id: rule.id, version: rule.version }],
      references: [{ id: canonical.id, version: canonical.version }],
    } satisfies GenerationContinuitySelection;
    await expect(generationContinuityStamp(
      env,
      ownerId,
      project.id,
      "image",
      selection,
      `Portrait inspired by Protected Franchise Name. ${directive.text}`,
    )).rejects.toThrow("continuity_commercial_identity_in_prompt");
    const submitted = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "image",
        performanceMode: "explicit-custom",
        idempotencyKey: "continuity_job_test_0001",
        workflow: {
          workflowId: imported.workflow.id,
          revisionId: imported.workflow.currentRevision.id,
          inputBindings: {},
          expectedPrompt: workflowPrompt,
        },
        continuity: selection,
      }),
    }), local);
    expect(submitted.status).toBe(202);
    const submittedPayload = await result(submitted) as { job: { prompt: string; settingsStamp: { continuity: Record<string, unknown> } } };
    expect(submittedPayload.job.prompt).toBe(workflowPrompt);
    expect(submittedPayload.job.settingsStamp.continuity).toMatchObject({
      schemaVersion: "creative-studio-generation-continuity-stamp/1.0",
      selection,
      directive: {
        text: directive.text,
        worldId: world.id,
        entityIds: [entity.id],
        ruleIds: [rule.id],
        referenceIds: [canonical.id],
        excludedCommercialReferenceIdentityIds: [canonical.id],
      },
      records: {
        world: { id: world.id, version: world.version },
        entities: [{ id: entity.id, version: entity.version }],
        rules: [{ id: rule.id, version: rule.version }],
        references: [{ id: canonical.id, version: canonical.version }],
        redactionReferences: [{ id: canonical.id, version: canonical.version }],
      },
    });
    expect(JSON.stringify(submittedPayload.job.settingsStamp.continuity)).toContain("Protected Franchise Name");
    expect((submittedPayload.job.settingsStamp.continuity.directive as { text: string }).text).not.toContain("Protected Franchise Name");
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
        outputBatch: {
          schemaVersion: "creative-studio-output-batch/1.0",
          batchId: "output_batch_123e4567-e89b-12d3-a456-426614174000",
          index: 2,
          count: 4,
        },
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
        settingsStamp: {
          performanceMode: "explicit-custom",
          outputBatch: {
            schemaVersion: "creative-studio-output-batch/1.0",
            batchId: "output_batch_123e4567-e89b-12d3-a456-426614174000",
            index: 2,
            count: 4,
          },
          workflow: { workflowId: importedPayload.workflow.id, revisionId: revisedPayload.workflow.currentRevision.id },
        },
      },
    });
  });

  it("persists reusable generation recipes with exact workflow settings and observed job evidence", async () => {
    const ownerId = "owner-recipes";
    const local = workerEnv("afdfw", afdfwFor(ownerId));
    const project = await testProject(ownerId, "Recipe Study");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Recipe direction",
      directive: "A polished translucent form in a dark studio.",
      targetModality: "image",
    });
    const graph = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }, _meta: { title: "Load model" } },
      "2": { class_type: "PrimitiveStringMultiline", inputs: { value: "A polished translucent form in a dark studio" }, _meta: { title: "Prompt" } },
      "3": { class_type: "KSampler", inputs: { seed: 42, steps: 8, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1, model: ["1", 0], positive: ["2", 0] }, _meta: { title: "Sampler" } },
      "4": { class_type: "SaveImage", inputs: { filename_prefix: "result", images: ["3", 0] }, _meta: { title: "Save image" } },
      "5": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 }, _meta: { title: "Image size" } },
    };
    const raw = JSON.stringify(graph);
    const imported = await result(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("recipe-image.json"),
        "x-cs-file-size": String(new TextEncoder().encode(raw).byteLength),
        "x-cs-workflow-name": encodeURIComponent("Recipe Image"),
      },
      body: raw,
    }), local)) as {
      workflow: {
        id: string;
        name: string;
        currentRevision: {
          id: string;
          version: number;
          format: "comfyui-api";
          contentHash: string;
          parameters: Array<{ id: string; value: string | number | boolean }>;
          models: string[];
        };
      };
    };
    const parameters = Object.fromEntries(imported.workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));

    const incompatibleSources = await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid image-input recipe",
        projectId: project.id,
        mediaKind: "image",
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        promptProfile: { id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: "z_image_turbo_bf16.safetensors" },
        parameters,
        sourceKinds: ["image"],
        intentTier: "scout",
      }),
    }), local);
    expect(incompatibleSources.status).toBe(400);
    expect(await result(incompatibleSources)).toMatchObject({ error: "recipe_source_kind_not_in_workflow" });

    const createdResponse = await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Fast translucent scout",
        description: "The exact known-fast Z-Image setup.",
        projectId: project.id,
        worldId: "world_translucent_forms",
        mediaKind: "image",
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        modelIdentifier: "z_image_turbo_bf16.safetensors",
        promptProfile: { id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: "z_image_turbo_bf16.safetensors" },
        parameters,
        sourceKinds: ["prompt"],
        intentTier: "scout",
      }),
    }), local);
    expect(createdResponse.status).toBe(201);
    const created = await result(createdResponse) as { recipe: { id: string; workflowRevisionId: string; parameters: Record<string, unknown>; evidence: unknown[]; evidenceSummary: { runs: number } } };
    expect(created.recipe).toMatchObject({ workflowRevisionId: imported.workflow.currentRevision.id, parameters, evidence: [], evidenceSummary: { runs: 0 } });

    const settingsStamp = {
      schemaVersion: 1 as const,
      source: "comfyui-workflow" as const,
      createdAt: "2026-08-26T12:00:00.000Z",
      reusedFromJobId: null,
      prompt: "A polished translucent form in a dark studio",
      provider: "local-comfyui",
      modality: "image" as const,
      performanceMode: "explicit-custom" as const,
      workflow: {
        workflowId: imported.workflow.id,
        revisionId: imported.workflow.currentRevision.id,
        version: imported.workflow.currentRevision.version,
        name: imported.workflow.name,
        format: imported.workflow.currentRevision.format,
        contentHash: imported.workflow.currentRevision.contentHash,
      },
      parameters,
      models: imported.workflow.currentRevision.models,
      inputAssetIds: [],
      inputArtifactIds: [],
      inputSources: [],
      inputBindings: {},
    };
    const otherProject = await testProject(ownerId, "Other Recipe Study");
    const otherDna = await createLocalDna(env, ownerId, {
      projectId: otherProject.id,
      name: "Other direction",
      directive: "The same workflow in a separate project.",
      targetModality: "image",
    });
    const otherProjectJob = await createQueuedJob(env, ownerId, {
      projectId: otherProject.id,
      dna: otherDna,
      modality: "image",
      idempotencyKey: "recipe_other_project_001",
      provider: "local-comfyui",
      reconcileEmail: null,
      executionTarget: "local-comfyui",
      workflowId: imported.workflow.id,
      workflowRevisionId: imported.workflow.currentRevision.id,
      settingsStampOverride: { ...settingsStamp, createdAt: "2026-08-26T11:58:00.000Z" },
    });
    await env.DB.prepare(`update creative_jobs set status = 'failed', progress = 100, error = 'Test failure',
      started_at = ?, completed_at = ?, updated_at = ?, execution_stage = 'failed', stage_updated_at = ? where id = ?`)
      .bind("2026-08-26T11:58:00.000Z", "2026-08-26T11:58:04.000Z", "2026-08-26T11:58:04.000Z", "2026-08-26T11:58:04.000Z", otherProjectJob.job.id).run();
    const projectMismatch = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: otherProjectJob.job.id }),
    }), local);
    expect(projectMismatch.status).toBe(400);
    expect(await result(projectMismatch)).toMatchObject({ error: "recipe_evidence_project_mismatch" });

    const globalRecipeResponse = await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Owner-wide translucent scout",
        projectId: null,
        mediaKind: "image",
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        modelIdentifier: "z_image_turbo_bf16.safetensors",
        promptProfile: { id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: "z_image_turbo_bf16.safetensors" },
        parameters,
        sourceKinds: ["prompt"],
        intentTier: "scout",
      }),
    }), local);
    expect(globalRecipeResponse.status).toBe(201);
    const globalRecipe = await result(globalRecipeResponse) as { recipe: { id: string } };
    const globalEvidence = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${globalRecipe.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: otherProjectJob.job.id }),
    }), local);
    expect(globalEvidence.status).toBe(201);

    const failed = await createQueuedJob(env, ownerId, {
      projectId: project.id,
      dna,
      modality: "image",
      idempotencyKey: "recipe_failed_001",
      provider: "local-comfyui",
      reconcileEmail: null,
      executionTarget: "local-comfyui",
      workflowId: imported.workflow.id,
      workflowRevisionId: imported.workflow.currentRevision.id,
      settingsStampOverride: settingsStamp,
    });
    await env.DB.prepare(`update creative_jobs set status = 'failed', progress = 100, error = 'CUDA out of memory',
      started_at = ?, completed_at = ?, updated_at = ?, execution_stage = 'failed', stage_updated_at = ? where id = ?`)
      .bind("2026-08-26T12:00:00.000Z", "2026-08-26T12:00:12.000Z", "2026-08-26T12:00:12.000Z", "2026-08-26T12:00:12.000Z", failed.job.id).run();
    const wrongProfileResponse = await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Wrong prompt profile",
        projectId: project.id,
        mediaKind: "image",
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        modelIdentifier: "z_image_turbo_bf16.safetensors",
        promptProfile: { id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: "Wrong target" },
        parameters,
        sourceKinds: ["prompt"],
        intentTier: "scout",
      }),
    }), local);
    const wrongProfile = await result(wrongProfileResponse) as { recipe: { id: string } };
    const promptProfileMismatch = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${wrongProfile.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: failed.job.id }),
    }), local);
    expect(promptProfileMismatch.status).toBe(400);
    expect(await result(promptProfileMismatch)).toMatchObject({ error: "recipe_evidence_prompt_profile_mismatch" });
    const failedEvidence = await result(await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: failed.job.id }),
    }), local));
    expect(failedEvidence).toMatchObject({
      ok: true,
      evidence: { jobId: failed.job.id, outcome: "failed", durationMs: 12_000, failure: "CUDA out of memory", acceptance: "unreviewed" },
      recipe: { evidenceSummary: { runs: 1, failed: 1 } },
    });

    const completed = await createQueuedJob(env, ownerId, {
      projectId: project.id,
      dna,
      modality: "image",
      idempotencyKey: "recipe_completed_001",
      provider: "local-comfyui",
      reconcileEmail: null,
      executionTarget: "local-comfyui",
      workflowId: imported.workflow.id,
      workflowRevisionId: imported.workflow.currentRevision.id,
      settingsStampOverride: { ...settingsStamp, createdAt: "2026-08-26T12:01:00.000Z" },
    });
    const artifactId = "artifact_recipe_completed";
    await env.DB.batch([
      env.DB.prepare(`insert into creative_artifacts (
        id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
        preview_kind, preview_url, preview_from, preview_to, upstream_media_path, parent_artifact_id,
        created_at, updated_at, settings_stamp_json
      ) values (?, ?, ?, ?, ?, 'image', ?, 'ready', 'local-comfyui', ?, 'remote-media', null, ?, ?, null, null, ?, ?, ?)`)
        .bind(artifactId, ownerId, project.id, completed.job.id, dna.artifactId, "Recipe result", settingsStamp.prompt,
          "#111827", "#6d28d9", "2026-08-26T12:01:09.000Z", "2026-08-26T12:01:09.000Z", JSON.stringify(settingsStamp)),
      env.DB.prepare(`update creative_jobs set status = 'completed', progress = 100, artifact_id = ?,
        started_at = ?, completed_at = ?, updated_at = ?, execution_stage = 'completed', stage_updated_at = ? where id = ?`)
        .bind(artifactId, "2026-08-26T12:01:00.000Z", "2026-08-26T12:01:09.000Z", "2026-08-26T12:01:09.000Z", "2026-08-26T12:01:09.000Z", completed.job.id),
      env.DB.prepare(`insert into creative_acceptances (id, owner_id, artifact_id, decision, note, actor, created_at)
        values ('accept_recipe_completed', ?, ?, 'accepted', 'Strong form and speed.', 'angelo', ?)`)
        .bind(ownerId, artifactId, "2026-08-26T12:02:00.000Z"),
    ]);
    const completedEvidence = await result(await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: completed.job.id }),
    }), local));
    expect(completedEvidence).toMatchObject({
      evidence: { jobId: completed.job.id, outcome: "completed", durationMs: 9_000, acceptance: "accepted" },
      recipe: { evidenceSummary: { runs: 2, completed: 1, failed: 1, accepted: 1, acceptanceRate: 1, medianDurationMs: 10_500 } },
    });

    for (let index = 0; index < 10; index += 1) {
      const observed = new Date(Date.UTC(2026, 7, 26, 12, 10 + index)).toISOString();
      const evidenceJob = await createQueuedJob(env, ownerId, {
        projectId: project.id,
        dna,
        modality: "image",
        idempotencyKey: `recipe_window_job_${String(index).padStart(3, "0")}`,
        provider: "local-comfyui",
        reconcileEmail: null,
        executionTarget: "local-comfyui",
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        settingsStampOverride: { ...settingsStamp, createdAt: observed },
      });
      await env.DB.prepare(`update creative_jobs set status = 'failed', progress = 100, error = 'Window evidence',
        started_at = ?, completed_at = ?, updated_at = ?, execution_stage = 'failed', stage_updated_at = ? where id = ?`)
        .bind(observed, observed, observed, observed, evidenceJob.job.id).run();
      const recorded = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: evidenceJob.job.id }),
      }), local);
      expect(recorded.status).toBe(201);
    }

    const snapshot = await result(await routeCreativeStudioApi(request("/api/creative-studio/snapshot"), local)) as { snapshot: { recipes: Array<{ id: string; evidence: unknown[] }> } };
    expect(snapshot.snapshot.recipes.map((recipe) => recipe.id)).toContain(created.recipe.id);
    expect(snapshot.snapshot.recipes.find((recipe) => recipe.id === created.recipe.id)?.evidence).toHaveLength(10);
    const detailedRecipe = await result(await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}`), local)) as { recipe: { evidence: unknown[] } };
    expect(detailedRecipe.recipe.evidence).toHaveLength(12);
    const immutableSettings = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentTier: "master" }),
    }), local);
    expect(immutableSettings.status).toBe(409);
    expect(await result(immutableSettings)).toMatchObject({ error: "recipe_evidence_settings_immutable" });
    const updated = await result(await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Proven translucent scout" }),
    }), local));
    expect(updated).toMatchObject({ recipe: { name: "Proven translucent scout", intentTier: "scout", worldId: "world_translucent_forms" } });

    const notOwned = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}`), workerEnv("afdfw", afdfwFor("owner-recipes-other")));
    expect(notOwned.status).toBe(404);
    await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${globalRecipe.recipe.id}`, { method: "DELETE" }), local);
    await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${wrongProfile.recipe.id}`, { method: "DELETE" }), local);
    await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${created.recipe.id}`, { method: "DELETE" }), local);
    const active = await result(await routeCreativeStudioApi(request("/api/creative-studio/recipes"), local)) as { recipes: unknown[] };
    expect(active.recipes).toHaveLength(0);
    const archived = await result(await routeCreativeStudioApi(request("/api/creative-studio/recipes?includeArchived=true"), local)) as { recipes: Array<{ id: string; archivedAt: string | null }> };
    expect(archived.recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.recipe.id, archivedAt: expect.any(String) }),
      expect.objectContaining({ id: globalRecipe.recipe.id, archivedAt: expect.any(String) }),
      expect.objectContaining({ id: wrongProfile.recipe.id, archivedAt: expect.any(String) }),
    ]));
  });

  it("bounds normal recipe snapshots to the newest 50 active records", async () => {
    const ownerId = "owner-recipe-window";
    const local = workerEnv("afdfw", afdfwFor(ownerId));
    const project = await testProject(ownerId, "Recipe Window");
    const graph = JSON.stringify({
      "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "A bounded recipe window" }, _meta: { title: "Prompt" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
    });
    const imported = await result(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.id,
        "x-cs-file-name": encodeURIComponent("recipe-window.json"),
        "x-cs-file-size": String(new TextEncoder().encode(graph).byteLength),
      },
      body: graph,
    }), local)) as { workflow: { id: string; name: string; currentRevision: { id: string; parameters: Array<{ id: string; value: string | number | boolean }> } } };
    const parameters = Object.fromEntries(imported.workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]));
    const baseResponse = await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Recipe window base",
        projectId: project.id,
        mediaKind: "image",
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        promptProfile: { id: "creative-studio-image-direct-prompt", version: "1.0", targetModel: imported.workflow.name },
        parameters,
        sourceKinds: ["prompt"],
        intentTier: "scout",
      }),
    }), local);
    const base = await result(baseResponse) as { recipe: { id: string } };
    await env.DB.batch(Array.from({ length: 55 }, (_, index) => {
      const recipeId = `recipe_window_${String(index).padStart(2, "0")}`;
      const timestamp = new Date(Date.UTC(2027, 0, 1, 0, index)).toISOString();
      return env.DB.prepare(`insert into creative_generation_recipes (
        id, owner_id, project_id, world_id, name, description, media_kind, workflow_id, workflow_revision_id,
        model_identifier, prompt_profile_json, parameters_json, source_kinds_json, intent_tier, created_at, updated_at, archived_at
      ) select ?, owner_id, project_id, world_id, ?, description, media_kind, workflow_id, workflow_revision_id,
        model_identifier, prompt_profile_json, parameters_json, source_kinds_json, intent_tier, ?, ?, null
        from creative_generation_recipes where id = ? and owner_id = ?`)
        .bind(recipeId, `Recipe window ${index}`, timestamp, timestamp, base.recipe.id, ownerId);
    }));

    const listed = await result(await routeCreativeStudioApi(request("/api/creative-studio/recipes"), local)) as { recipes: Array<{ id: string; archivedAt: string | null }> };
    expect(listed.recipes).toHaveLength(50);
    expect(listed.recipes[0].id).toBe("recipe_window_54");
    expect(listed.recipes.every((recipe) => recipe.archivedAt === null)).toBe(true);
    const snapshot = await result(await routeCreativeStudioApi(request("/api/creative-studio/snapshot"), local)) as { snapshot: { recipes: Array<{ id: string }> } };
    expect(snapshot.snapshot.recipes).toHaveLength(50);
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

  it("pages equal-timestamp artifacts without drift and reviews work older than the snapshot window", async () => {
    const ownerId = "development-angelo";
    const local = workerEnv("development");
    const project = await testProject(ownerId, "Complete History");
    const dna = await createLocalDna(env, ownerId, {
      projectId: project.id,
      name: "Complete History",
      directive: "A precise archive study with stable ordering.",
      targetModality: "image",
    });
    const tiedAt = "2026-08-20T12:00:00.000Z";
    await env.DB.prepare(`with recursive sequence(value) as (
        select 0 union all select value + 1 from sequence where value < 101
      ) insert into creative_jobs
        (id, owner_id, project_id, dna_artifact_id, capability, modality, status, progress, prompt, provider,
          artifact_id, created_at, updated_at, completed_at, execution_stage)
      select 'job_history_' || printf('%03d', value), ?, ?, ?, 'IMAGE_GENERATE', 'image', 'completed', 100,
        'Stable history prompt', 'development-worker', 'artifact_history_' || printf('%03d', value), ?, ?, ?, 'completed'
      from sequence`)
      .bind(ownerId, project.id, dna.artifactId, tiedAt, tiedAt, tiedAt).run();
    await env.DB.prepare(`with recursive sequence(value) as (
        select 0 union all select value + 1 from sequence where value < 101
      ) insert into creative_artifacts
        (id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
          preview_kind, preview_url, preview_from, preview_to, created_at, updated_at)
      select 'artifact_history_' || printf('%03d', value), ?, ?, 'job_history_' || printf('%03d', value), ?,
        'image', 'History ' || printf('%03d', value), 'ready', 'development-worker', 'Stable history prompt',
        'development-gradient', null, '#111827', '#6d28d9', ?, ?
      from sequence`)
      .bind(ownerId, project.id, dna.artifactId, tiedAt, tiedAt).run();

    const firstResponse = await routeCreativeStudioApi(request("/api/creative-studio/artifacts?page=true&limit=2"), local);
    expect(firstResponse.status).toBe(200);
    const first = (await result(firstResponse) as {
      page: { artifacts: Array<{ id: string }>; jobs: Array<{ id: string }>; nextCursor: { createdAt: string; artifactId: string }; hasMore: boolean; total: number };
    }).page;
    expect(first.artifacts.map((artifact) => artifact.id)).toEqual(["artifact_history_101", "artifact_history_100"]);
    expect(first.jobs.map((job) => job.id).sort()).toEqual(["job_history_100", "job_history_101"]);
    expect(first).toMatchObject({ hasMore: true, total: 102, nextCursor: { createdAt: tiedAt, artifactId: "artifact_history_100" } });

    const newerAt = "2026-08-20T12:01:00.000Z";
    await env.DB.prepare(`insert into creative_jobs
      (id, owner_id, project_id, dna_artifact_id, capability, modality, status, progress, prompt, provider,
        artifact_id, created_at, updated_at, completed_at, execution_stage)
      values ('job_history_new', ?, ?, ?, 'IMAGE_GENERATE', 'image', 'completed', 100, 'New history prompt',
        'development-worker', 'artifact_history_new', ?, ?, ?, 'completed')`)
      .bind(ownerId, project.id, dna.artifactId, newerAt, newerAt, newerAt).run();
    await env.DB.prepare(`insert into creative_artifacts
      (id, owner_id, project_id, job_id, dna_artifact_id, kind, name, status, provider, prompt,
        preview_kind, preview_url, preview_from, preview_to, created_at, updated_at)
      values ('artifact_history_new', ?, ?, 'job_history_new', ?, 'image', 'New history item', 'ready',
        'development-worker', 'New history prompt', 'development-gradient', null, '#111827', '#6d28d9', ?, ?)`)
      .bind(ownerId, project.id, dna.artifactId, newerAt, newerAt).run();

    const nextQuery = new URLSearchParams({
      page: "true",
      limit: "2",
      cursorCreatedAt: first.nextCursor.createdAt,
      cursorArtifactId: first.nextCursor.artifactId,
    });
    const second = (await result(await routeCreativeStudioApi(request(`/api/creative-studio/artifacts?${nextQuery}`), local)) as {
      page: { artifacts: Array<{ id: string }>; total: number };
    }).page;
    expect(second.artifacts.map((artifact) => artifact.id)).toEqual(["artifact_history_099", "artifact_history_098"]);
    expect(second.artifacts.map((artifact) => artifact.id)).not.toEqual(expect.arrayContaining(first.artifacts.map((artifact) => artifact.id)));
    expect(second.total).toBe(103);

    const invalidCursor = await routeCreativeStudioApi(request(`/api/creative-studio/artifacts?page=true&cursorCreatedAt=${encodeURIComponent(tiedAt)}`), local);
    expect(invalidCursor.status).toBe(400);
    expect(await result(invalidCursor)).toMatchObject({ error: "invalid_artifact_history_cursor" });
    const otherOwnerPage = await result(await routeCreativeStudioApi(
      request("/api/creative-studio/artifacts?page=true&limit=2"),
      workerEnv("afdfw", afdfwFor("owner-history-other")),
    ));
    expect(otherOwnerPage).toMatchObject({ page: { artifacts: [], jobs: [], total: 0, hasMore: false, nextCursor: null } });

    const reviewed = await routeCreativeStudioApi(request("/api/creative-studio/artifacts/artifact_history_000/accepted", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "Keep the oldest retained direction." }),
    }), local);
    expect(reviewed.status).toBe(200);
    expect(await result(reviewed)).toMatchObject({
      artifact: { id: "artifact_history_000", status: "accepted" },
      acceptance: { artifactId: "artifact_history_000", decision: "accepted", note: "Keep the oldest retained direction." },
    });
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
    const first = await result(await create()) as { job: { id: string; settingsStamp: Record<string, unknown> } };
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
    const retryPayload = await result(retried) as { job: { status: string; retryOfJobId: string; settingsStamp: Record<string, unknown> } };
    expect(retryPayload).toMatchObject({ job: { status: "queued", retryOfJobId: first.job.id } });
    expect(retryPayload.job.settingsStamp).toEqual({
      ...first.job.settingsStamp,
      createdAt: retryPayload.job.settingsStamp.createdAt,
      reusedFromJobId: first.job.id,
    });
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
    }), local)) as { workflow: { id: string; name: string; currentRevision: { id: string; parameters: Array<{ id: string; label: string; value: string | number | boolean }>; models: string[] } } };
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
      artifacts: Array<{ jobId: string; projectId: string; kind: "music"; prompt: string; settingsStamp: {
        workflow: { workflowId: string; revisionId: string; name: string };
        models: string[];
        parameters: Record<string, string | number | boolean>;
        promptEnhancement?: { sourcePrompt: string; enhancedPrompt: string; promptProfileId: string; targetModel: string };
      } }>;
    };
    expect(history.artifacts[0]).toMatchObject({
      prompt: enhancedPrompt,
      settingsStamp: { promptEnhancement: { sourcePrompt: created.job.prompt, enhancedPrompt } },
    });
    const musicArtifact = history.artifacts[0];
    const createMusicRecipe = async (targetModel: string) => result(await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: `MiniMax winner ${targetModel}`,
        projectId: musicArtifact.projectId,
        mediaKind: "music",
        workflowId: musicArtifact.settingsStamp.workflow.workflowId,
        workflowRevisionId: musicArtifact.settingsStamp.workflow.revisionId,
        modelIdentifier: musicArtifact.settingsStamp.models[0] ?? null,
        promptProfile: { id: "minimax-music-3-structured-caption", version: "1.0", targetModel },
        parameters: musicArtifact.settingsStamp.parameters,
        sourceKinds: ["prompt"],
        intentTier: "master",
      }),
    }), local)) as Promise<{ recipe: { id: string } }>;
    const wrongMusicRecipe = await createMusicRecipe("Wrong music target");
    const wrongMusicEvidence = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${wrongMusicRecipe.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: musicArtifact.jobId }),
    }), local);
    expect(wrongMusicEvidence.status).toBe(400);
    expect(await result(wrongMusicEvidence)).toMatchObject({ error: "recipe_evidence_prompt_profile_mismatch" });
    const musicRecipe = await createMusicRecipe("MiniMax Music 3");
    const musicEvidence = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${musicRecipe.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: musicArtifact.jobId }),
    }), local);
    expect(musicEvidence.status).toBe(201);
    expect(await result(musicEvidence)).toMatchObject({ evidence: { jobId: musicArtifact.jobId, outcome: "completed" } });
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
    const h3Prompt = compileVideoPromptWithSpeech(
      "Original H3 motion prompt",
      undefined,
      videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" }),
    );
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
      "2": { class_type: "MiniMaxH3I2V", inputs: { prompt: h3Prompt.prompt, image: ["1", 0], seed: 42, duration: 10 } },
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

    const missingSpeechPolicy = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "video",
        videoDurationSeconds: 10,
        idempotencyKey: "runner_video_missing_speech_001",
        workflow: {
          workflowId: imported.workflow.id,
          revisionId: imported.workflow.currentRevision.id,
          inputBindings: { [mediaParameter!.id]: uploaded.asset.id },
          expectedPrompt: h3Prompt.prompt,
        },
      }),
    }), local);
    expect(missingSpeechPolicy.status).toBe(400);
    expect(await result(missingSpeechPolicy)).toMatchObject({ error: "video_speech_policy_required" });

    const differentSpeech = compileVideoPromptWithSpeech(
      "Original H3 motion prompt",
      { mode: "exact-script", text: "Look up." },
      videoPromptProfileForIdentity({ name: "MiniMax H3 I2V" }),
    );
    const mismatchedSpeechPolicy = await routeCreativeStudioApi(request("/api/creative-studio/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        dnaArtifactId: dna.artifactId,
        modality: "video",
        videoDurationSeconds: 10,
        idempotencyKey: "runner_video_mismatch_speech_001",
        workflow: {
          workflowId: imported.workflow.id,
          revisionId: imported.workflow.currentRevision.id,
          inputBindings: { [mediaParameter!.id]: uploaded.asset.id },
          expectedPrompt: h3Prompt.prompt,
        },
        videoSpeech: differentSpeech.speech,
      }),
    }), local);
    expect(mismatchedSpeechPolicy.status).toBe(400);
    expect(await result(mismatchedSpeechPolicy)).toMatchObject({ error: "video_speech_prompt_mismatch" });

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
          expectedPrompt: h3Prompt.prompt,
        },
        videoVariant: alignedVideoVariant,
        videoSpeech: h3Prompt.speech,
        evolution: {
          schemaVersion: "creative-studio-evolution-request/1.0",
          studyId: "evolve_runner-test-001",
          role: "refine",
          sourceId: uploaded.asset.id,
          source: "upload",
        },
      }),
    }), local)) as { job: { id: string; status: string; startedAt: string | null; executionStage: string; settingsStamp: { workflow: { contentHash: string }; videoDurationSeconds: number; inputBindings: Record<string, string>; workloadEvidence: { source: string; profileId: string; label: string }; videoVariant: typeof alignedVideoVariant; videoSpeech: typeof h3Prompt.speech; evolution: { studyId: string; role: string; sourceId: string; sourceKind: string; projectCanon: { identity: string; currentDirection: string } } } } };
    expect(created.job).toMatchObject({ status: "queued", startedAt: null, executionStage: "queued", settingsStamp: { workflow: { contentHash: imported.workflow.currentRevision.contentHash }, videoDurationSeconds: 10 } });
    expect(created.job.settingsStamp.workloadEvidence).toEqual({ source: "workflow-revision", profileId: imported.workflow.currentRevision.id, label: "MiniMax H3 I2V v1" });
    expect(created.job.settingsStamp.inputBindings[mediaParameter!.id]).toBe(uploaded.asset.id);
    expect(created.job.settingsStamp.videoVariant).toEqual(alignedVideoVariant);
    expect(created.job.settingsStamp.videoSpeech).toEqual(h3Prompt.speech);
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
    }), local)) as { job: { id: string; upstreamId: string; retryOfJobId: string; settingsStamp: { videoVariant: typeof alignedVideoVariant; videoSpeech: typeof h3Prompt.speech } } };
    expect(retried.job).toMatchObject({ upstreamId: "comfy-prompt-h3-001", retryOfJobId: created.job.id, settingsStamp: { videoVariant: alignedVideoVariant, videoSpeech: h3Prompt.speech } });
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
          expectedPrompt: h3Prompt.prompt,
        },
        videoSpeech: h3Prompt.speech,
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
    const extendedHistory = await result(await routeCreativeStudioApi(request("/api/creative-studio/artifacts"), local)) as { artifacts: Array<{
      id: string;
      jobId: string;
      projectId: string;
      lineage: { sourceArtifactIds: string[] };
      settingsStamp: {
        workflow: { workflowId: string; revisionId: string; name: string };
        models: string[];
        parameters: Record<string, string | number | boolean>;
        inputSources: Array<{ kind: string }>;
        videoOperation?: { kind: string };
      };
    }> };
    expect(extendedHistory.artifacts[0]).toMatchObject({
      lineage: { sourceArtifactIds: [history.artifacts[0].id] },
      settingsStamp: { videoOperation: { kind: "extend" } },
    });
    expect(extendedHistory.artifacts[0].settingsStamp.inputSources).toEqual([expect.objectContaining({ kind: "video" })]);
    const extensionArtifact = extendedHistory.artifacts[0];
    const extensionRecipeResponse = await routeCreativeStudioApi(request("/api/creative-studio/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Executable final-frame extension",
        projectId: extensionArtifact.projectId,
        mediaKind: "video",
        workflowId: extensionArtifact.settingsStamp.workflow.workflowId,
        workflowRevisionId: extensionArtifact.settingsStamp.workflow.revisionId,
        modelIdentifier: extensionArtifact.settingsStamp.models[0] ?? null,
        promptProfile: {
          id: "creative-studio-video-direct-prompt",
          version: "1.0",
          targetModel: extensionArtifact.settingsStamp.models[0] ?? extensionArtifact.settingsStamp.workflow.name,
        },
        parameters: extensionArtifact.settingsStamp.parameters,
        sourceKinds: ["prompt", "image"],
        intentTier: "master",
      }),
    }), local);
    expect(extensionRecipeResponse.status).toBe(201);
    const extensionRecipe = await result(extensionRecipeResponse) as { recipe: { id: string; sourceKinds: string[] } };
    expect(extensionRecipe.recipe.sourceKinds).toEqual(["prompt", "image"]);
    const extensionEvidence = await routeCreativeStudioApi(request(`/api/creative-studio/recipes/${extensionRecipe.recipe.id}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: extensionArtifact.jobId }),
    }), local);
    expect(extensionEvidence.status).toBe(201);
    expect(await result(extensionEvidence)).toMatchObject({ evidence: { jobId: extensionArtifact.jobId, outcome: "completed" } });

    const chainedPrompt = compileVideoPromptWithSpeech(
      "Continue the retained motion study",
      undefined,
      videoPromptProfileForIdentity({ name: "Video remix" }),
    );
    const remixGraph = JSON.stringify({
      "10": { class_type: "VHS_LoadVideo", inputs: { video: "prior.mp4" }, _meta: { title: "Prior generated video" } },
      "11": { class_type: "SaveVideo", inputs: { video: ["10", 0] } },
      "12": { class_type: "PrimitiveStringMultiline", inputs: { value: chainedPrompt.prompt }, _meta: { title: "Prompt" } },
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
          expectedPrompt: chainedPrompt.prompt,
        },
        videoSpeech: chainedPrompt.speech,
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
