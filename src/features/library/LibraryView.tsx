import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

export function LibraryView() {
  const { snapshot, activeProjectId, selectDna } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const trainingExamples = snapshot?.trainingExamples.filter((example) => example.projectId === activeProjectId) ?? [];
  return (
    <section className="library-view fade-up">
      <div className="library-grid">
        {projectDna.map((artifact) => <article className="lib-card glass" key={artifact.artifactId}>
          <div className="lc-head"><span className="lc-tag">CreativeDNA · {artifact.targetModality}</span><Icon name={artifact.source.kind === "commercial_reference" ? "shield" : "dna"} size={18} /></div>
          <h3 className="lc-title">{artifact.name}</h3>
          <p className="lc-body">{artifact.source.directive}</p>
          <div className="library-dimensions">{Object.entries(artifact.shared).slice(0, 4).map(([key, value]) => <span key={key}>{key} <b>{value}</b></span>)}</div>
          <div className="lc-foot"><span className="lc-proj">v{artifact.version} · {artifact.lineage.parentArtifactId ? "evolved" : "root"}</span><button className="btn btn-ghost" onClick={() => selectDna(artifact)}>Open</button></div>
        </article>)}
      </div>
      {!projectDna.length ? <div className="empty-state glass"><Icon name="library" size={34} /><h2>Library is empty</h2><p>Saved CreativeDNA versions will appear here.</p></div> : null}
      <section className="training-library">
        <div className="media-library-head"><div><span className="eyebrow">CreativeDNA learning evidence</span><h2>Prompts + generation settings</h2></div><span className="state-pill ready">{trainingExamples.filter((example) => example.status === "training-ready").length} training-ready</span></div>
        <div className="training-example-grid">
          {trainingExamples.map((example) => <article className="training-example glass" key={example.id}>
            <div><span className={`state-pill ${example.status === "excluded" ? "rejected" : example.status === "training-ready" ? "ready" : "queued"}`}>{example.status}</span><Icon name={example.kind === "music" || example.kind === "audio" ? "music" : example.kind === "video" ? "video" : "image"} size={18} /></div>
            <p>{example.prompt}</p>
            <small>{example.settingsStamp.source}{example.settingsStamp.workflow ? ` · ${example.settingsStamp.workflow.name} v${example.settingsStamp.workflow.version}` : ""}</small>
            <code>{example.artifactId}</code>
          </article>)}
          {!trainingExamples.length ? <div className="empty-copy">Generated results become candidates here. Accepting an artifact makes its prompt and exact settings training-ready.</div> : null}
        </div>
      </section>
    </section>
  );
}
