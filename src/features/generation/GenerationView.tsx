import { useRef, useState } from "react";
import { creativeDnaCanGenerate, useStudio } from "../../app/StudioProvider";
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
  type WorkflowParameter,
  type WorkflowScalar,
} from "../../../shared/contracts";
import { WorkflowParameterField } from "../workflows/WorkflowParameterField";
import { sameWorkflowValue } from "../workflows/workflowValues";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_WORKFLOW_BYTES = 1024 * 1024;

type CreateModality = "music" | "image" | "video";

function workflowModality(value: string): CreateModality {
  if (value === "audio" || value === "music") return "music";
  return value === "video" ? "video" : "image";
}

export function GenerationView({ onQueued, onMedia, onWorkflows, onDesign, embedded = false }: { onQueued: () => void; onMedia: () => void; onWorkflows: () => void; onDesign: () => void; embedded?: boolean }) {
  const {
    snapshot,
    activeProjectId,
    activeDna,
    selectDna,
    uploadMedia,
    uploadWorkflow,
    submitAfdfwJob,
    submitDevelopmentPreviewJob,
    submitWorkflowJob,
    saveWorkflowRevision,
    busy,
    error,
  } = useStudio();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const workflowInputRef = useRef<HTMLInputElement>(null);
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const availableDna = snapshot ? projectDna.filter((artifact) => creativeDnaCanGenerate(snapshot, artifact)) : [];
  const selected = snapshot && activeDna && creativeDnaCanGenerate(snapshot, activeDna) ? activeDna : availableDna[0] ?? null;
  const projectMedia = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [];
  const projectArtifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId && artifact.retention.state === "retained") ?? [];
  const workflows = snapshot?.workflows.filter((item) => item.projectId === activeProjectId && item.executionState === "ready" && item.modality !== "3d") ?? [];
  const [workflowId, setWorkflowId] = useState("");
  const preferredWorkflow = workflows.find((item) => workflowModality(item.modality) === selected?.targetModality) ?? workflows[0] ?? null;
  const workflow = workflows.find((item) => item.id === workflowId) ?? preferredWorkflow;
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const [workflowValues, setWorkflowValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [workflowFile, setWorkflowFile] = useState<File | null>(null);
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const mediaParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind === "media") ?? [];
  const scalarParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind !== "media") ?? [];
  const effectiveValues = workflow && valuesRevisionId === workflow.currentRevision.id ? workflowValues : {};
  const outputModality = workflow ? workflowModality(workflow.modality) : selected?.targetModality ?? "image";
  const dnaPrompt = selected ? creativeDnaGenerationPrompt(selected, outputModality === "music" ? "music" : "image") : "";
  const workflowPromptParameter = primaryWorkflowPromptParameter(scalarParameters, workflow?.modality);
  const parameterValue = (parameter: WorkflowParameter) => {
    if (Object.prototype.hasOwnProperty.call(effectiveValues, parameter.id)) return effectiveValues[parameter.id];
    if (parameter.id === workflowPromptParameter?.id && dnaPrompt) return dnaPrompt;
    return parameter.value;
  };
  const settingsChanged = scalarParameters.some((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)));
  const runnerOnline = snapshot?.runners.some((runner) => runner.state === "online" || runner.state === "busy") ?? false;
  const uiOnlyDevelopment = snapshot?.adapter.id === "development-local-storage";
  const developmentPreviewAvailable = Boolean(uiOnlyDevelopment && snapshot?.adapter.development);
  const activeJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId && (job.status === "queued" || job.status === "running")) ?? [];
  const workflowReady = Boolean(workflow) && mediaParameters.every((parameter) => Boolean(inputBindings[parameter.id]));
  const performanceParameters = Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameterValue(parameter)]));
  const workflowWorkload = workflow ? analyzeGenerationWorkload({
    parameters: performanceParameters,
    models: workflow.currentRevision.models,
    inputAssetIds: Object.values(inputBindings),
    inputArtifactIds: [],
    prompt: workflowPromptParameter ? String(parameterValue(workflowPromptParameter)).trim() : dnaPrompt,
  }) : null;
  const workflowHistory = workflow && !settingsChanged ? workflowRuntimeHistory(snapshot?.jobs ?? [], workflow.currentRevision.id) : null;
  const afdfwCapability = outputModality === "music"
    ? snapshot?.capabilities.find((capability) => capability.key === "afdfw-music-generation") ?? null
    : outputModality === "image"
      ? snapshot?.capabilities.find((capability) => capability.key === "afdfw-image-generation") ?? null
      : null;
  const afdfwImageProfile = outputModality === "image" && afdfwCapability ? generationProviderWorkloadProfile("afdfw-z-image", "image") : null;
  const afdfwImageWorkload = afdfwImageProfile ? analyzeGenerationWorkload({
    parameters: afdfwImageProfile.parameters,
    models: afdfwImageProfile.models,
    inputAssetIds: [],
    inputArtifactIds: [],
    prompt: dnaPrompt,
  }) : null;

  const chooseWorkflow = (id: string) => {
    setWorkflowId(id);
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setNotice("");
  };

  const chooseMediaFile = (file: File | null) => {
    setLocalError("");
    if (file && file.size > MAX_MEDIA_BYTES) {
      setMediaFile(null);
      setLocalError("Choose source media no larger than 100 MB.");
      return;
    }
    setMediaFile(file);
  };

  const retainMedia = async () => {
    if (!mediaFile || uiOnlyDevelopment) return;
    try {
      const asset = await uploadMedia(mediaFile, trainingEligible);
      const compatible = mediaParameters.find((parameter) => !inputBindings[parameter.id] && (!parameter.mediaKind || parameter.mediaKind === asset.kind));
      if (compatible) setInputBindings((current) => ({ ...current, [compatible.id]: asset.id }));
      setMediaFile(null);
      setNotice(compatible ? `${asset.name} uploaded and selected for ${compatible.label}.` : `${asset.name} uploaded and retained.`);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const chooseWorkflowFile = (file: File | null) => {
    setLocalError("");
    if (file && file.size > MAX_WORKFLOW_BYTES) {
      setWorkflowFile(null);
      setLocalError("Choose a workflow JSON no larger than 1 MB.");
      return;
    }
    setWorkflowFile(file);
  };

  const importWorkflow = async () => {
    if (!workflowFile || uiOnlyDevelopment) return;
    try {
      const imported = await uploadWorkflow(workflowFile);
      setWorkflowFile(null);
      if (workflowInputRef.current) workflowInputRef.current.value = "";
      if (imported.executionState === "ready" && imported.modality !== "3d") {
        chooseWorkflow(imported.id);
        setNotice(`${imported.name} imported and selected.`);
      } else {
        setNotice(`${imported.name} was saved. Export it from ComfyUI in API format before generation.`);
      }
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const queueWorkflow = async () => {
    if (!selected || !workflow) return;
    selectDna(selected);
    const modified = Object.fromEntries(scalarParameters
      .filter((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)))
      .map((parameter) => [parameter.id, parameterValue(parameter)]));
    let runWorkflow = workflow;
    if (Object.keys(modified).length) {
      runWorkflow = await saveWorkflowRevision(workflow.id, workflow.currentRevision.id, modified);
      setValuesRevisionId(runWorkflow.currentRevision.id);
      setWorkflowValues(Object.fromEntries(runWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
    }
    await submitWorkflowJob(runWorkflow, inputBindings, selected.artifactId);
    setNotice(`${runWorkflow.name} queued. You can keep creating while it runs.`);
  };

  const submitRemote = async () => {
    if (!selected || outputModality === "video") return;
    selectDna(selected);
    await submitAfdfwJob(outputModality, selected.artifactId);
    setNotice(`Optional AFDFW ${outputModality} job queued.`);
  };

  const submitDevelopmentPreview = async () => {
    if (!selected || outputModality === "video") return;
    selectDna(selected);
    await submitDevelopmentPreviewJob(outputModality, selected.artifactId);
    setNotice(`Development ${outputModality} preview queued. This is simulated media.`);
  };

  return (
    <section className={`generation-section create-surface${embedded ? " embedded" : " fade-up"}`} id="creative-dna-generation" aria-label="Create with Creative Studio">
      {activeJobs.length ? <button className="create-active-queue" onClick={onQueued}><StatusDot status={activeJobs[0].status} /><span><strong>{activeJobs.length} active {activeJobs.length === 1 ? "job" : "jobs"}</strong><small>View queue</small></span><Icon name="chevron" size={15} /></button> : null}

      <div className="create-setup-grid">
        <section className="create-step glass">
          <header><b>1</b><span><strong>Direction</strong><small>CreativeDNA</small></span></header>
          {availableDna.length ? <><select aria-label="CreativeDNA direction" value={selected?.artifactId ?? ""} disabled={busy} onChange={(event) => selectDna(availableDna.find((artifact) => artifact.artifactId === event.target.value) ?? null)}>
            {availableDna.map((artifact) => <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.name} · v{artifact.version}</option>)}
          </select><button className="create-step-link" onClick={onDesign}>Edit or create DNA</button></> : <button className="btn btn-primary" onClick={onDesign}><Icon name="dna" size={16} /> Create CreativeDNA</button>}
        </section>

        <section className="create-step glass">
          <header><b>2</b><span><strong>Workflow</strong><small>ComfyUI JSON</small></span></header>
          {workflows.length ? <select aria-label="Generation workflow" value={workflow?.id ?? ""} disabled={busy} onChange={(event) => chooseWorkflow(event.target.value)}>
            {workflows.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentRevision.version} · {item.modality}</option>)}
          </select> : <span className="create-step-empty">No API-ready workflow yet</span>}
          <div className="create-inline-actions"><label className={`create-file-button${uiOnlyDevelopment ? " disabled" : ""}`}><input ref={workflowInputRef} type="file" accept="application/json,.json" disabled={busy || uiOnlyDevelopment} onChange={(event) => chooseWorkflowFile(event.target.files?.[0] ?? null)} /><Icon name="plus" size={14} /> {workflowFile?.name ?? "Choose JSON"}</label>{workflowFile ? <button className="create-step-link" disabled={busy} onClick={() => void importWorkflow()}>Import</button> : <button className="create-step-link" onClick={onWorkflows}>Manage</button>}</div>
        </section>

        <section className="create-step glass">
          <header><b>3</b><span><strong>Source</strong><small>{projectMedia.length} retained</small></span></header>
          <div className="create-inline-actions"><label className={`create-file-button${uiOnlyDevelopment ? " disabled" : ""}`}><input ref={mediaInputRef} type="file" accept={ACCEPTED_MEDIA} disabled={busy || uiOnlyDevelopment} onChange={(event) => chooseMediaFile(event.target.files?.[0] ?? null)} /><Icon name="plus" size={14} /> {mediaFile?.name ?? "Choose media"}</label>{mediaFile ? <button className="create-step-link" disabled={busy} onClick={() => void retainMedia()}>Upload</button> : <button className="create-step-link" onClick={onMedia}>Library</button>}</div>
          <label className="create-consent"><input type="checkbox" checked={trainingEligible} disabled={busy || uiOnlyDevelopment} onChange={(event) => setTrainingEligible(event.target.checked)} /> Training eligible</label>
        </section>
      </div>

      <section className="create-run glass">
        <header className="create-run-head"><div className={`create-output-icon ${outputModality}`}><Icon name={outputModality} size={22} /></div><div><span className="eyebrow">Output</span><h3>{workflow?.name ?? `${outputModality} generation`}</h3></div><em className={runnerOnline ? "online" : "offline"}>{runnerOnline ? "Runner online" : "Will wait for runner"}</em></header>

        {!selected ? <div className="create-blocked"><Icon name="dna" size={25} /><span><strong>Create a direction first.</strong><small>CreativeDNA supplies the prompt and lineage for every result.</small></span><button className="btn btn-primary" onClick={onDesign}>Create DNA</button></div> : <>
          <details className="create-prompt-preview"><summary><span>Prompt</span><small>{dnaPrompt.length.toLocaleString()} characters</small></summary><p>{dnaPrompt}</p></details>

          {workflow ? <>
            {mediaParameters.map((parameter) => {
              const uploadChoices = projectMedia.filter((asset) => !parameter.mediaKind || asset.kind === parameter.mediaKind)
                .map((asset) => ({ id: asset.id, label: `${asset.name} · upload` }));
              const artifactChoices = projectArtifacts.filter((artifact) => {
                const artifactKind = artifact.kind === "music" ? "audio" : artifact.kind;
                return !parameter.mediaKind || artifactKind === parameter.mediaKind;
              }).map((artifact) => ({ id: artifact.id, label: `${artifact.name} · generated` }));
              const choices = [...artifactChoices, ...uploadChoices];
              return <label className="field create-input-binding" key={parameter.id}><span>{parameter.label}</span><select value={inputBindings[parameter.id] ?? ""} onChange={(event) => setInputBindings((current) => ({ ...current, [parameter.id]: event.target.value }))}>
                <option value="">Choose retained {parameter.mediaKind ?? "media"}</option>
                {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
              </select>{!choices.length ? <small>Upload compatible media above.</small> : null}</label>;
            })}

            {scalarParameters.length ? <details className="workflow-run-settings">
              <summary><span>Settings</span><em>{settingsChanged ? `Save as v${workflow.currentRevision.version + 1}` : `v${workflow.currentRevision.version}`}</em></summary>
              <div className="workflow-run-parameters">{scalarParameters.map((parameter) => <WorkflowParameterField key={parameter.id} parameter={parameter} value={parameterValue(parameter)} showBinding={false} onChange={(value) => {
                if (valuesRevisionId !== workflow.currentRevision.id) {
                  setValuesRevisionId(workflow.currentRevision.id);
                  setWorkflowValues({ ...Object.fromEntries(scalarParameters.map((item) => [item.id, item.value])), [parameter.id]: value });
                } else {
                  setWorkflowValues((current) => ({ ...current, [parameter.id]: value }));
                }
              }} />)}</div>
              <button type="button" className="btn btn-ghost workflow-run-reset" disabled={!settingsChanged || busy} onClick={() => { setValuesRevisionId(workflow.currentRevision.id); setWorkflowValues(Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={14} /> Reset</button>
            </details> : null}

            {workflowWorkload ? <details className="workflow-performance create-performance">
              <summary><span><Icon name="analytics" size={15} /><strong>Speed & quality evidence</strong><small>{settingsChanged ? "New settings" : workflowHistory?.count ? `Median ${formatGenerationDuration(workflowHistory.medianMs)} · ${workflowHistory.count} runs` : "No exact-revision history"}</small></span><em>{Math.round(GENERATION_LONG_RUN_THRESHOLD_MS / 60_000)}m alert</em></summary>
              <div className="workflow-performance-body">{workflowWorkload.facts.length ? <div className="job-performance-facts">{workflowWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div> : <p>No workload controls are exposed by this workflow.</p>}{workflow.currentRevision.models.length ? <div className="job-performance-models"><small>Models</small><div>{workflow.currentRevision.models.map((model) => <code key={model}>{model}</code>)}</div></div> : null}<p>{workflowWorkload.likelyContributors.length ? `Likely cost drivers: ${workflowWorkload.likelyContributors.join(", ")}.` : "No high-cost setting stands out."}</p><small>{workflowWorkload.promptAssessment}</small></div>
            </details> : null}

            <div className="create-run-footer"><span>{workflow.currentRevision.nodeCount} nodes · {workflow.currentRevision.models.length} models · v{workflow.currentRevision.version}</span><button className="btn btn-primary" disabled={busy || !workflowReady || uiOnlyDevelopment} onClick={() => void queueWorkflow()}><Icon name="send" size={16} /> {settingsChanged ? `Save & generate ${outputModality}` : `Generate ${outputModality}`}</button></div>
          </> : <div className="create-blocked"><Icon name="flows" size={25} /><span><strong>Import a ComfyUI workflow.</strong><small>Choose its API-format JSON above; it will be selected automatically.</small></span>{developmentPreviewAvailable && outputModality !== "video" ? <button className="btn btn-ghost" disabled={busy} onClick={() => void submitDevelopmentPreview()}>Create development {outputModality} preview</button> : <button className="btn btn-primary" onClick={() => workflowInputRef.current?.click()}>Choose workflow JSON</button>}</div>}

          {afdfwCapability ? <details className="generation-optional-route create-remote-route"><summary><span>Optional remote route · AFDFW</span><em className={afdfwCapability.state}>{afdfwCapability.state}</em></summary><p>{afdfwCapability.detail}</p>{afdfwImageWorkload && afdfwImageProfile ? <div className="direct-generation-profile"><div>{afdfwImageWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div><details><summary>Model evidence · {afdfwImageProfile.models.length} files</summary>{afdfwImageProfile.models.map((model) => <code key={model}>{model}</code>)}</details></div> : null}<button className="btn btn-ghost" disabled={busy || afdfwCapability.state !== "available"} onClick={() => void submitRemote()}><Icon name="send" size={16} /> Generate remotely with AFDFW</button></details> : null}
          {selected.rights.referenceStoredAsProvenanceOnly ? <div className="rights-panel"><Icon name="shield" size={18} /><div><strong>Reference identity stays in lineage only.</strong></div></div> : null}
        </>}

        {notice ? <div className="create-notice" role="status"><span>{notice}</span>{activeJobs.length || notice.includes("queued") ? <button onClick={onQueued}>View queue</button> : null}</div> : null}
        {localError || error ? <div className="inline-error" role="alert">{localError || error}</div> : null}
      </section>
    </section>
  );
}
