import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { VIDEO_FULL_SCRIPT_MAX_LENGTH, videoScriptWordRange, type VideoDurationSeconds, type VideoScriptDraft } from "../../../shared/contracts";

export type VideoScriptBuilderSheetProps = {
  open: boolean;
  duration: VideoDurationSeconds;
  seedIdeas: string;
  /** The complete visual, camera, action, ending, and sound direction. */
  proposal: string;
  /** Optional words the subject should say exactly. */
  proposalSpokenText: string;
  /** Kept for compatibility with the generation form's current speech control. */
  ownerScript: string;
  /** The current generation direction that Gemma can polish into a full script. */
  ownerDirection?: string;
  draft: VideoScriptDraft | null;
  available: boolean;
  capabilityDetail?: string | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSeedIdeasChange: (value: string) => void;
  onProposalChange: (value: string) => void;
  onProposalSpokenTextChange: (value: string) => void;
  onBuild: () => void;
  onTighten: () => void;
  onUse: () => void;
};

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function compactSeed(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "Add a new starting idea";
  return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized;
}

export function VideoScriptBuilderSheet({
  open,
  duration,
  seedIdeas,
  proposal,
  proposalSpokenText,
  ownerScript,
  ownerDirection,
  draft,
  available,
  capabilityDetail,
  busy,
  error,
  onClose,
  onSeedIdeasChange,
  onProposalChange,
  onProposalSpokenTextChange,
  onBuild,
  onTighten,
  onUse,
}: VideoScriptBuilderSheetProps) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const scriptHelpId = useId();
  const dialogueHelpId = useId();
  const dialogueBudget = videoScriptWordRange(duration);
  const scriptCharacters = proposal.length;
  const dialogueWords = wordCount(proposalSpokenText);
  const pending = draft?.status === "waiting-for-runner" || draft?.status === "running";
  const legacyCompleted = draft?.status === "completed" && draft.scriptFormat === "dialogue-v1";
  const completed = draft?.status === "completed" && draft.scriptFormat === "full-script-v2";
  const fullDraft = draft?.scriptFormat === "full-script-v2" ? draft : null;
  const submittedBasis = fullDraft?.mode === "build"
    ? fullDraft.seedPhrases.join(" · ")
    : fullDraft?.sourceScript ?? fullDraft?.sceneDirection ?? "";
  const submittedLabel = fullDraft?.mode === "tighten" ? "Polished from" : "Written from";
  const showSubmittedBasis = Boolean(fullDraft && (pending || completed) && submittedBasis);
  const hasFullScript = proposal.trim().length >= 20 && scriptCharacters <= VIDEO_FULL_SCRIPT_MAX_LENGTH;
  const dialogueFits = dialogueWords <= dialogueBudget.maximum;
  const ready = completed && hasFullScript && dialogueFits;
  const polishSource = (ownerDirection ?? ownerScript).trim();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      const preferred = panelRef.current?.querySelector<HTMLElement>("[data-script-autofocus]");
      const fallback = [...(panelRef.current?.querySelectorAll<HTMLElement>(
        "textarea, input, button:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])",
      ) ?? [])].find((element) => !element.closest("details:not([open])"));
      (preferred ?? fallback)?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])",
      )].filter((element) => !element.closest("details:not([open])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  const statusText = pending
    ? draft?.status === "running"
      ? `Gemma is writing the full scene locally · ${Math.max(5, draft.progress)}%`
      : "Waiting for your Local Runner · your direction is unchanged"
    : draft?.status === "failed"
      ? "Gemma could not finish this script. Your direction is unchanged."
      : legacyCompleted
        ? "This older draft contains dialogue only · write a new full script"
      : completed
        ? "Full script ready to review · nothing changes until you use it"
        : "One seed phrase is enough — Gemma will write the complete scene";

  return createPortal(<div className="video-script-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className="video-script-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header>
        <span><small>Local Gemma · owner-reviewed</small><strong id={titleId}>Full Video Script</strong></span>
        <button type="button" aria-label="Close Full Video Script" onClick={onClose}><Icon name="close" size={17} /></button>
      </header>
      <div className="video-script-body">
        <div className={`video-script-status${draft?.status === "failed" ? " failed" : completed ? " ready" : ""}`} role={draft?.status === "failed" ? "alert" : "status"} aria-live="polite">
          <Icon name={draft?.status === "failed" ? "close" : pending ? "history" : "wand"} size={15} />
          <span><strong>{statusText}</strong><small>{duration}s full scene · dialogue optional</small></span>
        </div>

        {!available ? <p className="video-script-offline" role="alert">{capabilityDetail ?? "Start Local Runner 1.12 and ComfyUI to write with Gemma. Manual directions still work."}</p> : null}
        {error ? <p className="video-script-error" role="alert">{error}</p> : null}

        {showSubmittedBasis ? <div className="video-script-seed-provenance" aria-label="Submitted script basis">
          <span><strong>{submittedLabel}</strong><small>Submitted · retained with this draft</small></span>
          <p>{submittedBasis}</p>
        </div> : <label className="video-script-field video-script-seed">
          <span><strong>What should happen?</strong><small>One phrase or several ideas.</small></span>
          <textarea data-script-autofocus value={seedIdeas} maxLength={2_000} onChange={(event) => onSeedIdeasChange(event.target.value)} placeholder={"They pose for a fashion shoot\nThe camera becomes less predictable\nEnd on a confident close-up"} />
          <small>Gemma expands this into action, camera, atmosphere, ending, and sound.</small>
        </label>}

        {!completed && !pending ? <div className="video-script-build-actions">
          <button type="button" className="btn btn-primary" disabled={busy || pending || !available || seedIdeas.trim().length < 2} onClick={onBuild}><Icon name="wand" size={15} /> Write full video script</button>
          {polishSource.length >= 2 ? <button type="button" className="btn btn-ghost" disabled={busy || pending || !available} onClick={onTighten}>Polish current direction</button> : null}
        </div> : null}

        {completed ? <details className="video-script-next-idea">
          <summary><span><strong>Next draft idea</strong><small>{compactSeed(seedIdeas)}</small></span><Icon name="chevronDown" size={15} /></summary>
          <label className="video-script-field">
            <span><strong>What should happen next?</strong><small>This changes only the next draft.</small></span>
            <textarea value={seedIdeas} maxLength={2_000} onChange={(event) => onSeedIdeasChange(event.target.value)} />
          </label>
        </details> : null}

        {completed ? <div className="video-script-result">
          <label className="video-script-field video-script-proposal">
            <span><strong>Full video script</strong><small className={hasFullScript ? "" : "over"}>{scriptCharacters.toLocaleString()} / {VIDEO_FULL_SCRIPT_MAX_LENGTH} characters</small></span>
            <textarea
              data-script-autofocus
              value={proposal}
              maxLength={VIDEO_FULL_SCRIPT_MAX_LENGTH}
              onChange={(event) => onProposalChange(event.target.value)}
              aria-describedby={scriptHelpId}
              aria-invalid={!hasFullScript}
            />
            <small id={scriptHelpId}>{hasFullScript ? "Edit any action, camera move, ending, or sound before using it." : "Add the complete action, camera, ending, and sound direction."}</small>
          </label>

          <label className="video-script-field video-script-dialogue">
            <span><strong>Dialogue</strong><small>Optional · spoken exactly</small></span>
            <input
              type="text"
              value={proposalSpokenText}
              maxLength={1_200}
              onChange={(event) => onProposalSpokenTextChange(event.target.value.replace(/\r?\n/g, " "))}
              placeholder="Leave blank for no spoken words"
              aria-describedby={dialogueHelpId}
              aria-invalid={!dialogueFits}
            />
            <small id={dialogueHelpId} className={dialogueFits ? "" : "over"}>{proposalSpokenText.trim()
              ? `${dialogueWords} / ${dialogueBudget.maximum} spoken words · delivered exactly`
              : "No dialogue · sound and ambience stay on"}</small>
          </label>
        </div> : null}
      </div>
      {completed ? <footer>
        <button type="button" className="btn btn-ghost" disabled={busy || pending || !available || seedIdeas.trim().length < 2} onClick={onBuild}>Try another</button>
        <button type="button" className="btn btn-primary" disabled={busy || pending || !ready} onClick={onUse}>Use full script</button>
      </footer> : null}
    </section>
  </div>, document.body);
}
