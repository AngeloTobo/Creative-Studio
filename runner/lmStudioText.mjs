export function lmStudioTextConfiguration(environment = process.env) {
  const model = String(environment.CS_LM_STUDIO_MODEL || "").trim();
  if (!model) return null;
  if (model.length > 160 || /[\r\n]/.test(model)) throw new Error("lmstudio_model_invalid");
  const url = new URL(environment.CS_LM_STUDIO_URL || "http://127.0.0.1:1234");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("lmstudio_loopback_url_required");
  return { model, baseUrl: url.origin };
}
export function canUseLmStudioForEnhancement(bundle) {
  return bundle.promptEnhancement?.inputMode === "text-to-video" && !bundle.source;
}
export async function lmStudioEnhanceText(configuration, prompt, request = fetch, onRequest = () => {}) {
  const modelsResponse = await request(`${configuration.baseUrl}/api/v1/models`, { signal: AbortSignal.timeout(5000), redirect: "error" });
  if (!modelsResponse.ok) throw new Error(`lmstudio_models_unavailable:${modelsResponse.status}`);
  const models = await modelsResponse.json();
  if (!models.models?.some((model) => model.type === "llm" && model.loaded_instances?.some((instance) => instance.id === configuration.model))) throw new Error("lmstudio_configured_model_not_loaded");
  onRequest();
  const response = await request(`${configuration.baseUrl}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model: configuration.model, messages: [{ role: "user", content: String(prompt).slice(0, 16000) }], max_tokens: 768, temperature: 0.55, stream: false }),
  });
  if (!response.ok) throw new Error(`lmstudio_completion_failed:${response.status}`);
  const result = await response.json();
  const output = result.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim() || output.length > 12000 || result.choices?.[0]?.finish_reason === "length") throw new Error("lmstudio_completion_invalid_or_truncated");
  return { text: output.trim(), model: `lm-studio:${configuration.model}` };
}
