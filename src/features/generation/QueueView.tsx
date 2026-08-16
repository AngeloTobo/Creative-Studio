import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";

function age(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

export function QueueView() {
  const { snapshot, activeProjectId, refresh, retryJob, cancelJob, busy } = useStudio();
  const jobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId) ?? [];
  return (
    <section className="queue-view fade-up">
      <div className="view-actions"><span>{jobs.length} durable jobs</span><button className="btn btn-ghost" onClick={() => void refresh()}><Icon name="rerun" size={16} /> Refresh</button></div>
      <div className="queue-list">
        {jobs.map((job) => <article className="queue-card glass" key={job.id}>
          <div className="queue-icon" style={{ "--job-accent": job.modality === "music" ? "var(--pink)" : "var(--cyan)" } as React.CSSProperties}><Icon name={job.modality} size={23} /></div>
          <div className="queue-main">
            <div className="queue-title"><StatusDot status={job.status} /><strong>{job.modality === "music" ? "Music" : "Image"} from CreativeDNA</strong><span className={`state-pill ${job.status}`}>{job.status}</span></div>
            <p>{job.prompt}</p>
            <div className="queue-meta"><span>{job.provider}</span><span>{age(job.updatedAt)}</span><span>{job.id}</span></div>
            {job.retryOfJobId ? <div className="queue-lineage">Retry of {job.retryOfJobId}</div> : null}
            {job.error ? <div className="queue-error">{job.error.replaceAll("_", " ")}</div> : null}
            <div className="job-progress"><i style={{ width: `${job.progress}%` }} /></div>
            <div className="queue-controls">
              {job.status === "queued" || job.status === "running"
                ? <button className="btn btn-ghost" disabled={busy} title="Stops Creative Studio tracking. An upstream generation already running may still finish." onClick={() => void cancelJob(job.id)}>Cancel tracking</button>
                : null}
              {job.status === "failed" || job.status === "cancelled"
                ? <button className="btn btn-ghost" disabled={busy} onClick={() => void retryJob(job.id)}><Icon name="rerun" size={15} /> Retry</button>
                : null}
            </div>
          </div>
          <strong className="queue-percent">{job.progress}%</strong>
        </article>)}
        {!jobs.length ? <div className="empty-state glass"><Icon name="queue" size={34} /><h2>No jobs yet</h2><p>Submit music or image from a saved CreativeDNA version.</p></div> : null}
      </div>
    </section>
  );
}
