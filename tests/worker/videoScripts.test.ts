import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { compileVideoPromptWithSpeech } from "../../shared/contracts";
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

async function importVideoWorkflow(projectId: string, name = "MiniMax H3 T2V", duration = 10) {
  const graph = {
    "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "A figure poses in a fashion studio." }, _meta: { title: "Positive Prompt" } },
    "2": { class_type: "MiniMaxH3T2V", inputs: { prompt: ["1", 0], duration } },
    "3": { class_type: "SaveVideo", inputs: { video: ["2", 0] } },
  };
  const graphText = JSON.stringify(graph);
  return result<{ workflow: { id: string; currentRevision: { id: string; version: number } } }>(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cs-project-id": projectId,
      "x-cs-file-name": encodeURIComponent("minimax-h3-t2v-api.json"),
      "x-cs-file-size": String(new TextEncoder().encode(graphText).byteLength),
      "x-cs-workflow-name": encodeURIComponent(name),
    },
    body: graphText,
  }), env));
}

async function importImageVideoWorkflow(projectId: string) {
  const graph = {
    "1": { class_type: "LoadImage", inputs: { image: "source.png" } },
    "2": { class_type: "PrimitiveStringMultiline", inputs: { value: "A figure poses in a fashion studio." }, _meta: { title: "Positive Prompt" } },
    "3": { class_type: "MiniMaxH3I2V", inputs: { prompt: ["2", 0], image: ["1", 0], duration: 10 } },
    "4": { class_type: "SaveVideo", inputs: { video: ["3", 0] } },
  };
  const graphText = JSON.stringify(graph);
  return result<{ workflow: { id: string; currentRevision: { id: string } } }>(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cs-project-id": projectId,
      "x-cs-file-name": encodeURIComponent("minimax-h3-i2v-api.json"),
      "x-cs-file-size": String(new TextEncoder().encode(graphText).byteLength),
      "x-cs-workflow-name": encodeURIComponent("MiniMax H3 I2V"),
    },
    body: graphText,
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

const fullTimeline = "SHOT 1 (0.00-3.00 seconds): In a white fashion studio, the subject turns one shoulder toward the key light while fabric drifts behind them. The camera begins a slow waist-high push, preserving the clean background and long floor shadow.\nSHOT 2 (3.00-7.00 seconds): They cross the set with a measured step as the lens pans beside them; reflected silver light travels over the jacket and the surrounding curtains move gently.\nSHOT 3 (7.00-10.00 seconds): The camera settles into a close-up as they hold a final pose, the studio glow softens, and the frame becomes still.\nAudio: soft room tone, fabric movement, restrained footsteps, a quiet shutter click, and low ambient music without dialogue.";

describe("durable video Script Builder", () => {
  it("uses an owner-library workflow across projects and stamps exact owner/job lineage", async () => {
    const workflowProject = await createProject("Reusable Video Models");
    const project = await createProject("Full Script Lab");
    const imported = await importVideoWorkflow(workflowProject.project.id);
    const created = await result<{ videoScriptDraft: {
      id: string;
      projectId: string;
      status: string;
      scriptFormat: string;
      seedPhrases: string[];
      workflowRevisionId: string;
      promptProfile: { id: string; outputFormat: string; minimumWords: number; maximumWords: number };
    } }>(await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scriptFormat: "full-script-v2",
        projectId: project.project.id,
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        mode: "build",
        seedPhrases: ["They are posing for a fashion shoot"],
        sceneDirection: "A decisive editorial portrait in a white studio. No dialogue.",
        inputMode: "text-to-video",
        sourceId: null,
        videoDurationSeconds: 10,
        idempotencyKey: "full_video_script_lifecycle_001",
      }),
    }), env));
    expect(created.videoScriptDraft).toMatchObject({
      projectId: project.project.id,
      status: "waiting-for-runner",
      scriptFormat: "full-script-v2",
      seedPhrases: ["They are posing for a fashion shoot"],
      workflowRevisionId: imported.workflow.currentRevision.id,
      promptProfile: { id: "minimax-h3-i2v-motion/1.0", outputFormat: "minimax-h3-timeline", minimumWords: 60, maximumWords: 180 },
    });

    const runner = await enrollRunner("Full script runner");
    const gated = await result<{ kind: string | null }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.11.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    expect(gated.kind).toBeNull();

    const claimed = await result<{ kind: string; bundle: { videoScriptDraft: { id: string; scriptFormat: string }; source: null } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.12.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    expect(claimed).toMatchObject({ kind: "video-script", bundle: { videoScriptDraft: { id: created.videoScriptDraft.id, scriptFormat: "full-script-v2" }, source: null } });

    const completed = await result<{ videoScriptDraft: {
      status: string; generatedScript: string; currentScript: string; generatedSpokenText: null; currentSpokenText: null; editRevision: number;
    } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/video-scripts/${created.videoScriptDraft.id}/complete`, {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({
        output: JSON.stringify({ schemaVersion: "creative-studio-video-script-output/2.0", fullScript: fullTimeline, spokenText: null }),
        comfyPromptId: "comfy-full-video-script-001",
      }),
    }), env));
    expect(completed.videoScriptDraft).toMatchObject({
      status: "completed", generatedScript: fullTimeline, currentScript: fullTimeline,
      generatedSpokenText: null, currentSpokenText: null, editRevision: 0,
    });

    const edited = await result<{ videoScriptDraft: { currentScript: string; currentSpokenText: string; editRevision: number } }>(await routeCreativeStudioApi(request(`/api/creative-studio/video-scripts/${created.videoScriptDraft.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scriptFormat: "full-script-v2", currentScript: fullTimeline, currentSpokenText: "Pose.", expectedRevision: 0 }),
    }), env));
    expect(edited.videoScriptDraft).toMatchObject({ currentScript: fullTimeline, currentSpokenText: "Pose.", editRevision: 1 });

    const profile = { id: "minimax-h3-i2v-motion/1.0" as const, label: "MiniMax H3 I2VA motion direction", targetModel: "MiniMax H3",
      outputFormat: "minimax-h3-timeline" as const, minimumWords: 60, maximumWords: 180 };
    const compiled = compileVideoPromptWithSpeech(fullTimeline, { mode: "exact-script", text: "Pose." }, profile);
    const derivedJobPrompt = compiled.prompt.replace("The camera begins", "The camera unexpectedly begins");
    const stamp = await videoScriptStampForJob(env, "development-angelo", {
      scriptFormat: "full-script-v2",
      requestId: created.videoScriptDraft.id,
      appliedPrompt: fullTimeline,
      appliedSpokenText: "Pose.",
      editRevision: 1,
      projectId: project.project.id,
      videoDurationSeconds: 10,
      videoSpeech: compiled.speech,
      workflowId: imported.workflow.id,
      workflowRevisionId: "workflowrev_generation_variant_001",
      promptProfileId: profile.id,
      promptOutputFormat: profile.outputFormat,
      inputMode: "text-to-video",
      sourceId: null,
      jobPrompt: derivedJobPrompt,
    });
    expect(stamp).toMatchObject({
      schemaVersion: "creative-studio-video-script/2.0",
      scriptFormat: "full-script-v2",
      requestId: created.videoScriptDraft.id,
      generatedScript: fullTimeline,
      generatedSpokenText: null,
      appliedPrompt: fullTimeline,
      appliedSpokenText: "Pose.",
      jobPrompt: derivedJobPrompt,
      editRevision: 1,
      editedAfterGeneration: true,
      workflow: {
        id: imported.workflow.id,
        builderRevisionId: imported.workflow.currentRevision.id,
        generationRevisionId: "workflowrev_generation_variant_001",
      },
      sourceMaterialization: "none",
      promptDerivation: {
        kind: "reviewed-script",
        relation: "substantial-reviewed-overlap",
        reviewedTokenCoverage: expect.any(Number),
        reviewedPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        jobPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    await expect(videoScriptStampForJob(env, "development-angelo", {
      scriptFormat: "full-script-v2",
      requestId: created.videoScriptDraft.id,
      appliedPrompt: fullTimeline,
      appliedSpokenText: "Pose.",
      editRevision: 1,
      projectId: project.project.id,
      videoDurationSeconds: 10,
      videoSpeech: compiled.speech,
      workflowId: imported.workflow.id,
      workflowRevisionId: "workflowrev_generation_variant_002",
      promptProfileId: profile.id,
      promptOutputFormat: profile.outputFormat,
      inputMode: "text-to-video",
      sourceId: null,
      jobPrompt: `A completely unrelated submarine crosses a dark ocean trench. ${compiled.speech.directive}`,
    })).rejects.toThrow("video_script_job_prompt_mismatch");
    const dimensions = { energy: 50, tension: 50, contrast: 50, warmth: 50, spaciousness: 50, rhythmicity: 50, organicity: 50, polish: 50 };
    await expect(videoScriptStampForJob(env, "development-angelo", {
      scriptFormat: "full-script-v2",
      requestId: created.videoScriptDraft.id,
      appliedPrompt: fullTimeline,
      appliedSpokenText: "Pose.",
      editRevision: 1,
      projectId: project.project.id,
      videoDurationSeconds: 10,
      videoSpeech: compiled.speech,
      workflowId: imported.workflow.id,
      workflowRevisionId: "workflowrev_generation_evolution_001",
      promptProfileId: profile.id,
      promptOutputFormat: profile.outputFormat,
      inputMode: "text-to-video",
      sourceId: null,
      jobPrompt: `A completely unrelated submarine crosses a dark ocean trench. ${compiled.speech.directive}`,
      videoVariant: {
        schemaVersion: "creative-studio-video-variant/1.0",
        pairId: "video_pair_evolution-lineage-001",
        role: "aligned",
        seed: null,
        personalStyleWeight: 100,
        randomDnaWeight: 0,
        baseDimensions: dimensions,
        randomDimensions: null,
        effectiveDimensions: dimensions,
      },
      evolution: { studyId: "evolve_lineage-proof-001", role: "refine" },
    })).rejects.toThrow("video_script_job_prompt_mismatch");
    await expect(videoScriptDraftById(env, "different-owner", created.videoScriptDraft.id)).rejects.toThrow("video_script_draft_not_found");
  });

  it("binds the exact owned image into an image-to-video runner bundle", async () => {
    const project = await createProject("Full Script Image Grounding");
    const imported = await importImageVideoWorkflow(project.project.id);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const uploaded = await result<{ asset: { id: string; name: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/media", {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-cs-project-id": project.project.id,
        "x-cs-file-name": encodeURIComponent("fashion-source.png"),
        "x-cs-file-size": String(bytes.byteLength),
        "x-cs-training-eligible": "true",
      },
      body: bytes,
    }), env));
    const created = await result<{ videoScriptDraft: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scriptFormat: "full-script-v2",
        projectId: project.project.id,
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        mode: "build",
        seedPhrases: ["They are posing for a fashion shoot"],
        inputMode: "image-to-video",
        sourceId: uploaded.asset.id,
        videoDurationSeconds: 10,
        idempotencyKey: "full_video_script_image_grounding_001",
      }),
    }), env));
    const runner = await enrollRunner("Image grounded script runner");
    const claimed = await result<{ kind: string; bundle: { videoScriptDraft: { id: string; source: { id: string } }; source: {
      id: string; projectId: string; kind: string; source: string; originalFileName: string; mimeType: string; size: number;
    } } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.12.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    expect(claimed).toMatchObject({
      kind: "video-script",
      bundle: {
        videoScriptDraft: { id: created.videoScriptDraft.id, source: { id: uploaded.asset.id } },
        source: {
          id: uploaded.asset.id,
          projectId: project.project.id,
          kind: "image",
          source: "upload",
          originalFileName: "fashion-source.png",
          mimeType: "image/png",
          size: bytes.byteLength,
        },
      },
    });
  });

  it("reuses an origin-project image workflow without crossing the active project's media boundary", async () => {
    const workflowProject = await createProject("Script Model Origin");
    const activeProject = await createProject("Active Script Project");
    const imported = await importImageVideoWorkflow(workflowProject.project.id);
    const uploadImage = async (projectId: string, fileName: string) => {
      const bytes = new Uint8Array([137, 80, 78, 71]);
      return result<{ asset: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/media", {
        method: "POST",
        headers: {
          "content-type": "image/png",
          "x-cs-project-id": projectId,
          "x-cs-file-name": encodeURIComponent(fileName),
          "x-cs-file-size": String(bytes.byteLength),
          "x-cs-training-eligible": "false",
        },
        body: bytes,
      }), env));
    };
    const activeSource = await uploadImage(activeProject.project.id, "active-script-source.png");
    const originSource = await uploadImage(workflowProject.project.id, "origin-script-source.png");
    const scriptInput = (sourceId: string, idempotencyKey: string) => ({
      scriptFormat: "full-script-v2",
      projectId: activeProject.project.id,
      workflowId: imported.workflow.id,
      workflowRevisionId: imported.workflow.currentRevision.id,
      mode: "build",
      seedPhrases: ["They cross a violet fashion set"],
      sceneDirection: "A precise editorial walk with no dialogue.",
      inputMode: "image-to-video",
      sourceId,
      videoDurationSeconds: 10,
      idempotencyKey,
    });

    const accepted = await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scriptInput(activeSource.asset.id, "script_active_source_001")),
    }), env);
    expect(accepted.status).toBe(202);
    const acceptedPayload = await accepted.json() as {
      ok: boolean;
      videoScriptDraft: { id: string; projectId: string; workflowId: string; source: { id: string } };
    };
    expect(acceptedPayload).toMatchObject({
      ok: true,
      videoScriptDraft: {
        projectId: activeProject.project.id,
        workflowId: imported.workflow.id,
        source: { id: activeSource.asset.id },
      },
    });

    const rejected = await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scriptInput(originSource.asset.id, "script_origin_source_001")),
    }), env);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({ ok: false, error: "video_script_source_project_mismatch" });

    const runner = await enrollRunner("Cross-project source runner");
    const claimed = await result<{ kind: string; bundle: { videoScriptDraft: { id: string }; source: { id: string; projectId: string } } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ version: "1.12.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    expect(claimed).toMatchObject({
      kind: "video-script",
      bundle: {
        videoScriptDraft: { id: acceptedPayload.videoScriptDraft.id },
        source: { id: activeSource.asset.id, projectId: activeProject.project.id },
      },
    });
    await result(await routeCreativeStudioApi(request(`/api/creative-studio/runner/video-scripts/${acceptedPayload.videoScriptDraft.id}/fail`, {
      method: "POST",
      headers: runner.headers,
      body: JSON.stringify({ error: "cross_project_source_boundary_test_complete" }),
    }), env));
  });

  it("authoritatively rejects wrong workflow duration/source context and invented dialogue", async () => {
    const project = await createProject("Script validation");
    const imported = await importVideoWorkflow(project.project.id);
    const wrongDuration = await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scriptFormat: "full-script-v2", projectId: project.project.id, workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id, mode: "build", seedPhrases: ["fashion pose"],
        inputMode: "text-to-video", sourceId: null, videoDurationSeconds: 5, idempotencyKey: "full_script_wrong_duration_001",
      }),
    }), env);
    expect(wrongDuration.status).toBe(400);

    const unexpectedSource = await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scriptFormat: "full-script-v2", projectId: project.project.id, workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id, mode: "build", seedPhrases: ["fashion pose"],
        inputMode: "text-to-video", sourceId: "media_should_not_be_here", videoDurationSeconds: 10,
        idempotencyKey: "full_script_wrong_source_001",
      }),
    }), env);
    expect(unexpectedSource.status).toBe(400);

    const created = await result<{ videoScriptDraft: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/video-scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scriptFormat: "full-script-v2", projectId: project.project.id, workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id, mode: "build", seedPhrases: ["fashion pose"],
        sceneDirection: "No dialogue", inputMode: "text-to-video", sourceId: null, videoDurationSeconds: 10,
        idempotencyKey: "full_script_invented_dialogue_001",
      }),
    }), env));
    const runner = await enrollRunner("Validation runner");
    await result(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST", headers: runner.headers,
      body: JSON.stringify({ version: "1.12.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    const invalid = await routeCreativeStudioApi(request(`/api/creative-studio/runner/video-scripts/${created.videoScriptDraft.id}/complete`, {
      method: "POST", headers: runner.headers,
      body: JSON.stringify({
        output: JSON.stringify({ schemaVersion: "creative-studio-video-script-output/2.0", fullScript: fullTimeline, spokenText: "Smile." }),
        comfyPromptId: "comfy-invented-dialogue",
      }),
    }), env);
    expect(invalid.status).toBe(400);

    await result(await routeCreativeStudioApi(request(`/api/creative-studio/runners/${runner.runner.id}/revoke`, { method: "POST" }), env));
    expect(await videoScriptDraftById(env, "development-angelo", created.videoScriptDraft.id))
      .toMatchObject({ status: "waiting-for-runner", progress: 0, runnerId: null });
  });

  it("preserves and runs a legacy dialogue-v1 row on Runner 1.11", async () => {
    const project = await createProject("Legacy dialogue");
    const now = new Date().toISOString();
    const draftId = "videoscript_legacy_dialogue_001";
    await env.DB.prepare(`insert into creative_video_script_drafts
      (id, owner_id, project_id, status, progress, mode, seed_phrases_json, source_script, scene_direction,
        video_duration_seconds, generated_script, current_script, edit_revision, provider, model, comfy_prompt_id,
        runner_id, runner_lease_until, error, idempotency_key, created_at, updated_at, started_at, completed_at)
      values (?, 'development-angelo', ?, 'waiting-for-runner', 0, 'build', ?, null, ?, 10, null, null, 0,
        'local-comfyui', null, null, null, null, null, ?, ?, ?, null, null)`)
      .bind(draftId, project.project.id, JSON.stringify(["keep the signal alive"]), "One person speaks.",
        "legacy_dialogue_row_001", now, now).run();

    expect(await videoScriptDraftById(env, "development-angelo", draftId)).toMatchObject({ scriptFormat: "dialogue-v1" });
    const runner = await enrollRunner("Legacy script runner");
    const claimed = await result<{ kind: string; bundle: { videoScriptDraft: { id: string; scriptFormat: string } } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST", headers: runner.headers,
      body: JSON.stringify({ version: "1.11.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    expect(claimed).toMatchObject({ kind: "video-script", bundle: { videoScriptDraft: { id: draftId, scriptFormat: "dialogue-v1" } } });

    const generated = "We kept the signal alive through midnight.";
    await result(await routeCreativeStudioApi(request(`/api/creative-studio/runner/video-scripts/${draftId}/complete`, {
      method: "POST", headers: runner.headers,
      body: JSON.stringify({
        output: JSON.stringify({ schemaVersion: "creative-studio-video-script-output/1.0", spokenText: generated }),
        comfyPromptId: "comfy-legacy-script-001",
      }),
    }), env));
    const editedScript = "We carried the signal safely through midnight.";
    await result(await routeCreativeStudioApi(request(`/api/creative-studio/video-scripts/${draftId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scriptFormat: "dialogue-v1", currentScript: editedScript, expectedRevision: 0 }),
    }), env));
    const compiled = compileVideoPromptWithSpeech("The speaker turns toward the transmitter.", {
      mode: "exact-script", text: editedScript,
    }, { outputFormat: "natural-language" });
    const stamp = await videoScriptStampForJob(env, "development-angelo", {
      scriptFormat: "dialogue-v1", requestId: draftId, appliedScript: editedScript, editRevision: 1,
      projectId: project.project.id, videoDurationSeconds: 10, videoSpeech: compiled.speech,
    });
    expect(stamp).toMatchObject({ schemaVersion: "creative-studio-video-script/1.0", scriptFormat: "dialogue-v1", appliedScript: editedScript });
  });
});
