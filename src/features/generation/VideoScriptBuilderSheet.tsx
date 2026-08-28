import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../components/Icon";
import { videoScriptWordRange, type VideoDurationSeconds, type VideoScriptDraft } from "../../../shared/contracts";

type Props = {
  open: boolean;
  duration: VideoDurationSeconds;
  seedIdeas: string;
  proposal: string;
  ownerScript: string;
  draft: VideoScriptDraft | null;
  available: boolean;
  capabilityDetail?: string | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSeedIdeasChange: (value: string) => void;
  onProposalChange: (value: string) => void;
  onBuild: () => void;
  onTighten: () => void;
  onUse: () => void;
};

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function VideoScriptBuilderSheet({
  open,
  duration,
  seedIdeas,
  proposal,
  ownerScript,
  draft,
  available,
  capabilityDetail,
  busy,
  error,
  onClose,
  onSeedIdeasChange,
  onProposalChange,
  onBuild,
  onTighten,
  onUse,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const budget = videoScriptWordRange(duration);
  const proposalWords = wordCount(proposal);
  const pending = draft?.status === "waiting-for-runner" || draft?.status === "running";
  const completed = draft?.status === "completed";
  const ready = completed && Boolean(proposal.trim());
  const proposalFits = proposalWords > 0 && proposalWords <= budget.maximum;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("[autofocus], textarea, button:not([disabled])")?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      )];
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
      ? `Gemma is writing locally · ${Math.max(5, draft.progress)}%`
      : "Waiting for your Local Runner · your words are unchanged"
    : draft?.status === "failed"
      ? "Gemma could not finish this draft. Your words are unchanged."
      : completed
        ? "Draft ready to edit · it will not be used until you choose Use this script"
        : "Start from fragments or tighten words you already wrote";

  return createPortal(<div className="video-script-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className="video-script-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header>
        <span><small>Local Gemma · owner-reviewed</small><strong id={titleId}>Script Builder</strong></span>
        <button type="button" aria-label="Close Script Builder" onClick={onClose}><Icon name="close" size={17} /></button>
      </header>
      <div className="video-script-body">
        <div className={`video-script-status${draft?.status === "failed" ? " failed" : completed ? " ready" : ""}`} role={draft?.status === "failed" ? "alert" : "status"} aria-live="polite">
          <Icon name={draft?.status === "failed" ? "close" : pending ? "history" : "wand"} size={15} />
          <span><strong>{statusText}</strong><small>{duration}s target · {budget.minimum}–{budget.maximum} spoken words</small></span>
        </div>

        {!available ? <p className="video-script-offline" role="alert">{capabilityDetail ?? "Start Local Runner 1.11 and ComfyUI to write with Gemma. Manual scripts still work."}</p> : null}
        {error ? <p className="video-script-error" role="alert">{error}</p> : null}

        <label className="video-script-field">
          <span><strong>Seed phrases and ideas</strong><small>Fragments are welcome. Separate ideas with a new line, comma, or semicolon.</small></span>
          <textarea value={seedIdeas} maxLength={2_000} onChange={(event) => onSeedIdeasChange(event.target.value)} placeholder={"She recognizes the city\nThis body still feels borrowed\nSay it with quiet certainty"} />
        </label>

        <div className="video-script-build-actions">
          <button type="button" className="btn btn-primary" disabled={busy || pending || !available || seedIdeas.trim().length < 2} onClick={onBuild}><Icon name="wand" size={15} /> Build from ideas</button>
          <button type="button" className="btn btn-ghost" disabled={busy || pending || !available || ownerScript.trim().length < 2} onClick={onTighten}>Tighten my script</button>
        </div>

        {completed ? <label className="video-script-field video-script-proposal">
          <span><strong>Editable script draft</strong><small className={proposalFits ? "" : "over"}>{proposalWords} / {budget.maximum} words</small></span>
          <textarea value={proposal} maxLength={1_200} onChange={(event) => onProposalChange(event.target.value.replace(/\r?\n/g, " "))} aria-invalid={!proposalFits} />
          <small>Spoken words only. You can change anything before using it.</small>
        </label> : null}
      </div>
      <footer>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Keep my script</button>
        <button type="button" className="btn btn-primary" disabled={busy || pending || !ready || !proposalFits} onClick={onUse}>Use this script</button>
      </footer>
    </section>
  </div>, document.body);
}
