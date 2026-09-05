/** Resolve canonical stored LoRA paths to ComfyUI's platform-specific enum values. */
export async function resolveComfyLoraNames(config, graphValue, request = fetch) {
  const nodes = Object.values(graphValue).filter((node) => typeof node?.inputs?.lora_name === "string");
  if (!nodes.length) return graphValue;
  const graph = structuredClone(graphValue);
  const contracts = new Map();
  for (const node of Object.values(graph)) {
    if (typeof node?.inputs?.lora_name !== "string") continue;
    if (!contracts.has(node.class_type)) {
      const response = await request(`${config.comfyUrl}/object_info/${encodeURIComponent(node.class_type)}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`comfy_lora_contract_unavailable:${node.class_type}`);
      contracts.set(node.class_type, (await response.json())[node.class_type]);
    }
    const field = contracts.get(node.class_type)?.input?.required?.lora_name;
    const values = Array.isArray(field?.[0]) ? field[0] : field?.[1]?.options;
    if (!Array.isArray(values)) throw new Error(`comfy_lora_contract_invalid:${node.class_type}`);
    const canonical = node.inputs.lora_name.replaceAll("\\", "/");
    const matches = values.filter((value) => typeof value === "string" && value.replaceAll("\\", "/") === canonical);
    if (matches.length !== 1) throw new Error(`comfy_lora_file_missing_or_ambiguous:${canonical}`);
    node.inputs.lora_name = matches[0];
  }
  return graph;
}
