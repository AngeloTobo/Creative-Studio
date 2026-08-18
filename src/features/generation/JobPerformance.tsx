import {
  GENERATION_LONG_RUN_THRESHOLD_MS,
  analyzeGenerationWorkload,
  formatGenerationDuration,
  generationTiming,
  workflowRuntimeHistory,
  type Job,
} from "../../../shared/contracts";
import { Icon } from "../../components/Icon";

export function JobPerformance({ job, jobs }: { job: Job; jobs: Job[] }) {
  const timing = generationTiming(job);
  const workload = analyzeGenerationWorkload(job.settingsStamp);
  const revisionId = job.settingsStamp.workflow?.revisionId ?? null;
  const history = revisionId ? workflowRuntimeHistory(jobs, revisionId) : null;
  const active = job.status === "queued" || job.status === "running";
  const visibleDuration = timing.executionMs ?? timing.totalMs;
  const noStampedWorkload = !workload.facts.length;
  const likely = workload.likelyContributors.length
    ? `Likely workload contributors: ${workload.likelyContributors.join(", ")}.`
    : noStampedWorkload
      ? "Resolution, steps, frame count, and model load were not exposed in this settings stamp, so Creative Studio cannot attribute the delay to image size from evidence."
      : "No single high-cost setting stands out from the stamped workflow values.";

  return <details className={`job-performance${timing.isLongRunning ? " long-running" : ""}`} open={timing.isLongRunning || job.status === "failed"}>
    <summary>
      <span><Icon name="analytics" size={15} /><strong>{timing.stageLabel}</strong><small>{formatGenerationDuration(visibleDuration)}</small></span>
      <em>{timing.isLongRunning ? "20m alert crossed" : active ? "20m alert armed" : "timing retained"}</em>
    </summary>
    <div className="job-performance-body">
      <div className="job-performance-times">
        <span><small>Total</small><b>{formatGenerationDuration(timing.totalMs)}</b></span>
        <span><small>Queue</small><b>{formatGenerationDuration(timing.queueMs)}</b></span>
        <span><small>Execution</small><b>{formatGenerationDuration(timing.executionMs)}</b></span>
        {history?.count ? <span><small>Same v median</small><b>{formatGenerationDuration(history.medianMs)}</b></span> : null}
      </div>
      {workload.facts.length ? <div className="job-performance-facts">{workload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div> : null}
      {job.settingsStamp.models.length ? <div className="job-performance-models"><small>Model load evidence</small><div>{job.settingsStamp.models.map((model) => <code key={model}>{model}</code>)}</div></div> : null}
      <p>{timing.isLongRunning
        ? `This run passed the ${Math.round(GENERATION_LONG_RUN_THRESHOLD_MS / 60_000)}-minute awareness threshold. Local ComfyUI keeps rendering; Creative Studio does not cancel it at this point. ${likely}`
        : likely}</p>
      <small>{workload.promptAssessment}</small>
      {history ? <footer>{history.count
        ? `${history.count} completed ${history.count === 1 ? "run" : "runs"} on this exact workflow revision · fastest ${formatGenerationDuration(history.fastestMs)}.`
        : "No completed timing exists for this exact workflow revision yet."}</footer> : null}
      {job.settingsStamp.workloadEvidence ? <footer>Settings source: {job.settingsStamp.workloadEvidence.label}.</footer> : null}
      <footer>Stage timing is measured by Creative Studio. Exact node or GPU bottlenecks require ComfyUI node-level profiling, so likely causes are labeled rather than guessed.</footer>
    </div>
  </details>;
}
