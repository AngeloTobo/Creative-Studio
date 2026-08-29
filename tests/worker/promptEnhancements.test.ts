import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { routeCreativeStudioApi } from "../../worker/routes/api";
import { videoPromptEnhancementById, videoPromptEnhancementStampForJob } from "../../worker/promptEnhancements";

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://cs.angelotoborg.com${path}`, init);
}

async function result<T>(response: Response): Promise<T> {
  const payload = await response.json() as { ok: boolean; [key: string]: unknown };
  if (!payload.ok) throw new Error(String(payload.error));
  return payload as unknown as T;
}

const enhancedTimeline = "SHOT 1 (0.00-3.00 seconds): A translucent figure stands beneath a narrow blue light while the camera begins a restrained forward move and fine dust crosses the foreground. SHOT 2 (3.00-7.00 seconds): The figure turns toward a distant pulse, one hand opening as reflected light moves across the surface and the room responds with a slow curtain drift. SHOT 3 (7.00-10.00 seconds): The camera settles close to the profile; the hand closes, the pulse fades, and the last reflection becomes still without changing the location. Audio: soft room tone, a tactile glass movement, distant electrical resonance, and one low musical note that ends with the light.";

describe("durable video prompt enhancement", () => {
  it("creates, claims, completes, stamps, and owner-scopes a Gemma prompt request", async () => {
    const project = await result<{ project: { id: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Prompt Lab", type: "visual" }),
    }), env));

    const graph = {
      "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "A translucent figure turns toward a distant pulse." }, _meta: { title: "Positive Prompt" } },
      "2": { class_type: "MiniMaxH3T2V", inputs: { prompt: ["1", 0], duration: 10 } },
      "3": { class_type: "SaveVideo", inputs: { video: ["2", 0] } },
    };
    const graphText = JSON.stringify(graph);
    const imported = await result<{ workflow: { id: string; currentRevision: { id: string } } }>(await routeCreativeStudioApi(request("/api/creative-studio/workflows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cs-project-id": project.project.id,
        "x-cs-file-name": encodeURIComponent("minimax-h3-t2v-api.json"),
        "x-cs-file-size": String(new TextEncoder().encode(graphText).byteLength),
        "x-cs-workflow-name": encodeURIComponent("MiniMax H3 T2V"),
      },
      body: graphText,
    }), env));

    const created = await result<{ promptEnhancement: { id: string; status: string; outputFormat: string } }>(await routeCreativeStudioApi(request("/api/creative-studio/prompt-enhancements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.project.id,
        workflowId: imported.workflow.id,
        workflowRevisionId: imported.workflow.currentRevision.id,
        sourcePrompt: "A translucent figure turns toward a distant pulse as the room begins to respond.",
        inputMode: "text-to-video",
        sourceId: null,
        videoDurationSeconds: 10,
        idempotencyKey: "prompt_enhance_lifecycle_001",
      }),
    }), env));
    expect(created.promptEnhancement).toMatchObject({ status: "waiting-for-runner", outputFormat: "minimax-h3-timeline" });

    const enrollment = await result<{ token: string }>(await routeCreativeStudioApi(request("/api/creative-studio/runners/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Prompt runner" }),
    }), env));
    const runnerHeaders = { authorization: `Bearer ${enrollment.token}`, "content-type": "application/json" };
    const claimed = await result<{ kind: string; bundle: { promptEnhancement: { id: string }; source: null } }>(await routeCreativeStudioApi(request("/api/creative-studio/runner/work/claim", {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ version: "1.10.0", comfyUrl: "http://127.0.0.1:8188", comfyReady: true, modelTrainingProviders: [] }),
    }), env));
    expect(claimed).toMatchObject({ kind: "prompt-enhancement", bundle: { promptEnhancement: { id: created.promptEnhancement.id }, source: null } });

    const completed = await result<{ promptEnhancement: { status: string; enhancedPrompt: string; comfyPromptId: string; model: string } }>(await routeCreativeStudioApi(request(`/api/creative-studio/runner/prompt-enhancements/${created.promptEnhancement.id}/complete`, {
      method: "POST",
      headers: runnerHeaders,
      body: JSON.stringify({ enhancedPrompt: enhancedTimeline, comfyPromptId: "comfy-video-prompt-001" }),
    }), env));
    expect(completed.promptEnhancement).toMatchObject({
      status: "completed",
      enhancedPrompt: enhancedTimeline,
      comfyPromptId: "comfy-video-prompt-001",
      model: "gemma4_e4b_it_fp8_scaled.safetensors",
    });
    const discoveryPrompt = `${enhancedTimeline} The final camera scale changes once while continuity remains intact.`;
    const stamp = await videoPromptEnhancementStampForJob(env, "development-angelo", {
      requestId: created.promptEnhancement.id,
      basePrompt: enhancedTimeline,
      appliedPrompt: discoveryPrompt,
      projectId: project.project.id,
      workflowId: imported.workflow.id,
      workflowRevisionId: "workflowrev_descendant_not_required_for_provenance",
      promptProfileId: "minimax-h3-i2v-motion/1.0",
      promptOutputFormat: "minimax-h3-timeline",
    });
    expect(stamp).toMatchObject({
      requestId: created.promptEnhancement.id,
      generationWorkflowRevisionId: "workflowrev_descendant_not_required_for_provenance",
      enhancementWorkflowRevisionId: imported.workflow.currentRevision.id,
      basePrompt: enhancedTimeline,
      appliedPrompt: discoveryPrompt,
      editedAfterEnhancement: false,
    });

    const fetched = await result<{
      promptEnhancement: { id: string; status: string };
    }>(await routeCreativeStudioApi(request(`/api/creative-studio/prompt-enhancements/${created.promptEnhancement.id}`), env));
    expect(fetched.promptEnhancement).toEqual(expect.objectContaining({ id: created.promptEnhancement.id, status: "completed" }));
    await expect(videoPromptEnhancementById(env, "different-owner", created.promptEnhancement.id)).rejects.toThrow("prompt_enhancement_not_found");
  });
});
