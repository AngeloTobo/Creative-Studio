import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { compileCreativeTasteMemory, type Acceptance, type AcceptanceDecision, type Artifact, type CreativeTasteSignal, type EvolutionStudy } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";
import { orderArtifactHistory } from "./artifactHistory";

type ReviewIntent = { artifact: Artifact; decision: AcceptanceDecision };

function actorName(actor: Acceptance["actor"]) {
  return actor === "angelo" ? "Angelo" : "Development user";
}

function downloadName(artifact: Artifact) {
  const name = artifact.name.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${name || "creative-studio-artifact"}-${artifact.kind}`;
}

function compactArtifactPrompt(artifact: Artifact) {
  const prompt = artifact.prompt.replace(/\s+/g, " ").trim();
  if (prompt.length <= 320) return prompt;
  const sentence = prompt.slice(0, 321);
  const boundary = Math.max(sentence.lastIndexOf(". "), sentence.lastIndexOf("; "), sentence.lastIndexOf(", "));
  return `${sentence.slice(0, boundary >= 180 ? boundary + 1 : 317).trim()}…`;
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
  return (
    <section className="decision-history" aria-label="Decision history">
      <header><span><Icon name="history" size={15} /> Decision history</span><b>{decisions.length}</b></header>
      {decisions.length ? <ol>{decisions.map((decision) => <li key={decision.id}><div><span className={`state-pill ${decision.decision}`}>{decision.decision}</span><time dateTime={decision.createdAt}>{new Date(decision.createdAt).toLocaleString()}</time></div><p>{decision.note || "No note recorded."}</p><small>Reviewed by {actorName(decision.actor)}</small></li>)}</ol> : <p className="decision-empty">No decisions recorded yet.</p>}
    </section>
  );
}

function ArtifactCard({ artifact, onQueued, onInspect, onReview, onContinueLoop, onExtendVideo, onEvolve, focused }: { artifact: Artifact; onQueued: () => void; onInspect: (artifact: Artifact) => void; onReview: (intent: ReviewIntent) => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; onEvolve: (artifactId: string) => void; focused: boolean }) {
  const { snapshot, reuseJob, busy } = useStudio();
  const [expanded, setExpanded] = useState(false);
  const decisions = snapshot?.acceptances.filter((item) => item.artifactId === artifact.id) ?? [];
  const training = snapshot?.trainingExamples.find((item) => item.artifactId === artifact.id);
  const reuse = async () => {
    await reuseJob(artifact.jobId);
    onQueued();
  };
  return (
    <article className={`artifact-card glass${focused ? " cockpit-focus" : ""}`} id={`artifact-card-${artifact.id}`}>
      <ArtifactThumb artifact={artifact} playable />
      <div className="artifact-body">
        <div className="artifact-title"><div><span className={`state-pill ${artifact.status}`}>{artifact.status}</span><h3>{artifact.name}</h3></div><Icon name={artifact.kind} size={20} /></div>
        <p>{compactArtifactPrompt(artifact)}</p>
        <div className="artifact-meta"><span>{artifact.provider}</span><span>{new Date(artifact.createdAt).toLocaleString()}</span></div>
        <ArtifactMediaReview artifact={artifact} onInspect={() => artifact.kind === "image" && onInspect(artifact)} onExtend={artifact.kind === "video" ? () => onExtendVideo(artifact.id) : undefined} />
        <DecisionHistory decisions={decisions} />
        <button className="lineage-toggle" onClick={() => setExpanded((value) => !value)}><Icon name="history" size={15} /> {expanded ? "Hide lineage" : "Show lineage"}</button>
        {expanded ? <div className="lineage-panel"><span>DNA <code>{artifact.dnaArtifactId}</code></span>{artifact.settingsStamp.evolution ? <span>Evolution <b>{artifact.settingsStamp.evolution.role}</b> · study <code>{artifact.settingsStamp.evolution.studyId}</code></span> : null}{artifact.settingsStamp.videoVariant ? <span>Version <b>{artifact.settingsStamp.videoVariant.role === "aligned" ? "Aligned" : "Discovery"}</b> · {artifact.settingsStamp.videoVariant.personalStyleWeight}% personal / {artifact.settingsStamp.videoVariant.randomDnaWeight}% random DNA</span> : null}{artifact.settingsStamp.promptEnhancement ? <><span>Song prompt <b>{artifact.settingsStamp.promptEnhancement.targetModel ?? artifact.settingsStamp.workflow?.name ?? "selected model"}</b> · Gemma 4 · {artifact.settingsStamp.promptEnhancement.sourceWordCount} → {artifact.settingsStamp.promptEnhancement.enhancedWordCount} words</span><details className="lineage-prompt" open><summary>Exact caption sent to the music model</summary><pre>{artifact.settingsStamp.promptEnhancement.enhancedPrompt}</pre></details><details className="lineage-prompt"><summary>Authored brief before Gemma formatting · lineage only</summary><p>{artifact.settingsStamp.promptEnhancement.sourcePrompt}</p></details></> : null}<span>Job <code>{artifact.jobId}</code></span><span>Retention <b>{artifact.retention.state}</b>{artifact.retention.size ? ` · ${Math.ceil(artifact.retention.size / 1024)} KB` : ""}</span><span>Settings <b>{artifact.settingsStamp.source}</b>{artifact.settingsStamp.workflow ? ` · ${artifact.settingsStamp.workflow.name} v${artifact.settingsStamp.workflow.version}` : ""}</span><span>Stamp <code>{artifact.settingsStamp.workflow?.contentHash ?? artifact.settingsStamp.createdAt}</code></span><span>CreativeDNA training <b>{training?.status ?? "candidate"}</b></span><span>Decisions <b>{decisions.length}</b></span>{artifact.settingsStamp.models.map((model) => <small key={model}>model · {model}</small>)}</div> : null}
        <div className="artifact-actions">
          <button className="btn artifact-evolve" disabled={busy || artifact.status === "retaining"} onClick={() => onEvolve(artifact.id)}><Icon name="star" size={16} /> Evolve this</button>
          <button className="btn btn-ghost artifact-reuse" disabled={busy || artifact.status === "retaining"} onClick={() => void reuse()}><Icon name="rerun" size={16} /> Reuse settings</button>
          <button className="btn artifact-accept" disabled={busy || artifact.status === "retaining"} onClick={() => onReview({ artifact, decision: "accepted" })}><Icon name="check" size={16} /> Accept</button>
          <button className="btn artifact-reject" disabled={busy || artifact.status === "retaining"} onClick={() => onReview({ artifact, decision: "rejected" })}><Icon name="close" size={16} /> Reject</button>
          <button className="btn btn-ghost" disabled={busy || artifact.status === "retaining"} onClick={() => onReview({ artifact, decision: "archived" })}><Icon name="archive" size={16} /> Archive</button>
        </div>
        {training?.status === "training-ready" ? <button className="btn btn-primary artifact-continue-loop" onClick={onContinueLoop}><Icon name="dna" size={16} /> Continue production loop</button> : null}
      </div>
    </article>
  );
}

type ArtifactCardSharedProps = Omit<Parameters<typeof ArtifactCard>[0], "artifact" | "focused">;

function EvolutionStudyGroup({ study, artifacts, cardProps }: { study: EvolutionStudy; artifacts: Artifact[]; cardProps: ArtifactCardSharedProps }) {
  return <article className="evolution-study glass">
    <header><span><small>Evolution study · {new Date(study.createdAt).toLocaleString()}</small><h2>{study.sourceName}</h2></span><span className="evolution-study-count">{study.branches.length} {study.branches.length === 1 ? "result" : "results"}</span></header>
    <div className="evolution-study-context"><span><b>Canon</b>{study.canon.identity || "Not set"}</span><span><b>Current direction</b>{study.canon.currentDirection || "Not set"}</span></div>
    <div className="evolution-branch-grid">
      {study.branches.map((branch) => {
        const artifact = artifacts.find((item) => item.id === branch.artifactId);
        return <section className="evolution-branch" key={branch.jobId}>
          <div className="evolution-branch-label"><span className={`state-pill ${branch.status}`}>{branch.status}</span><strong>{branch.role[0].toUpperCase() + branch.role.slice(1)}</strong><small>{branch.modality}</small></div>
          {artifact ? <ArtifactCard {...cardProps} artifact={artifact} focused={false} /> : <div className="evolution-branch-pending"><Icon name="history" size={22} /><strong>{branch.role[0].toUpperCase() + branch.role.slice(1)} is {branch.status}</strong><small>Job {branch.jobId}</small></div>}
        </section>;
      })}
    </div>
  </article>;
}

function LearnedNotice({ signals, onClose }: { signals: CreativeTasteSignal[]; onClose: () => void }) {
  if (!signals.length) return null;
  return <div className="creative-learned" role="status"><Icon name="dna" size={18} /><span><strong>Creative Studio learned from that decision</strong>{signals.map((signal) => <small key={signal.id}><b>{signal.kind}</b> · {signal.text}</small>)}</span><button className="icon-button" aria-label="Close learned feedback" onClick={onClose}><Icon name="close" size={15} /></button></div>;
}

export function ArtifactsView({ onQueued, onContinueLoop, onExtendVideo, onEvolve, focusArtifactId }: { onQueued: () => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; onEvolve: (artifactId: string) => void; focusArtifactId?: string }) {
  const { snapshot, activeProjectId, error, busy, reviewArtifact } = useStudio();
  const [inspected, setInspected] = useState<Artifact | null>(null);
  const [reviewIntent, setReviewIntent] = useState<ReviewIntent | null>(null);
  const [learnedSignals, setLearnedSignals] = useState<CreativeTasteSignal[]>([]);
  const artifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const studies = snapshot?.evolutionStudies?.filter((study) => study.projectId === activeProjectId) ?? [];
  const history = orderArtifactHistory(artifacts, studies);
  const projectTaste = snapshot?.tasteMemory?.projects[activeProjectId]?.taste;
  const artifactCounts = (["retaining", "ready", "accepted", "rejected", "archived"] as const)
    .map((status) => ({ status, count: artifacts.filter((artifact) => artifact.status === status).length }))
    .filter(({ count }) => count > 0);
  useEffect(() => {
    if (!focusArtifactId) return;
    window.requestAnimationFrame(() => document.getElementById(`artifact-card-${focusArtifactId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [focusArtifactId]);
  return (
    <section className="artifacts-view fade-up">
      <div className="artifact-summary">
        {artifactCounts.map(({ status, count }) => <div className="glass" key={status}><strong>{count}</strong><span>{status}</span></div>)}
      </div>
      {projectTaste?.signalCount ? <details className="taste-memory-summary glass"><summary><span><Icon name="dna" size={16} /><strong>What Creative Studio has learned</strong></span><small>{projectTaste.signalCount} project signals · {snapshot?.tasteMemory?.personal.signalCount ?? 0} personal signals</small></summary><div><span><b>Preserve</b>{projectTaste.preserve[0]?.text ?? "No preserve signal yet"}</span><span><b>Redirect</b>{projectTaste.redirect[0]?.text ?? "No redirect signal yet"}</span><span><b>Avoid</b>{projectTaste.avoid[0]?.text ?? "No avoid signal yet"}</span></div></details> : null}
      <LearnedNotice signals={learnedSignals} onClose={() => setLearnedSignals([])} />
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="artifact-grid" role="feed" aria-label="Artifact history, newest first">
        {history.map((entry) => entry.kind === "study"
          ? <EvolutionStudyGroup key={entry.key} study={entry.study} artifacts={artifacts} cardProps={{ onQueued, onInspect: setInspected, onReview: setReviewIntent, onContinueLoop, onExtendVideo, onEvolve }} />
          : <ArtifactCard key={entry.key} artifact={entry.artifact} onQueued={onQueued} onInspect={setInspected} onReview={setReviewIntent} onContinueLoop={onContinueLoop} onExtendVideo={onExtendVideo} onEvolve={onEvolve} focused={focusArtifactId === entry.artifact.id} />)}
        {!artifacts.length ? <div className="empty-state glass"><Icon name="gallery" size={34} /><h2>No artifacts yet</h2><p>Completed jobs become reviewable artifacts here.</p></div> : null}
      </div>
      {inspected ? <ImageInspector artifact={inspected} onClose={() => setInspected(null)} /> : null}
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
