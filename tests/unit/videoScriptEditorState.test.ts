import { describe, expect, it } from "vitest";
import {
  resolveCompletedVideoScriptEditor,
  restoredVideoScriptEditorIsDirty,
} from "../../src/features/generation/videoScriptEditorState";

describe("full video script editor restoration", () => {
  const completed = {
    currentScript: "The server's completed full scene.",
    currentSpokenText: "Hold the pose.",
  };

  it("hydrates a clean editor from the durable completed result", () => {
    expect(resolveCompletedVideoScriptEditor({ proposal: "", spokenText: "" }, completed, false)).toEqual({
      proposal: completed.currentScript,
      spokenText: completed.currentSpokenText,
    });
  });

  it("preserves browser-restored owner edits, including intentionally removed dialogue", () => {
    const local = { proposal: "My edited full scene.", spokenText: "" };
    expect(resolveCompletedVideoScriptEditor(local, completed, true)).toEqual(local);
  });

  it("preserves non-empty drafts from sessions saved before the dirty flag existed", () => {
    expect(restoredVideoScriptEditorIsDirty(undefined, "videoscript_1", "My recovered scene.")).toBe(true);
    expect(restoredVideoScriptEditorIsDirty(undefined, "videoscript_1", "")).toBe(false);
    expect(restoredVideoScriptEditorIsDirty(false, "videoscript_1", "My recovered scene.")).toBe(false);
  });
});
