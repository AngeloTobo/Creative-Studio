import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Directly exercise local runner JavaScript.
import { lmStudioTextConfiguration, canUseLmStudioForEnhancement, lmStudioEnhanceText } from "../../runner/lmStudioText.mjs";
// @ts-expect-error Directly exercise local runner JavaScript.
import { resolveComfyLoraNames } from "../../runner/comfyLoraNames.mjs";

describe("optional local text helper", () => {
  it("is opt-in and limits endpoints to loopback without credentials or redirects", () => {
    expect(lmStudioTextConfiguration({})).toBeNull();
    expect(() => lmStudioTextConfiguration({ CS_LM_STUDIO_MODEL: "my-model", CS_LM_STUDIO_URL: "https://example.com" })).toThrow("lmstudio_loopback_url_required");
    expect(() => lmStudioTextConfiguration({ CS_LM_STUDIO_MODEL: "my-model", CS_LM_STUDIO_URL: "http://secret@127.0.0.1:1234" })).toThrow("lmstudio_loopback_url_required");
    expect(canUseLmStudioForEnhancement({ promptEnhancement: { inputMode: "image-to-video" }, source: { id: "image" } })).toBe(false);
  });
  it("does not invoke chat or load a model when the configured instance is not resident", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ models: [{ type: "llm", key: "my-model", loaded_instances: [] }] }));
    await expect(lmStudioEnhanceText({ baseUrl: "http://127.0.0.1:1234", model: "my-model" }, "prompt", request)).rejects.toThrow("lmstudio_configured_model_not_loaded");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("records actual LM identity, bounds completion, and fails clearly without a silent fallback", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ models: [{ type: "llm", loaded_instances: [{ id: "resident" }] }] })).mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "A leaf turns slowly in a pool of light." }, finish_reason: "stop" }] }));
    const result = await lmStudioEnhanceText({ baseUrl: "http://127.0.0.1:1234", model: "resident" }, "prompt", request);
    expect(result.model).toBe("lm-studio:resident");
    const options = request.mock.calls[1][1];
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toMatchObject({ model: "resident", max_tokens: 768, stream: false });
  });
});
describe("Comfy LoRA filename enums", () => {
  it("uses the exact observed Windows filename without mutating provenance or the original graph", async () => {
    const path = "creative-studio/modeltrain_123/adapter_model.safetensors";
    const graph = { "1": { class_type: "LoraLoader", inputs: { lora_name: path } } };
    const request = vi.fn().mockResolvedValue(Response.json({ LoraLoader: { input: { required: { lora_name: [[path.replaceAll("/", "\\")]] } } } }));
    const resolved = await resolveComfyLoraNames({ comfyUrl: "http://127.0.0.1:8188" }, graph, request);
    expect(resolved["1"].inputs.lora_name).toBe(path.replaceAll("/", "\\"));
    expect(graph["1"].inputs.lora_name).toBe(path);
  });
  it("rejects missing checkpoints before prompt submission", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ LoraLoader: { input: { required: { lora_name: [["other.safetensors"]] } } } }));
    await expect(resolveComfyLoraNames({ comfyUrl: "http://127.0.0.1:8188" }, { "1": { class_type: "LoraLoader", inputs: { lora_name: "missing.safetensors" } } }, request)).rejects.toThrow("comfy_lora_file_missing_or_ambiguous");
  });
});
