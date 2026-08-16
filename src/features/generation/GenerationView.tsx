import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";
import type { GenerationModality } from "../../../shared/contracts";

export function GenerationView({ onQueued }: { onQueued: () => void }) {
  const { snapshot, activeProjectId, activeDna, selectDna, submitJob, busy, error } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const selected = activeDna ?? projectDna[0] ?? null;

  const submit = async (modality: GenerationModality) => {
    if (!selected) return;
    selectDna(selected);
    await submitJob(modality, selected.artifactId);
    onQueued();
  };

  return (
    <div className="generation-workspace fade-up">
      <section className="generation-dna glass">
        <div className="generation-head"><div><span className="eyebrow">Source blueprint</span><h2>{selected?.name ?? "Choose CreativeDNA"}</h2></div>{selected ? <span className="dna-version">v{selected.version}</span> : null}</div>
        {selected ? <>
          <p>{selected.source.directive}</p>
          <div className="generation-axis-row">{Object.entries(selected.shared).map(([key, value]) => <span key={key}><small>{key}</small><b>{value}</b></span>)}</div>
          <div className="prompt-translations">
            <article><span><Icon name="music" size={18} /> Music translation</span><p>{selected.generationPrompts.music}</p><button className="btn btn-ghost" disabled={busy} onClick={() => void submit("music")}><Icon name="send" size={16} /> Queue music</button></article>
            <article><span><Icon name="image" size={18} /> Image translation</span><p>{selected.generationPrompts.image}</p><button className="btn btn-primary" disabled={busy} onClick={() => void submit("image")}><Icon name="send" size={16} /> Queue image</button></article>
          </div>
          {selected.rights.referenceStoredAsProvenanceOnly ? <div className="rights-panel"><Icon name="shield" size={20} /><div><strong>Reference identity is lineage-only</strong><p>{selected.rights.blockedDownstream.join(", ")} are blocked downstream.</p></div></div> : null}
        </> : <div className="dna-empty"><Icon name="dna" size={30} /><strong>Build CreativeDNA first.</strong><span>Generation always starts from a saved, versioned blueprint.</span></div>}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>

      <aside className="generation-history glass">
        <span className="eyebrow">Saved DNA</span>
        <div className="generation-dna-list">
          {projectDna.map((artifact) => <button key={artifact.artifactId} className={selected?.artifactId === artifact.artifactId ? "on" : ""} onClick={() => selectDna(artifact)}><Icon name={artifact.targetModality} size={16} /><span><strong>{artifact.name}</strong><small>v{artifact.version} · {artifact.source.kind === "commercial_reference" ? "reference-safe" : "original"}</small></span></button>)}
        </div>
        <div className="queue-mini">
          <span className="eyebrow">Active jobs</span>
          {snapshot?.jobs.filter((job) => job.status === "queued" || job.status === "running").slice(0, 4).map((job) => <div key={job.id}><StatusDot status={job.status} /><span><strong>{job.modality}</strong><small>{job.status} · {job.progress}%</small></span></div>)}
          {!snapshot?.jobs.some((job) => job.status === "queued" || job.status === "running") ? <p>Queue is clear.</p> : null}
        </div>
      </aside>
    </div>
  );
}
