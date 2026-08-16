import { useEffect } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";
import { jobIssuePresentation } from "./jobFailure";

function age(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

export function QueueView({ focusRunId }: { focusRunId?: string }) {
  const { snapshot, activeProjectId, refresh, retryJob, cancelJob, cancelDnaTraining, busy } = useStudio();
  const jobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId) ?? [];
  const trainingJobs = snapshot?.trainingJobs.filter((job) => job.projectId === activeProjectId) ?? [];
  useEffect(() => {
    if (!focusRunId) return;
    window.requestAnimationFrame(() => document.getElementById(`queue-run-${focusRunId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [focusRunId]);
  return (
    <section className="queue-view fade-up">
      <div className="view-actions"><span>{jobs.length + trainingJobs.length} durable jobs · {trainingJobs.length} training</span><button className="btn btn-ghost" onClick={() => void refresh()}><Icon name="rerun" size={16} /> Refresh</button></div>
      <div className="queue-list">
        {trainingJobs.map((job) => <article className={`queue-card glass training-queue-card${focusRunId === job.id ? " cockpit-focus" : ""}`} id={`queue-run-${job.id}`} key={job.id}>
          <div className="queue-icon" style={{ "--job-accent": "var(--pink)" } as React.CSSProperties}><Icon name="dna" size={23} /></div>
          <div className="queue-main">
            <div className="queue-title"><i className={`training-status-dot ${job.status}`} /><strong>CreativeDNA training</strong><span className={`state-pill ${job.status}`}>{job.status.replaceAll("-", " ")}</span></div>
            <p>{job.name}</p>
            <div className="queue-meta"><span>{job.provider}</span><span>{job.assetIds.length} uploads</span><span>{job.trainingExampleIds.length} accepted examples</span></div>
            {job.runnerId ? <div className="queue-lineage">Claimed by {job.runnerId}</div> : <div className="queue-lineage">Waiting for an authenticated local trainer</div>}
            {job.error ? <div className="queue-error">{job.error.replaceAll("_", " ")}</div> : null}
            <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>
            {(job.status === "waiting-for-runner" || job.status === "running") ? <div className="queue-controls"><button className="btn btn-ghost" disabled={busy} onClick={() => void cancelDnaTraining(job.id)}>Cancel training</button></div> : null}
          </div>
          <strong className="queue-percent">{job.progress}%</strong>
        </article>)}
        {jobs.map((job) => {
          const issue = jobIssuePresentation(job.status, job.error, job.modality);
          return <article className={`queue-card glass${focusRunId === job.id ? " cockpit-focus" : ""}`} id={`queue-run-${job.id}`} key={job.id}>
          <div className="queue-icon" style={{ "--job-accent": job.modality === "music" ? "var(--pink)" : job.modality === "video" ? "var(--violet)" : "var(--cyan)" } as React.CSSProperties}><Icon name={job.modality} size={23} /></div>
          <div className="queue-main">
            <div className="queue-title"><StatusDot status={job.status} /><strong>{job.artifactId && job.status === "running" ? "Retaining completed result" : `${job.modality === "music" ? "Music" : job.modality === "video" ? "Video" : "Image"} from CreativeDNA`}</strong><span className={`state-pill ${job.status}`}>{job.status}</span></div>
            <p>{job.prompt}</p>
            <div className="queue-meta"><span>{job.provider}</span><span>Updated {age(job.updatedAt)}</span><span>{job.id}</span></div>
            {job.retryOfJobId ? <div className="queue-lineage">Retry of {job.retryOfJobId}</div> : null}
            {issue ? <section className={`job-issue ${job.status}`} aria-label={issue.title}><header><Icon name={job.status === "failed" ? "close" : "archive"} size={16} /><strong>{issue.title}</strong></header><p>{issue.summary}</p><small>Provider detail <code>{issue.raw}</code></small><footer>{issue.action}</footer></section> : null}
            <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>
            <div className="queue-controls">
              {(job.status === "queued" || job.status === "running") && !job.artifactId
                ? <button className="btn btn-ghost" disabled={busy} title="Stops Creative Studio tracking. An upstream generation already running may still finish." onClick={() => void cancelJob(job.id)}>Cancel tracking</button>
                : null}
              {job.status === "failed" || job.status === "cancelled"
                ? <button className="btn job-retry" disabled={busy} onClick={() => void retryJob(job.id)}><Icon name="rerun" size={15} /> Retry as new job</button>
                : null}
            </div>
          </div>
          <strong className="queue-percent">{job.progress}%</strong>
        </article>})}
        {!jobs.length && !trainingJobs.length ? <div className="empty-state glass"><Icon name="queue" size={34} /><h2>No jobs yet</h2><p>Train CreativeDNA from uploads or generate image, music, and video from a saved version.</p></div> : null}
      </div>
    </section>
  );
}
