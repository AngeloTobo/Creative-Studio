import { useState } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";
import type { GenerationModality } from "../../../shared/contracts";

export function GenerationView({ onQueued, onMedia, embedded = false }: { onQueued: () => void; onMedia: () => void; embedded?: boolean }) {
  const { snapshot, activeProjectId, activeDna, selectDna, submitJob, submitWorkflowJob, busy, error } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const selected = activeDna ?? projectDna[0] ?? null;
  const projectMedia = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [];
  const workflows = snapshot?.workflows.filter((workflow) => workflow.projectId === activeProjectId && workflow.executionState === "ready" && workflow.modality !== "3d") ?? [];
  const [workflowId, setWorkflowId] = useState("");
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const workflow = workflows.find((item) => item.id === workflowId) ?? workflows[0] ?? null;
  const mediaParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind === "media") ?? [];
  const runnerOnline = snapshot?.runners.some((runner) => runner.state === "online" || runner.state === "busy") ?? false;

  const submit = async (modality: GenerationModality) => {
    if (!selected) return;
    selectDna(selected);
    await submitJob(modality, selected.artifactId);
    onQueued();
  };

  const submitWorkflow = async () => {
    if (!selected || !workflow) return;
    selectDna(selected);
    await submitWorkflowJob(workflow, inputBindings, selected.artifactId);
    onQueued();
  };

  const workflowReady = Boolean(workflow) && mediaParameters.every((parameter) => Boolean(inputBindings[parameter.id]));

  return (
    <section className={`generation-section${embedded ? " embedded" : " fade-up"}`} aria-labelledby="generation-title">
      <header className="generation-section-head"><div><span className="eyebrow">DNA-to-output translation</span><h2 id="generation-title">Generate</h2><p>Queue image, music, or an imported local workflow from the selected immutable CreativeDNA version.</p></div></header>
      <div className="generation-workspace">
      <section className="generation-dna glass">
        <div className="generation-head"><div><span className="eyebrow">Source blueprint</span><h2>{selected?.name ?? "Choose CreativeDNA"}</h2></div>{selected ? <span className="dna-version">v{selected.version}</span> : null}</div>
        {selected ? <>
          <p>{selected.source.directive}</p>
          <div className="generation-axis-row">{Object.entries(selected.shared).map(([key, value]) => <span key={key}><small>{key}</small><b>{value}</b></span>)}</div>
          <div className="prompt-translations">
            <article><span><Icon name="music" size={18} /> Music translation</span><p>{selected.generationPrompts.music}</p><button className="btn btn-ghost" disabled={busy} onClick={() => void submit("music")}><Icon name="send" size={16} /> Queue music</button></article>
            <article><span><Icon name="image" size={18} /> Image translation</span><p>{selected.generationPrompts.image}</p><button className="btn btn-primary" disabled={busy} onClick={() => void submit("image")}><Icon name="send" size={16} /> Queue image</button></article>
          </div>
          <section className="workflow-generate">
            <header><span><Icon name="flows" size={18} /><strong>Run a local ComfyUI workflow</strong></span><em className={runnerOnline ? "online" : "offline"}>{runnerOnline ? "Runner online" : "Will wait for runner"}</em></header>
            {workflows.length ? <>
              <label className="field"><span>Immutable workflow revision</span><select value={workflow?.id ?? ""} disabled={busy} onChange={(event) => { setWorkflowId(event.target.value); setInputBindings({}); }}>
                {workflows.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentRevision.version} · {item.modality}</option>)}
              </select></label>
              {mediaParameters.map((parameter) => {
                const choices = projectMedia.filter((asset) => !parameter.mediaKind || asset.kind === parameter.mediaKind);
                return <label className="field" key={parameter.id}><span>{parameter.label}</span><select value={inputBindings[parameter.id] ?? ""} onChange={(event) => setInputBindings((current) => ({ ...current, [parameter.id]: event.target.value }))}>
                  <option value="">Select retained {parameter.mediaKind ?? "media"}</option>
                  {choices.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.originalFileName}</option>)}
                </select>{!choices.length ? <small>Upload matching project media first.</small> : null}</label>;
              })}
              <div className="workflow-generate-meta"><span>{workflow?.currentRevision.nodeCount} nodes</span><span>{workflow?.currentRevision.contentHash.slice(0, 12)}</span><span>{workflow?.currentRevision.models.length ?? 0} models</span></div>
              <button className="btn btn-primary" disabled={busy || !workflowReady || snapshot?.adapter.development} onClick={() => void submitWorkflow()}><Icon name="send" size={16} /> Queue {workflow?.modality} workflow</button>
            </> : <div className="workflow-generate-empty"><span>No API-ready workflows in this project.</span><small>Import an API-format ComfyUI JSON in Workflows first.</small></div>}
          </section>
          {selected.rights.referenceStoredAsProvenanceOnly ? <div className="rights-panel"><Icon name="shield" size={20} /><div><strong>Reference identity is lineage-only</strong><p>{selected.rights.blockedDownstream.join(", ")} are blocked downstream.</p></div></div> : null}
        </> : <div className="dna-empty"><Icon name="dna" size={30} /><strong>Build CreativeDNA first.</strong><span>Generation always starts from a saved, versioned blueprint.</span></div>}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>

      <aside className="generation-history glass">
        <div className="generation-media-link"><span><span className="eyebrow">Project media</span><strong>{projectMedia.length} retained</strong><small>Provenance-ready source assets</small></span><button className="btn-icon" aria-label="Open project media" onClick={onMedia}><Icon name="image" size={18} /></button></div>
        <p className="generation-media-note">Direct generation uses the saved DNA prompt. Local workflows use their exact saved prompt, settings, and bound media inputs.</p>
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
    </section>
  );
}
