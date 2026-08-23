import { useEffect, useRef, useState } from "react";
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
  type Artifact,
  type MediaAsset,
  type WorkflowParameter,
  type WorkflowScalar,
} from "../../../shared/contracts";
import { WorkflowParameterField } from "../workflows/WorkflowParameterField";
import { sameWorkflowValue } from "../workflows/workflowValues";
import {
  preferredQuickWorkflow,
  quickInputBindings,
  workflowCreateIntent,
  type CreateIntent,
  type QuickSourceKind,
} from "./quickCreate";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_WORKFLOW_BYTES = 1024 * 1024;

type QuickSource = {
  id: string;
  kind: QuickSourceKind;
  name: string;
  source: "upload" | "artifact";
  trainingEligible: boolean;
};

const INTENTS: Array<{ id: CreateIntent; label: string; icon: "image" | "video" | "music" | "dna" }> = [
  { id: "image", label: "Image", icon: "image" },
  { id: "video", label: "Video", icon: "video" },
  { id: "music", label: "Song", icon: "music" },
  { id: "train", label: "Train", icon: "dna" },
];

function sourceFromAsset(asset: MediaAsset): QuickSource {
  return { id: asset.id, kind: asset.kind, name: asset.name, source: "upload", trainingEligible: asset.trainingEligible };
}

function sourceFromArtifact(artifact: Artifact): QuickSource {
  return {
    id: artifact.id,
    kind: artifact.kind === "music" ? "audio" : artifact.kind,
    name: artifact.name,
    source: "artifact",
    trainingEligible: false,
  };
}

function shortDnaName(direction: string, intent: Exclude<CreateIntent, "train">) {
  const words = direction.trim().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").split(" ").slice(0, 6).join(" ");
  return words || `${intent === "music" ? "Song" : intent[0].toUpperCase() + intent.slice(1)} direction`;
}

export function GenerationView({
  onQueued,
  onMedia,
  onWorkflows,
  onDesign,
  onTrain,
  embedded = false,
}: {
  onQueued: () => void;
  onMedia: () => void;
  onWorkflows: () => void;
  onDesign: () => void;
  onTrain: (assetIds?: string[]) => void;
  embedded?: boolean;
}) {
  const {
    snapshot,
    activeProjectId,
    activeDna,
    selectDna,
    saveDna,
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
  const directionInitialized = useRef(false);
  const directionProjectId = useRef<string | null>(null);
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const availableDna = snapshot ? projectDna.filter((artifact) => creativeDnaCanGenerate(snapshot, artifact)) : [];
  const selected = snapshot && activeDna && creativeDnaCanGenerate(snapshot, activeDna) ? activeDna : availableDna[0] ?? null;
  const projectMedia = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [];
  const projectArtifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId && artifact.retention.state === "retained") ?? [];
  const workflows = snapshot?.workflows.filter((item) => item.projectId === activeProjectId && item.executionState === "ready" && item.modality !== "3d") ?? [];
  const [intent, setIntent] = useState<CreateIntent>("image");
  const [direction, setDirection] = useState("");
  const [quickSourceId, setQuickSourceId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const [workflowValues, setWorkflowValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (directionProjectId.current !== activeProjectId) {
      directionProjectId.current = activeProjectId;
      directionInitialized.current = false;
      setDirection("");
      setIntent("image");
      setQuickSourceId("");
      setWorkflowId("");
      setInputBindings({});
      setWorkflowValues({});
      setValuesRevisionId("");
      setNotice("");
    }
    if (!selected || directionInitialized.current) return;
    directionInitialized.current = true;
    setDirection(selected.source.directive || creativeDnaGenerationPrompt(selected, selected.targetModality));
    setIntent(selected.targetModality);
  }, [activeProjectId, selected]);

  const sourceChoices = intent === "train"
    ? projectMedia.map(sourceFromAsset)
    : [...projectArtifacts.map(sourceFromArtifact), ...projectMedia.map(sourceFromAsset)];
  const quickSource = sourceChoices.find((source) => source.id === quickSourceId) ?? null;
  const generationIntent = intent === "train" ? "image" : intent;
  const preferredWorkflow = preferredQuickWorkflow(workflows, generationIntent, quickSource?.kind ?? null);
  const workflow = workflows.find((item) => item.id === workflowId && workflowCreateIntent(item.modality) === generationIntent) ?? preferredWorkflow;
  const mediaParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind === "media") ?? [];
  const scalarParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind !== "media") ?? [];
  const effectiveInputBindings = quickInputBindings(mediaParameters, inputBindings, quickSource);
  const effectiveValues = workflow && valuesRevisionId === workflow.currentRevision.id ? workflowValues : {};
  const workflowPromptParameter = primaryWorkflowPromptParameter(scalarParameters, workflow?.modality);
  const parameterValue = (parameter: WorkflowParameter) => {
    if (Object.prototype.hasOwnProperty.call(effectiveValues, parameter.id)) return effectiveValues[parameter.id];
    if (parameter.id === workflowPromptParameter?.id && direction.trim()) return direction.trim();
    return parameter.value;
  };
  const settingsChanged = scalarParameters.some((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)));
  const runnerOnline = snapshot?.runners.some((runner) => runner.state === "online" || runner.state === "busy") ?? false;
  const uiOnlyDevelopment = snapshot?.adapter.id === "development-local-storage";
  const developmentPreviewAvailable = Boolean(uiOnlyDevelopment && snapshot?.adapter.development);
  const activeJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId && (job.status === "queued" || job.status === "running")) ?? [];
  const missingMediaParameters = mediaParameters.filter((parameter) => !effectiveInputBindings[parameter.id]);
  const sourceConnected = Boolean(quickSource && Object.values(effectiveInputBindings).includes(quickSource.id));
  const workflowReady = Boolean(workflow) && missingMediaParameters.length === 0;
  const directionReady = direction.trim().length >= 4;
  const trainingSource = quickSource?.source === "upload" && quickSource.trainingEligible ? quickSource : null;
  const performanceParameters = Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameterValue(parameter)]));
  const workflowWorkload = workflow ? analyzeGenerationWorkload({
    parameters: performanceParameters,
    models: workflow.currentRevision.models,
    inputAssetIds: Object.values(effectiveInputBindings),
    inputArtifactIds: [],
    prompt: workflowPromptParameter ? String(parameterValue(workflowPromptParameter)).trim() : direction.trim(),
  }) : null;
  const workflowHistory = workflow && !settingsChanged ? workflowRuntimeHistory(snapshot?.jobs ?? [], workflow.currentRevision.id) : null;
  const afdfwCapability = generationIntent === "music"
    ? snapshot?.capabilities.find((capability) => capability.key === "afdfw-music-generation") ?? null
    : generationIntent === "image"
      ? snapshot?.capabilities.find((capability) => capability.key === "afdfw-image-generation") ?? null
      : null;
  const afdfwImageProfile = generationIntent === "image" && afdfwCapability ? generationProviderWorkloadProfile("afdfw-z-image", "image") : null;
  const afdfwImageWorkload = afdfwImageProfile ? analyzeGenerationWorkload({
    parameters: afdfwImageProfile.parameters,
    models: afdfwImageProfile.models,
    inputAssetIds: [],
    inputArtifactIds: [],
    prompt: direction.trim(),
  }) : null;

  const resetWorkflowOverrides = () => {
    setWorkflowId("");
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setNotice("");
  };

  const chooseIntent = (nextIntent: CreateIntent) => {
    setIntent(nextIntent);
    resetWorkflowOverrides();
  };

  const chooseWorkflow = (id: string) => {
    setWorkflowId(id);
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setNotice("");
  };

  const uploadAndUseMedia = async (file: File | null) => {
    setLocalError("");
    if (!file || uiOnlyDevelopment) return;
    if (file.size > MAX_MEDIA_BYTES) {
      setLocalError("Choose source media no larger than 100 MB.");
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      return;
    }
    try {
      const asset = await uploadMedia(file, intent === "train" ? true : trainingEligible);
      setQuickSourceId(asset.id);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      if (intent === "train") {
        onTrain([asset.id]);
        return;
      }
      setNotice(`${asset.name} uploaded and ready to use.`);
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const importAndUseWorkflow = async (file: File | null) => {
    setLocalError("");
    if (!file || uiOnlyDevelopment) return;
    if (file.size > MAX_WORKFLOW_BYTES) {
      setLocalError("Choose a workflow JSON no larger than 1 MB.");
      if (workflowInputRef.current) workflowInputRef.current.value = "";
      return;
    }
    try {
      const imported = await uploadWorkflow(file);
      if (workflowInputRef.current) workflowInputRef.current.value = "";
      if (imported.executionState === "ready" && imported.modality !== "3d") {
        setIntent(workflowCreateIntent(imported.modality));
        setWorkflowId(imported.id);
        setInputBindings({});
        setWorkflowValues({});
        setValuesRevisionId("");
        setNotice(`${imported.name} imported and selected.`);
      } else {
        setNotice(`${imported.name} was saved. Export it from ComfyUI in API format before generation.`);
      }
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const ensureDna = async () => {
    const cleanDirection = direction.trim();
    if (cleanDirection.length < 4) {
      setLocalError("Describe what you want to create first.");
      return null;
    }
    const referenceAssetIds = quickSource?.source === "upload" ? [quickSource.id] : [];
    const selectedReferences = selected?.source.referenceAssetIds ?? [];
    const dnaTarget = generationIntent === "music" ? "music" : "image";
    const canReuse = selected
      && selected.targetModality === dnaTarget
      && selected.source.directive.trim() === cleanDirection
      && referenceAssetIds.length === selectedReferences.length
      && referenceAssetIds.every((id) => selectedReferences.includes(id));
    if (canReuse) return selected;
    return saveDna({
      name: shortDnaName(cleanDirection, generationIntent),
      directive: cleanDirection,
      targetModality: dnaTarget,
      sourceKind: referenceAssetIds.length ? "owner_uploads" : "original",
      referenceAssetIds,
      parentArtifactId: selected?.artifactId ?? null,
    });
  };

  const queueWorkflow = async () => {
    if (!workflow || !workflowReady) return;
    setLocalError("");
    try {
      const dna = await ensureDna();
      if (!dna) return;
      selectDna(dna);
      const modified = Object.fromEntries(scalarParameters
        .filter((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)))
        .map((parameter) => [parameter.id, parameterValue(parameter)]));
      let runWorkflow = workflow;
      if (Object.keys(modified).length) {
        runWorkflow = await saveWorkflowRevision(workflow.id, workflow.currentRevision.id, modified);
        setValuesRevisionId(runWorkflow.currentRevision.id);
        setWorkflowValues(Object.fromEntries(runWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
      }
      await submitWorkflowJob(runWorkflow, effectiveInputBindings, dna.artifactId);
      setNotice(`${runWorkflow.name} queued. You can keep creating while it runs.`);
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const submitRemote = async () => {
    if (generationIntent === "video") return;
    setLocalError("");
    try {
      const dna = await ensureDna();
      if (!dna) return;
      selectDna(dna);
      await submitAfdfwJob(generationIntent, dna.artifactId);
      setNotice(`Optional AFDFW ${generationIntent} job queued.`);
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const submitDevelopmentPreview = async () => {
    if (generationIntent === "video") return;
    setLocalError("");
    try {
      const dna = await ensureDna();
      if (!dna) return;
      selectDna(dna);
      await submitDevelopmentPreviewJob(generationIntent, dna.artifactId);
      setNotice(`Development ${generationIntent} preview queued. This is simulated media.`);
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const sourceRequirement = missingMediaParameters[0]?.mediaKind;
  const primaryLabel = !workflow
    ? "Add workflow JSON"
    : !workflowReady
      ? `Choose ${sourceRequirement ?? "source"}`
      : settingsChanged
        ? `Save & generate ${generationIntent}`
        : `Generate ${generationIntent}`;

  return (
    <section className={`generation-section create-surface quick-create${embedded ? " embedded" : " fade-up"}`} id="creative-dna-generation" aria-label="Create with Creative Studio">
      {activeJobs.length ? <button className="create-active-queue" onClick={onQueued}><StatusDot status={activeJobs[0].status} /><span><strong>{activeJobs.length} active {activeJobs.length === 1 ? "job" : "jobs"}</strong><small>View queue</small></span><Icon name="chevron" size={15} /></button> : null}

      <div className="quick-intents" role="group" aria-label="What do you want to make?">
        {INTENTS.map((item) => <button key={item.id} className={intent === item.id ? "on" : ""} aria-pressed={intent === item.id} onClick={() => chooseIntent(item.id)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
      </div>

      <section className="quick-create-card glass">
        <div className="quick-create-head">
          <div className={`create-output-icon ${intent}`}><Icon name={intent === "train" ? "dna" : intent} size={22} /></div>
          <div><span className="eyebrow">{intent === "train" ? "Learn from your work" : `New ${intent === "music" ? "song" : intent}`}</span><h2>{intent === "train" ? "Train CreativeDNA" : "Create"}</h2></div>
          {intent !== "train" ? <em className={runnerOnline ? "online" : "offline"}>{runnerOnline ? "Runner online" : "Will wait for runner"}</em> : null}
        </div>

        <div className="quick-source-row">
          <label className={`quick-upload${uiOnlyDevelopment ? " disabled" : ""}`}>
            <input ref={mediaInputRef} type="file" accept={ACCEPTED_MEDIA} disabled={busy || uiOnlyDevelopment} onChange={(event) => void uploadAndUseMedia(event.target.files?.[0] ?? null)} />
            <Icon name="plus" size={16} />
            <span><strong>{busy ? "Working…" : intent === "train" ? "Upload training media" : "Upload a source"}</strong><small>Image, audio, or video</small></span>
          </label>
          {sourceChoices.length ? <label className="quick-source-select"><span>or use retained work</span><select aria-label="Retained source" value={quickSource?.id ?? ""} disabled={busy} onChange={(event) => { setQuickSourceId(event.target.value); setInputBindings({}); }}><option value="">No source</option>{sourceChoices.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.source === "upload" ? "upload" : "generated"}</option>)}</select></label> : null}
        </div>

        {intent === "train" ? <>
          <p className="quick-train-copy">Choose one consented upload, then review the full training set and start the durable local run.</p>
          <button className="btn btn-primary quick-primary" disabled={busy} onClick={() => onTrain(trainingSource ? [trainingSource.id] : [])}><Icon name="dna" size={17} /> {trainingSource ? "Continue to training" : "Open training"}</button>
        </> : <>
          <label className="quick-direction"><span>{intent === "music" ? "Describe the song" : intent === "video" ? "Describe the video" : "Describe the image"}</span><textarea value={direction} maxLength={1200} onChange={(event) => setDirection(event.target.value)} placeholder={intent === "music" ? "Tempo, feeling, instruments, structure, and vocals…" : intent === "video" ? "Subject, action, camera movement, light, and atmosphere…" : "Subject, composition, materials, light, color, and atmosphere…"} /></label>
          <div className="quick-workflow-line"><span><Icon name="flows" size={14} /> {workflow?.name ?? `No ${intent === "music" ? "music" : intent} workflow`}</span>{quickSource ? <small>{sourceConnected ? "Source connected" : "Source not used by this workflow"}</small> : workflow?.currentRevision.parameters.some((parameter) => parameter.kind === "media") ? <small>Source required</small> : <small>No source required</small>}</div>
          <button className="btn btn-primary quick-primary" disabled={busy || uiOnlyDevelopment || !directionReady || (Boolean(workflow) && !workflowReady)} onClick={() => workflow ? void queueWorkflow() : workflowInputRef.current?.click()}><Icon name={workflow ? "send" : "plus"} size={17} /> {primaryLabel}</button>
          {!workflow && developmentPreviewAvailable && generationIntent !== "video" ? <button className="btn btn-ghost quick-development" disabled={busy || !directionReady} onClick={() => void submitDevelopmentPreview()}>Create explicitly simulated development preview</button> : null}
        </>}
      </section>

      {intent !== "train" ? <details className="quick-create-advanced glass">
        <summary><span><Icon name="settings" size={15} /><strong>Advanced</strong></span><small>DNA, workflow, exact settings, and remote route</small></summary>
        <div className="quick-advanced-body">
          <section className="quick-advanced-section">
            <header><strong>CreativeDNA</strong><button className="link-btn" onClick={onDesign}>Edit DNA</button></header>
            {availableDna.length ? <select aria-label="CreativeDNA direction" value={selected?.artifactId ?? ""} disabled={busy} onChange={(event) => {
              const dna = availableDna.find((artifact) => artifact.artifactId === event.target.value) ?? null;
              selectDna(dna);
              if (dna) setDirection(dna.source.directive || creativeDnaGenerationPrompt(dna, dna.targetModality));
            }}>{availableDna.map((artifact) => <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.name} · v{artifact.version}</option>)}</select> : <button className="btn btn-ghost" onClick={onDesign}>Build detailed CreativeDNA</button>}
            <label className="create-consent"><input type="checkbox" checked={trainingEligible} disabled={busy || uiOnlyDevelopment} onChange={(event) => setTrainingEligible(event.target.checked)} /> New uploads can be used for training</label>
          </section>

          <section className="quick-advanced-section">
            <header><strong>ComfyUI workflow</strong><button className="link-btn" onClick={onWorkflows}>Manage</button></header>
            {workflows.filter((item) => workflowCreateIntent(item.modality) === generationIntent).length ? <select aria-label="Generation workflow" value={workflow?.id ?? ""} disabled={busy} onChange={(event) => chooseWorkflow(event.target.value)}>{workflows.filter((item) => workflowCreateIntent(item.modality) === generationIntent).map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.currentRevision.version}</option>)}</select> : <span className="create-step-empty">No API-ready workflow for this output</span>}
            <label className={`create-file-button${uiOnlyDevelopment ? " disabled" : ""}`}><input ref={workflowInputRef} type="file" accept="application/json,.json" disabled={busy || uiOnlyDevelopment} onChange={(event) => void importAndUseWorkflow(event.target.files?.[0] ?? null)} /><Icon name="plus" size={14} /> Import workflow JSON</label>
          </section>

          {mediaParameters.length > 1 || missingMediaParameters.length ? <section className="quick-advanced-section quick-advanced-wide"><header><strong>Workflow inputs</strong><small>{missingMediaParameters.length ? `${missingMediaParameters.length} required` : "Connected"}</small></header><div className="quick-binding-grid">{mediaParameters.map((parameter) => {
            const uploadChoices = projectMedia.filter((asset) => !parameter.mediaKind || asset.kind === parameter.mediaKind).map((asset) => ({ id: asset.id, label: `${asset.name} · upload` }));
            const artifactChoices = projectArtifacts.filter((artifact) => !parameter.mediaKind || (artifact.kind === "music" ? "audio" : artifact.kind) === parameter.mediaKind).map((artifact) => ({ id: artifact.id, label: `${artifact.name} · generated` }));
            return <label className="field" key={parameter.id}><span>{parameter.label}</span><select value={effectiveInputBindings[parameter.id] ?? ""} onChange={(event) => setInputBindings((current) => ({ ...current, [parameter.id]: event.target.value }))}><option value="">Choose {parameter.mediaKind ?? "media"}</option>{[...artifactChoices, ...uploadChoices].map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>;
          })}</div></section> : null}

          {scalarParameters.length ? <section className="quick-advanced-section quick-advanced-wide"><header><strong>Exact settings</strong><small>{settingsChanged ? `Will save workflow v${(workflow?.currentRevision.version ?? 0) + 1}` : `Workflow v${workflow?.currentRevision.version}`}</small></header><div className="workflow-run-parameters">{scalarParameters.map((parameter) => <WorkflowParameterField key={parameter.id} parameter={parameter} value={parameterValue(parameter)} showBinding={false} onChange={(value) => {
            if (!workflow) return;
            if (valuesRevisionId !== workflow.currentRevision.id) {
              setValuesRevisionId(workflow.currentRevision.id);
              setWorkflowValues({ ...Object.fromEntries(scalarParameters.map((item) => [item.id, item.value])), [parameter.id]: value });
            } else setWorkflowValues((current) => ({ ...current, [parameter.id]: value }));
          }} />)}</div>{settingsChanged ? <button type="button" className="btn btn-ghost workflow-run-reset" disabled={busy} onClick={() => { if (!workflow) return; setValuesRevisionId(workflow.currentRevision.id); setWorkflowValues(Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={14} /> Reset settings</button> : null}</section> : null}

          {workflowWorkload ? <details className="workflow-performance create-performance quick-advanced-wide"><summary><span><Icon name="analytics" size={15} /><strong>Speed & quality evidence</strong><small>{settingsChanged ? "New settings" : workflowHistory?.count ? `Median ${formatGenerationDuration(workflowHistory.medianMs)} · ${workflowHistory.count} runs` : "No exact-revision history"}</small></span><em>{Math.round(GENERATION_LONG_RUN_THRESHOLD_MS / 60_000)}m alert</em></summary><div className="workflow-performance-body">{workflowWorkload.facts.length ? <div className="job-performance-facts">{workflowWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div> : <p>No workload controls are exposed by this workflow.</p>}{workflow.currentRevision.models.length ? <div className="job-performance-models"><small>Models</small><div>{workflow.currentRevision.models.map((model) => <code key={model}>{model}</code>)}</div></div> : null}<p>{workflowWorkload.likelyContributors.length ? `Likely cost drivers: ${workflowWorkload.likelyContributors.join(", ")}.` : "No high-cost setting stands out."}</p><small>{workflowWorkload.promptAssessment}</small></div></details> : null}

          {afdfwCapability ? <details className="generation-optional-route create-remote-route quick-advanced-wide"><summary><span>Optional remote route · AFDFW</span><em className={afdfwCapability.state}>{afdfwCapability.state}</em></summary><p>{afdfwCapability.detail}</p>{afdfwImageWorkload && afdfwImageProfile ? <div className="direct-generation-profile"><div>{afdfwImageWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div><details><summary>Model evidence · {afdfwImageProfile.models.length} files</summary>{afdfwImageProfile.models.map((model) => <code key={model}>{model}</code>)}</details></div> : null}<button className="btn btn-ghost" disabled={busy || afdfwCapability.state !== "available" || !directionReady} onClick={() => void submitRemote()}><Icon name="send" size={16} /> Generate remotely with AFDFW</button></details> : null}
          {selected?.rights.referenceStoredAsProvenanceOnly ? <div className="rights-panel quick-advanced-wide"><Icon name="shield" size={18} /><div><strong>Reference identity stays in lineage only.</strong></div></div> : null}
        </div>
      </details> : null}

      {notice ? <div className="create-notice" role="status"><span>{notice}</span>{activeJobs.length || notice.includes("queued") ? <button onClick={onQueued}>View queue</button> : null}</div> : null}
      {localError || error ? <div className="inline-error" role="alert">{localError || error}</div> : null}
      <button className="quick-library-link" onClick={onMedia}><Icon name="library" size={14} /> Browse all media</button>
    </section>
  );
}
