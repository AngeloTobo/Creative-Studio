import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { compileVideoPromptWithSpeech, videoPromptProfileForIdentity } from "../../shared/contracts";
import { routeCreativeStudioApi } from "../../worker/routes/api";
import { videoScriptDraftById, videoScriptStampForJob } from "../../worker/videoScripts";

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://cs.angelotoborg.com${path}`, init);
}

async function result<T>(response: Response): Promise<T> {
  const payload = await response.json() as { ok: boolean; error?: string };
  if (!payload.ok) throw new Error(String(payload.error));
  return payload as T;
}

async function createProject(name: string) {
  return result<{ project: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, type: "visual" }),
  }), env));
}

async function enrollRunner(name: string) {
  const enrollment = await result<{ runner: { id: string }; token: string }>(await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  }), env));
  return { ...enrollment, headers: { authorization: `Bearer ${enrollment.token}`, "content-type": "application/json" } };
}

describe("durable video Script Builder", () => {
  it("creates, version-gates, completes, edits, stamps, and owner-scopes a local Gemma draft", async () => {
    const project = await createProject("Dialogue Lab");
    const created = await result<{ videoScriptDraft: { id: string; status: string; seedPhrases: string[] } }>(await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.project.id,
        mode: "build",
        seedPhrases: ["we kept the signal alive", "midnight", "find one another"],
        sceneDirection: "One person speaks beneath a damaged transmitter.",
        videoDurationSeconds: 10,
        idempotencyKey: "video_script_lifecycle_001",
      }),
    }), env));
    expect(created.videoScriptDraft).toMatchObject({ status: "waiting-for-runner", seedPhrases: ["we kept the signal alive", "midnight", "find one another"] });

    const runner = await enrollRunner("Script runner");
    const gated = await result<{ kind: string | null }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.10.0", comfyUrl: "http://127.0.0.1:8188", modelTrainingProviders: [] }),
    }), env));
    expect(gated.kind).toBeNull();

    const claimed = await result<{ kind: string; bundle: { videoScriptDraft: { id: string } } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.11.0", comfyUrl: "http://127.0.0.1:8188", modelTrainingProviders: [] }),
    }), env));
    expect(claimed).toMatchObject({ kind: "video-script", bundle: { videoScriptDraft: { id: created.videoScriptDraft.id } } });

    const generated = "We kept the signal alive through midnight.";
    const completed = await result<{ videoScriptDraft: { status: string; generatedScript: string; currentScript: string; editRevision: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/video-scripts/${created.videoScriptDraft.id}/complete`, {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({
        output: JSON.stringify({ schemaVersion: "creative-studio-video-script-output/1.0", spokenText: generated }),
        comfyPromptId: "comfy-video-script-001",
      }),
    }), env));
    expect(completed.videoScriptDraft).toMatchObject({ status: "completed", generatedScript: generated, currentScript: generated, editRevision: 0 });

    const editedScript = "We carried the signal safely through midnight.";
    const edited = await result<{ videoScriptDraft: { currentScript: string; editRevision: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/video-scripts/${created.videoScriptDraft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentScript: editedScript, expectedRevision: 0 }),
    }), env));
    expect(edited.videoScriptDraft).toMatchObject({ currentScript: editedScript, editRevision: 1 });

    const compiled = compileVideoPromptWithSpeech("The speaker turns toward the transmitter.", {
      mode: "exact-script",
      text: editedScript,
    }, videoPromptProfileForIdentity({ name: "LTX 2.5 Image to Video" }));
    const stamp = await videoScriptStampForJob(env, "development-angelo", {
      requestId: created.videoScriptDraft.id,
      appliedScript: editedScript,
      editRevision: 1,
      projectId: project.project.id,
      videoDurationSeconds: 10,
      videoSpeech: compiled.speech,
    });
    expect(stamp).toMatchObject({
      requestId: created.videoScriptDraft.id,
      generatedScript: generated,
      appliedScript: editedScript,
      editRevision: 1,
      editedAfterGeneration: true,
      provider: "local-comfyui",
    });
    await expect(videoScriptDraftById(env, "different-owner", created.videoScriptDraft.id)).rejects.toThrow("video_script_draft_not_found");
  });

  it("rejects invalid Gemma output and requeues a running draft when its runner is revoked", async () => {
    const project = await createProject("Script recovery");
    const created = await result<{ videoScriptDraft: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.project.id,
        mode: "tighten",
        sourceScript: "I think, maybe, we should keep following the signal through this difficult night.",
        sceneDirection: "One person speaks.",
        videoDurationSeconds: 10,
        idempotencyKey: "video_script_recovery_001",
      }),
    }), env));
    const runner = await enrollRunner("Recovery runner");
    await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.11.0", comfyUrl: "http://127.0.0.1:8188", modelTrainingProviders: [] }),
    }), env));

    const invalid = await routeCreativeStudioApi(request(`/api/creative-studio/runner/video-scripts/${created.videoScriptDraft.id}/complete`, {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({
        output: JSON.stringify({ schemaVersion: "creative-studio-video-script-output/1.0", spokenText: "Too short." }),
        comfyPromptId: "comfy-invalid",
      }),
    }), env);
    expect(invalid.status).toBe(400);

    await result(await routeCreativeStudioApi(request(`/api/creative-studio/runners/${runner.runner.id}/revoke`, { method: "POST" }), env));
    expect(await videoScriptDraftById(env, "development-angelo", created.videoScriptDraft.id))
      .toMatchObject({ status: "waiting-for-runner", progress: 0, runnerId: null });
  });
});
