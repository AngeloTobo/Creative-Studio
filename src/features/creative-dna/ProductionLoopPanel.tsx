import type { ProductionLoopSurface, ProductionLoopStage, ProjectProductionLoop } from "../../../shared/contracts";
import { Icon, type IconName } from "../../components/Icon";

const STAGE_LABELS: Record<ProductionLoopStage, string> = {
  "needs-dna": "Blueprint needed",
  "ready-to-generate": "Ready to produce",
  "generation-running": "Production running",
  "review-output": "Output review needed",
  "generation-failed": "Production needs attention",
  "evidence-ready": "Evidence ready",
  "training-running": "DNA training running",
  "review-training": "Training review needed",
};

type LoopStep = {
  key: "blueprint" | "produce" | "review" | "learn";
  label: string;
  detail: string;
  icon: IconName;
  state: "complete" | "current" | "upcoming";
};

function steps(loop: ProjectProductionLoop): LoopStep[] {
  const productionStarted = loop.counts.generationActive > 0 || loop.counts.outputsReadyForReview > 0
    || loop.counts.outputsAccepted > 0 || loop.counts.evidenceFresh > 0 || loop.counts.evidenceUsed > 0;
  const reviewed = loop.counts.outputsAccepted > 0 || loop.counts.evidenceFresh > 0 || loop.counts.evidenceUsed > 0;
  const learningStarted = loop.counts.evidenceUsed > 0 || loop.counts.trainingActive > 0
    || loop.counts.trainingPendingReview > 0 || loop.counts.trainedVersionsApproved > 0;
  const stage = loop.stage;
  return [
    {
      key: "blueprint", label: "Active DNA", icon: "dna",
      detail: loop.activeDnaName ? `${loop.activeDnaName} · v${loop.activeDnaVersion}` : "No active blueprint",
      state: loop.activeDnaArtifactId ? "complete" : "current",
    },
    {
      key: "produce", label: "Produce", icon: "wand",
      detail: loop.counts.generationActive ? `${loop.counts.generationActive} job active` : productionStarted ? "Durable result recorded" : "Ready for a real output",
      state: stage === "ready-to-generate" || stage === "generation-running" || stage === "generation-failed" ? "current" : productionStarted ? "complete" : "upcoming",
    },
    {
      key: "review", label: "Review output", icon: "check",
      detail: loop.counts.outputsReadyForReview ? `${loop.counts.outputsReadyForReview} retained result waiting` : reviewed ? `${loop.counts.outputsAccepted} accepted` : "Decision and note required",
      state: stage === "review-output" ? "current" : reviewed ? "complete" : "upcoming",
    },
    {
      key: "learn", label: "Evolve DNA", icon: "history",
      detail: loop.counts.evidenceFresh ? `${loop.counts.evidenceFresh} fresh evidence` : loop.counts.trainingPendingReview ? `${loop.counts.trainingPendingReview} result waiting` : loop.counts.trainingActive ? `${loop.counts.trainingActive} training run active` : learningStarted ? `${loop.counts.trainedVersionsApproved} trained version approved` : "Accepted evidence enters once",
      state: stage === "evidence-ready" || stage === "training-running" || stage === "review-training" ? "current" : learningStarted ? "complete" : "upcoming",
    },
  ];
}

export function ProductionLoopPanel({ loop, onAction, compact = false }: { loop: ProjectProductionLoop; onAction: (surface: ProductionLoopSurface) => void; compact?: boolean }) {
  if (compact) return <section className="production-loop-compact glass" aria-label="CreativeDNA production loop">
    <span className={`production-loop-stage ${loop.stage}`}>{STAGE_LABELS[loop.stage]}</span>
    <span className="production-loop-compact-next"><small>Next</small><strong>{loop.nextAction.label}</strong><p>{loop.nextAction.detail}</p></span>
    <span className="production-loop-compact-counts"><b>{loop.counts.outputsReadyForReview}</b> review · <b>{loop.counts.evidenceFresh}</b> fresh evidence</span>
    <button className="btn btn-primary" aria-label="Go to the next production-loop action" onClick={() => onAction(loop.nextAction.surface)}>{loop.nextAction.label} <Icon name="arrow" size={15} /></button>
  </section>;
  return <section className="production-loop glass" aria-labelledby="production-loop-title">
    <header className="production-loop-head">
      <div><span className="eyebrow">Phase 3 · Production loop</span><h2 id="production-loop-title">Make, decide, learn, repeat</h2><p>One Worker-derived state connects the active CreativeDNA, durable production, retained output review, and fresh accepted evidence.</p></div>
      <span className={`production-loop-stage ${loop.stage}`}>{STAGE_LABELS[loop.stage]}</span>
    </header>
    <div className="production-loop-steps">
      {steps(loop).map((step, index) => <article className={step.state} key={step.key}>
        <span className="production-loop-index">{step.state === "complete" ? <Icon name="check" size={14} /> : index + 1}</span>
        <span className="production-loop-icon"><Icon name={step.icon} size={18} /></span>
        <span><strong>{step.label}</strong><small>{step.detail}</small></span>
      </article>)}
    </div>
    <footer className="production-loop-next">
      <span><small>Next owner action</small><strong>{loop.nextAction.label}</strong><p>{loop.nextAction.detail}</p></span>
      <button className="btn btn-primary" aria-label="Go to the next production-loop action" onClick={() => onAction(loop.nextAction.surface)}>{loop.nextAction.label} <Icon name="arrow" size={15} /></button>
    </footer>
    {loop.counts.evidenceUsed ? <p className="production-loop-boundary"><Icon name="shield" size={14} /> {loop.counts.evidenceUsed} accepted {loop.counts.evidenceUsed === 1 ? "result has" : "results have"} already been captured by a durable training run and will not be silently added again.</p> : null}
  </section>;
}
