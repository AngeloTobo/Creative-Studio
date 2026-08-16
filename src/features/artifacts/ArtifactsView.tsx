import { useState } from "react";
import type { AcceptanceDecision, Artifact } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";

function ArtifactCard({ artifact, onQueued }: { artifact: Artifact; onQueued: () => void }) {
  const { snapshot, reviewArtifact, reuseJob, busy } = useStudio();
  const [expanded, setExpanded] = useState(false);
  const decisions = snapshot?.acceptances.filter((item) => item.artifactId === artifact.id) ?? [];
  const training = snapshot?.trainingExamples.find((item) => item.artifactId === artifact.id);
  const decide = (decision: AcceptanceDecision) => reviewArtifact(artifact.id, decision);
  const reuse = async () => {
    await reuseJob(artifact.jobId);
    onQueued();
  };
  return (
    <article className="artifact-card glass">
      <ArtifactThumb artifact={artifact} />
      <div className="artifact-body">
        <div className="artifact-title"><div><span className={`state-pill ${artifact.status}`}>{artifact.status}</span><h3>{artifact.name}</h3></div><Icon name={artifact.kind} size={20} /></div>
        <p>{artifact.prompt}</p>
        <div className="artifact-meta"><span>{artifact.provider}</span><span>{new Date(artifact.createdAt).toLocaleString()}</span></div>
        <button className="lineage-toggle" onClick={() => setExpanded((value) => !value)}><Icon name="history" size={15} /> {expanded ? "Hide lineage" : "Show lineage"}</button>
        {expanded ? <div className="lineage-panel"><span>DNA <code>{artifact.dnaArtifactId}</code></span><span>Job <code>{artifact.jobId}</code></span><span>Retention <b>{artifact.retention.state}</b>{artifact.retention.size ? ` · ${Math.ceil(artifact.retention.size / 1024)} KB` : ""}</span><span>Settings <b>{artifact.settingsStamp.source}</b>{artifact.settingsStamp.workflow ? ` · ${artifact.settingsStamp.workflow.name} v${artifact.settingsStamp.workflow.version}` : ""}</span><span>Stamp <code>{artifact.settingsStamp.workflow?.contentHash ?? artifact.settingsStamp.createdAt}</code></span><span>CreativeDNA training <b>{training?.status ?? "candidate"}</b></span><span>Decisions <b>{decisions.length}</b></span>{artifact.settingsStamp.models.map((model) => <small key={model}>model · {model}</small>)}{decisions.map((decision) => <small key={decision.id}>{decision.decision} · {new Date(decision.createdAt).toLocaleString()}</small>)}</div> : null}
        <div className="artifact-actions">
          <button className="btn btn-ghost artifact-reuse" disabled={busy || artifact.status === "retaining"} onClick={() => void reuse()}><Icon name="rerun" size={16} /> Reuse settings</button>
          <button className="btn artifact-accept" disabled={busy || artifact.status === "retaining"} onClick={() => void decide("accepted")}><Icon name="check" size={16} /> Accept</button>
          <button className="btn artifact-reject" disabled={busy || artifact.status === "retaining"} onClick={() => void decide("rejected")}><Icon name="close" size={16} /> Reject</button>
          <button className="btn btn-ghost" disabled={busy || artifact.status === "retaining"} onClick={() => void decide("archived")}><Icon name="archive" size={16} /> Archive</button>
        </div>
      </div>
    </article>
  );
}

export function ArtifactsView({ onQueued }: { onQueued: () => void }) {
  const { snapshot, activeProjectId, error } = useStudio();
  const artifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  return (
    <section className="artifacts-view fade-up">
      <div className="artifact-summary">
        {(["retaining", "ready", "accepted", "rejected", "archived"] as const).map((status) => <div className="glass" key={status}><strong>{artifacts.filter((artifact) => artifact.status === status).length}</strong><span>{status}</span></div>)}
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="artifact-grid">
        {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} onQueued={onQueued} />)}
        {!artifacts.length ? <div className="empty-state glass"><Icon name="gallery" size={34} /><h2>No artifacts yet</h2><p>Completed jobs become reviewable artifacts here.</p></div> : null}
      </div>
    </section>
  );
}
