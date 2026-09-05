// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { inspectWorkflowGraph, primaryWorkflowPromptParameter } from "../../shared/contracts/workflows";

it("keeps local song caption and lyrics separate with an actual audio output", () => {
  const graph = JSON.parse(readFileSync(new URL("../../runner/workflows/minimax-music3-local.json", import.meta.url), "utf8"));
  const inspection = inspectWorkflowGraph(graph);
  expect(["audio", "music"]).toContain(inspection.modality);
  expect(primaryWorkflowPromptParameter(inspection.parameters, inspection.modality)?.binding).toMatchObject({ nodeId: "4", inputName: "caption" });
  expect(inspection.parameters.some((parameter) => parameter.promptRole === "lyrics" && parameter.binding.format === "comfyui-api" && parameter.binding.inputName === "lyrics")).toBe(true);
  expect(graph["8"].class_type).toBe("SaveAudio");
  expect(Object.values(graph).every((node) => !(node as { class_type: string }).class_type.includes("Api"))).toBe(true);
});
