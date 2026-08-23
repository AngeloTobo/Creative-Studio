import {
  applyWorkflowValues,
  inspectWorkflowGraph,
  type SaveWorkflowRevisionRequest,
  type WorkflowDefinition,
  type WorkflowRevision,
} from "../shared/contracts";
import { boundedText, id } from "./lib/http";
import { projectById } from "./repository";
import type { Env } from "./types";

export const MAX_WORKFLOW_BYTES = 1024 * 1024;

type WorkflowRow = {
  id: string;
  projectId: string;
  name: string;
  description: string;
  sourceFileName: string;
  modality: WorkflowDefinition["modality"];
  executionState: WorkflowDefinition["executionState"];
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
};

type RevisionRow = {
  id: string;
  workflowId: string;
  version: number;
  parentRevisionId: string | null;
  format: WorkflowRevision["format"];
  contentHash: string;
  graphJson: string;
  nodeCount: number;
  parametersJson: string;
  modelsJson: string;
  createdAt: string;
};

const WORKFLOW_COLUMNS = `id, project_id as projectId, name, description, source_file_name as sourceFileName,
  modality, execution_state as executionState, current_revision_id as currentRevisionId,
  created_at as createdAt, updated_at as updatedAt`;

const REVISION_COLUMNS = `id, workflow_id as workflowId, version, parent_revision_id as parentRevisionId,
  format, content_hash as contentHash, graph_json as graphJson, node_count as nodeCount,
  parameters_json as parametersJson, models_json as modelsJson, created_at as createdAt`;

function parseRevision(row: RevisionRow): WorkflowRevision {
  return {
    id: row.id,
    workflowId: row.workflowId,
    version: Number(row.version),
    parentRevisionId: row.parentRevisionId,
    format: row.format,
    contentHash: row.contentHash,
    nodeCount: Number(row.nodeCount),
    parameters: JSON.parse(row.parametersJson) as WorkflowRevision["parameters"],
    models: JSON.parse(row.modelsJson) as string[],
    createdAt: row.createdAt,
  };
}

async function digest(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeFileName(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return boundedText(leaf, 180);
}

function decodedHeader(request: Request, name: string) {
  try { return decodeURIComponent(request.headers.get(name) ?? ""); } catch { throw new Error("invalid_workflow_headers"); }
}

async function definitionFromRow(env: Env, ownerId: string, row: WorkflowRow) {
  const revision = await env.DB.prepare(`select ${REVISION_COLUMNS} from creative_workflow_revisions where id = ? and workflow_id = ? and owner_id = ?`)
    .bind(row.currentRevisionId, row.id, ownerId).first<RevisionRow>();
  if (!revision) throw new Error("workflow_revision_not_found");
  return { ...row, currentRevision: parseRevision(revision) } satisfies WorkflowDefinition;
}

export async function listWorkflows(env: Env, ownerId: string): Promise<WorkflowDefinition[]> {
  const result = await env.DB.prepare(`select ${WORKFLOW_COLUMNS} from creative_workflows where owner_id = ? order by updated_at desc limit 100`)
    .bind(ownerId).all<WorkflowRow>();
  return Promise.all((result.results ?? []).map((row) => definitionFromRow(env, ownerId, row)));
}

export async function importWorkflow(env: Env, request: Request, ownerId: string) {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/json")) throw new Error("unsupported_workflow_type");
  const projectId = boundedText(request.headers.get("x-cs-project-id"), 80);
  const sourceFileName = safeFileName(decodedHeader(request, "x-cs-file-name"));
  const requestedName = boundedText(decodedHeader(request, "x-cs-workflow-name"), 120);
  const description = boundedText(decodedHeader(request, "x-cs-workflow-description"), 500);
  const claimedSize = Number(request.headers.get("x-cs-file-size"));
  if (!projectId || !sourceFileName || !Number.isInteger(claimedSize)) throw new Error("invalid_workflow_headers");
  if (claimedSize <= 0) throw new Error("empty_workflow_upload");
  if (claimedSize > MAX_WORKFLOW_BYTES) throw new Error("workflow_upload_too_large");
  const project = await projectById(env, ownerId, projectId);
  if (!project) throw new Error("project_not_found");
  if (project.status === "archived") throw new Error("project_archived");
  const graphJson = await request.text();
  if (new TextEncoder().encode(graphJson).byteLength !== claimedSize) throw new Error("workflow_upload_size_mismatch");
  let graph: unknown;
  try { graph = JSON.parse(graphJson); } catch { throw new Error("invalid_workflow_json"); }
  const inspection = inspectWorkflowGraph(graph);
  const now = new Date().toISOString();
  const workflowId = id("workflow");
  const revisionId = id("workflowrev");
  const workflowName = requestedName || boundedText(sourceFileName.replace(/\.json$/i, ""), 120) || "ComfyUI workflow";
  const contentHash = await digest(graphJson);
  const executionState = inspection.format === "comfyui-api" ? "ready" : "api-export-required";
  await env.DB.batch([
    env.DB.prepare(`insert into creative_workflows (
      id, owner_id, project_id, name, description, source_file_name, modality, execution_state,
      current_revision_id, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(workflowId, ownerId, projectId, workflowName, description, sourceFileName, inspection.modality,
        executionState, revisionId, now, now),
    env.DB.prepare(`insert into creative_workflow_revisions (
      id, owner_id, workflow_id, version, parent_revision_id, format, content_hash, graph_json,
      node_count, parameters_json, models_json, created_at
    ) values (?, ?, ?, 1, null, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(revisionId, ownerId, workflowId, inspection.format, contentHash, graphJson,
        inspection.nodeCount, JSON.stringify(inspection.parameters), JSON.stringify(inspection.models), now),
  ]);
  return definitionFromRow(env, ownerId, {
    id: workflowId, projectId, name: workflowName, description, sourceFileName, modality: inspection.modality,
    executionState, currentRevisionId: revisionId, createdAt: now, updatedAt: now,
  });
}

async function ownedRevision(env: Env, ownerId: string, workflowId: string, revisionId: string) {
  return env.DB.prepare(`select ${REVISION_COLUMNS} from creative_workflow_revisions where id = ? and workflow_id = ? and owner_id = ?`)
    .bind(revisionId, workflowId, ownerId).first<RevisionRow>();
}

export async function workflowExecutionPlan(env: Env, ownerId: string, workflowId: string, revisionId: string) {
  const row = await env.DB.prepare(`select ${WORKFLOW_COLUMNS} from creative_workflows where id = ? and owner_id = ?`)
    .bind(workflowId, ownerId).first<WorkflowRow>();
  if (!row) throw new Error("workflow_not_found");
  const revisionRow = await ownedRevision(env, ownerId, workflowId, revisionId);
  if (!revisionRow) throw new Error("workflow_revision_not_found");
  const revision = parseRevision(revisionRow);
  if (revision.format !== "comfyui-api") throw new Error("workflow_api_export_required");
  let graph: unknown;
  try { graph = JSON.parse(revisionRow.graphJson); } catch { throw new Error("invalid_workflow_json"); }
  return {
    workflow: { ...row, currentRevision: revision } satisfies WorkflowDefinition,
    graph,
  };
}

export async function createWorkflowRevision(env: Env, ownerId: string, workflowId: string, input: SaveWorkflowRevisionRequest) {
  const workflow = await env.DB.prepare(`select ${WORKFLOW_COLUMNS} from creative_workflows where id = ? and owner_id = ?`)
    .bind(workflowId, ownerId).first<WorkflowRow>();
  if (!workflow) throw new Error("workflow_not_found");
  const base = await ownedRevision(env, ownerId, workflowId, boundedText(input.baseRevisionId, 100));
  if (!base) throw new Error("workflow_revision_not_found");
  let graph: unknown;
  try { graph = JSON.parse(base.graphJson); } catch { throw new Error("invalid_workflow_json"); }
  const parameters = parseRevision(base).parameters;
  const updated = applyWorkflowValues(graph, parameters, input.values ?? {});
  const graphJson = JSON.stringify(updated);
  const inspection = inspectWorkflowGraph(updated);
  const contentHash = await digest(graphJson);
  if (contentHash === base.contentHash) throw new Error("workflow_revision_unchanged");
  const latest = await env.DB.prepare("select max(version) as version from creative_workflow_revisions where workflow_id = ? and owner_id = ?")
    .bind(workflowId, ownerId).first<{ version: number | null }>();
  const version = Number(latest?.version ?? 0) + 1;
  const revisionId = id("workflowrev");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`insert into creative_workflow_revisions (
      id, owner_id, workflow_id, version, parent_revision_id, format, content_hash, graph_json,
      node_count, parameters_json, models_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(revisionId, ownerId, workflowId, version, base.id, inspection.format, contentHash, graphJson,
        inspection.nodeCount, JSON.stringify(inspection.parameters), JSON.stringify(inspection.models), now),
    env.DB.prepare("update creative_workflows set current_revision_id = ?, modality = ?, execution_state = ?, updated_at = ? where id = ? and owner_id = ?")
      .bind(revisionId, inspection.modality, inspection.format === "comfyui-api" ? "ready" : "api-export-required", now, workflowId, ownerId),
  ]);
  return definitionFromRow(env, ownerId, {
    ...workflow,
    modality: inspection.modality,
    executionState: inspection.format === "comfyui-api" ? "ready" : "api-export-required",
    currentRevisionId: revisionId,
    updatedAt: now,
  });
}

export async function workflowContent(env: Env, ownerId: string, workflowId: string, requestedRevisionId: string | null) {
  const workflow = await env.DB.prepare(`select ${WORKFLOW_COLUMNS} from creative_workflows where id = ? and owner_id = ?`)
    .bind(workflowId, ownerId).first<WorkflowRow>();
  if (!workflow) throw new Error("workflow_not_found");
  const revisionId = boundedText(requestedRevisionId, 100) || workflow.currentRevisionId;
  const revision = await ownedRevision(env, ownerId, workflowId, revisionId);
  if (!revision) throw new Error("workflow_revision_not_found");
  const leaf = workflow.sourceFileName.replace(/\.json$/i, "");
  return new Response(revision.graphJson, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${leaf}-v${revision.version}.json`)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-creative-studio-workflow-hash": revision.contentHash,
    },
  });
}
