import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  CONTINUITY_FACETS,
  PROMOTE_TO_CANON_SCHEMA_VERSION,
  compileCreativeTasteMemory,
  videoGenerationVariantLabel,
  type Acceptance,
  type AcceptanceDecision,
  type Artifact,
  type CreativeTasteSignal,
  type EvolutionStudy,
  type ContinuityFacet,
  type World,
  type WorldEntity,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";
import { videoSpeechLabel, videoSpeechSummary } from "../generation/videoContextPresentation";
import { artifactMatchesHistoryFilter, artifactsForHistoryEntry, countArtifactsInHistory, loadedArtifactHistory, type ArtifactHistoryEntry } from "./artifactHistory";
import { artifactCanSaveWinningRecipe, generationRecipeMatchesArtifact, winningRecipeForArtifact } from "./winningRecipe";

type ReviewIntent = { artifact: Artifact; decision: AcceptanceDecision };
type CanonIntent = { artifact: Artifact };
type ActiveStatusFilter = "all" | Exclude<Artifact["status"], "archived">;
type ArtifactKindFilter = "all" | Artifact["kind"];
type RecipePromotionState = {
  status: "idle" | "saving" | "saved" | "error";
  message: string;
  acceptance: AcceptanceDecision | "unreviewed" | null;
};
const ARTIFACT_PAGE_SIZE = 8;

function actorName(actor: Acceptance["actor"]) {
  return actor === "angelo" ? "Angelo" : "Development user";
}

function downloadName(artifact: Artifact) {
  const name = artifact.name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${name || "creative-studio-artifact"}-${artifact.kind}`;
}

function recipePromotionError(error: unknown) {
  if (!(error instanceof Error)) return "Creative Studio could not save this recipe.";
  return error.message.replaceAll("_", " ");
}

function ModalShell({ labelledBy, onClose, className = "", children }: { labelledBy: string; onClose: () => void; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = panel.current;
    if (!dialog) return;

    const obscured: Array<{ element: HTMLElement; inert: boolean; ariaHidden: string | null }> = [];
    let modalBranch: HTMLElement | null = dialog.parentElement;
    while (modalBranch && modalBranch !== document.body) {
      const parent: HTMLElement | null = modalBranch.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === modalBranch) continue;
        obscured.push({ element: sibling, inert: sibling.inert, ariaHidden: sibling.getAttribute("aria-hidden") });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      }
      modalBranch = parent;
    }

    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    const initialFocus = dialog.querySelector<HTMLElement>("[autofocus]") ?? focusableElements()[0] ?? dialog;
    initialFocus.focus();

    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      for (const { element, inert, ariaHidden } of obscured) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      previous?.focus();
    };
  }, []);

  return (
    <div className="studio-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panel} className={`studio-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </section>
    </div>
  );
}

export function ArtifactMediaReview({ artifact, onInspect, onExtend }: { artifact: Artifact; onInspect: () => void; onExtend?: () => void }) {
  const mediaUrl = artifact.preview.kind === "remote-media" ? artifact.preview.url : null;
  if (!mediaUrl) return null;
  if (artifact.kind === "3d") return <section className="artifact-playback"><span>3D mesh  /  GLB</span><a className="btn btn-ghost artifact-download" href={mediaUrl} download={`${downloadName(artifact)}.glb`}><Icon name="cube" size={15} /> Download GLB</a><small>Open in your 3D app to inspect and edit.</small></section>;
  if (artifact.kind === "music") {
    return (
      <section className="artifact-audio-review" aria-label={`Audio review for ${artifact.name}`}>
        <div><Icon name="music" size={18} /><span><strong>Retained audio</strong><small>Listen to the full result before deciding.</small></span></div>
        <audio controls preload="none" src={mediaUrl}>Your browser does not support audio playback.</audio>
        <a className="btn btn-ghost artifact-download" href={mediaUrl} download={downloadName(artifact)}><Icon name="arrow" size={15} /> Download audio</a>
      </section>
    );
  }
  if (artifact.kind === "video") {
    return (
      <section className="artifact-video-tools" aria-label={`Video actions for ${artifact.name}`}>
        {onExtend ? <button type="button" className="btn artifact-extend" onClick={onExtend}><Icon name="video" size={15} /> Extend video</button> : null}
        <a className="btn btn-ghost artifact-download" href={mediaUrl} download={downloadName(artifact)}><Icon name="arrow" size={15} /> Download video</a>
      </section>
    );
  }
  return <button type="button" className="btn btn-ghost artifact-inspect" onClick={onInspect}><Icon name="search" size={15} /> Inspect full-size image</button>;
}

function ImageInspector({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  if (!artifact.preview.url) return null;
  return (
    <ModalShell labelledBy="image-inspector-title" onClose={onClose} className="image-inspector">
      <header><span><small>Full-size image inspection</small><h2 id="image-inspector-title">{artifact.name}</h2></span><button type="button" className="icon-button" aria-label="Close image inspection" onClick={onClose}><Icon name="close" size={20} /></button></header>
      <div className="image-inspector-canvas"><img src={artifact.preview.url} alt={artifact.name} /></div>
      <footer><span>{artifact.provider} · {new Date(artifact.createdAt).toLocaleString()}</span><a className="btn btn-ghost" href={artifact.preview.url} download={downloadName(artifact)}><Icon name="arrow" size={15} /> Download image</a></footer>
    </ModalShell>
  );
}

export function VideoInspector({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  if (!artifact.preview.url) return null;
  return (
    <ModalShell labelledBy="video-inspector-title" onClose={onClose} className="video-inspector">
      <header><span><small>Video playback</small><h2 id="video-inspector-title">{artifact.name}</h2></span><button type="button" className="icon-button" aria-label="Close video player" onClick={onClose}><Icon name="close" size={20} /></button></header>
      <div className="video-inspector-canvas"><video src={artifact.preview.url} poster={artifact.preview.posterUrl ?? undefined} controls autoPlay playsInline preload="metadata">Your browser does not support video playback.</video></div>
      <footer><span>{artifact.provider} · {new Date(artifact.createdAt).toLocaleString()}</span><a className="btn btn-ghost" href={artifact.preview.url} download={downloadName(artifact)}><Icon name="arrow" size={15} /> Download video</a></footer>
    </ModalShell>
  );
}

function ReviewDialog({ intent, busy, onClose, onConfirm }: { intent: ReviewIntent; busy: boolean; onClose: () => void; onConfirm: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const required = intent.decision === "accepted" || intent.decision === "rejected";
  const canSubmit = !required || Boolean(note.trim());
  const action = intent.decision === "accepted" ? "Accept" : intent.decision === "rejected" ? "Reject" : "Archive";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(note.trim());
    } catch {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onClose();
  };

  return (
    <ModalShell labelledBy="review-dialog-title" onClose={submitting ? () => undefined : onClose} className="review-dialog">
      <form onSubmit={(event) => void submit(event)}>
        <header><span><small>Artifact decision</small><h2 id="review-dialog-title">{action} {intent.artifact.name}</h2></span><button type="button" className="icon-button" aria-label="Close artifact review" disabled={submitting} onClick={onClose}><Icon name="close" size={20} /></button></header>
        <p>{required ? "Record what drove this decision. The note becomes part of the permanent review history." : "Add an optional note before moving this artifact out of active review."}</p>
        <label className="review-note-field"><span>Review note{required ? " (required)" : " (optional)"}</span><textarea autoFocus required={required} maxLength={500} rows={5} value={note} onChange={(event) => setNote(event.target.value)} placeholder={intent.decision === "accepted" ? "What should CreativeDNA learn from this result?" : intent.decision === "rejected" ? "What missed the mark, and what should change next time?" : "Why is this artifact being archived?"} /><small>{note.length}/500 characters</small></label>
        <footer><button type="button" className="btn btn-ghost" disabled={submitting} onClick={onClose}>Cancel</button><button type="submit" className={`btn artifact-${intent.decision === "accepted" ? "accept" : intent.decision === "rejected" ? "reject" : "archive"}`} disabled={busy || submitting || !canSubmit}>{submitting ? "Recording…" : `${action} artifact`}</button></footer>
      </form>
    </ModalShell>
  );
}

function CanonDialog({ intent, worlds, entities, busy, onClose, onPromote }: {
  intent: CanonIntent;
  worlds: World[];
  entities: WorldEntity[];
  busy: boolean;
  onClose: () => void;
  onPromote: (input: { world: World; entity: WorldEntity; facets: ContinuityFacet[]; guidance: string; note: string }) => Promise<void>;
}) {
  const [worldId, setWorldId] = useState(worlds[0]?.id ?? "");
  const availableEntities = entities.filter((entity) => entity.worldId === worldId && entity.status === "active");
  const [entityId, setEntityId] = useState(availableEntities[0]?.id ?? "");
  const [facets, setFacets] = useState<ContinuityFacet[]>(["identity"]);
  const [guidance, setGuidance] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectedWorld = worlds.find((world) => world.id === worldId) ?? null;
  const selectedEntity = availableEntities.find((entity) => entity.id === entityId) ?? availableEntities[0] ?? null;
  const canSubmit = Boolean(selectedWorld && selectedEntity && facets.length && guidance.trim().length >= 4 && note.trim().length >= 4);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !selectedWorld || !selectedEntity) return;
    setSubmitting(true);
    try {
      await onPromote({ world: selectedWorld, entity: selectedEntity, facets, guidance: guidance.trim(), note: note.trim() });
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  return <ModalShell labelledBy="canon-dialog-title" onClose={submitting ? () => undefined : onClose} className="review-dialog canon-dialog">
    <form onSubmit={(event) => void submit(event)}>
      <header><span><small>Explicit world decision</small><h2 id="canon-dialog-title">Make {intent.artifact.name} canon</h2></span><button type="button" className="icon-button" aria-label="Close canon promotion" disabled={submitting} onClick={onClose}><Icon name="close" size={20} /></button></header>
      <p>Acceptance records quality. This separate action decides exactly what becomes reusable continuity for future generations.</p>
      <div className="canon-targets">
        <label><span>World</span><select autoFocus value={worldId} onChange={(event) => { const nextWorldId = event.target.value; setWorldId(nextWorldId); setEntityId(entities.find((entity) => entity.worldId === nextWorldId && entity.status === "active")?.id ?? ""); }}>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
        <label><span>Character, place, or object</span><select value={selectedEntity?.id ?? ""} onChange={(event) => setEntityId(event.target.value)}>{availableEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name} · {entity.kind}</option>)}</select></label>
      </div>
      <fieldset className="canon-facets"><legend>What is canonical?</legend><div>{CONTINUITY_FACETS.map((facet) => <button type="button" key={facet} className={facets.includes(facet) ? "on" : ""} aria-pressed={facets.includes(facet)} onClick={() => setFacets((current) => current.includes(facet) ? current.filter((item) => item !== facet) : [...current, facet])}>{facet}</button>)}</div></fieldset>
      <label className="review-note-field"><span>Reusable continuity guidance</span><textarea required maxLength={500} rows={3} value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="Describe only the traits future generations must preserve." /><small>{guidance.length}/500 characters</small></label>
      <label className="review-note-field"><span>Why this becomes canon</span><textarea required maxLength={500} rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record your artistic reason for this promotion." /><small>{note.length}/500 characters</small></label>
      <footer><button type="button" className="btn btn-ghost" disabled={submitting} onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || submitting || !canSubmit}>{submitting ? "Promoting…" : "Confirm canon"}</button></footer>
    </form>
  </ModalShell>;
}

function DecisionHistory({ decisions }: { decisions: Acceptance[] }) {
  if (!decisions.length) return null;
  return (
    <section className="decision-history" aria-label="Decision history">
      <header><span><Icon name="history" size={15} /> Decision history</span><b>{decisions.length}</b></header>
      <ol>{decisions.map((decision) => <li key={decision.id}><div><span className={`state-pill ${decision.decision}`}>{decision.decision}</span><time dateTime={decision.createdAt}>{new Date(decision.createdAt).toLocaleString()}</time></div><p>{decision.note || "No note recorded."}</p><small>Reviewed by {actorName(decision.actor)}</small></li>)}</ol>
    </section>
  );
}

function ArtifactCard({ artifact, onReuse, onInspect, onPlayVideo, onReview, onMakeCanon, onContinueLoop, onExtendVideo, onEvolve, onAnimate, onAnimateFourWay, focused, compact = false }: { artifact: Artifact; onReuse: (artifact: Artifact) => void; onInspect: (artifact: Artifact) => void; onPlayVideo: (artifact: Artifact) => void; onReview: (intent: ReviewIntent) => void; onMakeCanon: (intent: CanonIntent) => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; onEvolve: (artifactId: string) => void; onAnimate: (artifactId: string) => void; onAnimateFourWay: (artifactId: string) => void; focused: boolean; compact?: boolean }) {
  const { snapshot, createGenerationRecipe, recordGenerationRecipeEvidence, busy } = useStudio();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [recipePromotion, setRecipePromotion] = useState<RecipePromotionState>({ status: "idle", message: "", acceptance: null });
  const decisions = snapshot?.acceptances.filter((item) => item.artifactId === artifact.id) ?? [];
  const training = snapshot?.trainingExamples.find((item) => item.artifactId === artifact.id);
  const job = snapshot?.jobs.find((item) => item.id === artifact.jobId);
  const workflow = snapshot?.workflows.find((item) => item.id === artifact.settingsStamp.workflow?.workflowId
    && item.currentRevision.id === artifact.settingsStamp.workflow?.revisionId);
  const canSaveRecipe = artifactCanSaveWinningRecipe(artifact, job, snapshot?.adapter.development ?? true, workflow);
  const artifactRecipe = canSaveRecipe && workflow ? winningRecipeForArtifact(artifact, workflow) : null;
  const matchingRecipe = artifactRecipe
    ? (snapshot?.recipes ?? []).find((recipe) => generationRecipeMatchesArtifact(recipe, artifactRecipe))
    : undefined;
  const recordedEvidence = matchingRecipe?.evidence.find((evidence) => evidence.jobId === artifact.jobId);
  const currentAcceptance = decisions[0]?.decision ?? "unreviewed";
  const alreadyCanon = (snapshot?.canonPromotions ?? []).some((promotion) => promotion.sourceArtifactId === artifact.id);
  const hasCanonTarget = (snapshot?.worlds ?? []).some((world) => world.projectId === artifact.projectId && world.status === "active"
    && (snapshot?.worldEntities ?? []).some((entity) => entity.worldId === world.id && entity.status === "active"));
  const continuity = artifact.settingsStamp.continuity;
  const currentWorld = continuity ? (snapshot?.worlds ?? []).find((world) => world.id === continuity.records.world.id) : null;
  const continuityDrifted = Boolean(continuity && (
    !currentWorld
    || currentWorld.version !== continuity.records.world.version
    || continuity.records.entities.some((stamped) => {
      const current = (snapshot?.worldEntities ?? []).find((entity) => entity.id === stamped.id);
      return !current || current.version !== stamped.version;
    })
    || continuity.records.rules.some((stamped) => {
      const current = (snapshot?.continuityRules ?? []).find((rule) => rule.id === stamped.id);
      return !current || current.version !== stamped.version;
    })
    || continuity.records.references.some((stamped) => {
      const current = (snapshot?.canonReferences ?? []).find((reference) => reference.id === stamped.id);
      return !current || current.version !== stamped.version;
    })
  ));
  const recipeEvidenceCurrent = recordedEvidence?.acceptance === currentAcceptance;
  const prompt = artifact.prompt.replace(/\s+/g, " ").trim();
  const hasLongPrompt = prompt.length > 180;
  const promptEnhancement = artifact.settingsStamp.promptEnhancement;
  const videoPromptEnhancement = promptEnhancement?.schemaVersion === "creative-studio-video-prompt-enhancement/1.0"
    ? promptEnhancement
    : null;
  const exactEnhancedPrompt = videoPromptEnhancement?.appliedPrompt ?? promptEnhancement?.enhancedPrompt ?? "";
  const videoRole = artifact.settingsStamp.videoVariant
    ? videoGenerationVariantLabel(artifact.settingsStamp.videoVariant.role)
    : null;
  const videoSpeech = artifact.settingsStamp.videoSpeech ?? null;
  const disabled = busy || artifact.status === "retaining";
  const animateAction = artifact.kind === "image" ? <button className="btn btn-primary artifact-animate" disabled={disabled} onClick={() => onAnimate(artifact.id)} title="Prepare two speed-safe 5-second versions in Create"><Icon name="video" size={16} /> Animate</button> : null;
  const animateFourWayAction = artifact.kind === "image" ? <button className="btn btn-ghost artifact-animate-four" disabled={disabled} onClick={() => onAnimateFourWay(artifact.id)} title="Prepare Exact, Enhanced, Left Field, and Awe in Create"><Icon name="star" size={16} /> Animate ×4</button> : null;
  const evolveAction = artifact.kind === "3d" ? null : <button className="btn artifact-evolve" disabled={disabled} onClick={() => onEvolve(artifact.id)}><Icon name="star" size={16} /> Evolve this</button>;
  const reuseAction = <button className="btn btn-ghost artifact-reuse" disabled={disabled} title="Review these retained settings in Create before generating" onClick={() => onReuse(artifact)}><Icon name="rerun" size={16} /> Reuse setup</button>;
  const acceptAction = <button className="btn artifact-accept" disabled={disabled} onClick={() => onReview({ artifact, decision: "accepted" })}><Icon name="check" size={16} /> Accept</button>;
  const rejectAction = <button className="btn artifact-reject" disabled={disabled} onClick={() => onReview({ artifact, decision: "rejected" })}><Icon name="close" size={16} /> Reject</button>;
  const archiveAction = <button className="btn btn-ghost" disabled={disabled} onClick={() => onReview({ artifact, decision: "archived" })}><Icon name="archive" size={16} /> Archive</button>;
  const canonAction = artifact.kind !== "3d" && artifact.status === "accepted" && artifact.retention.state === "retained" && (alreadyCanon || hasCanonTarget)
    ? <button className="btn btn-ghost artifact-canon" disabled={disabled || alreadyCanon} onClick={() => onMakeCanon({ artifact })}><Icon name="shield" size={16} /> {alreadyCanon ? "Canon saved" : "Make canon"}</button>
    : null;
  const saveWinningRecipe = async () => {
    if (!artifactRecipe || recipeEvidenceCurrent || recipePromotion.status === "saving") return;
    setRecipePromotion({ status: "saving", message: "Saving the exact workflow settings and evidence.", acceptance: null });
    try {
      const recipe = matchingRecipe ?? await createGenerationRecipe(artifactRecipe);
      await recordGenerationRecipeEvidence(recipe.id, artifact.jobId);
      setRecipePromotion({ status: "saved", message: `${recipe.name} is ready to reuse from Create.`, acceptance: currentAcceptance });
    } catch (caught) {
      setRecipePromotion({ status: "error", message: recipePromotionError(caught), acceptance: null });
    }
  };
  const promotionSaved = recipeEvidenceCurrent
    || (recipePromotion.status === "saved" && recipePromotion.acceptance === currentAcceptance);
  const promotionLabel = promotionSaved
    ? "Winning recipe saved"
    : recipePromotion.status === "saving"
      ? "Saving winning recipe..."
      : recipePromotion.status === "error"
        ? "Could not save - retry"
        : recordedEvidence
          ? "Update winning evidence"
          : "Save winning recipe";
  const promotionAction = canSaveRecipe ? <button
    type="button"
    className={compact ? "btn btn-ghost" : "artifact-prompt-toggle"}
    disabled={busy || promotionSaved || recipePromotion.status === "saving"}
    aria-label={promotionLabel}
    aria-live="polite"
    title={recipePromotion.message || "Keep these exact model settings as a proven master recipe."}
    onClick={() => void saveWinningRecipe()}
  ><Icon name="star" size={compact ? 15 : 13} /> {promotionLabel}</button> : null;
  return (
    <article className={`artifact-card glass${focused ? " cockpit-focus" : ""}${compact ? " artifact-card-compact" : ""}`} id={`artifact-card-${artifact.id}`}>
      <div className="artifact-hero">
        <ArtifactThumb artifact={artifact} />
        {artifact.kind === "image" ? <ArtifactMediaReview artifact={artifact} onInspect={() => onInspect(artifact)} /> : null}
        {artifact.kind === "video" && artifact.preview.url ? <button type="button" className="artifact-play" onClick={() => onPlayVideo(artifact)} aria-label={`Play ${artifact.name}`}><Icon name="video" size={17} /><span>Play</span></button> : null}
      </div>
      <div className="artifact-body">
        <div className="artifact-title"><div><span className={`state-pill ${artifact.status}`}>{artifact.status}</span>{artifact.settingsStamp.loveLoop ? <span className="love-loop-origin"><Icon name="star" size={10} /> Daily love</span> : null}{videoRole ? <span className="video-context-chip role">{videoRole}</span> : null}{videoSpeech ? <span className="video-context-chip speech" aria-label={videoSpeechSummary(videoSpeech)} title={videoSpeechSummary(videoSpeech)}>{videoSpeechLabel(videoSpeech)}</span> : null}<h3>{artifact.name}</h3></div><Icon name={artifact.kind} size={20} /></div>
        <p className={`artifact-prompt${promptExpanded ? " expanded" : ""}`}>{prompt}</p>
        {hasLongPrompt ? <button type="button" className="artifact-prompt-toggle" aria-expanded={promptExpanded} onClick={() => setPromptExpanded((value) => !value)}>{promptExpanded ? "Show less" : "Read full prompt"}</button> : null}
        <div className="artifact-meta"><span>{artifact.provider}</span><span>{new Date(artifact.createdAt).toLocaleString()}</span></div>
        {artifact.kind !== "image" ? <ArtifactMediaReview artifact={artifact} onInspect={() => undefined} onExtend={artifact.kind === "video" ? () => onExtendVideo(artifact.id) : undefined} /> : null}
        {compact ? <div className={`artifact-compact-actions${artifact.kind === "image" ? " has-animation" : ""}`} aria-label={`Actions for ${artifact.name}`}>
          {artifact.kind === "image" ? animateAction : artifact.status === "ready" ? acceptAction : evolveAction}
          {artifact.kind === "image" ? artifact.status === "ready" ? acceptAction : evolveAction : null}
          <details>
            <summary className="btn btn-ghost"><Icon name="more" size={16} /> More actions</summary>
            <div>
              {artifact.status !== "ready" ? acceptAction : null}
              {rejectAction}
              {animateFourWayAction}
              {artifact.status === "ready" ? evolveAction : null}
              {reuseAction}
              {promotionAction}
              {canonAction}
              {archiveAction}
            </div>
          </details>
        </div> : <>
          <div className="artifact-actions artifact-create-actions" aria-label={`Create from ${artifact.name}`}>
            {animateAction}
            {animateFourWayAction}
            {evolveAction}
            {reuseAction}
          </div>
          <div className="artifact-review-actions" aria-label={`Review ${artifact.name}`}>
            {acceptAction}
            {rejectAction}
            {archiveAction}
          </div>
          {promotionAction}
          {canonAction}
        </>}
        <details className="artifact-details">
          <summary><span><Icon name="history" size={15} /> Details &amp; history</span><small>{decisions.length ? `${decisions.length} ${decisions.length === 1 ? "decision" : "decisions"}` : "Lineage + settings"}</small></summary>
          <DecisionHistory decisions={decisions} />
          {continuity ? <section className="artifact-continuity-stamp" aria-label="Generation continuity stamp">
            <header><span><Icon name="shield" size={14} /><strong>{continuity.records.world.name}</strong></span><em className={continuityDrifted ? "lineage-drift" : "lineage-current"}>{continuityDrifted ? `Historical v${continuity.records.world.version}` : `Current v${continuity.records.world.version}`}</em></header>
            <p>{continuity.directive.text}</p>
            <div>{continuity.records.entities.map((entity) => <span key={entity.id}>{entity.name} · v{entity.version}</span>)}<span>{continuity.records.rules.length} rules</span><span>{continuity.records.references.length} canon refs</span></div>
          </section> : null}
          <div className="lineage-panel">
            <span>DNA <code>{artifact.dnaArtifactId}</code></span>
            {artifact.settingsStamp.evolution ? <span>Evolution <b>{artifact.settingsStamp.evolution.role}</b> · study <code>{artifact.settingsStamp.evolution.studyId}</code></span> : null}
            {artifact.settingsStamp.outputBatch ? <span>Output <b>{artifact.settingsStamp.outputBatch.index} of {artifact.settingsStamp.outputBatch.count}</b> · batch <code>{artifact.settingsStamp.outputBatch.batchId}</code></span> : null}
            {artifact.settingsStamp.videoVariant ? <span>Direction <b>{videoRole}</b> · {artifact.settingsStamp.videoVariant.personalStyleWeight}% personal / {artifact.settingsStamp.videoVariant.randomDnaWeight}% random DNA</span> : null}
            {videoSpeech ? <span>Speech <b>{videoSpeechSummary(videoSpeech)}</b></span> : null}
            {artifact.settingsStamp.promptReference ? <span>Prompt inspiration <b>{artifact.settingsStamp.promptReference.name}</b> · {artifact.settingsStamp.promptReference.source} {artifact.settingsStamp.promptReference.kind}</span> : null}
            {promptEnhancement ? <>
              <span>{videoPromptEnhancement ? "Video prompt" : "Song prompt"} <b>{promptEnhancement.targetModel ?? artifact.settingsStamp.workflow?.name ?? "selected model"}</b> · Gemma 4 · {promptEnhancement.sourceWordCount} → {promptEnhancement.enhancedWordCount} words{videoPromptEnhancement?.editedAfterEnhancement ? " · edited after enhancement" : ""}</span>
              <details className="lineage-prompt" open><summary>{videoPromptEnhancement ? "Exact motion prompt sent to the video model" : "Exact caption sent to the music model"}</summary><pre>{exactEnhancedPrompt}</pre></details>
              <details className="lineage-prompt"><summary>{videoPromptEnhancement ? "Original motion brief before Gemma enhancement · lineage only" : "Authored brief before Gemma formatting · lineage only"}</summary><p>{promptEnhancement.sourcePrompt}</p></details>
            </> : null}
            <span>Job <code>{artifact.jobId}</code></span>
            <span>Retention <b>{artifact.retention.state}</b>{artifact.retention.size ? ` · ${Math.ceil(artifact.retention.size / 1024)} KB` : ""}</span>
            <span>Settings <b>{artifact.settingsStamp.source}</b>{artifact.settingsStamp.workflow ? ` · ${artifact.settingsStamp.workflow.name} v${artifact.settingsStamp.workflow.version}` : ""}</span>
            <span>Stamp <code>{artifact.settingsStamp.workflow?.contentHash ?? artifact.settingsStamp.createdAt}</code></span>
            <span>CreativeDNA training <b>{training?.status ?? "candidate"}</b></span>
            <span>Decisions <b>{decisions.length}</b></span>
            {artifact.settingsStamp.models.map((model) => <small key={model}>model · {model}</small>)}
          </div>
        </details>
        {training?.status === "training-ready" ? <button className="btn btn-primary artifact-continue-loop" onClick={onContinueLoop}><Icon name="dna" size={16} /> Continue production loop</button> : null}
      </div>
    </article>
  );
}

type ArtifactCardSharedProps = Omit<Parameters<typeof ArtifactCard>[0], "artifact" | "focused">;

function EvolutionStudyGroup({ study, artifacts, cardProps, focusArtifactId }: { study: EvolutionStudy; artifacts: Artifact[]; cardProps: ArtifactCardSharedProps; focusArtifactId?: string }) {
  const branches = study.branches.map((branch) => ({ branch, artifact: artifacts.find((item) => item.id === branch.artifactId) }));
  const mediaBranches = branches.filter((item): item is typeof item & { artifact: Artifact } => Boolean(item.artifact));
  const activeRuns = branches.filter(({ branch, artifact }) => !artifact && (branch.status === "queued" || branch.status === "running" || branch.status === "retaining"));
  const runsWithoutMedia = branches.filter(({ branch, artifact }) => !artifact && branch.status !== "queued" && branch.status !== "running" && branch.status !== "retaining");
  const renderRun = ({ branch }: (typeof branches)[number]) => <li key={branch.jobId}><span className={`state-pill ${branch.status}`}>{branch.status}</span><strong>{branch.role[0].toUpperCase() + branch.role.slice(1)}</strong><small>{branch.modality} · {branch.jobId}</small></li>;
  return <article className="evolution-study glass">
    <header><span><small>Direction board · {new Date(study.createdAt).toLocaleString()}</small><h2>{study.sourceName}</h2></span><span className="evolution-study-count">{mediaBranches.length} {mediaBranches.length === 1 ? "result" : "results"} · {study.branches.length} {study.branches.length === 1 ? "run" : "runs"}</span></header>
    <p className="evolution-board-help">Compare the directions together. On phone, swipe sideways; accept the strongest result and keep its exact recipe.</p>
    <details className="evolution-study-context-details"><summary>Shared world direction</summary><div className="evolution-study-context"><span><b>Canon</b>{study.canon.identity || "Not set"}</span><span><b>Current direction</b>{study.canon.currentDirection || "Not set"}</span></div></details>
    {activeRuns.length ? <ol className="evolution-active-runs" aria-label="Active evolution runs">{activeRuns.map(renderRun)}</ol> : null}
    <div className="evolution-branch-grid">
      {mediaBranches.map(({ branch, artifact }, index) => <section className="evolution-branch" key={branch.jobId}>
          <div className="evolution-branch-label"><b>{String.fromCharCode(65 + index)}</b><span className={`state-pill ${branch.status}`}>{branch.status}</span><strong>{branch.role[0].toUpperCase() + branch.role.slice(1)}</strong><small>{branch.modality}</small></div>
          <ArtifactCard {...cardProps} artifact={artifact} focused={focusArtifactId === artifact.id} />
        </section>)}
    </div>
    {runsWithoutMedia.length ? <details className="evolution-no-media"><summary><span><Icon name="history" size={15} /><strong>{runsWithoutMedia.length} {runsWithoutMedia.length === 1 ? "run" : "runs"} without media</strong></span><small>Cancelled, failed, or superseded</small></summary><ol>{runsWithoutMedia.map(renderRun)}</ol></details> : null}
  </article>;
}

function LearnedNotice({ signals, onClose }: { signals: CreativeTasteSignal[]; onClose: () => void }) {
  if (!signals.length) return null;
  return <div className="creative-learned" role="status"><Icon name="dna" size={18} /><span><strong>Creative Studio learned from that decision</strong>{signals.map((signal) => <small key={signal.id}><b>{signal.kind}</b> · {signal.text}</small>)}</span><button className="icon-button" aria-label="Close learned feedback" onClick={onClose}><Icon name="close" size={15} /></button></div>;
}

export type ArtifactsViewProps = { onReuse: (artifact: Artifact) => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; onEvolve: (artifactId: string) => void; onAnimate: (artifactId: string) => void; onAnimateFourWay: (artifactId: string) => void; focusArtifactId?: string; embedded?: boolean; compact?: boolean };

export function ArtifactsView({ onReuse, onContinueLoop, onExtendVideo, onEvolve, onAnimate, onAnimateFourWay, focusArtifactId, embedded = false, compact = embedded }: ArtifactsViewProps) {
  const { snapshot, activeProjectId, error, busy, reviewArtifact, loadArtifactHistory, promoteArtifactToCanon } = useStudio();
  const [inspected, setInspected] = useState<Artifact | null>(null);
  const [playingVideo, setPlayingVideo] = useState<Artifact | null>(null);
  const [reviewIntent, setReviewIntent] = useState<ReviewIntent | null>(null);
  const [canonIntent, setCanonIntent] = useState<CanonIntent | null>(null);
  const [learnedSignals, setLearnedSignals] = useState<CreativeTasteSignal[]>([]);
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<ArtifactKindFilter>("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyCursor, setHistoryCursor] = useState<{ createdAt: string; artifactId: string } | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyTotal, setHistoryTotal] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeLoadedArtifactIds, setActiveLoadedArtifactIds] = useState<string[]>([]);
  const activeRequestGenerationRef = useRef(0);
  const [archivedCursor, setArchivedCursor] = useState<{ createdAt: string; artifactId: string } | null>(null);
  const [archivedHasMore, setArchivedHasMore] = useState(false);
  const [archivedTotal, setArchivedTotal] = useState<number | null>(null);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedLoadedArtifactIds, setArchivedLoadedArtifactIds] = useState<string[]>([]);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archivedRequestGenerationRef = useRef(0);
  const [activeVisibleCount, setActiveVisibleCount] = useState(ARTIFACT_PAGE_SIZE);
  const [archivedVisibleCount, setArchivedVisibleCount] = useState(ARTIFACT_PAGE_SIZE);
  const artifacts = useMemo(() => snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.artifacts]);
  const studies = useMemo(() => snapshot?.evolutionStudies?.filter((study) => study.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.evolutionStudies]);
  const activeHistory = useMemo(() => loadedArtifactHistory(artifacts, studies, activeLoadedArtifactIds, {
    boundary: "active",
    statuses: statusFilter === "all" ? undefined : [statusFilter],
    kinds: kindFilter === "all" ? undefined : [kindFilter],
    search: historySearch || undefined,
  }, focusArtifactId), [activeLoadedArtifactIds, artifacts, focusArtifactId, historySearch, kindFilter, statusFilter, studies]);
  const focusedIndex = focusArtifactId ? activeHistory.findIndex((entry) => artifactsForHistoryEntry(entry, artifacts).some((artifact) => artifact.id === focusArtifactId)) : -1;
  const focusVisibleCount = focusedIndex < 0 ? 0 : Math.ceil((focusedIndex + 1) / ARTIFACT_PAGE_SIZE) * ARTIFACT_PAGE_SIZE;
  const effectiveActiveVisibleCount = Math.max(activeVisibleCount, focusVisibleCount);
  const visibleActiveHistory = activeHistory.slice(0, effectiveActiveVisibleCount);
  const archivedHistory = useMemo(() => loadedArtifactHistory(artifacts, studies, archivedLoadedArtifactIds, {
    boundary: "archived",
    kinds: kindFilter === "all" ? undefined : [kindFilter],
    search: historySearch || undefined,
  }, focusArtifactId), [archivedLoadedArtifactIds, artifacts, focusArtifactId, historySearch, kindFilter, studies]);
  const visibleArchivedHistory = archivedHistory.slice(0, archivedVisibleCount);
  const visibleActiveArtifactCount = useMemo(() => countArtifactsInHistory(visibleActiveHistory, artifacts), [artifacts, visibleActiveHistory]);
  const visibleArchivedArtifactCount = useMemo(() => countArtifactsInHistory(visibleArchivedHistory, artifacts), [artifacts, visibleArchivedHistory]);
  const activeArtifactCount = artifacts.filter((artifact) => artifact.status !== "archived").length;
  const archivedArtifactCount = artifacts.filter((artifact) => artifact.status === "archived").length;
  const projectTaste = snapshot?.tasteMemory?.projects[activeProjectId]?.taste;
  const focusArtifactArchived = Boolean(focusArtifactId && artifacts.some((artifact) => artifact.id === focusArtifactId && artifact.status === "archived"));
  const artifactCounts = (["retaining", "ready", "accepted", "rejected"] as const)
    .map((status) => ({ status, count: artifacts.filter((artifact) => artifact.status === status).length }))
    .filter(({ count }) => count > 0);
  const activeQuerySnapshotHead = useMemo(() => artifacts
    .filter((artifact) => artifactMatchesHistoryFilter(artifact, {
      boundary: "active",
      statuses: statusFilter === "all" ? undefined : [statusFilter],
      kinds: kindFilter === "all" ? undefined : [kindFilter],
      search: historySearch || undefined,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 24)
    .map((artifact) => `${artifact.id}:${artifact.status}:${artifact.updatedAt}`)
    .join("|"), [artifacts, historySearch, kindFilter, statusFilter]);

  useEffect(() => {
    archivedRequestGenerationRef.current += 1;
    const resetFrame = window.requestAnimationFrame(() => {
      setArchivedCursor(null);
      setArchivedHasMore(false);
      setArchivedTotal(null);
      setArchivedLoading(false);
      setArchivedOpen(false);
      setArchivedLoadedArtifactIds([]);
      setArchivedVisibleCount(ARTIFACT_PAGE_SIZE);
    });
    return () => window.cancelAnimationFrame(resetFrame);
  }, [activeProjectId, historySearch, kindFilter]);

  useEffect(() => {
    if (!activeProjectId) return;
    let live = true;
    const requestGeneration = ++activeRequestGenerationRef.current;
    void Promise.resolve().then(async () => {
      if (!live || requestGeneration !== activeRequestGenerationRef.current) return;
      setHistoryLoading(true);
      setHistoryCursor(null);
      setHistoryHasMore(false);
      setActiveLoadedArtifactIds([]);
      setActiveVisibleCount(0);
      try {
        const page = await loadArtifactHistory({
          projectId: activeProjectId,
          limit: 24,
          statuses: statusFilter === "all" ? undefined : [statusFilter],
          kinds: kindFilter === "all" ? undefined : [kindFilter],
          search: historySearch || undefined,
        });
        if (!live || requestGeneration !== activeRequestGenerationRef.current) return;
        setHistoryCursor(page.nextCursor);
        setHistoryHasMore(page.hasMore);
        setHistoryTotal(page.total);
        setActiveLoadedArtifactIds(page.artifacts.map((artifact) => artifact.id));
        setActiveVisibleCount(ARTIFACT_PAGE_SIZE);
      } catch {
        // StudioProvider exposes the normalized request error.
      } finally {
        if (live && requestGeneration === activeRequestGenerationRef.current) setHistoryLoading(false);
      }
    });
    return () => {
      live = false;
      activeRequestGenerationRef.current += 1;
    };
  }, [activeProjectId, activeQuerySnapshotHead, historySearch, kindFilter, loadArtifactHistory, statusFilter]);
  useEffect(() => {
    if (!focusArtifactId) return;
    let scrollFrame = 0;
    const revealFrame = window.requestAnimationFrame(() => {
      if (focusArtifactArchived) setArchivedOpen(true);
      scrollFrame = window.requestAnimationFrame(() => document.getElementById(`artifact-card-${focusArtifactId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    });
    return () => {
      window.cancelAnimationFrame(revealFrame);
      window.cancelAnimationFrame(scrollFrame);
    };
  }, [focusArtifactId, focusArtifactArchived, effectiveActiveVisibleCount]);

  const loadMoreActive = async () => {
    if (effectiveActiveVisibleCount < activeHistory.length) {
      setActiveVisibleCount(Math.min(effectiveActiveVisibleCount + ARTIFACT_PAGE_SIZE, activeHistory.length));
      return;
    }
    if (historyHasMore) {
      if (!historyCursor || historyLoading) return;
      const requestGeneration = ++activeRequestGenerationRef.current;
      setHistoryLoading(true);
      try {
        const page = await loadArtifactHistory({
          projectId: activeProjectId,
          cursor: historyCursor,
          limit: 24,
          statuses: statusFilter === "all" ? undefined : [statusFilter],
          kinds: kindFilter === "all" ? undefined : [kindFilter],
          search: historySearch || undefined,
        });
        if (requestGeneration !== activeRequestGenerationRef.current) return;
        setHistoryCursor(page.nextCursor);
        setHistoryHasMore(page.hasMore);
        setHistoryTotal(page.total);
        setActiveLoadedArtifactIds((current) => [...new Set([...current, ...page.artifacts.map((artifact) => artifact.id)])]);
        setActiveVisibleCount((count) => count + ARTIFACT_PAGE_SIZE);
      } finally {
        if (requestGeneration === activeRequestGenerationRef.current) setHistoryLoading(false);
      }
      return;
    }
  };

  const loadArchived = async (cursor: typeof archivedCursor = null) => {
    if (!activeProjectId || archivedLoading) return;
    const requestGeneration = ++archivedRequestGenerationRef.current;
    setArchivedLoading(true);
    if (!cursor) {
      setArchivedCursor(null);
      setArchivedHasMore(false);
      setArchivedLoadedArtifactIds([]);
      setArchivedVisibleCount(0);
    }
    try {
      const page = await loadArtifactHistory({
        projectId: activeProjectId,
        cursor,
        limit: 24,
        statuses: ["archived"],
        includeArchived: true,
        kinds: kindFilter === "all" ? undefined : [kindFilter],
        search: historySearch || undefined,
      });
      if (requestGeneration !== archivedRequestGenerationRef.current) return;
      setArchivedCursor(page.nextCursor);
      setArchivedHasMore(page.hasMore);
      setArchivedTotal(page.total);
      setArchivedLoadedArtifactIds((current) => cursor
        ? [...new Set([...current, ...page.artifacts.map((artifact) => artifact.id)])]
        : page.artifacts.map((artifact) => artifact.id));
      setArchivedVisibleCount((count) => cursor ? count + ARTIFACT_PAGE_SIZE : ARTIFACT_PAGE_SIZE);
    } finally {
      if (requestGeneration === archivedRequestGenerationRef.current) setArchivedLoading(false);
    }
  };

  const loadMoreArchived = async () => {
    if (archivedVisibleCount < archivedHistory.length) {
      setArchivedVisibleCount((count) => Math.min(count + ARTIFACT_PAGE_SIZE, archivedHistory.length));
      return;
    }
    if (archivedHasMore) {
      if (!archivedCursor || archivedLoading) return;
      await loadArchived(archivedCursor);
    }
  };

  const renderHistoryEntry = (entry: ArtifactHistoryEntry) => entry.kind === "study"
    ? <EvolutionStudyGroup key={entry.key} study={entry.study} artifacts={artifacts} focusArtifactId={focusArtifactId} cardProps={{ onReuse, onInspect: setInspected, onPlayVideo: setPlayingVideo, onReview: setReviewIntent, onMakeCanon: setCanonIntent, onContinueLoop, onExtendVideo, onEvolve, onAnimate, onAnimateFourWay, compact }} />
    : <ArtifactCard key={entry.key} artifact={entry.artifact} onReuse={onReuse} onInspect={setInspected} onPlayVideo={setPlayingVideo} onReview={setReviewIntent} onMakeCanon={setCanonIntent} onContinueLoop={onContinueLoop} onExtendVideo={onExtendVideo} onEvolve={onEvolve} onAnimate={onAnimate} onAnimateFourWay={onAnimateFourWay} focused={focusArtifactId === entry.artifact.id} compact={compact} />;
  return (
    <section className={`artifacts-view fade-up${embedded ? " artifacts-embedded" : ""}`} aria-label={embedded ? "Completed results" : undefined}>
      {!embedded ? <div className="artifacts-toolbar glass">
        <div><strong>{activeArtifactCount}</strong><span>active {activeArtifactCount === 1 ? "item" : "items"}</span>{archivedArtifactCount ? <small>{archivedArtifactCount} archived</small> : null}</div>
        <button type="button" className="btn btn-primary" onClick={onContinueLoop}><Icon name="star" size={16} /> Create new</button>
      </div> : null}
      {artifacts.length ? <div className="artifact-filters" role="toolbar" aria-label="Filter active artifacts">
        <button type="button" className={statusFilter === "all" ? "active" : ""} aria-pressed={statusFilter === "all"} onClick={() => { setStatusFilter("all"); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); }}>All <b>{artifacts.length - artifacts.filter((artifact) => artifact.status === "archived").length}</b></button>
        {artifactCounts.map(({ status, count }) => <button type="button" className={statusFilter === status ? "active" : ""} aria-pressed={statusFilter === status} onClick={() => { setStatusFilter(status); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); }} key={status}>{status} <b>{count}</b></button>)}
        <label><select aria-label="Media type" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as ArtifactKindFilter); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); setArchivedOpen(false); }}><option value="all">All media</option><option value="image">Images</option><option value="video">Videos</option><option value="music">Songs</option></select></label>
        <form className="artifact-search" role="search" onSubmit={(event) => { event.preventDefault(); setHistorySearch(searchDraft.trim()); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); setArchivedOpen(false); }}><Icon name="search" size={13} /><input aria-label="Search artifact history" value={searchDraft} maxLength={120} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search history" /><button type="submit" disabled={historyLoading}>Search</button>{historySearch ? <button type="button" aria-label="Clear history search" onClick={() => { setSearchDraft(""); setHistorySearch(""); }}>Clear</button> : null}</form>
      </div> : null}
      {projectTaste?.signalCount ? <details className="taste-memory-summary glass"><summary><span><Icon name="dna" size={16} /><strong>What Creative Studio has learned</strong></span><small>{projectTaste.signalCount} project signals · {snapshot?.tasteMemory?.personal.signalCount ?? 0} personal signals</small></summary><div><span><b>Preserve</b>{projectTaste.preserve[0]?.text ?? "No preserve signal yet"}</span><span><b>Redirect</b>{projectTaste.redirect[0]?.text ?? "No redirect signal yet"}</span><span><b>Avoid</b>{projectTaste.avoid[0]?.text ?? "No avoid signal yet"}</span></div></details> : null}
      <LearnedNotice signals={learnedSignals} onClose={() => setLearnedSignals([])} />
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="artifact-grid" role="feed" aria-label="Artifact history, newest first">
        {visibleActiveHistory.map(renderHistoryEntry)}
        {!artifacts.length ? <div className="empty-state glass"><Icon name="gallery" size={34} /><h2>No artifacts yet</h2><p>Completed jobs become reviewable artifacts here.</p></div> : null}
        {artifacts.length && !activeHistory.length ? <div className="empty-state glass artifact-filter-empty"><Icon name="search" size={28} /><h2>No matching active work</h2><p>Choose another status or media type. Archived work remains available below.</p></div> : null}
      </div>
      {effectiveActiveVisibleCount < activeHistory.length || historyHasMore ? <div className="artifact-load-more"><button type="button" className="btn btn-ghost" disabled={historyLoading} onClick={() => void loadMoreActive()}>{historyLoading ? "Loading history…" : "Load older work"}<small>{historyTotal !== null ? `${Math.max(0, historyTotal - visibleActiveArtifactCount)} remaining` : "from storage"}</small></button></div> : null}
      <details className="archived-artifacts glass" open={archivedOpen} onToggle={(event) => { const open = event.currentTarget.open; setArchivedOpen(open); if (open) { setArchivedVisibleCount(ARTIFACT_PAGE_SIZE); void loadArchived(null); } else setArchivedVisibleCount(ARTIFACT_PAGE_SIZE); }}>
        <summary><span><Icon name="archive" size={16} /><strong>Archived history</strong></span><small>{archivedTotal === null ? "Hidden · open to load" : `${archivedTotal} hidden ${archivedTotal === 1 ? "item" : "items"}`}</small></summary>
        {archivedOpen ? <><div className="artifact-grid" role="feed" aria-label="Archived artifact history, newest first">{visibleArchivedHistory.map(renderHistoryEntry)}{!archivedLoading && !archivedHistory.length ? <div className="empty-state artifact-filter-empty"><Icon name="archive" size={24} /><h2>No archived work</h2><p>Archived results stay out of the active gallery.</p></div> : null}</div>{archivedVisibleCount < archivedHistory.length || archivedHasMore ? <div className="artifact-load-more"><button type="button" className="btn btn-ghost" disabled={archivedLoading} onClick={() => void loadMoreArchived()}>{archivedLoading ? "Loading…" : "Load older archived"}<small>{archivedTotal !== null ? `${Math.max(0, archivedTotal - visibleArchivedArtifactCount)} remaining` : "from storage"}</small></button></div> : null}</> : null}
      </details>
      {inspected ? <ImageInspector artifact={inspected} onClose={() => setInspected(null)} /> : null}
      {playingVideo ? <VideoInspector artifact={playingVideo} onClose={() => setPlayingVideo(null)} /> : null}
      {reviewIntent ? <ReviewDialog key={`${reviewIntent.artifact.id}-${reviewIntent.decision}`} intent={reviewIntent} busy={busy} onClose={() => setReviewIntent(null)} onConfirm={async (note) => {
        const result = await reviewArtifact(reviewIntent.artifact.id, reviewIntent.decision, note);
        if (snapshot) {
          const learned = compileCreativeTasteMemory({ projects: snapshot.projects, artifacts: [result.artifact], acceptances: [result.acceptance], trainingReviews: [], dnaArtifacts: snapshot.dnaArtifacts });
          setLearnedSignals([...learned.personal.preserve, ...learned.personal.redirect, ...learned.personal.avoid]);
        }
      }} /> : null}
      {canonIntent && snapshot ? <CanonDialog key={canonIntent.artifact.id} intent={canonIntent} worlds={(snapshot.worlds ?? []).filter((world) => world.projectId === canonIntent.artifact.projectId && world.status === "active")} entities={(snapshot.worldEntities ?? []).filter((entity) => entity.projectId === canonIntent.artifact.projectId && entity.status === "active")} busy={busy} onClose={() => setCanonIntent(null)} onPromote={async ({ world, entity, facets, guidance, note }) => {
        const acceptance = [...snapshot.acceptances]
          .filter((decision) => decision.artifactId === canonIntent.artifact.id && decision.decision === "accepted")
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0];
        await promoteArtifactToCanon(world.id, {
          schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION,
          confirmation: "promote-artifact-to-canon",
          projectId: canonIntent.artifact.projectId,
          worldId: world.id,
          entityId: entity.id,
          artifactId: canonIntent.artifact.id,
          facets,
          continuityNotes: facets.map((facet) => ({ facet, value: guidance })),
          note,
          expectedEntityVersion: entity.version,
          acceptanceId: acceptance?.id ?? null,
        });
      }} /> : null}
    </section>
  );
}
