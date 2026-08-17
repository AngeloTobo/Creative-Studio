import { buildGemmaDescriptionGraph, findComfyTextOutput } from "../runner/index.mjs";

const [kind, filename, ...labelParts] = process.argv.slice(2);
if (!kind || !filename || !["image", "audio", "video"].includes(kind)) {
  process.stderr.write("Usage: node scripts/probe-gemma-description.mjs <image|audio|video> <Comfy input filename> [label]\n");
  process.exitCode = 2;
} else {
  const comfyUrl = String(process.env.CS_COMFY_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");
  const graph = buildGemmaDescriptionGraph(kind, filename, labelParts.join(" ") || filename);
  const submitted = await fetch(`${comfyUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "creative-studio-gemma-probe" }),
  });
  const payload = await submitted.json().catch(() => ({}));
  if (!submitted.ok || !payload.prompt_id) throw new Error(`Gemma probe submission failed: ${JSON.stringify(payload)}`);
  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    const response = await fetch(`${comfyUrl}/history/${encodeURIComponent(payload.prompt_id)}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Gemma probe history failed: ${response.status}`);
    const history = await response.json();
    const entry = history[payload.prompt_id];
    if (entry?.status?.status_str === "error") throw new Error(`Gemma probe execution failed: ${JSON.stringify(entry.status.messages || [])}`);
    const text = findComfyTextOutput(entry, graph);
    if (text) {
      process.stdout.write(`${JSON.stringify({ promptId: payload.prompt_id, kind, model: graph["3"].inputs.clip_name, text }, null, 2)}\n`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (Date.now() - started >= 15 * 60_000) throw new Error("Gemma probe timed out.");
}
