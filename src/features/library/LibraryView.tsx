import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

export function LibraryView() {
  const { snapshot, activeProjectId, selectDna } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
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
    </section>
  );
}
