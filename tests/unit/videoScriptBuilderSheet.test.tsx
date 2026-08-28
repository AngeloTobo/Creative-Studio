import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoScriptDraft } from "../../shared/contracts";
import { VideoScriptBuilderSheet } from "../../src/features/generation/VideoScriptBuilderSheet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const completedDraft = {
  id: "videoscript_test",
  projectId: "project_test",
  status: "completed",
  progress: 100,
  mode: "build",
  scriptFormat: "full-script-v2",
  seedPhrases: ["they are posing for a fashion shoot"],
  sourceScript: null,
  sceneDirection: "They are posing for a fashion shoot.",
  videoDurationSeconds: 10,
  workflowId: "workflow_video_test",
  workflowRevisionId: "workflow_revision_test",
  workflowName: "LTX 2.5 image to video",
  workflowVersion: 4,
  promptProfile: {
    id: "generic-video-motion/1.0",
    label: "General video motion",
    targetModel: "LTX 2.5",
    outputFormat: "natural-language",
    minimumWords: 35,
    maximumWords: 160,
  },
  inputMode: "image-to-video",
  source: null,
  generatedScript: "The models settle into an angular pose beneath a hard white key light. The camera glides from the reflective floor to their faces while fabric lifts in a controlled gust. A flash freezes the final close-up. Sound: shutter clicks, low room tone, and the soft rush of fabric.",
  currentScript: "The models settle into an angular pose beneath a hard white key light. The camera glides from the reflective floor to their faces while fabric lifts in a controlled gust. A flash freezes the final close-up. Sound: shutter clicks, low room tone, and the soft rush of fabric.",
  generatedSpokenText: null,
  currentSpokenText: null,
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
} satisfies VideoScriptDraft;

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

function setInputValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonNamed(name: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim().includes(name));
}

describe("Full Video Script sheet", () => {
  it("keeps the full-script editor stable and makes dialogue explicitly optional", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function Harness() {
      const [open, setOpen] = useState(false);
      const [seedIdeas, setSeedIdeas] = useState("they are posing for a fashion shoot");
      const [proposal, setProposal] = useState(completedDraft.currentScript ?? "");
      const [spokenText, setSpokenText] = useState("");
      return <>
        <button type="button" onClick={() => setOpen(true)}>Help me write</button>
        <VideoScriptBuilderSheet
          open={open}
          duration={10}
          seedIdeas={seedIdeas}
          proposal={proposal}
          proposalSpokenText={spokenText}
          ownerScript=""
          ownerDirection="They pose beneath studio lights."
          draft={completedDraft}
          available
          busy={false}
          error=""
          onClose={() => setOpen(false)}
          onSeedIdeasChange={setSeedIdeas}
          onProposalChange={setProposal}
          onProposalSpokenTextChange={setSpokenText}
          onBuild={vi.fn()}
          onTighten={vi.fn()}
          onUse={vi.fn()}
        />
      </>;
    }

    await act(async () => root?.render(<Harness />));
    const trigger = buttonNamed("Help me write");
    expect(trigger).not.toBeUndefined();
    trigger?.focus();
    await act(async () => trigger?.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Full Video Script");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("10s full scene · dialogue optional");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("No dialogue · sound and ambience stay on");
    const provenance = document.querySelector<HTMLElement>(".video-script-seed-provenance");
    expect(provenance?.textContent).toContain("they are posing for a fashion shoot");
    const nextIdea = document.querySelector<HTMLDetailsElement>("details.video-script-next-idea");
    expect(nextIdea?.hasAttribute("open")).toBe(false);

    const proposal = document.querySelector<HTMLTextAreaElement>(".video-script-proposal textarea");
    expect(proposal).not.toBeNull();
    expect(document.activeElement).toBe(proposal);
    proposal?.focus();
    const edited = "The models pivot together under a strobing white key light.\nThe camera drops to the floor, arcs around their silhouettes, then lands on a composed final close-up. Sound: sharp shutter clicks, a low room pulse, and fabric moving through the air.";
    await act(async () => setTextareaValue(proposal!, edited));
    expect(proposal?.value).toContain("\nThe camera drops");
    expect(document.activeElement).toBe(proposal);

    const dialogue = document.querySelector<HTMLInputElement>(".video-script-dialogue input");
    expect(dialogue).not.toBeNull();
    await act(async () => setInputValue(dialogue!, "Hold that look."));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("3 / 16 spoken words · delivered exactly");
    expect(buttonNamed("Use full script")?.disabled).toBe(false);

    await act(async () => nextIdea?.querySelector("summary")?.click());
    const nextIdeaInput = document.querySelector<HTMLTextAreaElement>(".video-script-next-idea textarea");
    expect(nextIdeaInput).not.toBeNull();
    await act(async () => setTextareaValue(nextIdeaInput!, "They cross a mirrored runway."));
    expect(nextIdeaInput?.value).toBe("They cross a mirrored runway.");
    expect(provenance?.textContent).toContain("they are posing for a fashion shoot");
    expect(provenance?.textContent).not.toContain("mirrored runway");

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("turns one seed phrase into the primary full-script action and offers current-direction polish", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onBuild = vi.fn();
    const onTighten = vi.fn();

    await act(async () => root?.render(<VideoScriptBuilderSheet
      open
      duration={5}
      seedIdeas="They are posing for a fashion shoot"
      proposal=""
      proposalSpokenText=""
      ownerScript=""
      ownerDirection="The models stand in a studio."
      draft={null}
      available
      busy={false}
      error=""
      onClose={vi.fn()}
      onSeedIdeasChange={vi.fn()}
      onProposalChange={vi.fn()}
      onProposalSpokenTextChange={vi.fn()}
      onBuild={onBuild}
      onTighten={onTighten}
      onUse={vi.fn()}
    />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("What should happen?");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Gemma expands this into action, camera, atmosphere, ending, and sound.");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("spoken words");

    await act(async () => buttonNamed("Write full video script")?.click());
    await act(async () => buttonNamed("Polish current direction")?.click());
    expect(onBuild).toHaveBeenCalledOnce();
    expect(onTighten).toHaveBeenCalledOnce();
  });
});
