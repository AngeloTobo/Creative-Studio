import { useEffect, useMemo, useRef, useState } from "react";
import { creativeDnaCanGenerate, useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";
import {
  GENERATION_LONG_RUN_THRESHOLD_MS,
  FAST_IMAGE_MAX_STEPS,
  assessImagePerformance,
  analyzeGenerationWorkload,
  createVideoGenerationVersions,
  creativeDnaGenerationPrompt,
  fastImageParameterOverrides,
  formatGenerationDuration,
  generationProviderWorkloadProfile,
  primaryWorkflowPromptParameter,
  workflowRuntimeHistory,
  type Artifact,
  type MediaAsset,
  type ImagePerformanceMode,
  type WorkflowDefinition,
  type WorkflowParameter,
  type WorkflowScalar,
  type VideoGenerationOperation,
} from "../../../shared/contracts";
import { WorkflowParameterField } from "../workflows/WorkflowParameterField";
import { sameWorkflowValue } from "../workflows/workflowValues";
import {
  preferredQuickWorkflow,
  quickInputBindings,
  quickParameterValue,
  workflowCreateIntent,
  type CreateIntent,
  type QuickSourceKind,
} from "./quickCreate";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

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

function modelSummary(workflow: WorkflowDefinition) {
  const inputKinds = [...new Set(workflow.currentRevision.parameters
    .filter((parameter) => parameter.kind === "media" && parameter.mediaKind)
    .map((parameter) => parameter.mediaKind))];
  const input = inputKinds.length ? `${inputKinds.join(" + ")} source` : "No source required";
  const models = workflow.currentRevision.models.length;
  return `${input} · ${models || "No detected"} model ${models === 1 ? "file" : "files"}`;
}

function randomUint32() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0];
}

export function GenerationView({
  onQueued,
  onMedia,
  onWorkflows,
  onDesign,
  onTrain,
  initialVideoExtensionArtifactId,
  embedded = false,
}: {
  onQueued: () => void;
  onMedia: () => void;
  onWorkflows: () => void;
  onDesign: () => void;
  onTrain: (assetIds?: string[]) => void;
  initialVideoExtensionArtifactId?: string;
  embedded?: boolean;
}) {
  const {
    snapshot,
    activeProjectId,
    activeDna,
    selectDna,
    saveDna,
    uploadMedia,
    submitAfdfwJob,
    submitDevelopmentPreviewJob,
    submitWorkflowJob,
    saveWorkflowRevision,
    busy,
    error,
  } = useStudio();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const availableDna = snapshot ? projectDna.filter((artifact) => creativeDnaCanGenerate(snapshot, artifact)) : [];
  const selected = snapshot && activeDna && creativeDnaCanGenerate(snapshot, activeDna) ? activeDna : availableDna[0] ?? null;
  const projectMedia = useMemo(() => snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.mediaAssets]);
  const projectArtifacts = useMemo(() => snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId && artifact.retention.state === "retained") ?? [], [activeProjectId, snapshot?.artifacts]);
  const workflows = snapshot?.workflows.filter((item) => item.executionState === "ready" && item.modality !== "3d") ?? [];
  const initialVideoSource = initialVideoExtensionArtifactId
    ? projectArtifacts.find((artifact) => artifact.id === initialVideoExtensionArtifactId && artifact.kind === "video") ?? null
    : null;
  const directionInitialized = useRef(Boolean(initialVideoSource));
  const directionProjectId = useRef<string | null>(activeProjectId);
  const [intent, setIntent] = useState<CreateIntent>(initialVideoSource ? "video" : "image");
  const [direction, setDirection] = useState("");
  const [quickSourceId, setQuickSourceId] = useState(initialVideoSource?.id ?? "");
  const [workflowId, setWorkflowId] = useState("");
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const [workflowValues, setWorkflowValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const [imagePerformanceMode, setImagePerformanceMode] = useState<ImagePerformanceMode>("fast-default");
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState(initialVideoSource ? `${initialVideoSource.name} is ready to extend from its final frame.` : "");
  const [videoOperation, setVideoOperation] = useState<VideoGenerationOperation | null>(initialVideoSource ? {
    kind: "extend",
    sourceId: initialVideoSource.id,
    source: "artifact",
    sourceFrame: "last",
    outputMode: "combined",
    transitionSeconds: 0.5,
    audioMode: "keep-source",
  } : null);

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
      setImagePerformanceMode("fast-default");
      setNotice("");
      setVideoOperation(null);
    }
    if (!selected || directionInitialized.current) return;
    directionInitialized.current = true;
    setDirection(selected.source.directive || creativeDnaGenerationPrompt(selected, selected.targetModality));
    setIntent(selected.targetModality);
  }, [activeProjectId, selected]);

  const sourceChoices = videoOperation
    ? [...projectArtifacts.filter((artifact) => artifact.kind === "video").map(sourceFromArtifact), ...projectMedia.filter((asset) => asset.kind === "video").map(sourceFromAsset)]
    : intent === "train"
    ? projectMedia.map(sourceFromAsset)
    : [...projectArtifacts.map(sourceFromArtifact), ...projectMedia.map(sourceFromAsset)];
  const quickSource = sourceChoices.find((source) => source.id === quickSourceId) ?? null;
  const generationIntent = intent === "train" ? "image" : intent;
  const intentWorkflows = workflows.filter((item) => workflowCreateIntent(item.modality) === generationIntent);
  const preferredWorkflow = preferredQuickWorkflow(intentWorkflows, generationIntent, videoOperation ? "image" : quickSource?.kind ?? null);
  const workflow = workflows.find((item) => item.id === workflowId && workflowCreateIntent(item.modality) === generationIntent) ?? preferredWorkflow;
  const mediaParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind === "media") ?? [];
  const scalarParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind !== "media") ?? [];
  const bindingSource = videoOperation && quickSource ? { ...quickSource, kind: "image" as const } : quickSource;
  const effectiveInputBindings = quickInputBindings(mediaParameters, inputBindings, bindingSource);
  const effectiveVideoOperation = videoOperation && quickSource?.kind === "video"
    ? { ...videoOperation, sourceId: quickSource.id, source: quickSource.source } satisfies VideoGenerationOperation
    : null;
  const effectiveValues = workflow && valuesRevisionId === workflow.currentRevision.id ? workflowValues : {};
  const workflowPromptParameter = primaryWorkflowPromptParameter(scalarParameters, workflow?.modality);
  const workflowSeedParameter = generationIntent === "video"
    ? scalarParameters.find((parameter) => parameter.kind === "number" && /(?:^|\b|::)(?:noise_)?seed(?:\b|$)/i.test(`${parameter.id} ${parameter.label} ${parameter.binding.format === "comfyui-api" ? parameter.binding.inputName : ""}`)) ?? null
    : null;
  const rawParameterValue = (parameter: WorkflowParameter) => quickParameterValue(
    parameter,
    workflowPromptParameter?.id ?? null,
    direction,
    effectiveValues,
  );
  const fastImageOverrides = generationIntent === "image" && imagePerformanceMode === "fast-default"
    ? fastImageParameterOverrides(scalarParameters.map((parameter) => ({ ...parameter, value: rawParameterValue(parameter) })))
    : {};
  const parameterValue = (parameter: WorkflowParameter) => Object.prototype.hasOwnProperty.call(fastImageOverrides, parameter.id)
    ? fastImageOverrides[parameter.id]
    : rawParameterValue(parameter);
  const settingsChanged = scalarParameters.some((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)));
  const runnerOnline = snapshot?.runners.some((runner) => runner.state === "online" || runner.state === "busy") ?? false;
  const uiOnlyDevelopment = snapshot?.adapter.id === "development-local-storage";
  const developmentPreviewAvailable = Boolean(uiOnlyDevelopment && snapshot?.adapter.development);
  const activeJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId && (job.status === "queued" || job.status === "running")) ?? [];
  const missingMediaParameters = mediaParameters.filter((parameter) => !effectiveInputBindings[parameter.id]);
  const workflowReady = Boolean(workflow) && missingMediaParameters.length === 0;
  const directionReady = direction.trim().length >= 4;
  const trainingSource = quickSource?.source === "upload" && quickSource.trainingEligible ? quickSource : null;
  const performanceParameters = Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameterValue(parameter)]));
  const imagePerformance = generationIntent === "image" && workflow ? assessImagePerformance(performanceParameters) : null;
  const fastImageBlocked = imagePerformanceMode === "fast-default" && Boolean(imagePerformance?.requiresExplicitCustom);
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
    setImagePerformanceMode("fast-default");
    setNotice("");
  };

  const chooseIntent = (nextIntent: CreateIntent) => {
    if (nextIntent !== intent) setDirection("");
    setIntent(nextIntent);
    setVideoOperation(null);
    resetWorkflowOverrides();
  };

  const chooseWorkflow = (id: string) => {
    setWorkflowId(id);
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setImagePerformanceMode("fast-default");
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
      if (videoOperation && asset.kind !== "video") {
        setLocalError("Choose a video to extend.");
        return;
      }
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
    if (videoOperation && !effectiveVideoOperation) {
      setLocalError("Choose a retained video to extend.");
      return;
    }
    if (generationIntent === "video" && !workflowPromptParameter) {
      setLocalError("This video model does not expose a prompt, so Creative Studio cannot make two distinct versions. Map its prompt input in Models first.");
      return;
    }
    try {
      const dna = await ensureDna();
      if (!dna) return;
      selectDna(dna);
      const videoVersions = generationIntent === "video"
        ? createVideoGenerationVersions({
          direction: direction.trim(),
          dimensions: dna.shared,
          pairId: `video_pair_${crypto.randomUUID()}`,
          discoverySeed: randomUint32(),
          hasSource: Boolean(quickSource),
        })
        : null;
      const modified = Object.fromEntries(scalarParameters
        .filter((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)))
        .map((parameter) => [parameter.id, parameterValue(parameter)]));
      let runWorkflow = workflow;
      if (Object.keys(modified).length) {
        runWorkflow = await saveWorkflowRevision(workflow.id, workflow.currentRevision.id, modified);
      }
      if (videoVersions && workflowPromptParameter) {
        const [aligned, discovery] = videoVersions;
        const discoveryValues: Record<string, WorkflowScalar> = { [workflowPromptParameter.id]: discovery.prompt };
        if (workflowSeedParameter && discovery.variant.seed !== null) discoveryValues[workflowSeedParameter.id] = discovery.variant.seed;
        const discoveryWorkflow = await saveWorkflowRevision(
          runWorkflow.id,
          runWorkflow.currentRevision.id,
          discoveryValues,
        );
        setValuesRevisionId(discoveryWorkflow.currentRevision.id);
        setWorkflowValues(Object.fromEntries(discoveryWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
        await submitWorkflowJob(
          runWorkflow,
          effectiveInputBindings,
          dna.artifactId,
          effectiveVideoOperation ?? undefined,
          undefined,
          aligned.variant,
        );
        await submitWorkflowJob(
          discoveryWorkflow,
          effectiveInputBindings,
          dna.artifactId,
          effectiveVideoOperation ?? undefined,
          undefined,
          discovery.variant,
        );
        setNotice("Aligned and Discovery queued as 2 durable video jobs. They will render one after the other on the Local Runner.");
        return;
      }
      setValuesRevisionId(runWorkflow.currentRevision.id);
      setWorkflowValues(Object.fromEntries(runWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
      await submitWorkflowJob(
        runWorkflow,
        effectiveInputBindings,
        dna.artifactId,
        effectiveVideoOperation ?? undefined,
        generationIntent === "image" ? imagePerformanceMode : undefined,
      );
      setNotice(`${effectiveVideoOperation ? "Video extension" : runWorkflow.name} queued. You can keep creating while it runs.`);
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
  const basePrimaryLabel = !workflow
    ? "Choose a model"
    : !workflowReady
      ? `Choose ${sourceRequirement ?? "source"}`
      : settingsChanged
        ? effectiveVideoOperation ? "Save & extend 2 versions" : generationIntent === "video" ? "Save & generate 2 videos" : `Save & generate ${generationIntent}`
        : effectiveVideoOperation
          ? "Extend into 2 versions"
          : generationIntent === "video" ? "Generate 2 videos" : `Generate ${generationIntent}`;
  const primaryLabel = generationIntent === "image" && workflow
    ? `${basePrimaryLabel}${imagePerformanceMode === "fast-default" ? " · fast" : imagePerformance?.requiresExplicitCustom ? " · can be slow" : " · custom"}`
    : basePrimaryLabel;

  return (
    <section className={`generation-section create-surface quick-create${embedded ? " embedded" : " fade-up"}`} id="creative-dna-generation" aria-label="Create with Creative Studio">
      {activeJobs.length ? <button className="create-active-queue" onClick={onQueued}><StatusDot status={activeJobs[0].status} /><span><strong>{activeJobs.length} active {activeJobs.length === 1 ? "job" : "jobs"}</strong><small>View queue</small></span><Icon name="chevron" size={15} /></button> : null}

      <div className="quick-intents" role="group" aria-label="What do you want to make?">
        {INTENTS.map((item) => <button key={item.id} className={intent === item.id ? "on" : ""} aria-pressed={intent === item.id} onClick={() => chooseIntent(item.id)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
      </div>

      <section className="quick-create-card glass">
        <div className="quick-create-head">
          <div className={`create-output-icon ${intent}`}><Icon name={intent === "train" ? "dna" : intent} size={22} /></div>
          <div><span className="eyebrow">{intent === "train" ? "Learn from your work" : videoOperation ? "Continue retained motion" : `New ${intent === "music" ? "song" : intent}`}</span><h2>{intent === "train" ? "Train CreativeDNA" : videoOperation ? "Extend video" : "Create"}</h2></div>
          {intent !== "train" ? <em className={runnerOnline ? "online" : "offline"}>{runnerOnline ? "Runner online" : "Will wait for runner"}</em> : null}
        </div>

        {intent !== "train" ? <div className="quick-model-picker">
          <div className="quick-model-head"><span>Model</span><button className="link-btn" onClick={onWorkflows}>Manage models</button></div>
          {intentWorkflows.length ? <div className="quick-models" role="group" aria-label={`${intent === "music" ? "Song" : intent} model`}>
            {intentWorkflows.map((item) => <button key={item.id} className={workflow?.id === item.id ? "on" : ""} aria-pressed={workflow?.id === item.id} disabled={busy} onClick={() => chooseWorkflow(item.id)}><Icon name={item.modality === "music" || item.modality === "audio" ? "music" : item.modality === "video" ? "video" : "image"} size={17} /><span><strong>{item.name}</strong><small>{modelSummary(item)}</small></span></button>)}
          </div> : <button className="quick-model-empty" onClick={onWorkflows}><Icon name="flows" size={16} /><span><strong>No {intent === "music" ? "song" : intent} model is ready</strong><small>Manage models</small></span><Icon name="chevron" size={14} /></button>}
        </div> : null}

        {generationIntent === "image" && workflow ? <div className={`quick-image-speed${fastImageBlocked ? " blocked" : ""}`}>
          <div className="quick-image-speed-options" role="group" aria-label="Image speed">
            <button type="button" className={imagePerformanceMode === "fast-default" ? "on" : ""} aria-pressed={imagePerformanceMode === "fast-default"} disabled={busy} onClick={() => setImagePerformanceMode("fast-default")}><Icon name="generate" size={15} /><span><strong>Fast</strong><small>Up to 512×512 · {FAST_IMAGE_MAX_STEPS} steps · 1 image</small></span></button>
            <button type="button" className={imagePerformanceMode === "explicit-custom" ? "on warning" : "warning"} aria-pressed={imagePerformanceMode === "explicit-custom"} disabled={busy} onClick={() => setImagePerformanceMode("explicit-custom")}><Icon name="settings" size={15} /><span><strong>Custom · can be slow</strong><small>Use the exact workflow settings</small></span></button>
          </div>
          <small>{fastImageBlocked
            ? `Fast mode cannot safely run this model because ${imagePerformance?.reasons.join(" and ")}. Choose Custom only when you accept a longer render.`
            : imagePerformanceMode === "fast-default"
              ? "Uses the proven local image target; a first model load can still add setup time."
              : imagePerformance?.requiresExplicitCustom
                ? `Long-run factors: ${imagePerformance.reasons.join("; ")}.`
                : "Custom mode is explicit, but these exact controls are still within the fast limits."}</small>
        </div> : null}

        {generationIntent === "video" && workflow ? <div className="quick-video-pair" aria-label="Two video versions per request">
          <Icon name="video" size={16} />
          <span><strong>2 versions per run</strong><small>Aligned: your exact direction · Discovery: 70% random DNA</small></span>
        </div> : null}

        <div className={`quick-source-row${videoOperation ? " video-extension-source" : ""}`}>
          <label className={`quick-upload${uiOnlyDevelopment ? " disabled" : ""}`}>
            <input ref={mediaInputRef} type="file" accept={videoOperation ? "video/mp4,video/webm,video/quicktime" : ACCEPTED_MEDIA} disabled={busy || uiOnlyDevelopment} onChange={(event) => void uploadAndUseMedia(event.target.files?.[0] ?? null)} />
            <Icon name="plus" size={16} />
            <span><strong>{busy ? "Working…" : intent === "train" ? "Upload training media" : videoOperation ? "Upload video to extend" : "Upload a source"}</strong><small>{videoOperation ? "MP4, WebM, or MOV" : "Image, audio, or video"}</small></span>
          </label>
          {sourceChoices.length ? <label className="quick-source-select"><span>{videoOperation ? "video to extend" : "or use retained work"}</span><select aria-label={videoOperation ? "Video to extend" : "Retained source"} value={quickSource?.id ?? ""} disabled={busy} onChange={(event) => { setQuickSourceId(event.target.value); setInputBindings({}); }}><option value="">No source</option>{sourceChoices.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.source === "upload" ? "upload" : "generated"}</option>)}</select></label> : null}
        </div>

        {videoOperation ? <section className="quick-video-tools" aria-label="Video extension settings">
          <header><span><Icon name="video" size={16} /><strong>Final-frame continuation</strong></span><small>Local FFmpeg + ComfyUI</small></header>
          <div>
            <label><span>Result</span><select value={videoOperation.outputMode} disabled={busy} onChange={(event) => setVideoOperation((current) => current ? { ...current, outputMode: event.target.value as VideoGenerationOperation["outputMode"], transitionSeconds: event.target.value === "combined" ? 0.5 : 0, audioMode: event.target.value === "combined" ? "keep-source" : "mute" } : current)}><option value="combined">One longer video</option><option value="continuation">Continuation clip only</option></select></label>
            <label><span>Join</span><select value={videoOperation.transitionSeconds} disabled={busy || videoOperation.outputMode !== "combined"} onChange={(event) => setVideoOperation((current) => current ? { ...current, transitionSeconds: Number(event.target.value) as VideoGenerationOperation["transitionSeconds"] } : current)}><option value="0">Clean cut</option><option value="0.25">0.25s dissolve</option><option value="0.5">0.5s dissolve</option><option value="1">1s dissolve</option></select></label>
            <label className="quick-video-audio"><input type="checkbox" checked={videoOperation.audioMode === "keep-source"} disabled={busy || videoOperation.outputMode !== "combined"} onChange={(event) => setVideoOperation((current) => current ? { ...current, audioMode: event.target.checked ? "keep-source" : "mute" } : current)} /><span><strong>Keep source audio</strong><small>Silence continues after the original track ends.</small></span></label>
          </div>
        </section> : null}

        {intent === "train" ? <>
          <p className="quick-train-copy">Choose one consented upload, then review the full training set and start the durable local run.</p>
          <button className="btn btn-primary quick-primary" disabled={busy} onClick={() => onTrain(trainingSource ? [trainingSource.id] : [])}><Icon name="dna" size={17} /> {trainingSource ? "Continue to training" : "Open training"}</button>
        </> : <>
          <label className="quick-direction"><span>{intent === "music" ? "Describe the song" : videoOperation ? "Describe what happens next" : intent === "video" ? "Describe the video" : "Describe the image"}</span><textarea value={direction} maxLength={1200} onChange={(event) => setDirection(event.target.value)} placeholder={intent === "music" ? "Tempo, feeling, instruments, structure, and vocals…" : videoOperation ? "Continue the action, camera motion, lighting, and timing…" : intent === "video" ? "Subject, action, camera movement, light, and atmosphere…" : "Subject, composition, materials, light, color, and atmosphere…"} /></label>
          <button className="btn btn-primary quick-primary" disabled={busy || uiOnlyDevelopment || !workflow || !directionReady || !workflowReady || fastImageBlocked || (generationIntent === "video" && !workflowPromptParameter)} onClick={() => void queueWorkflow()}><Icon name="send" size={17} /> {primaryLabel}</button>
          {!workflow && developmentPreviewAvailable && generationIntent !== "video" ? <button className="btn btn-ghost quick-development" disabled={busy || !directionReady} onClick={() => void submitDevelopmentPreview()}>Create explicitly simulated development preview</button> : null}
        </>}
      </section>

      {intent !== "train" ? <details className="quick-create-advanced glass">
        <summary><span><Icon name="settings" size={15} /><strong>Advanced</strong></span><small>DNA, exact settings, and remote route</small></summary>
        <div className="quick-advanced-body">
          <section className="quick-advanced-section quick-advanced-wide">
            <header><strong>CreativeDNA</strong><button className="link-btn" onClick={onDesign}>Edit DNA</button></header>
            {availableDna.length ? <select aria-label="CreativeDNA direction" value={selected?.artifactId ?? ""} disabled={busy} onChange={(event) => {
              const dna = availableDna.find((artifact) => artifact.artifactId === event.target.value) ?? null;
              selectDna(dna);
              if (dna) setDirection(dna.source.directive || creativeDnaGenerationPrompt(dna, dna.targetModality));
            }}>{availableDna.map((artifact) => <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.name} · v{artifact.version}</option>)}</select> : <button className="btn btn-ghost" onClick={onDesign}>Build detailed CreativeDNA</button>}
            <label className="create-consent"><input type="checkbox" checked={trainingEligible} disabled={busy || uiOnlyDevelopment} onChange={(event) => setTrainingEligible(event.target.checked)} /> New uploads can be used for training</label>
          </section>

          {mediaParameters.length > 1 || missingMediaParameters.length ? <section className="quick-advanced-section quick-advanced-wide"><header><strong>Workflow inputs</strong><small>{missingMediaParameters.length ? `${missingMediaParameters.length} required` : "Connected"}</small></header><div className="quick-binding-grid">{mediaParameters.map((parameter) => {
            const uploadChoices = projectMedia.filter((asset) => !parameter.mediaKind || asset.kind === parameter.mediaKind).map((asset) => ({ id: asset.id, label: `${asset.name} · upload` }));
            const artifactChoices = projectArtifacts.filter((artifact) => !parameter.mediaKind || (artifact.kind === "music" ? "audio" : artifact.kind) === parameter.mediaKind).map((artifact) => ({ id: artifact.id, label: `${artifact.name} · generated` }));
            return <label className="field" key={parameter.id}><span>{parameter.label}</span><select value={effectiveInputBindings[parameter.id] ?? ""} onChange={(event) => setInputBindings((current) => ({ ...current, [parameter.id]: event.target.value }))}><option value="">Choose {parameter.mediaKind ?? "media"}</option>{[...artifactChoices, ...uploadChoices].map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>;
          })}</div></section> : null}

          {scalarParameters.length ? <section className="quick-advanced-section quick-advanced-wide"><header><strong>Exact settings</strong><small>{settingsChanged ? `Will save workflow v${(workflow?.currentRevision.version ?? 0) + 1}` : `Workflow v${workflow?.currentRevision.version}`}</small></header><div className="workflow-run-parameters">{scalarParameters.map((parameter) => <WorkflowParameterField key={parameter.id} parameter={parameter} value={parameterValue(parameter)} showBinding={false} onChange={(value) => {
            if (!workflow) return;
            if (parameter.id === workflowPromptParameter?.id) {
              setDirection(String(value));
              return;
            }
            const displayedValues = Object.fromEntries(scalarParameters.map((item) => [item.id, parameterValue(item)]));
            setImagePerformanceMode("explicit-custom");
            setValuesRevisionId(workflow.currentRevision.id);
            setWorkflowValues({ ...displayedValues, [parameter.id]: value });
          }} />)}</div>{settingsChanged ? <button type="button" className="btn btn-ghost workflow-run-reset" disabled={busy} onClick={() => { if (!workflow) return; setImagePerformanceMode("fast-default"); setValuesRevisionId(workflow.currentRevision.id); setWorkflowValues(Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={14} /> Return to fast defaults</button> : null}</section> : null}

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
