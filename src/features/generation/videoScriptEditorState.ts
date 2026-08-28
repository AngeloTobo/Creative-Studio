export type VideoScriptEditorText = {
  proposal: string;
  spokenText: string;
};

/**
 * A completed runner result may arrive after a browser-restored owner edit.
 * Runner text hydrates a clean editor, but it must never replace a local edit.
 */
export function resolveCompletedVideoScriptEditor(
  local: VideoScriptEditorText,
  completed: { currentScript: string | null; currentSpokenText: string | null },
  preserveLocalEdits: boolean,
): VideoScriptEditorText {
  if (preserveLocalEdits) return local;
  return {
    proposal: completed.currentScript ?? "",
    spokenText: completed.currentSpokenText ?? "",
  };
}

/** Older saved sessions predate the explicit dirty flag. Preserve their
 * non-empty editor text once so an upgrade cannot discard an owner draft. */
export function restoredVideoScriptEditorIsDirty(
  savedDirty: unknown,
  draftId: string,
  proposal: string,
) {
  if (typeof savedDirty === "boolean") return savedDirty;
  return Boolean(draftId && proposal);
}
