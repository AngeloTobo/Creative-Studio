import { useState } from "react";
import {
  CREATIVE_DNA_DIMENSION_KEYS,
  type CreativeDnaArtifact,
  type CreativeDnaDimensionKey,
  type CreativeDnaTrainingJob,
  type CreativeDnaTrainingReview,
  type CreativeDnaTrainingReviewDecision,
} from "../../../shared/contracts";
import { Icon } from "../../components/Icon";

const DIMENSION_LABELS: Record<CreativeDnaDimensionKey, string> = {
  energy: "Energy",
  tension: "Tension",
  contrast: "Contrast",
  warmth: "Warmth",
  spaciousness: "Space",
  rhythmicity: "Rhythm",
  organicity: "Organic",
  polish: "Polish",
};

function deltaLabel(base: number | undefined, trained: number) {
  if (base === undefined) return "new";
  const delta = trained - base;
  return delta === 0 ? "0" : delta > 0 ? `+${delta}` : String(delta);
}

function actorLabel(actor: CreativeDnaTrainingReview["actor"]) {
  return actor === "angelo" ? "Angelo" : "Development user";
}

export function TrainingReviewPanel({
  job,
  artifact,
  baseArtifact,
  reviews,
  active,
  busy,
  onClose,
  onDecision,
}: {
  job: CreativeDnaTrainingJob;
  artifact: CreativeDnaArtifact;
  baseArtifact: CreativeDnaArtifact | null;
  reviews: CreativeDnaTrainingReview[];
  active: boolean;
  busy: boolean;
  onClose: () => void;
  onDecision: (decision: CreativeDnaTrainingReviewDecision, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<CreativeDnaTrainingReviewDecision | null>(null);
  const analysis = artifact.training?.analysis;
  const latest = reviews[0] ?? null;

  const decide = async (decision: CreativeDnaTrainingReviewDecision) => {
    const reviewNote = note.trim();
    if (!reviewNote) return;
    setSubmitting(decision);
    try {
      await onDecision(decision, reviewNote);
      setNote("");
    } finally {
      setSubmitting(null);
    }
  };

  if (!analysis) return null;

  return (
    <section className="training-review-workspace" aria-labelledby={`training-review-${job.id}`}>
      <header className="training-review-head">
        <div>
          <span className="eyebrow">Phase 2 · Training review</span>
          <h3 id={`training-review-${job.id}`}>Compare before activation</h3>
          <p>The trained version cannot generate or become a parent until you approve it. Every decision and note remains in history.</p>
        </div>
        <div className="training-review-head-actions">
          <span className={`state-pill ${latest?.decision ?? "waiting-for-runner"}`}>{latest?.decision ?? "pending review"}</span>
          {active ? <span className="badge active">Active project DNA</span> : null}
          <button className="icon-button" aria-label="Close training review" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
      </header>

      <div className="training-review-summary">
        <article><span>Baseline</span><strong>{baseArtifact?.name ?? "New DNA root"}</strong><small>{baseArtifact ? `v${baseArtifact.version}` : "No parent version"}</small><p>{baseArtifact?.source.directive ?? "This training run creates a new root CreativeDNA."}</p></article>
        <Icon name="arrow" size={20} />
        <article className="trained"><span>Trained result</span><strong>{artifact.name}</strong><small>v{artifact.version} · {analysis.sources.length} measured source{analysis.sources.length === 1 ? "" : "s"}</small><p>{artifact.source.directive}</p></article>
      </div>

      <section className="training-dimension-compare" aria-label="CreativeDNA dimension comparison">
        <header><span><strong>Dimension comparison</strong><small>Measured profile versus its baseline</small></span><span>Base</span><span>Trained</span><span>Change</span><span>Confidence</span></header>
        {CREATIVE_DNA_DIMENSION_KEYS.map((key) => {
          const measurement = analysis.dimensions[key];
          const baseline = baseArtifact?.shared[key];
          return <div key={key}><strong>{DIMENSION_LABELS[key]}</strong><span>{baseline ?? "—"}</span><span>{artifact.shared[key]}</span><b className={baseline === undefined || artifact.shared[key] >= baseline ? "up" : "down"}>{deltaLabel(baseline, artifact.shared[key])}</b><span>{Math.round(measurement.confidence * 100)}%</span></div>;
        })}
      </section>

      <section className="training-source-evidence" aria-label="Training source evidence">
        <header><span><strong>Source evidence</strong><small>{analysis.summary}</small></span><b>{analysis.sources.length}</b></header>
        <div>
          {analysis.sources.map((source) => <details key={source.sourceId} className="training-source-card" open={analysis.sources.length === 1}>
            <summary><span><Icon name={source.kind === "audio" ? "music" : source.kind} size={17} /><span><strong>{source.label}</strong><small>{source.sourceType.replace("-", " ")} · {source.kind}</small></span></span><b>{Math.round(source.confidence * 100)}%</b></summary>
            {source.detailedDescription ? <section className="training-source-description" aria-label={`Detailed description for ${source.label}`}>
              <header><span><strong>Detailed media description</strong><small>Reusable prompt · Gemma 4 through local ComfyUI</small></span><span className="state-pill ready">retained</span></header>
              <p>{source.detailedDescription.text}</p>
              <small>{source.detailedDescription.model} · workflow v{source.detailedDescription.workflowVersion} · prompt {source.detailedDescription.comfyPromptId}</small>
            </section> : <p className="training-source-description-legacy">This earlier training result predates detailed Gemma media descriptions.</p>}
            <ul>{source.observations.map((observation) => <li key={observation}>{observation}</li>)}</ul>
            <details className="training-source-technical"><summary>Measured technical evidence · {Object.keys(source.metrics).length}</summary><div className="training-source-metrics">{Object.entries(source.metrics).slice(0, 10).map(([key, value]) => <span key={key}><small>{key}</small><b>{String(value)}</b></span>)}</div></details>
          </details>)}
        </div>
      </section>

      <div className="training-review-decision">
        <label className="review-note-field"><span>Training review note (required)</span><textarea value={note} maxLength={500} rows={4} onChange={(event) => setNote(event.target.value)} placeholder="What did the trained profile capture correctly, or what should change before another run?" /><small>{note.length}/500 characters</small></label>
        <div><button className="btn artifact-reject" disabled={busy || Boolean(submitting) || !note.trim()} onClick={() => void decide("rejected")}><Icon name="close" size={16} /> {submitting === "rejected" ? "Recording…" : "Reject trained version"}</button><button className="btn artifact-accept" disabled={busy || Boolean(submitting) || !note.trim()} onClick={() => void decide("approved")}><Icon name="check" size={16} /> {submitting === "approved" ? "Activating…" : "Approve & activate"}</button></div>
        <p>Approval makes this exact immutable version the project’s active CreativeDNA. Rejection keeps the current active version, or returns to the recorded baseline if this result was active.</p>
      </div>

      <section className="training-review-history" aria-label="Training review history">
        <header><span><Icon name="history" size={15} /> Decision history</span><b>{reviews.length}</b></header>
        {reviews.length ? <ol>{reviews.map((review) => <li key={review.id}><div><span className={`state-pill ${review.decision}`}>{review.decision}</span><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleString()}</time></div><p>{review.note}</p><small>Reviewed by {actorLabel(review.actor)} · active DNA after decision: {review.activeDnaArtifactId ?? "none"}</small></li>)}</ol> : <p>No training decision has been recorded yet.</p>}
      </section>
    </section>
  );
}
