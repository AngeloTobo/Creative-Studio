import { useState } from "react";
import type { AcceptanceDecision, Artifact } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { snapshot, reviewArtifact, busy } = useStudio();
  const [expanded, setExpanded] = useState(false);
  const decisions = snapshot?.acceptances.filter((item) => item.artifactId === artifact.id) ?? [];
  const decide = (decision: AcceptanceDecision) => reviewArtifact(artifact.id, decision);
  return (
    <article className="artifact-card glass">
      <ArtifactThumb artifact={artifact} />
      <div className="artifact-body">
        <div className="artifact-title"><div><span className={`state-pill ${artifact.status}`}>{artifact.status}</span><h3>{artifact.name}</h3></div><Icon name={artifact.kind} size={20} /></div>
        <p>{artifact.prompt}</p>
        <div className="artifact-meta"><span>{artifact.provider}</span><span>{new Date(artifact.createdAt).toLocaleString()}</span></div>
        <button className="lineage-toggle" onClick={() => setExpanded((value) => !value)}><Icon name="history" size={15} /> {expanded ? "Hide lineage" : "Show lineage"}</button>
        {expanded ? <div className="lineage-panel"><span>DNA <code>{artifact.dnaArtifactId}</code></span><span>Job <code>{artifact.jobId}</code></span><span>Decisions <b>{decisions.length}</b></span>{decisions.map((decision) => <small key={decision.id}>{decision.decision} · {new Date(decision.createdAt).toLocaleString()}</small>)}</div> : null}
        <div className="artifact-actions">
          <button className="btn artifact-accept" disabled={busy} onClick={() => void decide("accepted")}><Icon name="check" size={16} /> Accept</button>
          <button className="btn artifact-reject" disabled={busy} onClick={() => void decide("rejected")}><Icon name="close" size={16} /> Reject</button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void decide("archived")}><Icon name="archive" size={16} /> Archive</button>
        </div>
      </div>
    </article>
  );
}

export function ArtifactsView() {
  const { snapshot, error } = useStudio();
  return (
    <section className="artifacts-view fade-up">
      <div className="artifact-summary">
        {(["ready", "accepted", "rejected", "archived"] as const).map((status) => <div className="glass" key={status}><strong>{snapshot?.artifacts.filter((artifact) => artifact.status === status).length ?? 0}</strong><span>{status}</span></div>)}
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="artifact-grid">
        {snapshot?.artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}
        {!snapshot?.artifacts.length ? <div className="empty-state glass"><Icon name="gallery" size={34} /><h2>No artifacts yet</h2><p>Completed jobs become reviewable artifacts here.</p></div> : null}
      </div>
    </section>
  );
}
