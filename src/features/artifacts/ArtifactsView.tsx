import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { compileCreativeTasteMemory, type Acceptance, type AcceptanceDecision, type Artifact, type CreativeTasteSignal, type EvolutionStudy } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";
import { artifactsForHistoryEntry, orderArtifactHistory, partitionArtifactHistory, type ArtifactHistoryEntry } from "./artifactHistory";

type ReviewIntent = { artifact: Artifact; decision: AcceptanceDecision };
type ActiveStatusFilter = "all" | Exclude<Artifact["status"], "archived">;
type ArtifactKindFilter = "all" | Artifact["kind"];
const ARTIFACT_PAGE_SIZE = 8;

function actorName(actor: Acceptance["actor"]) {
  return actor === "angelo" ? "Angelo" : "Development user";
}

function downloadName(artifact: Artifact) {
  const name = artifact.name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${name || "creative-studio-artifact"}-${artifact.kind}`;
}

function ModalShell({ labelledBy, onClose, className = "", children }: { labelledBy: string; onClose: () => void; className?: string; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previous?.focus();
    };
  }, [onClose]);

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
  if (artifact.kind === "music") {
    return (
      <section className="artifact-audio-review" aria-label={`Audio review for ${artifact.name}`}>
        <div><Icon name="music" size={18} /><span><strong>Retained audio</strong><small>Listen to the full result before deciding.</small></span></div>
        <audio controls preload="metadata" src={mediaUrl}>Your browser does not support audio playback.</audio>
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
      <footer><span>{artifact.provider} Â· {new Date(artifact.createdAt).toLocaleString()}</span><a className="btn btn-ghost" href={artifact.preview.url} download={downloadName(artifact)}><Icon name="arrow" size={15} /> Download video</a></footer>
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

function DecisionHistory({ decisions }: { decisions: Acceptance[] }) {
  if (!decisions.length) return null;
  return (
    <section className="decision-history" aria-label="Decision history">
      <header><span><Icon name="history" size={15} /> Decision history</span><b>{decisions.length}</b></header>
      <ol>{decisions.map((decision) => <li key={decision.id}><div><span className={`state-pill ${decision.decision}`}>{decision.decision}</span><time dateTime={decision.createdAt}>{new Date(decision.createdAt).toLocaleString()}</time></div><p>{decision.note || "No note recorded."}</p><small>Reviewed by {actorName(decision.actor)}</small></li>)}</ol>
    </section>
  );
}

function ArtifactCard({ artifact, onQueued, onInspect, onPlayVideo, onReview, onContinueLoop, onExtendVideo, onEvolve, onAnimate, focused }: { artifact: Artifact; onQueued: () => void; onInspect: (artifact: Artifact) => void; onPlayVideo: (artifact: Artifact) => void; onReview: (intent: ReviewIntent) => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; onEvolve: (artifactId: string) => void; onAnimate: (artifactId: string) => void; focused: boolean }) {
  const { snapshot, reuseJob, busy } = useStudio();
  const [promptExpanded, setPromptExpanded] = useState(false);
  const decisions = snapshot?.acceptances.filter((item) => item.artifactId === artifact.id) ?? [];
  const training = snapshot?.trainingExamples.find((item) => item.artifactId === artifact.id);
  const prompt = artifact.prompt.replace(/\s+/g, " ").trim();
  const hasLongPrompt = prompt.length > 180;
  const reuse = async () => {
    await reuseJob(artifact.jobId);
    onQueued();
  };
  return (
    <article className={`artifact-card glass${focused ? " cockpit-focus" : ""}`} id={`artifact-card-${artifact.id}`}>
      <div className="artifact-hero">
        <ArtifactThumb artifact={artifact} />
        {artifact.kind === "image" ? <ArtifactMediaReview artifact={artifact} onInspect={() => onInspect(artifact)} /> : null}
        {artifact.kind === "video" && artifact.preview.url ? <button type="button" className="artifact-play" onClick={() => onPlayVideo(artifact)} aria-label={`Play ${artifact.name}`}><Icon name="video" size={17} /><span>Play</span></button> : null}
      </div>
      <div className="artifact-body">
        <div className="artifact-title"><div><span className={`state-pill ${artifact.status}`}>{artifact.status}</span><h3>{artifact.name}</h3></div><Icon name={artifact.kind} size={20} /></div>
        <p className={`artifact-prompt${promptExpanded ? " expanded" : ""}`}>{prompt}</p>
        {hasLongPrompt ? <button type="button" className="artifact-prompt-toggle" aria-expanded={promptExpanded} onClick={() => setPromptExpanded((value) => !value)}>{promptExpanded ? "Show less" : "Read full prompt"}</button> : null}
        <div className="artifact-meta"><span>{artifact.provider}</span><span>{new Date(artifact.createdAt).toLocaleString()}</span></div>
        {artifact.kind !== "image" ? <ArtifactMediaReview artifact={artifact} onInspect={() => undefined} onExtend={artifact.kind === "video" ? () => onExtendVideo(artifact.id) : undefined} /> : null}
        <div className="artifact-actions artifact-create-actions" aria-label={`Create from ${artifact.name}`}>
          {artifact.kind === "image" ? <button className="btn btn-primary artifact-animate" disabled={busy || artifact.status === "retaining"} onClick={() => onAnimate(artifact.id)}><Icon name="video" size={16} /> Animate</button> : null}
          <button className="btn artifact-evolve" disabled={busy || artifact.status === "retaining"} onClick={() => onEvolve(artifact.id)}><Icon name="star" size={16} /> Evolve this</button>
          <button className="btn btn-ghost artifact-reuse" disabled={busy || artifact.status === "retaining"} onClick={() => void reuse()}><Icon name="rerun" size={16} /> Reuse settings</button>
        </div>
        <div className="artifact-review-actions" aria-label={`Review ${artifact.name}`}>
          <button className="btn artifact-accept" disabled={busy || artifact.status === "retaining"} onClick={() => onReview({ artifact, decision: "accepted" })}><Icon name="check" size={16} /> Accept</button>
          <button className="btn artifact-reject" disabled={busy || artifact.status === "retaining"} onClick={() => onReview({ artifact, decision: "rejected" })}><Icon name="close" size={16} /> Reject</button>
          <button className="btn btn-ghost" disabled={busy || artifact.status === "retaining"} onClick={() => onReview({ artifact, decision: "archived" })}><Icon name="archive" size={16} /> Archive</button>
        </div>
        <details className="artifact-details">
          <summary><span><Icon name="history" size={15} /> Details &amp; history</span><small>{decisions.length ? `${decisions.length} ${decisions.length === 1 ? "decision" : "decisions"}` : "Lineage + settings"}</small></summary>
          <DecisionHistory decisions={decisions} />
          <div className="lineage-panel"><span>DNA <code>{artifact.dnaArtifactId}</code></span>{artifact.settingsStamp.evolution ? <span>Evolution <b>{artifact.settingsStamp.evolution.role}</b> · study <code>{artifact.settingsStamp.evolution.studyId}</code></span> : null}{artifact.settingsStamp.videoVariant ? <span>Version <b>{artifact.settingsStamp.videoVariant.role === "aligned" ? "Aligned" : "Discovery"}</b> · {artifact.settingsStamp.videoVariant.personalStyleWeight}% personal / {artifact.settingsStamp.videoVariant.randomDnaWeight}% random DNA</span> : null}{artifact.settingsStamp.promptEnhancement ? <><span>Song prompt <b>{artifact.settingsStamp.promptEnhancement.targetModel ?? artifact.settingsStamp.workflow?.name ?? "selected model"}</b> · Gemma 4 · {artifact.settingsStamp.promptEnhancement.sourceWordCount} → {artifact.settingsStamp.promptEnhancement.enhancedWordCount} words</span><details className="lineage-prompt" open><summary>Exact caption sent to the music model</summary><pre>{artifact.settingsStamp.promptEnhancement.enhancedPrompt}</pre></details><details className="lineage-prompt"><summary>Authored brief before Gemma formatting · lineage only</summary><p>{artifact.settingsStamp.promptEnhancement.sourcePrompt}</p></details></> : null}<span>Job <code>{artifact.jobId}</code></span><span>Retention <b>{artifact.retention.state}</b>{artifact.retention.size ? ` · ${Math.ceil(artifact.retention.size / 1024)} KB` : ""}</span><span>Settings <b>{artifact.settingsStamp.source}</b>{artifact.settingsStamp.workflow ? ` · ${artifact.settingsStamp.workflow.name} v${artifact.settingsStamp.workflow.version}` : ""}</span><span>Stamp <code>{artifact.settingsStamp.workflow?.contentHash ?? artifact.settingsStamp.createdAt}</code></span><span>CreativeDNA training <b>{training?.status ?? "candidate"}</b></span><span>Decisions <b>{decisions.length}</b></span>{artifact.settingsStamp.models.map((model) => <small key={model}>model · {model}</small>)}</div>
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
    <header><span><small>Evolution · {new Date(study.createdAt).toLocaleString()}</small><h2>{study.sourceName}</h2></span><span className="evolution-study-count">{mediaBranches.length} media · {study.branches.length} runs</span></header>
    <details className="evolution-study-context-details"><summary>Study direction</summary><div className="evolution-study-context"><span><b>Canon</b>{study.canon.identity || "Not set"}</span><span><b>Current direction</b>{study.canon.currentDirection || "Not set"}</span></div></details>
    {activeRuns.length ? <ol className="evolution-active-runs" aria-label="Active evolution runs">{activeRuns.map(renderRun)}</ol> : null}
    <div className="evolution-branch-grid">
      {mediaBranches.map(({ branch, artifact }) => <section className="evolution-branch" key={branch.jobId}>
          <div className="evolution-branch-label"><span className={`state-pill ${branch.status}`}>{branch.status}</span><strong>{branch.role[0].toUpperCase() + branch.role.slice(1)}</strong><small>{branch.modality}</small></div>
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

export function ArtifactsView({ onQueued, onContinueLoop, onExtendVideo, onEvolve, onAnimate, focusArtifactId }: { onQueued: () => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; onEvolve: (artifactId: string) => void; onAnimate: (artifactId: string) => void; focusArtifactId?: string }) {
  const { snapshot, activeProjectId, error, busy, reviewArtifact } = useStudio();
  const [inspected, setInspected] = useState<Artifact | null>(null);
  const [playingVideo, setPlayingVideo] = useState<Artifact | null>(null);
  const [reviewIntent, setReviewIntent] = useState<ReviewIntent | null>(null);
  const [learnedSignals, setLearnedSignals] = useState<CreativeTasteSignal[]>([]);
  const [statusFilter, setStatusFilter] = useState<ActiveStatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<ArtifactKindFilter>("all");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [activeVisibleCount, setActiveVisibleCount] = useState(ARTIFACT_PAGE_SIZE);
  const [archivedVisibleCount, setArchivedVisibleCount] = useState(ARTIFACT_PAGE_SIZE);
  const activeLoadMore = useRef<HTMLButtonElement>(null);
  const artifacts = useMemo(() => snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.artifacts]);
  const studies = useMemo(() => snapshot?.evolutionStudies?.filter((study) => study.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.evolutionStudies]);
  const history = useMemo(() => orderArtifactHistory(artifacts, studies), [artifacts, studies]);
  const partitionedHistory = useMemo(() => partitionArtifactHistory(history, artifacts), [artifacts, history]);
  const activeHistory = useMemo(() => partitionedHistory.active.filter((entry) => artifactsForHistoryEntry(entry, artifacts).some((artifact) => (statusFilter === "all" || artifact.status === statusFilter) && (kindFilter === "all" || artifact.kind === kindFilter))), [artifacts, kindFilter, partitionedHistory.active, statusFilter]);
  const focusedIndex = focusArtifactId ? activeHistory.findIndex((entry) => artifactsForHistoryEntry(entry, artifacts).some((artifact) => artifact.id === focusArtifactId)) : -1;
  const focusVisibleCount = focusedIndex < 0 ? 0 : Math.ceil((focusedIndex + 1) / ARTIFACT_PAGE_SIZE) * ARTIFACT_PAGE_SIZE;
  const effectiveActiveVisibleCount = Math.max(activeVisibleCount, focusVisibleCount);
  const visibleActiveHistory = activeHistory.slice(0, effectiveActiveVisibleCount);
  const visibleArchivedHistory = partitionedHistory.archived.slice(0, archivedVisibleCount);
  const projectTaste = snapshot?.tasteMemory?.projects[activeProjectId]?.taste;
  const focusArtifactArchived = Boolean(focusArtifactId && artifacts.some((artifact) => artifact.id === focusArtifactId && artifact.status === "archived"));
  const artifactCounts = (["retaining", "ready", "accepted", "rejected"] as const)
    .map((status) => ({ status, count: artifacts.filter((artifact) => artifact.status === status).length }))
    .filter(({ count }) => count > 0);
  useEffect(() => {
    const trigger = activeLoadMore.current;
    if (!trigger || effectiveActiveVisibleCount >= activeHistory.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setActiveVisibleCount(Math.min(effectiveActiveVisibleCount + ARTIFACT_PAGE_SIZE, activeHistory.length));
    }, { rootMargin: "600px 0px" });
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [activeHistory.length, effectiveActiveVisibleCount]);
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

  const renderHistoryEntry = (entry: ArtifactHistoryEntry) => entry.kind === "study"
    ? <EvolutionStudyGroup key={entry.key} study={entry.study} artifacts={artifacts} focusArtifactId={focusArtifactId} cardProps={{ onQueued, onInspect: setInspected, onPlayVideo: setPlayingVideo, onReview: setReviewIntent, onContinueLoop, onExtendVideo, onEvolve, onAnimate }} />
    : <ArtifactCard key={entry.key} artifact={entry.artifact} onQueued={onQueued} onInspect={setInspected} onPlayVideo={setPlayingVideo} onReview={setReviewIntent} onContinueLoop={onContinueLoop} onExtendVideo={onExtendVideo} onEvolve={onEvolve} onAnimate={onAnimate} focused={focusArtifactId === entry.artifact.id} />;
  return (
    <section className="artifacts-view fade-up">
      <div className="artifacts-toolbar glass">
        <div><strong>{partitionedHistory.active.length}</strong><span>active {partitionedHistory.active.length === 1 ? "item" : "items"}</span>{partitionedHistory.archived.length ? <small>{partitionedHistory.archived.length} archived</small> : null}</div>
        <button type="button" className="btn btn-primary" onClick={onContinueLoop}><Icon name="star" size={16} /> Create new</button>
      </div>
      {artifacts.length ? <div className="artifact-filters" role="toolbar" aria-label="Filter active artifacts">
        <button type="button" className={statusFilter === "all" ? "active" : ""} aria-pressed={statusFilter === "all"} onClick={() => { setStatusFilter("all"); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); }}>All <b>{artifacts.length - artifacts.filter((artifact) => artifact.status === "archived").length}</b></button>
        {artifactCounts.map(({ status, count }) => <button type="button" className={statusFilter === status ? "active" : ""} aria-pressed={statusFilter === status} onClick={() => { setStatusFilter(status); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); }} key={status}>{status} <b>{count}</b></button>)}
        <label><select aria-label="Media type" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as ArtifactKindFilter); setActiveVisibleCount(ARTIFACT_PAGE_SIZE); }}><option value="all">All media</option><option value="image">Images</option><option value="video">Videos</option><option value="music">Songs</option><option value="3d">3D</option></select></label>
      </div> : null}
      {projectTaste?.signalCount ? <details className="taste-memory-summary glass"><summary><span><Icon name="dna" size={16} /><strong>What Creative Studio has learned</strong></span><small>{projectTaste.signalCount} project signals · {snapshot?.tasteMemory?.personal.signalCount ?? 0} personal signals</small></summary><div><span><b>Preserve</b>{projectTaste.preserve[0]?.text ?? "No preserve signal yet"}</span><span><b>Redirect</b>{projectTaste.redirect[0]?.text ?? "No redirect signal yet"}</span><span><b>Avoid</b>{projectTaste.avoid[0]?.text ?? "No avoid signal yet"}</span></div></details> : null}
      <LearnedNotice signals={learnedSignals} onClose={() => setLearnedSignals([])} />
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="artifact-grid" role="feed" aria-label="Artifact history, newest first">
        {visibleActiveHistory.map(renderHistoryEntry)}
        {!artifacts.length ? <div className="empty-state glass"><Icon name="gallery" size={34} /><h2>No artifacts yet</h2><p>Completed jobs become reviewable artifacts here.</p></div> : null}
        {artifacts.length && !activeHistory.length ? <div className="empty-state glass artifact-filter-empty"><Icon name="search" size={28} /><h2>No matching active work</h2><p>Choose another status or media type. Archived work remains available below.</p></div> : null}
      </div>
      {effectiveActiveVisibleCount < activeHistory.length ? <div className="artifact-load-more"><button ref={activeLoadMore} type="button" className="btn btn-ghost" onClick={() => setActiveVisibleCount(Math.min(effectiveActiveVisibleCount + ARTIFACT_PAGE_SIZE, activeHistory.length))}>Load more <small>{activeHistory.length - effectiveActiveVisibleCount} remaining</small></button></div> : null}
      {partitionedHistory.archived.length ? <details className="archived-artifacts glass" open={archivedOpen} onToggle={(event) => { const open = event.currentTarget.open; setArchivedOpen(open); if (!open) setArchivedVisibleCount(ARTIFACT_PAGE_SIZE); }}>
        <summary><span><Icon name="archive" size={16} /><strong>Archived history</strong></span><small>{partitionedHistory.archived.length} hidden {partitionedHistory.archived.length === 1 ? "item" : "items"}</small></summary>
        {archivedOpen ? <><div className="artifact-grid" role="feed" aria-label="Archived artifact history, newest first">{visibleArchivedHistory.map(renderHistoryEntry)}</div>{archivedVisibleCount < partitionedHistory.archived.length ? <div className="artifact-load-more"><button type="button" className="btn btn-ghost" onClick={() => setArchivedVisibleCount((count) => Math.min(count + ARTIFACT_PAGE_SIZE, partitionedHistory.archived.length))}>Load more archived <small>{partitionedHistory.archived.length - archivedVisibleCount} remaining</small></button></div> : null}</> : null}
      </details> : null}
      {inspected ? <ImageInspector artifact={inspected} onClose={() => setInspected(null)} /> : null}
      {playingVideo ? <VideoInspector artifact={playingVideo} onClose={() => setPlayingVideo(null)} /> : null}
      {reviewIntent ? <ReviewDialog key={`${reviewIntent.artifact.id}-${reviewIntent.decision}`} intent={reviewIntent} busy={busy} onClose={() => setReviewIntent(null)} onConfirm={async (note) => {
        const result = await reviewArtifact(reviewIntent.artifact.id, reviewIntent.decision, note);
        if (snapshot) {
          const learned = compileCreativeTasteMemory({ projects: snapshot.projects, artifacts: [result.artifact], acceptances: [result.acceptance], trainingReviews: [], dnaArtifacts: snapshot.dnaArtifacts });
          setLearnedSignals([...learned.personal.preserve, ...learned.personal.redirect, ...learned.personal.avoid]);
        }
      }} /> : null}
    </section>
  );
}
