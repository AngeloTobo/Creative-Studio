import { useState } from "react";
import { creativeDnaCanGenerate, creativeDnaReviewDecision, useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";
import {
  GENERATION_LONG_RUN_THRESHOLD_MS,
  analyzeGenerationWorkload,
  creativeDnaGenerationPrompt,
  formatGenerationDuration,
  generationProviderWorkloadProfile,
  primaryWorkflowPromptParameter,
  workflowRuntimeHistory,
  type GenerationModality,
  type WorkflowParameter,
  type WorkflowScalar,
} from "../../../shared/contracts";
import { WorkflowParameterField } from "../workflows/WorkflowParameterField";
import { sameWorkflowValue } from "../workflows/workflowValues";

export function GenerationView({ onQueued, onMedia, embedded = false }: { onQueued: () => void; onMedia: () => void; embedded?: boolean }) {
  const { snapshot, activeProjectId, activeDna, selectDna, submitJob, submitWorkflowJob, saveWorkflowRevision, busy, error } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const availableDna = snapshot ? projectDna.filter((artifact) => creativeDnaCanGenerate(snapshot, artifact)) : [];
  const selected = snapshot && activeDna && creativeDnaCanGenerate(snapshot, activeDna) ? activeDna : availableDna[0] ?? null;
  const projectMedia = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [];
  const projectArtifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId && artifact.retention.state === "retained") ?? [];
  const workflows = snapshot?.workflows.filter((workflow) => workflow.projectId === activeProjectId && workflow.executionState === "ready" && workflow.modality !== "3d") ?? [];
  const [workflowId, setWorkflowId] = useState("");
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const [workflowValues, setWorkflowValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const workflow = workflows.find((item) => item.id === workflowId) ?? workflows[0] ?? null;
  const mediaParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind === "media") ?? [];
  const scalarParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind !== "media") ?? [];
  const effectiveValues = workflow && valuesRevisionId === workflow.currentRevision.id ? workflowValues : {};
  const imagePrompt = selected ? creativeDnaGenerationPrompt(selected, "image") : "";
  const musicPrompt = selected ? creativeDnaGenerationPrompt(selected, "music") : "";
  const dnaWorkflowPrompt = workflow?.modality === "music" || workflow?.modality === "audio" ? musicPrompt : imagePrompt;
  const workflowPromptParameter = primaryWorkflowPromptParameter(scalarParameters, workflow?.modality);
  const parameterValue = (parameter: WorkflowParameter) => {
    if (Object.prototype.hasOwnProperty.call(effectiveValues, parameter.id)) return effectiveValues[parameter.id];
    if (parameter.id === workflowPromptParameter?.id && dnaWorkflowPrompt) return dnaWorkflowPrompt;
    return parameter.value;
  };
  const settingsChanged = scalarParameters.some((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)));
  const runnerOnline = snapshot?.runners.some((runner) => runner.state === "online" || runner.state === "busy") ?? false;
  const performanceParameters = Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameterValue(parameter)]));
  const stampedPrompt = workflowPromptParameter ? String(parameterValue(workflowPromptParameter)).trim() : "";
  const workflowPrompt = stampedPrompt || dnaWorkflowPrompt;
  const workflowWorkload = workflow ? analyzeGenerationWorkload({
    parameters: performanceParameters,
    models: workflow.currentRevision.models,
    inputAssetIds: Object.values(inputBindings),
    inputArtifactIds: [],
    prompt: workflowPrompt,
  }) : null;
  const workflowHistory = workflow && !settingsChanged ? workflowRuntimeHistory(snapshot?.jobs ?? [], workflow.currentRevision.id) : null;
  const remoteImageCapability = snapshot?.capabilities.find((capability) => capability.key === "image-generation");
  const directImageProfile = remoteImageCapability?.provider === "AFDFW Z-Image adapter"
    ? generationProviderWorkloadProfile("afdfw-z-image", "image")
    : null;
  const directImageWorkload = directImageProfile ? analyzeGenerationWorkload({
    parameters: directImageProfile.parameters,
    models: directImageProfile.models,
    inputAssetIds: [],
    inputArtifactIds: [],
    prompt: imagePrompt,
  }) : null;

  const submit = async (modality: GenerationModality) => {
    if (!selected) return;
    selectDna(selected);
    await submitJob(modality, selected.artifactId);
    onQueued();
  };

  const submitWorkflow = async () => {
    if (!selected || !workflow) return;
    selectDna(selected);
    let runWorkflow = workflow;
    if (settingsChanged) {
      const modified = Object.fromEntries(scalarParameters
        .filter((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)))
        .map((parameter) => [parameter.id, parameterValue(parameter)]));
      runWorkflow = await saveWorkflowRevision(workflow.id, workflow.currentRevision.id, modified);
      setValuesRevisionId(runWorkflow.currentRevision.id);
      setWorkflowValues(Object.fromEntries(runWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
    }
    await submitWorkflowJob(runWorkflow, inputBindings, selected.artifactId);
    onQueued();
  };

  const workflowReady = Boolean(workflow) && mediaParameters.every((parameter) => Boolean(inputBindings[parameter.id]));

  return (
    <section className={`generation-section${embedded ? " embedded" : " fade-up"}`} id="creative-dna-generation" aria-labelledby="generation-title">
      <header className="generation-section-head"><div><span className="eyebrow">DNA-to-output translation</span><h2 id="generation-title">Generate</h2><p>Queue image, music, or an imported local workflow from the selected immutable CreativeDNA version.</p></div></header>
      <div className="generation-workspace">
      <section className="generation-dna glass">
        <div className="generation-head"><div><span className="eyebrow">Source blueprint</span><h2>{selected?.name ?? "Choose CreativeDNA"}</h2></div>{selected ? <span className="dna-version">v{selected.version}</span> : null}</div>
        {selected ? <>
          <div className="generation-axis-row">{Object.entries(selected.shared).map(([key, value]) => <span key={key}><small>{key}</small><b>{value}</b></span>)}</div>
          <div className="prompt-translations">
            <article><span><Icon name="music" size={18} /> Music translation</span><p>{musicPrompt}</p><button className="btn btn-ghost" disabled={busy} onClick={() => void submit("music")}><Icon name="send" size={16} /> Queue music</button></article>
            <article><span><Icon name="image" size={18} /> Image description</span><p>{imagePrompt}</p>{directImageWorkload && directImageProfile ? <div className="direct-generation-profile"><div>{directImageWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div><details><summary>Model load evidence · {directImageProfile.models.length} files</summary>{directImageProfile.models.map((model) => <code key={model}>{model}</code>)}</details><small>{directImageProfile.label} · stamped with the job</small></div> : null}<button className="btn btn-primary" disabled={busy} onClick={() => void submit("image")}><Icon name="send" size={16} /> Queue image</button></article>
          </div>
          <section className="workflow-generate">
            <header><span><Icon name="flows" size={18} /><strong>Run a local ComfyUI workflow</strong></span><em className={runnerOnline ? "online" : "offline"}>{runnerOnline ? "Runner online" : "Will wait for runner"}</em></header>
            {workflows.length ? <>
              <label className="field"><span>Workflow</span><select value={workflow?.id ?? ""} disabled={busy} onChange={(event) => { setWorkflowId(event.target.value); setInputBindings({}); setWorkflowValues({}); setValuesRevisionId(""); }}>
                {workflows.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentRevision.version} · {item.modality}</option>)}
              </select></label>
              {mediaParameters.map((parameter) => {
                const uploadChoices = projectMedia.filter((asset) => !parameter.mediaKind || asset.kind === parameter.mediaKind)
                  .map((asset) => ({ id: asset.id, label: `Upload · ${asset.name} · ${asset.originalFileName}` }));
                const artifactChoices = projectArtifacts.filter((artifact) => {
                  const artifactKind = artifact.kind === "music" ? "audio" : artifact.kind;
                  return !parameter.mediaKind || artifactKind === parameter.mediaKind;
                }).map((artifact) => ({ id: artifact.id, label: `Generated · ${artifact.name} · ${artifact.status}` }));
                const choices = [...artifactChoices, ...uploadChoices];
                return <label className="field" key={parameter.id}><span>{parameter.label}</span><select value={inputBindings[parameter.id] ?? ""} onChange={(event) => setInputBindings((current) => ({ ...current, [parameter.id]: event.target.value }))}>
                  <option value="">Select retained {parameter.mediaKind ?? "media"}</option>
                  {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
                </select>{!choices.length ? <small>Upload matching project media first.</small> : null}</label>;
              })}
              {scalarParameters.length ? <details className="workflow-run-settings" open>
                <summary><span>Run settings</span><em>{settingsChanged ? `Will save as v${workflow!.currentRevision.version + 1}` : `Using v${workflow!.currentRevision.version}`}</em></summary>
                <div className="workflow-run-parameters">
                  {scalarParameters.map((parameter) => <WorkflowParameterField key={parameter.id} parameter={parameter} value={parameterValue(parameter)} showBinding={false} onChange={(value) => {
                    if (valuesRevisionId !== workflow!.currentRevision.id) {
                      setValuesRevisionId(workflow!.currentRevision.id);
                      setWorkflowValues({ ...Object.fromEntries(scalarParameters.map((item) => [item.id, item.value])), [parameter.id]: value });
                    } else {
                      setWorkflowValues((current) => ({ ...current, [parameter.id]: value }));
                    }
                  }} />)}
                </div>
                <button type="button" className="btn btn-ghost workflow-run-reset" disabled={!settingsChanged || busy} onClick={() => { setValuesRevisionId(workflow!.currentRevision.id); setWorkflowValues(Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={14} /> Reset to v{workflow!.currentRevision.version}</button>
              </details> : null}
              {workflowWorkload ? <details className="workflow-performance">
                <summary><span><Icon name="analytics" size={15} /><strong>Performance profile</strong><small>{settingsChanged ? "New settings · timing starts with this run" : workflowHistory?.count ? `Median ${formatGenerationDuration(workflowHistory.medianMs)} · ${workflowHistory.count} exact ${workflowHistory.count === 1 ? "run" : "runs"}` : "No exact-revision history yet"}</small></span><em>{Math.round(GENERATION_LONG_RUN_THRESHOLD_MS / 60_000)}m long-run alert</em></summary>
                <div className="workflow-performance-body">
                  {workflowWorkload.facts.length ? <div className="job-performance-facts">{workflowWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div> : <p>No size, step, frame, duration, or model workload is exposed by this workflow.</p>}
                  {workflow.currentRevision.models.length ? <div className="job-performance-models"><small>Model load evidence</small><div>{workflow.currentRevision.models.map((model) => <code key={model}>{model}</code>)}</div></div> : null}
                  <p>{workflowWorkload.likelyContributors.length ? `Likely cost drivers: ${workflowWorkload.likelyContributors.join(", ")}.` : "No single high-cost setting stands out from the exposed values."}</p>
                  <small>{workflowWorkload.promptAssessment}</small>
                  <footer>{workflowHistory?.count ? `Fastest exact-revision run: ${formatGenerationDuration(workflowHistory.fastestMs)}. Change one stamped setting at a time, then use retained review decisions to compare speed with quality.` : "Creative Studio will retain execution time for this immutable revision after a successful run, creating a real speed baseline without estimating minutes."}</footer>
                </div>
              </details> : null}
              <div className="workflow-generate-meta"><span>{workflow?.currentRevision.nodeCount} nodes</span><span>{workflow?.currentRevision.contentHash.slice(0, 12)}</span><span>{workflow?.currentRevision.models.length ?? 0} models</span></div>
              <button className="btn btn-primary" disabled={busy || !workflowReady || snapshot?.adapter.development} onClick={() => void submitWorkflow()}><Icon name="send" size={16} /> {settingsChanged ? `Save v${workflow!.currentRevision.version + 1} & queue` : `Queue ${workflow?.modality} workflow`}</button>
            </> : <div className="workflow-generate-empty"><span>No API-ready workflows in this project.</span><small>Import an API-format ComfyUI JSON in Workflows first.</small></div>}
          </section>
          {selected.rights.referenceStoredAsProvenanceOnly ? <div className="rights-panel"><Icon name="shield" size={20} /><div><strong>Reference identity is lineage-only</strong><p>{selected.rights.blockedDownstream.join(", ")} are blocked downstream.</p></div></div> : null}
        </> : <div className="dna-empty"><Icon name="dna" size={30} /><strong>Build CreativeDNA first.</strong><span>Generation always starts from a saved, versioned blueprint.</span></div>}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>

      <aside className="generation-history glass">
        <div className="generation-media-link"><span><span className="eyebrow">Project media</span><strong>{projectMedia.length} retained</strong><small>Provenance-ready source assets</small></span><button className="btn-icon" aria-label="Open project media" onClick={onMedia}><Icon name="image" size={18} /></button></div>
        <p className="generation-media-note">Direct generation uses this saved description. Local runs save it into the workflow's primary prompt with the exact settings and bound inputs.</p>
        <span className="eyebrow">Saved DNA</span>
        <div className="generation-dna-list">
          {projectDna.map((artifact) => {
            const usable = snapshot ? creativeDnaCanGenerate(snapshot, artifact) : false;
            const review = snapshot ? creativeDnaReviewDecision(snapshot, artifact) : null;
            return <button key={artifact.artifactId} disabled={!usable} className={`${selected?.artifactId === artifact.artifactId ? "on" : ""}${!usable ? " review-locked" : ""}`} onClick={() => selectDna(artifact)}><Icon name={artifact.targetModality} size={16} /><span><strong>{artifact.name}</strong><small>v{artifact.version} · {review ? `training ${review}` : artifact.source.kind === "commercial_reference" ? "reference-safe" : "original"}</small></span></button>;
          })}
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
