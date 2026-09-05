import { useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  minimumOvernightOutputCount,
  type CreateOvernightSessionRequest,
  type GenerationModality,
  type OvernightExploration,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import {
  OVERNIGHT_MODALITIES,
  bestOvernightWorkflow,
  bytesLabel,
  compactDuration,
  estimatedOvernightDuration,
  overnightWorkflowCandidates,
} from "./overnightPresentation";
import { useOvernightDialog } from "./useOvernightDialog";
import "./OvernightStudio.css";

type OvernightArmInput = Omit<CreateOvernightSessionRequest, "projectId" | "dnaArtifactId" | "idempotencyKey">;

export type OvernightSetupSheetProps = {
  open: boolean;
  projectId: string;
  dnaArtifactId: string | null;
  onClose: () => void;
  onArm: (input: OvernightArmInput) => Promise<unknown> | unknown;
};

type OvernightModality = Exclude<GenerationModality, "3d">;

type ScheduleChoice = "now" | "tonight";

const EXPLORATION_OPTIONS: Array<{ value: OvernightExploration; label: string; detail: string }> = [
  { value: "familiar", label: "Familiar", detail: "Stay close to your DNA" },
  { value: "exploratory", label: "Explore", detail: "Recognizable, with turns" },
  { value: "wild", label: "Wild", detail: "Push into surprise" },
];

const MEDIA_LABELS: Record<OvernightModality, { label: string; detail: string }> = {
  image: { label: "Scenes", detail: "Still frames" },
  video: { label: "Motion", detail: "Video scenes" },
  music: { label: "Sound", detail: "Songs and soundscapes" },
};

function localInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function startDate(choice: ScheduleChoice, now = new Date()) {
  if (choice === "now") return now;
  const date = new Date(now);
  date.setHours(22, 0, 0, 0);
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
  return date;
}

function defaultCutoff(start: Date, choice: ScheduleChoice) {
  if (choice === "now") return new Date(start.getTime() + 8 * 60 * 60 * 1_000);
  const cutoff = new Date(start);
  cutoff.setDate(cutoff.getDate() + 1);
  cutoff.setHours(7, 0, 0, 0);
  return cutoff;
}

function derivedSessionName(seed: string, surprise: boolean, scheduledFor: Date) {
  const clean = seed.replace(/\s+/g, " ").trim();
  if (!surprise && clean) return clean.slice(0, 72);
  return `Night studio · ${scheduledFor.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function Stepper({ label, value, minimum, maximum, onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  return <div className="overnight-stepper">
    <span>{label}</span>
    <div role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= minimum} onClick={() => onChange(value - 1)}>−</button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= maximum} onClick={() => onChange(value + 1)}>+</button>
    </div>
  </div>;
}

export function OvernightSetupSheet({ open, projectId, dnaArtifactId, onClose, onArm }: OvernightSetupSheetProps) {
  const { snapshot, busy, error: providerError } = useStudio();
  const titleId = useId();
  const panelRef = useOvernightDialog<HTMLElement>(open, onClose);
  const [storySeed, setStorySeed] = useState("");
  const [surprise, setSurprise] = useState(true);
  const [storyCount, setStoryCount] = useState(1);
  const [outputCount, setOutputCount] = useState(4);
  const [modalities, setModalities] = useState<OvernightModality[] | null>(null);
  const [exploration, setExploration] = useState<OvernightExploration>("exploratory");
  const [scheduleChoice, setScheduleChoice] = useState<ScheduleChoice>("tonight");
  const [scheduledFor, setScheduledFor] = useState(() => localInputValue(startDate("tonight")));
  const [cutoffAt, setCutoffAt] = useState(() => localInputValue(defaultCutoff(startDate("tonight"), "tonight")));
  const [maxFailures, setMaxFailures] = useState(2);
  const [maxBytes, setMaxBytes] = useState(512 * 1024 * 1024);
  const [worldId, setWorldId] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<Partial<Record<OvernightModality, string>>>({});
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const candidates = useMemo(() => {
    if (!snapshot) return { image: [], video: [], music: [] };
    return {
      image: overnightWorkflowCandidates(snapshot, projectId, "image"),
      video: overnightWorkflowCandidates(snapshot, projectId, "video"),
      music: overnightWorkflowCandidates(snapshot, projectId, "music"),
    };
  }, [projectId, snapshot]);

  const worlds = useMemo(() => (snapshot?.worlds ?? [])
    .filter((world) => world.projectId === projectId && world.status === "active")
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [projectId, snapshot?.worlds]);

  const bestWorkflowIds = useMemo(() => {
    const ids: Partial<Record<OvernightModality, string>> = {};
    if (!snapshot) return ids;
    for (const modality of OVERNIGHT_MODALITIES) {
      const best = bestOvernightWorkflow(snapshot, projectId, modality);
      if (best) ids[modality] = best.workflow.id;
    }
    return ids;
  }, [projectId, snapshot]);

  const selectedModalities = useMemo(() => {
    const available = OVERNIGHT_MODALITIES.filter((modality) => candidates[modality].length > 0);
    if (modalities !== null) return modalities.filter((modality) => available.includes(modality));
    const defaults = (["image", "music"] as OvernightModality[]).filter((modality) => available.includes(modality));
    return defaults.length ? defaults : available.slice(0, 1);
  }, [candidates, modalities]);

  const selections = useMemo(() => selectedModalities.flatMap((modality) => {
    const chosen = candidates[modality].find((candidate) => candidate.workflow.id === (selectedWorkflowIds[modality] ?? bestWorkflowIds[modality]))
      ?? candidates[modality][0];
    return chosen ? [chosen.selection] : [];
  }), [bestWorkflowIds, candidates, selectedModalities, selectedWorkflowIds]);
  const minimumOutputCount = Math.max(3, minimumOvernightOutputCount(selectedModalities, storyCount));
  const effectiveOutputCount = Math.max(outputCount, minimumOutputCount);

  const development = snapshot?.adapter.development ?? false;
  const runnerOnline = snapshot?.runners.some((runner) => (runner.state === "online" || runner.state === "busy")
    && Boolean(runner.comfyVersion) && !runner.lastError) ?? false;
  const estimate = estimatedOvernightDuration(selections, effectiveOutputCount, storyCount);
  const parsedStart = new Date(scheduledFor);
  const parsedCutoff = new Date(cutoffAt);
  const scheduleDuration = parsedCutoff.getTime() - parsedStart.getTime();
  const invalidSchedule = !Number.isFinite(parsedStart.getTime())
    || !Number.isFinite(parsedCutoff.getTime())
    || parsedStart.getTime() < openedAt - 5 * 60_000
    || parsedStart.getTime() > openedAt + 7 * 24 * 60 * 60_000
    || scheduleDuration < 30 * 60_000
    || scheduleDuration > 12 * 60 * 60_000;
  const canArm = Boolean(snapshot)
    && !development
    && Boolean(dnaArtifactId)
    && selectedModalities.length > 0
    && selections.length === selectedModalities.length
    && !invalidSchedule
    && (surprise || storySeed.trim().length >= 3)
    && !submitting
    && !busy;

  const chooseSchedule = (choice: ScheduleChoice) => {
    const start = startDate(choice);
    setScheduleChoice(choice);
    setScheduledFor(localInputValue(start));
    setCutoffAt(localInputValue(defaultCutoff(start, choice)));
  };

  const toggleModality = (modality: OvernightModality) => {
    if (!candidates[modality].length) return;
    setModalities(selectedModalities.includes(modality)
      ? selectedModalities.filter((item) => item !== modality)
      : [...selectedModalities, modality]);
  };

  const arm = async () => {
    if (!canArm) return;
    setLocalError("");
    setSubmitting(true);
    try {
      const start = new Date(scheduledFor);
      const requestSelections = selections.map((selection) => ({
        modality: selection.modality,
        recipeId: selection.recipeId,
        workflowId: selection.workflowId,
        workflowRevisionId: selection.workflowRevisionId,
      }));
      await onArm({
        worldId,
        name: derivedSessionName(storySeed, surprise, start),
        storySeed: surprise ? "Surprise me" : storySeed.trim(),
        storyCount,
        outputCount: effectiveOutputCount,
        modalities: selectedModalities,
        exploration,
        workflowSelections: requestSelections,
        scheduledFor: start.toISOString(),
        cutoffAt: new Date(cutoffAt).toISOString(),
        maxFailures,
        maxBytes,
      });
      onClose();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Creative Studio could not arm this overnight run.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(<div className="overnight-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className="overnight-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="overnight-sheet-head">
        <span><small>LOCAL-FIRST · BROWSER CAN CLOSE</small><strong id={titleId}>Overnight Studio</strong></span>
        <button type="button" aria-label="Close Overnight Studio" onClick={onClose}><Icon name="close" size={18} /></button>
      </header>

      <div className="overnight-sheet-body">
        <section className="overnight-seed-block">
          <div className="overnight-section-head"><span><small>STORY ENGINE</small><strong>What should the night discover?</strong></span><button type="button" className={surprise ? "on" : ""} aria-pressed={surprise} onClick={() => setSurprise((value) => !value)}><Icon name="wand" size={14} /> Surprise me</button></div>
          {!surprise ? <textarea data-overnight-autofocus value={storySeed} maxLength={2_000} onChange={(event) => setStorySeed(event.target.value)} placeholder="A world, character, tension, image, or question to explore" /> : <div className="overnight-surprise"><Icon name="moon" size={21} /><span><strong>Gemma will propose the stories.</strong><small>Your CreativeDNA{worldId ? " and selected World" : ""} remain the continuity anchor.</small></span></div>}
          <div className="overnight-count-row">
            <Stepper label="Stories" value={storyCount} minimum={1} maximum={3} onChange={setStoryCount} />
            <Stepper label="Total creations" value={effectiveOutputCount} minimum={minimumOutputCount} maximum={8} onChange={setOutputCount} />
          </div>
        </section>

        <section className="overnight-media-block">
          <div className="overnight-section-head"><span><small>MEDIA MIX</small><strong>Choose what wakes up finished</strong></span><em>{effectiveOutputCount} total</em></div>
          <div className="overnight-media-grid">
            {OVERNIGHT_MODALITIES.map((modality) => {
              const enabled = selectedModalities.includes(modality);
              const options = candidates[modality];
              const chosen = options.find((candidate) => candidate.workflow.id === (selectedWorkflowIds[modality] ?? bestWorkflowIds[modality])) ?? options[0] ?? null;
              return <article key={modality} className={`${enabled ? "on" : ""}${options.length ? "" : " unavailable"}`}>
                <button type="button" aria-pressed={enabled} disabled={!options.length} onClick={() => toggleModality(modality)}>
                  <span className="overnight-media-icon"><Icon name={modality === "music" ? "music" : modality} size={19} /></span>
                  <span><strong>{MEDIA_LABELS[modality].label}</strong><small>{options.length ? MEDIA_LABELS[modality].detail : "No text-only workflow"}</small></span>
                  <i aria-hidden="true">{enabled ? <Icon name="check" size={13} /> : null}</i>
                </button>
                {enabled && chosen ? <div className="overnight-workflow-choice">
                  {options.length > 1 ? <select aria-label={`${MEDIA_LABELS[modality].label} workflow`} value={chosen.workflow.id} onChange={(event) => setSelectedWorkflowIds((current) => ({ ...current, [modality]: event.target.value }))}>{options.map((option) => <option key={option.workflow.id} value={option.workflow.id}>{option.workflow.name}</option>)}</select> : <strong>{chosen.workflow.name}</strong>}
                  <small>{chosen.selection.videoDurationSeconds ? `${chosen.selection.videoDurationSeconds === 60 ? "1m" : `${chosen.selection.videoDurationSeconds}s`} video · ` : ""}{chosen.recipe ? `${chosen.recipe.intentTier} recipe · ${compactDuration(chosen.selection.estimatedDurationMs)}` : `Direct workflow · ${compactDuration(null)}`}</small>
                </div> : null}
              </article>;
            })}
          </div>
        </section>

        <section className="overnight-direction-block">
          <div className="overnight-section-head"><span><small>CREATIVE RANGE</small><strong>How far should it travel?</strong></span></div>
          <div className="overnight-exploration" role="radiogroup" aria-label="Creative range">
            {EXPLORATION_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={exploration === option.value} className={exploration === option.value ? "on" : ""} onClick={() => setExploration(option.value)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}
          </div>
          {worlds.length ? <label className="overnight-world"><span>World continuity</span><select value={worldId ?? ""} onChange={(event) => setWorldId(event.target.value || null)}><option value="">CreativeDNA only</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label> : null}
        </section>

        <section className="overnight-limits-block">
          <div className="overnight-section-head"><span><small>START + LIMITS</small><strong>Bound the run before sleep</strong></span>{estimate ? <em>{compactDuration(estimate)} estimated</em> : <em>Timing learns from runs</em>}</div>
          <div className="overnight-schedule-choice" role="radiogroup" aria-label="Start time"><button type="button" role="radio" aria-checked={scheduleChoice === "now"} className={scheduleChoice === "now" ? "on" : ""} onClick={() => chooseSchedule("now")}>Start now</button><button type="button" role="radio" aria-checked={scheduleChoice === "tonight"} className={scheduleChoice === "tonight" ? "on" : ""} onClick={() => chooseSchedule("tonight")}>Tonight · 10 PM</button></div>
          <div className="overnight-time-grid">
            <label><span>Start</span><input type="datetime-local" value={scheduledFor} onChange={(event) => { setScheduleChoice("now"); setScheduledFor(event.target.value); }} /></label>
            <label><span>Hard cutoff</span><input type="datetime-local" value={cutoffAt} min={scheduledFor} onChange={(event) => setCutoffAt(event.target.value)} /></label>
          </div>
          <div className="overnight-limit-grid">
            <label><span>Stop after failures</span><select value={maxFailures} onChange={(event) => setMaxFailures(Number(event.target.value))}><option value={1}>1 failure</option><option value={2}>2 failures</option><option value={3}>3 failures</option></select></label>
            <label><span>Storage ceiling</span><select value={maxBytes} onChange={(event) => setMaxBytes(Number(event.target.value))}><option value={268435456}>256 MB</option><option value={536870912}>512 MB</option><option value={1073741824}>1 GB</option></select></label>
          </div>
          <div className={`overnight-runner-state ${runnerOnline ? "online" : "offline"}`}><i /><span><strong>{runnerOnline ? "Local Runner is ready" : "Local Runner is offline"}</strong><small>{runnerOnline ? "Your machine does the render work; Cloudflare stores only durable coordination." : "You can arm tonight, but start the Local Runner before the scheduled time."}</small></span></div>
        </section>

        <aside className="overnight-boundary"><Icon name="shield" size={17} /><span><strong>Morning review stays yours.</strong><small>Results are retained for review. Nothing is auto-accepted, trained into CreativeDNA, or promoted to canon.</small></span></aside>

        {development ? <p className="overnight-error" role="alert">Overnight runs require the durable Creative Studio backend; the labeled development adapter cannot run after the browser closes.</p> : null}
        {!dnaArtifactId ? <p className="overnight-error" role="alert">Choose or create a CreativeDNA profile before arming an overnight run.</p> : null}
        {invalidSchedule ? <p className="overnight-error" role="alert">Choose a start within seven days and a hard cutoff 30 minutes to 12 hours later.</p> : null}
        {(localError || providerError) ? <p className="overnight-error" role="alert">{localError || providerError}</p> : null}
      </div>

      <footer className="overnight-sheet-footer">
        <span><strong>{selectedModalities.length ? selectedModalities.map((modality) => MEDIA_LABELS[modality].label).join(" + ") : "Choose media"}</strong><small>{bytesLabel(maxBytes)} max · {maxFailures} failure stop</small></span>
        <button type="button" className="btn btn-primary" disabled={!canArm} onClick={() => void arm()}><Icon name="moon" size={17} /> {submitting ? "Arming…" : scheduleChoice === "now" ? "Start overnight run" : "Arm for tonight"}</button>
      </footer>
    </section>
  </div>, document.body);
}
