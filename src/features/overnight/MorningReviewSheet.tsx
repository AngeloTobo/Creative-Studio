import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AcceptanceDecision, Artifact, OvernightSession, OvernightTask } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { latestAcceptance } from "./overnightPresentation";
import { useOvernightDialog } from "./useOvernightDialog";
import "./OvernightStudio.css";

export type MorningReviewSheetProps = {
  open: boolean;
  session: OvernightSession | null;
  onClose: () => void;
  onComplete?: (sessionId: string) => void;
};

type ReviewItem = {
  task: OvernightTask;
  artifact: Artifact;
};

function ReviewMedia({ artifact }: { artifact: Artifact }) {
  const source = artifact.preview.url;
  if (!source) return <div className="morning-review-no-media"><Icon name={artifact.kind === "music" ? "music" : artifact.kind} size={34} /><strong>Retained media is not available yet.</strong></div>;
  if (artifact.kind === "image") return <img src={source} alt={artifact.name} loading="eager" decoding="async" />;
  if (artifact.kind === "video") return <video src={source} poster={artifact.preview.posterUrl ?? undefined} controls playsInline preload="metadata" aria-label={artifact.name} />;
  return <div className="morning-review-audio"><span><Icon name="music" size={30} /><strong>{artifact.name}</strong></span><audio src={source} controls preload="metadata" /></div>;
}

function MorningReviewDialog({ session, onClose, onComplete }: Omit<MorningReviewSheetProps, "open" | "session"> & { session: OvernightSession }) {
  const { snapshot, reviewArtifact, loadArtifactHistory, busy } = useStudio();
  const panelRef = useOvernightDialog<HTMLElement>(true, onClose);
  const titleId = useId();
  const artifactSnapshotRef = useRef(snapshot?.artifacts ?? []);
  const requiredArtifactIds = useMemo(() => session.tasks.flatMap((task) => task.status === "completed" && task.artifactId ? [task.artifactId] : []), [session.tasks]);
  const [note, setNote] = useState("");
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const [historyArtifacts, setHistoryArtifacts] = useState<Artifact[]>([]);
  const [hydrating, setHydrating] = useState(() => {
    const available = new Set((snapshot?.artifacts ?? []).map((artifact) => artifact.id));
    return requiredArtifactIds.some((artifactId) => !available.has(artifactId));
  });
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const targetIds = new Set(requiredArtifactIds);
    const found = new Map(artifactSnapshotRef.current.map((artifact) => [artifact.id, artifact]));
    if ([...targetIds].every((artifactId) => found.has(artifactId))) return;
    let cancelled = false;
    void (async () => {
      try {
        let cursor = null;
        for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
          const page = await loadArtifactHistory({ projectId: session.projectId, cursor, limit: 50, includeArchived: true });
          if (cancelled) return;
          page.artifacts.forEach((artifact) => found.set(artifact.id, artifact));
          if ([...targetIds].every((artifactId) => found.has(artifactId)) || !page.hasMore || !page.nextCursor) break;
          cursor = page.nextCursor;
        }
        if (!cancelled) setHistoryArtifacts([...found.values()].filter((artifact) => targetIds.has(artifact.id)));
      } catch (error) {
        if (!cancelled) setLocalError(error instanceof Error ? error.message : "Creative Studio could not load this run's retained results.");
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadArtifactHistory, requiredArtifactIds, session.projectId]);

  const allItems = useMemo<ReviewItem[]>(() => {
    if (!session || !snapshot) return [];
    const artifacts = new Map([...snapshot.artifacts, ...historyArtifacts].map((artifact) => [artifact.id, artifact]));
    return [...session.tasks]
      .sort((left, right) => left.ordinal - right.ordinal)
      .flatMap((task) => {
        if (task.status !== "completed" || !task.artifactId) return [];
        const artifact = artifacts.get(task.artifactId);
        return artifact ? [{ task, artifact }] : [];
      });
  }, [historyArtifacts, session, snapshot]);

  const decidedIds = useMemo(() => new Set(allItems.flatMap(({ artifact }) => (
    artifact.status !== "ready" || latestAcceptance(snapshot?.acceptances ?? [], artifact.id) ? [artifact.id] : []
  ))), [allItems, snapshot?.acceptances]);
  const pending = allItems.filter(({ artifact }) => !decidedIds.has(artifact.id) && !reviewedIds.includes(artifact.id));
  const available = pending.filter(({ artifact }) => !skippedIds.includes(artifact.id));
  const item = available[0] ?? null;
  const decidedCount = allItems.length - pending.length;
  const position = Math.min(allItems.length, decidedCount + skippedIds.length + (item ? 1 : 0));
  const noteReady = note.trim().length >= 3;
  const allDecided = allItems.length > 0 && pending.length === 0;
  const skippedOnly = !item && pending.length > 0;

  const decide = async (decision: Extract<AcceptanceDecision, "accepted" | "rejected">) => {
    if (!item || !noteReady || submitting) return;
    setSubmitting(true);
    setLocalError("");
    try {
      await reviewArtifact(item.artifact.id, decision, note.trim());
      setReviewedIds((current) => [...current, item.artifact.id]);
      setNote("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Creative Studio could not save this review.");
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    if (session) onComplete?.(session.id);
    onClose();
  };

  return createPortal(<div className="overnight-backdrop morning-review-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panelRef} className="morning-review-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="morning-review-head">
        <span><small>MORNING REVIEW · {allItems.length ? `${position} / ${allItems.length}` : "NO RESULTS"}</small><strong id={titleId}>{session.name}</strong></span>
        <button type="button" aria-label="Close morning review" onClick={onClose}><Icon name="close" size={18} /></button>
      </header>

      {item ? <>
        <div className="morning-review-media"><ReviewMedia artifact={item.artifact} /><span className="morning-review-kind"><Icon name={item.artifact.kind === "music" ? "music" : item.artifact.kind} size={13} /> {item.artifact.kind}</span></div>
        <div className="morning-review-context">
          <span><small>{item.task.storyTitle}</small><strong>{item.task.sceneTitle?.trim() || item.artifact.name}</strong></span>
          <p>{item.artifact.prompt}</p>
        </div>
        <label className="morning-review-note">
          <span><strong>Your note</strong><small>Required before Keep or Pass</small></span>
          <textarea data-overnight-autofocus value={note} maxLength={2_000} onChange={(event) => setNote(event.target.value)} placeholder="What worked, or what should change next time?" />
        </label>
        {localError ? <p className="overnight-error" role="alert">{localError}</p> : null}
        <div className="morning-review-actions">
          <button type="button" className="morning-pass" disabled={!noteReady || submitting || busy} onClick={() => void decide("rejected")}><Icon name="close" size={15} /><span><strong>Pass</strong><small>Record the redirect</small></span></button>
          <button type="button" className="morning-keep" disabled={!noteReady || submitting || busy} onClick={() => void decide("accepted")}><Icon name="star" size={15} /><span><strong>Keep</strong><small>Record what to preserve</small></span></button>
        </div>
        <button type="button" className="morning-skip" disabled={submitting || busy} onClick={() => { setSkippedIds((current) => [...current, item.artifact.id]); setNote(""); }}>Skip for now <Icon name="arrow" size={13} /></button>
        <aside className="morning-review-boundary"><Icon name="shield" size={14} /> Review creates a taste signal only. It does not auto-train CreativeDNA or change World canon.</aside>
      </> : <div className="morning-review-finished">
        <span><Icon name={allDecided ? "check" : skippedOnly ? "history" : "moon"} size={32} /></span>
        <strong>{hydrating ? "Loading retained results" : allDecided ? "Morning review complete" : skippedOnly ? "Skipped work is still waiting" : "No completed artifacts yet"}</strong>
        <p>{hydrating ? "Creative Studio is finding the exact retained files for this run." : allDecided ? `${allItems.length} ${allItems.length === 1 ? "creation has" : "creations have"} an explicit decision.` : skippedOnly ? "Nothing was decided for skipped work. Return whenever you are ready." : "This run has not produced retained media for review."}</p>
        {localError ? <p className="overnight-error" role="alert">{localError}</p> : null}
        {skippedOnly ? <button type="button" className="btn btn-ghost" onClick={() => setSkippedIds([])}><Icon name="rerun" size={14} /> Review skipped work</button> : null}
        {!hydrating ? <button type="button" className="btn btn-primary" onClick={finish}>{allDecided ? "Done" : "Close"}</button> : null}
      </div>}
    </section>
  </div>, document.body);
}

export function MorningReviewSheet({ open, session, onClose, onComplete }: MorningReviewSheetProps) {
  if (!open || !session) return null;
  return <MorningReviewDialog key={session.id} session={session} onClose={onClose} onComplete={onComplete} />;
}
