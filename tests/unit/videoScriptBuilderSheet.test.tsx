import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoScriptDraft } from "../../shared/contracts";
import { VideoScriptBuilderSheet } from "../../src/features/generation/VideoScriptBuilderSheet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const completedDraft: VideoScriptDraft = {
  id: "videoscript_test",
  projectId: "project_test",
  status: "completed",
  progress: 100,
  mode: "build",
  seedPhrases: ["we kept the signal alive"],
  sourceScript: null,
  sceneDirection: "One person speaks beneath a damaged transmitter.",
  videoDurationSeconds: 10,
  generatedScript: "We kept the signal alive through midnight.",
  currentScript: "We kept the signal alive through midnight.",
  editRevision: 0,
  provider: "local-comfyui",
  model: "gemma4_e4b_it_fp8_scaled.safetensors",
  comfyPromptId: "comfy_script_test",
  runnerId: "runner_test",
  error: null,
  createdAt: "2026-08-28T12:00:00.000Z",
  updatedAt: "2026-08-28T12:01:00.000Z",
  startedAt: "2026-08-28T12:00:10.000Z",
  completedAt: "2026-08-28T12:01:00.000Z",
};

let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Video Script Builder sheet", () => {
  it("keeps the proposal editor and focus stable while the owner replaces Gemma's draft", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function Harness() {
      const [open, setOpen] = useState(false);
      const [proposal, setProposal] = useState(completedDraft.currentScript ?? "");
      return <>
        <button type="button" onClick={() => setOpen(true)}>Help me write</button>
        <VideoScriptBuilderSheet
          open={open}
          duration={10}
          seedIdeas="we kept the signal alive"
          proposal={proposal}
          ownerScript="My current words."
          draft={completedDraft}
          available
          busy={false}
          error=""
          onClose={() => setOpen(false)}
          onSeedIdeasChange={vi.fn()}
          onProposalChange={setProposal}
          onBuild={vi.fn()}
          onTighten={vi.fn()}
          onUse={vi.fn()}
        />
      </>;
    }

    await act(async () => root?.render(<Harness />));
    const trigger = document.querySelector<HTMLButtonElement>("button");
    expect(trigger).not.toBeNull();
    trigger?.focus();
    await act(async () => trigger?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const proposal = document.querySelector<HTMLTextAreaElement>(".video-script-proposal textarea");
    expect(proposal).not.toBeNull();
    proposal?.focus();
    await act(async () => setTextareaValue(proposal!, "We carried the signal safely through midnight."));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.activeElement).toBe(proposal);

    await act(async () => setTextareaValue(proposal!, ""));
    expect(document.body.contains(proposal)).toBe(true);
    expect(document.activeElement).toBe(proposal);

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
