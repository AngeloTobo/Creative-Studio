import { imageStyleWorkflowGraph } from "../shared/contracts/imageStyleWorkflow";
import type { ModelAdapter } from "../shared/contracts";
import type { Env } from "./types";
import { importWorkflow, listWorkflows } from "./workflows";

export async function ensureImageStyleWorkflow(env: Env, ownerId: string, adapter: ModelAdapter) {
  const sourceFileName = `${adapter.id}-sd15.json`;
  const existing = (await listWorkflows(env, ownerId)).find((workflow) => workflow.projectId === adapter.projectId && workflow.sourceFileName === sourceFileName);
  if (existing) return existing;
  const graph = JSON.stringify(imageStyleWorkflowGraph(adapter.localFile.relativePath, adapter.concept.triggerToken));
  return importWorkflow(env, new Request("http://localhost/api/creative-studio/workflows", { method: "POST", headers: {
    "content-type": "application/json", "x-cs-project-id": adapter.projectId,
    "x-cs-file-name": encodeURIComponent(sourceFileName), "x-cs-workflow-name": encodeURIComponent(`${adapter.name} · SD1.5`),
    "x-cs-workflow-description": encodeURIComponent("Generate with this project's approved image style. Native SD1.5, 512px, 20 steps."),
    "x-cs-file-size": String(new TextEncoder().encode(graph).byteLength),
  }, body: graph }), ownerId);
}
