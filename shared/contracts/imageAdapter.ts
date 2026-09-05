import type { WorkflowDefinition } from "./workflows";

/** Bind only the exact base family trained by the local image trainer. */
export function imageAdapterParameterIds(workflow: WorkflowDefinition): { fileId: string; strengthIds: string[] } | null {
  if (workflow.modality !== "image" || !workflow.currentRevision.models.some((model) =>
    model.replaceAll("\\", "/").split("/").at(-1) === "v1-5-pruned-emaonly-fp16.safetensors")) return null;
  const parameters = workflow.currentRevision.parameters;
  const files = parameters.filter((parameter) => parameter.binding.format === "comfyui-api" && parameter.binding.inputName === "lora_name");
  // Ambiguous chains must be configured deliberately instead of overwriting several adapters.
  if (files.length !== 1 || files[0].binding.format !== "comfyui-api") return null;
  const nodeId = files[0].binding.nodeId;
  const strengths = parameters.filter((parameter) => parameter.binding.format === "comfyui-api"
    && parameter.binding.nodeId === nodeId && ["strength_model", "strength_clip"].includes(parameter.binding.inputName));
  if (!strengths.some((parameter) => parameter.binding.format === "comfyui-api" && parameter.binding.inputName === "strength_model")) return null;
  return { fileId: files[0].id, strengthIds: strengths.map((parameter) => parameter.id) };
}
