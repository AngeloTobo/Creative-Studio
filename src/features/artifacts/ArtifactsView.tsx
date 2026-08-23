import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Acceptance, AcceptanceDecision, Artifact } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";

type ReviewIntent = { artifact: Artifact; decision: AcceptanceDecision };

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

function ArtifactCard({ artifact, onQueued, onInspect, onReview, onContinueLoop, onExtendVideo, focused }: { artifact: Artifact; onQueued: () => void; onInspect: (artifact: Artifact) => void; onReview: (intent: ReviewIntent) => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; focused: boolean }) {
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
        <p>{artifact.prompt}</p>
        <div className="artifact-meta"><span>{artifact.provider}</span><span>{new Date(artifact.createdAt).toLocaleString()}</span></div>
        <ArtifactMediaReview artifact={artifact} onInspect={() => artifact.kind === "image" && onInspect(artifact)} onExtend={artifact.kind === "video" ? () => onExtendVideo(artifact.id) : undefined} />
        <DecisionHistory decisions={decisions} />
        <button className="lineage-toggle" onClick={() => setExpanded((value) => !value)}><Icon name="history" size={15} /> {expanded ? "Hide lineage" : "Show lineage"}</button>
        {expanded ? <div className="lineage-panel"><span>DNA <code>{artifact.dnaArtifactId}</code></span><span>Job <code>{artifact.jobId}</code></span><span>Retention <b>{artifact.retention.state}</b>{artifact.retention.size ? ` · ${Math.ceil(artifact.retention.size / 1024)} KB` : ""}</span><span>Settings <b>{artifact.settingsStamp.source}</b>{artifact.settingsStamp.workflow ? ` · ${artifact.settingsStamp.workflow.name} v${artifact.settingsStamp.workflow.version}` : ""}</span><span>Stamp <code>{artifact.settingsStamp.workflow?.contentHash ?? artifact.settingsStamp.createdAt}</code></span><span>CreativeDNA training <b>{training?.status ?? "candidate"}</b></span><span>Decisions <b>{decisions.length}</b></span>{artifact.settingsStamp.models.map((model) => <small key={model}>model · {model}</small>)}</div> : null}
        <div className="artifact-actions">
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

export function ArtifactsView({ onQueued, onContinueLoop, onExtendVideo, focusArtifactId }: { onQueued: () => void; onContinueLoop: () => void; onExtendVideo: (artifactId: string) => void; focusArtifactId?: string }) {
  const { snapshot, activeProjectId, error, busy, reviewArtifact } = useStudio();
  const [inspected, setInspected] = useState<Artifact | null>(null);
  const [reviewIntent, setReviewIntent] = useState<ReviewIntent | null>(null);
  const artifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
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
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="artifact-grid">
        {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} onQueued={onQueued} onInspect={setInspected} onReview={setReviewIntent} onContinueLoop={onContinueLoop} onExtendVideo={onExtendVideo} focused={focusArtifactId === artifact.id} />)}
        {!artifacts.length ? <div className="empty-state glass"><Icon name="gallery" size={34} /><h2>No artifacts yet</h2><p>Completed jobs become reviewable artifacts here.</p></div> : null}
      </div>
      {inspected ? <ImageInspector artifact={inspected} onClose={() => setInspected(null)} /> : null}
      {reviewIntent ? <ReviewDialog key={`${reviewIntent.artifact.id}-${reviewIntent.decision}`} intent={reviewIntent} busy={busy} onClose={() => setReviewIntent(null)} onConfirm={(note) => reviewArtifact(reviewIntent.artifact.id, reviewIntent.decision, note)} /> : null}
    </section>
  );
}
