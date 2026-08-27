import { useMemo, useState } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

type MemoryTab = "dna" | "evidence";

export function LibraryView({ embedded = false }: { embedded?: boolean } = {}) {
  const { snapshot, activeProjectId, activeDna, selectDna } = useStudio();
  const [tab, setTab] = useState<MemoryTab>("dna");
  const projectDna = useMemo(() => (snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [])
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [activeProjectId, snapshot?.dnaArtifacts]);
  const trainingExamples = useMemo(() => (snapshot?.trainingExamples.filter((example) => example.projectId === activeProjectId) ?? [])
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [activeProjectId, snapshot?.trainingExamples]);
  const readyEvidence = trainingExamples.filter((example) => example.status === "training-ready").length;

  return (
    <section className={`library-view library-view-compact fade-up${embedded ? " embedded" : ""}`}>
      <header className="memory-header">
        <div>{!embedded ? <span className="eyebrow">Creative memory</span> : null}<h2>CreativeDNA memory</h2><p>Versioned direction and the real accepted evidence behind it.</p></div>
        {activeDna ? <span className="memory-active"><Icon name="dna" size={15} /><span><small>Active</small><strong>{activeDna.name} · v{activeDna.version}</strong></span></span> : null}
      </header>
      <nav className="memory-tabs glass" role="tablist" aria-label="Creative memory">
        <button role="tab" aria-selected={tab === "dna"} className={tab === "dna" ? "on" : ""} onClick={() => setTab("dna")}><Icon name="dna" size={16} /><span>DNA versions</span><b>{projectDna.length}</b></button>
        <button role="tab" aria-selected={tab === "evidence"} className={tab === "evidence" ? "on" : ""} onClick={() => setTab("evidence")}><Icon name="history" size={16} /><span>Accepted evidence</span><b>{readyEvidence}</b></button>
      </nav>

      {tab === "dna" ? <div role="tabpanel" className="library-grid memory-dna-grid">
        {projectDna.map((artifact) => {
          const active = activeDna?.artifactId === artifact.artifactId;
          return <article className={`lib-card memory-dna-card glass${active ? " on" : ""}`} key={artifact.artifactId}>
            <div className="lc-head"><span className="lc-tag">{artifact.targetModality} · v{artifact.version}</span><Icon name={artifact.source.kind === "commercial_reference" ? "shield" : "dna"} size={18} /></div>
            <h3 className="lc-title">{artifact.name}</h3>
            <p className="lc-body">{artifact.source.directive}</p>
            <div className="library-dimensions">{Object.entries(artifact.shared).slice(0, 4).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")} <b>{value}</b></span>)}</div>
            <div className="lc-foot"><span className="lc-proj">{artifact.lineage.parentArtifactId ? "Evolved" : "Root"} · {new Date(artifact.createdAt).toLocaleDateString()}</span><button className={`btn ${active ? "btn-ghost" : "btn-primary"}`} disabled={active} onClick={() => selectDna(artifact)}>{active ? <><Icon name="check" size={14} /> Active</> : "Use DNA"}</button></div>
          </article>;
        })}
        {!projectDna.length ? <div className="empty-state glass"><Icon name="library" size={34} /><h2>No saved DNA yet</h2><p>Create or analyze a direction to start this project’s memory.</p></div> : null}
      </div> : <section role="tabpanel" className="training-library memory-evidence">
        <div className="memory-evidence-summary"><span className="state-pill ready">{readyEvidence} training-ready</span><span>{trainingExamples.length - readyEvidence} candidate or excluded</span></div>
        <div className="training-example-grid">
          {trainingExamples.map((example) => <article className="training-example memory-example glass" key={example.id}>
            <div><span className={`state-pill ${example.status === "excluded" ? "rejected" : example.status === "training-ready" ? "ready" : "queued"}`}>{example.status}</span><Icon name={example.kind === "music" || example.kind === "audio" ? "music" : example.kind === "video" ? "video" : "image"} size={18} /></div>
            <p>{example.prompt}</p>
            <small>{example.settingsStamp.source}{example.settingsStamp.workflow ? ` · ${example.settingsStamp.workflow.name} v${example.settingsStamp.workflow.version}` : ""}</small>
            <code>{example.artifactId}</code>
          </article>)}
          {!trainingExamples.length ? <div className="empty-state glass"><Icon name="history" size={30} /><strong>No evidence yet</strong><p>Accepting a retained result makes its prompt and exact settings available here.</p></div> : null}
        </div>
      </section>}
    </section>
  );
}
