import { useEffect, useMemo, useRef, useState } from "react";
import { creativeDnaCanGenerate, useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { StatusDot } from "../../components/Visuals";
import {
  GENERATION_LONG_RUN_THRESHOLD_MS,
  GENERATION_ASPECT_PRESETS,
  GENERATION_FPS_PRESETS,
  GENERATION_STEP_PRESETS,
  IMAGE_MEGAPIXEL_PRESETS,
  VIDEO_MEGAPIXEL_PRESETS,
  FAST_IMAGE_MAX_STEPS,
  assessImagePerformance,
  analyzeGenerationWorkload,
  createVideoGenerationVersions,
  createSongPromptRecommendations,
  canonicalWorkflowParameterValue,
  evolutionBranchPrompt,
  creativeDnaDescriptionSummaries,
  creativeDnaGenerationPrompt,
  fastImageParameterOverrides,
  formatGenerationDuration,
  estimateGenerationRuntime,
  generationCanvasOverrides,
  generationControlSet,
  inferGenerationAspectRatio,
  generationProviderWorkloadProfile,
  generationWorkflowPromptParameters,
  musicWorkflowLyricsParameter,
  musicWorkflowPromptProfile,
  primaryWorkflowPromptParameter,
  VIDEO_DURATION_OPTIONS,
  videoDurationLabel,
  videoWorkflowDurationParameters,
  videoWorkflowDurationProfile,
  workflowSupportsVideoDuration,
  workflowRuntimeHistory,
  type Artifact,
  type MediaAsset,
  type ImagePerformanceMode,
  type WorkflowDefinition,
  type WorkflowParameter,
  type WorkflowScalar,
  type VideoGenerationOperation,
  type VideoDurationSeconds,
  type EvolutionJobContext,
  type EvolutionRole,
  type GenerationAspectRatio,
} from "../../../shared/contracts";
import { WorkflowParameterField } from "../workflows/WorkflowParameterField";
import { sameWorkflowValue } from "../workflows/workflowValues";
import {
  preferredQuickWorkflow,
  quickAnimationDirection,
  quickInputBindings,
  quickParameterValue,
  workflowCreateIntent,
  type CreateIntent,
  type QuickSourceKind,
} from "./quickCreate";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const ACCEPTED_ART = "image/jpeg,image/png,image/webp,image/gif";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

type QuickSource = {
  id: string;
  kind: QuickSourceKind;
  name: string;
  source: "upload" | "artifact";
  trainingEligible: boolean;
  createdAt: string;
  previewUrl: string | null;
  posterUrl: string | null;
  colors: [string, string];
};

const SOURCE_GALLERY_LIMIT = 6;

const INTENTS: Array<{ id: CreateIntent; label: string; icon: "image" | "video" | "music" | "dna" }> = [
  { id: "image", label: "Image", icon: "image" },
  { id: "video", label: "Video", icon: "video" },
  { id: "music", label: "Song", icon: "music" },
  { id: "train", label: "Train", icon: "dna" },
];

function sourceFromAsset(asset: MediaAsset): QuickSource {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    source: "upload",
    trainingEligible: asset.trainingEligible,
    createdAt: asset.createdAt,
    previewUrl: asset.contentUrl,
    posterUrl: null,
    colors: asset.kind === "image" ? ["#312e81", "#c026d3"] : asset.kind === "video" ? ["#172554", "#7c3aed"] : ["#164e63", "#db2777"],
  };
}

function sourceFromArtifact(artifact: Artifact): QuickSource {
  return {
    id: artifact.id,
    kind: artifact.kind === "music" ? "audio" : artifact.kind,
    name: artifact.name,
    source: "artifact",
    trainingEligible: false,
    createdAt: artifact.createdAt,
    previewUrl: artifact.preview.url,
    posterUrl: artifact.preview.posterUrl ?? null,
    colors: artifact.preview.colors,
  };
}

function newestQuickSources(sources: QuickSource[]) {
  return [...new Map(sources.map((source) => [source.id, source])).values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.name.localeCompare(right.name));
}

function QuickSourceVisual({ source }: { source: QuickSource }) {
  if (source.kind === "image" && source.previewUrl) return <img src={source.previewUrl} alt="" loading="lazy" />;
  if (source.kind === "video" && source.posterUrl) return <img src={source.posterUrl} alt="" loading="lazy" />;
  if (source.kind === "video" && source.previewUrl) return <video src={`${source.previewUrl}#t=0.001`} muted playsInline preload="metadata" aria-hidden="true" onLoadedMetadata={(event) => {
    const video = event.currentTarget;
    if (video.duration > 0 && video.currentTime === 0) video.currentTime = Math.min(0.001, video.duration / 2);
  }} />;
  if (source.kind === "audio") return <span className="quick-source-wave" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</span>;
  return <span className="quick-source-fallback"><Icon name={source.kind} size={21} /></span>;
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

function durationRange(lowMs: number, highMs: number) {
  const low = formatGenerationDuration(lowMs);
  const high = formatGenerationDuration(highMs);
  return low === high ? low : `${low}–${high}`;
}

export function GenerationView({
  onQueued,
  onMedia,
  onWorkflows,
  onDesign,
  onTrain,
  initialVideoExtensionArtifactId,
  initialEvolutionSourceId,
  initialSourceId,
  initialCreateIntent,
  initialAutoStart = false,
  embedded = false,
}: {
  onQueued: () => void;
  onMedia: () => void;
  onWorkflows: () => void;
  onDesign: () => void;
  onTrain: (assetIds?: string[]) => void;
  initialVideoExtensionArtifactId?: string;
  initialEvolutionSourceId?: string;
  initialSourceId?: string;
  initialCreateIntent?: CreateIntent;
  initialAutoStart?: boolean;
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
  const allProjectArtifacts = useMemo(() => snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.artifacts]);
  const projectArtifacts = useMemo(() => allProjectArtifacts.filter((artifact) => artifact.retention.state === "retained"), [allProjectArtifacts]);
  const workflows = snapshot?.workflows.filter((item) => item.executionState === "ready" && item.modality !== "3d") ?? [];
  const initialVideoSource = initialVideoExtensionArtifactId
    ? projectArtifacts.find((artifact) => artifact.id === initialVideoExtensionArtifactId && artifact.kind === "video") ?? null
    : null;
  const initialEvolutionArtifact = initialEvolutionSourceId
    ? allProjectArtifacts.find((artifact) => artifact.id === initialEvolutionSourceId) ?? null
    : null;
  const initialEvolutionAsset = initialEvolutionSourceId
    ? projectMedia.find((asset) => asset.id === initialEvolutionSourceId) ?? null
    : null;
  const initialEvolutionSource = initialEvolutionArtifact
    ? sourceFromArtifact(initialEvolutionArtifact)
    : initialEvolutionAsset ? sourceFromAsset(initialEvolutionAsset) : null;
  const initialDirectArtifact = initialSourceId ? allProjectArtifacts.find((artifact) => artifact.id === initialSourceId) ?? null : null;
  const initialDirectAsset = initialSourceId ? projectMedia.find((asset) => asset.id === initialSourceId) ?? null : null;
  const initialDirectSource = initialDirectArtifact ? sourceFromArtifact(initialDirectArtifact) : initialDirectAsset ? sourceFromAsset(initialDirectAsset) : null;
  const initialDirectAnalysis = initialDirectAsset
    ? [...projectDna]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .flatMap((artifact) => artifact.training?.analysis.sources ?? [])
      .find((source) => source.kind === "image" && (source.mediaId === initialDirectAsset.id || source.sourceId === initialDirectAsset.id) && source.detailedDescription)
    : null;
  const initialDirectDescription = initialDirectAnalysis?.detailedDescription
    ? creativeDnaDescriptionSummaries(initialDirectAnalysis.detailedDescription).shortSummary
    : null;
  const initialIntent: CreateIntent = initialCreateIntent ?? (initialVideoSource || initialEvolutionSource?.kind === "video"
    ? "video"
    : initialEvolutionSource?.kind === "audio" ? "music" : "image");
  const autoAnimate = Boolean(initialAutoStart && initialIntent === "video" && initialDirectSource?.kind === "image");
  const initialDirection = autoAnimate
    ? quickAnimationDirection(initialDirectArtifact?.prompt ?? initialDirectDescription)
    : initialEvolutionArtifact?.prompt ?? selected?.source.directive ?? "";
  const autoStartRequested = useRef(autoAnimate);
  const queueWorkflowRef = useRef<(openQueueAfter?: boolean) => Promise<void>>(async () => undefined);
  const directionInitialized = useRef(Boolean(initialVideoSource || initialEvolutionSource || initialDirectSource));
  const directionProjectId = useRef<string | null>(activeProjectId);
  const [intent, setIntent] = useState<CreateIntent>(initialIntent);
  const [direction, setDirection] = useState(initialDirection);
  const [lyrics, setLyrics] = useState("");
  const [quickSourceId, setQuickSourceId] = useState(initialVideoSource?.id ?? initialEvolutionSource?.id ?? initialDirectSource?.id ?? "");
  const [evolutionEnabled, setEvolutionEnabled] = useState(Boolean(initialEvolutionSource));
  const [evolutionStudyId] = useState(() => `evolve_${crypto.randomUUID()}`);
  const [workflowId, setWorkflowId] = useState("");
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const [workflowValues, setWorkflowValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const [imagePerformanceMode, setImagePerformanceMode] = useState<ImagePerformanceMode>("fast-default");
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<VideoDurationSeconds>(5);
  const [canvasAspectRatio, setCanvasAspectRatio] = useState<GenerationAspectRatio | null>(null);
  const [canvasMegapixels, setCanvasMegapixels] = useState<number | null>(null);
  const [sourceGalleryExpanded, setSourceGalleryExpanded] = useState(false);
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState(autoAnimate ? `Preparing ${initialDirectSource?.name ?? "image"} for animation…` : initialVideoSource ? `${initialVideoSource.name} is ready to extend from its final frame.` : initialEvolutionSource ? `${initialEvolutionSource.name} is ready to evolve as a grouped study.` : initialDirectSource ? `${initialDirectSource.name} is selected as the source.` : "");
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
      setLyrics("");
      setIntent("image");
      setQuickSourceId("");
      setWorkflowId("");
      setInputBindings({});
      setWorkflowValues({});
      setValuesRevisionId("");
      setImagePerformanceMode("fast-default");
      setVideoDurationSeconds(5);
      setCanvasAspectRatio(null);
      setCanvasMegapixels(null);
      setSourceGalleryExpanded(false);
      setNotice("");
      setVideoOperation(null);
      setEvolutionEnabled(false);
    }
    if (!selected || directionInitialized.current) return;
    directionInitialized.current = true;
    setDirection(selected.source.directive || creativeDnaGenerationPrompt(selected, selected.targetModality));
    setIntent(selected.targetModality);
  }, [activeProjectId, selected]);

  const sourceIntent = intent === "train" ? "image" : intent;
  const compatibleSourceKinds = new Set<QuickSourceKind>(workflows
    .filter((item) => workflowCreateIntent(item.modality) === sourceIntent)
    .flatMap((item) => item.currentRevision.parameters
      .filter((parameter) => parameter.kind === "media" && parameter.mediaKind)
      .map((parameter) => parameter.mediaKind as QuickSourceKind)));
  if (!compatibleSourceKinds.size && intent !== "train") compatibleSourceKinds.add("image");
  const compatibleArtifacts = projectArtifacts.filter((artifact) => compatibleSourceKinds.has(artifact.kind === "music" ? "audio" : artifact.kind));
  const compatibleMedia = projectMedia.filter((asset) => compatibleSourceKinds.has(asset.kind));
  const sourceChoices = newestQuickSources(evolutionEnabled
    ? [
      ...(initialEvolutionArtifact && !projectArtifacts.some((artifact) => artifact.id === initialEvolutionArtifact.id) ? [sourceFromArtifact(initialEvolutionArtifact)] : []),
      ...projectArtifacts.map(sourceFromArtifact),
      ...projectMedia.map(sourceFromAsset),
    ]
    : videoOperation
      ? [...projectArtifacts.filter((artifact) => artifact.kind === "video").map(sourceFromArtifact), ...projectMedia.filter((asset) => asset.kind === "video").map(sourceFromAsset)]
      : intent === "train"
        ? projectMedia.map(sourceFromAsset)
        : intent === "music"
          ? projectMedia.filter((asset) => asset.kind === "image").map(sourceFromAsset)
          : [...compatibleArtifacts.map(sourceFromArtifact), ...compatibleMedia.map(sourceFromAsset)]);
  const quickSource = sourceChoices.find((source) => source.id === quickSourceId) ?? null;
  const compactSourceChoices = sourceChoices.slice(0, SOURCE_GALLERY_LIMIT);
  const visibleSourceChoices = sourceGalleryExpanded
    ? sourceChoices
    : quickSource && !compactSourceChoices.some((source) => source.id === quickSource.id)
      ? [quickSource, ...compactSourceChoices.slice(0, SOURCE_GALLERY_LIMIT - 1)]
      : compactSourceChoices;
  const songArtAnalysis = intent === "music" && quickSource?.source === "upload"
    ? [...projectDna]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .flatMap((artifact) => artifact.training?.analysis.sources ?? [])
      .find((source) => source.kind === "image" && (source.mediaId === quickSource.id || source.sourceId === quickSource.id) && source.detailedDescription)
    : null;
  const songArtDescription = songArtAnalysis?.detailedDescription
    ? creativeDnaDescriptionSummaries(songArtAnalysis.detailedDescription).shortSummary
    : null;
  const songPromptRecommendations = intent === "music"
    ? createSongPromptRecommendations({ artDescription: songArtDescription, dna: selected })
    : [];
  const generationIntent = intent === "train" ? "image" : intent;
  const projectTasteMemory = snapshot?.tasteMemory?.projects[activeProjectId];
  const personalTaste = snapshot?.tasteMemory?.personal;
  const intentWorkflows = workflows.filter((item) => workflowCreateIntent(item.modality) === generationIntent);
  const durationCompatibleWorkflows = generationIntent === "video"
    ? intentWorkflows.filter((item) => workflowSupportsVideoDuration(item, videoDurationSeconds))
    : intentWorkflows;
  const runtimeHistoryByWorkflowId = Object.fromEntries(intentWorkflows.map((item) => {
    const durations = (snapshot?.jobs ?? [])
      .filter((job) => job.status === "completed" && job.settingsStamp.workflow?.workflowId === item.id && job.startedAt && job.completedAt)
      .map((job) => new Date(job.completedAt!).getTime() - new Date(job.startedAt!).getTime())
      .filter((duration) => Number.isFinite(duration) && duration >= 0)
      .sort((left, right) => left - right);
    const middle = Math.floor(durations.length / 2);
    const median = !durations.length ? null : durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2;
    return [item.id, { count: durations.length, medianMs: median }];
  }));
  const runtimeMsByWorkflowId = Object.fromEntries(Object.entries(runtimeHistoryByWorkflowId).map(([id, history]) => [id, history.medianMs]));
  const requestedWorkflow = workflows.find((item) => item.id === workflowId && workflowCreateIntent(item.modality) === generationIntent) ?? null;
  const preferredWorkflow = preferredQuickWorkflow(durationCompatibleWorkflows, generationIntent, videoOperation ? "image" : quickSource?.kind ?? null, runtimeMsByWorkflowId);
  const workflow = requestedWorkflow && (generationIntent !== "video" || workflowSupportsVideoDuration(requestedWorkflow, videoDurationSeconds))
    ? requestedWorkflow
    : preferredWorkflow;
  const durationFallback = generationIntent === "video" && requestedWorkflow && workflow && requestedWorkflow.id !== workflow.id
    ? `${videoWorkflowDurationProfile(requestedWorkflow).label} supports up to ${videoDurationLabel(videoWorkflowDurationProfile(requestedWorkflow).maxSeconds)}; ${workflow.name} is selected for this length.`
    : null;
  const musicPromptProfile = generationIntent === "music" && workflow ? musicWorkflowPromptProfile(workflow) : null;
  const mediaParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind === "media") ?? [];
  const scalarParameters = workflow?.currentRevision.parameters.filter((parameter) => parameter.kind !== "media") ?? [];
  const durationParameters = generationIntent === "video" ? videoWorkflowDurationParameters(scalarParameters) : [];
  const durationParameterIds = new Set(durationParameters.map((parameter) => parameter.id));
  const bindingSource = videoOperation && quickSource ? { ...quickSource, kind: "image" as const } : quickSource;
  const effectiveInputBindings = quickInputBindings(mediaParameters, inputBindings, bindingSource);
  const effectiveVideoOperation = videoOperation && quickSource?.kind === "video"
    ? { ...videoOperation, sourceId: quickSource.id, source: quickSource.source } satisfies VideoGenerationOperation
    : null;
  const effectiveValues = workflow && valuesRevisionId === workflow.currentRevision.id ? workflowValues : {};
  const workflowPromptParameters = generationWorkflowPromptParameters(scalarParameters);
  const workflowPromptParameter = primaryWorkflowPromptParameter(scalarParameters, workflow?.modality);
  const workflowPromptParameterIds = new Set(workflowPromptParameters.map((parameter) => parameter.id));
  const workflowLyricsParameter = musicWorkflowLyricsParameter(scalarParameters, workflow?.modality);
  const baseParameterValue = (parameter: WorkflowParameter) => canonicalWorkflowParameterValue(parameter, durationParameterIds.has(parameter.id)
    ? videoDurationSeconds
    : parameter.id === workflowLyricsParameter?.id
      ? lyrics
      : workflowPromptParameterIds.has(parameter.id)
        ? direction.trim()
        : quickParameterValue(parameter, workflowPromptParameter?.id ?? null, direction, effectiveValues));
  const baseScalarParameters = scalarParameters.map((parameter) => ({ ...parameter, value: baseParameterValue(parameter) }));
  const generationControls = generationControlSet(baseScalarParameters);
  const graphicalParameterIds = new Set([
    ...durationParameterIds,
    ...generationControls.parameterIds,
    ...workflowPromptParameterIds,
    ...(workflowLyricsParameter ? [workflowLyricsParameter.id] : []),
  ]);
  const advancedScalarParameters = scalarParameters.filter((parameter) => !graphicalParameterIds.has(parameter.id));
  const workflowSeedParameter = generationControls.seed[0] ?? null;
  const canvasOverrides = generationCanvasOverrides(baseScalarParameters, canvasAspectRatio, canvasMegapixels);
  const rawParameterValue = (parameter: WorkflowParameter) => Object.prototype.hasOwnProperty.call(canvasOverrides, parameter.id)
    ? canvasOverrides[parameter.id]
    : baseParameterValue(parameter);
  const fastImageOverrides = generationIntent === "image" && imagePerformanceMode === "fast-default"
    ? fastImageParameterOverrides(scalarParameters.map((parameter) => ({ ...parameter, value: rawParameterValue(parameter) })))
    : {};
  const parameterValue = (parameter: WorkflowParameter) => Object.prototype.hasOwnProperty.call(fastImageOverrides, parameter.id)
    ? fastImageOverrides[parameter.id]
    : rawParameterValue(parameter);
  const settingsChanged = scalarParameters.some((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)));
  const advancedSettingsChanged = advancedScalarParameters.some((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)));
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
    videoDurationSeconds: generationIntent === "video" ? videoDurationSeconds : undefined,
  }) : null;
  const baselineWorkload = workflow ? analyzeGenerationWorkload({
    parameters: Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value])),
    models: workflow.currentRevision.models,
    inputAssetIds: [],
    inputArtifactIds: [],
    prompt: "",
  }) : null;
  const workflowHistory = workflow ? workflowRuntimeHistory(snapshot?.jobs ?? [], workflow.currentRevision.id) : null;
  const workflowWideHistory = workflow ? runtimeHistoryByWorkflowId[workflow.id] : null;
  const runtimeEvidence = workflowHistory?.count && workflowHistory.medianMs
    ? { count: workflowHistory.count, medianMs: workflowHistory.medianMs, exactRevision: true }
    : workflowWideHistory?.count && workflowWideHistory.medianMs
      ? { count: workflowWideHistory.count, medianMs: workflowWideHistory.medianMs, exactRevision: false }
      : null;
  const estimatedOutputCount = evolutionEnabled ? 3 : generationIntent === "video" ? 2 : 1;
  const runtimeEstimate = estimateGenerationRuntime(runtimeEvidence?.medianMs ?? null, workflowWorkload, baselineWorkload, estimatedOutputCount);
  const displayedScalarParameters = scalarParameters.map((parameter) => ({ ...parameter, value: parameterValue(parameter) }));
  const displayedAspectRatio = inferGenerationAspectRatio(displayedScalarParameters);
  const displayedMegapixels = workflowWorkload?.megapixels ?? null;
  const stepsParameter = generationControls.steps[0] ?? null;
  const fpsParameter = generationControls.fps[0] ?? null;
  const showAspectControls = generationControls.aspect.length > 0 || (generationControls.width.length > 0 && generationControls.height.length > 0);
  const showResolutionControls = generationControls.megapixels.length > 0 || (generationControls.width.length > 0 && generationControls.height.length > 0);
  const megapixelPresets = generationIntent === "video" ? VIDEO_MEGAPIXEL_PRESETS : IMAGE_MEGAPIXEL_PRESETS;
  const showGraphicalRenderControls = showAspectControls || showResolutionControls || Boolean(stepsParameter || fpsParameter || workflowSeedParameter);
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
    setCanvasAspectRatio(null);
    setCanvasMegapixels(null);
    setLyrics("");
    setNotice("");
  };

  const chooseGraphicalValue = (parameter: WorkflowParameter, value: WorkflowScalar) => {
    if (!workflow) return;
    const displayedValues = Object.fromEntries(scalarParameters.map((item) => [item.id, parameterValue(item)]));
    if (generationIntent === "image" && generationControls.steps.some((item) => item.id === parameter.id) && Number(value) > FAST_IMAGE_MAX_STEPS) {
      setImagePerformanceMode("explicit-custom");
    }
    setValuesRevisionId(workflow.currentRevision.id);
    setWorkflowValues({ ...displayedValues, [parameter.id]: canonicalWorkflowParameterValue(parameter, value) });
  };

  const chooseCanvasAspect = (aspect: GenerationAspectRatio) => {
    setCanvasAspectRatio(aspect);
    setLocalError("");
  };

  const chooseCanvasMegapixels = (megapixels: number) => {
    setCanvasMegapixels(megapixels);
    if (generationIntent === "image" && megapixels > 512 * 512 / 1_000_000) setImagePerformanceMode("explicit-custom");
    setLocalError("");
  };

  const chooseIntent = (nextIntent: CreateIntent) => {
    if (nextIntent !== intent && !evolutionEnabled) setDirection("");
    setIntent(nextIntent);
    setVideoOperation(null);
    setSourceGalleryExpanded(false);
    resetWorkflowOverrides();
  };

  const chooseWorkflow = (id: string) => {
    setWorkflowId(id);
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setImagePerformanceMode("fast-default");
    setCanvasAspectRatio(null);
    setCanvasMegapixels(null);
    setLyrics("");
    setNotice("");
  };

  const chooseVideoDuration = (seconds: VideoDurationSeconds) => {
    setVideoDurationSeconds(seconds);
    setLocalError("");
    if (!workflow || workflowSupportsVideoDuration(workflow, seconds)) {
      setNotice("");
      return;
    }
    const replacement = preferredQuickWorkflow(
      intentWorkflows.filter((item) => workflowSupportsVideoDuration(item, seconds)),
      "video",
      videoOperation ? "image" : quickSource?.kind ?? null,
      runtimeMsByWorkflowId,
    );
    setWorkflowId(replacement?.id ?? "");
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setCanvasAspectRatio(null);
    setCanvasMegapixels(null);
    const profile = videoWorkflowDurationProfile(workflow);
    setNotice(replacement
      ? `${profile.label} supports up to ${videoDurationLabel(profile.maxSeconds)}. ${replacement.name} selected for ${videoDurationLabel(seconds)}.`
      : `No ready video model exposes a supported ${videoDurationLabel(seconds)} duration control.`);
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
      if (intent === "music" && asset.kind !== "image") {
        setLocalError("Choose an image artwork to inspire the song prompt.");
        return;
      }
      if (videoOperation && asset.kind !== "video") {
        setLocalError("Choose a video to extend.");
        return;
      }
      setQuickSourceId(asset.id);
      setSourceGalleryExpanded(false);
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

  const queueWorkflow = async (openQueueAfter = false) => {
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
      if (evolutionEnabled && quickSource && workflowPromptParameter && projectTasteMemory && personalTaste) {
        const roles: EvolutionRole[] = ["refine", "correct", "discovery"];
        const videoVersions = generationIntent === "video"
          ? createVideoGenerationVersions({
            direction: direction.trim(),
            dimensions: dna.shared,
            pairId: `video_pair_${crypto.randomUUID()}`,
            discoverySeed: randomUint32(),
            hasSource: Boolean(quickSource),
          })
          : null;
        let branchWorkflow = runWorkflow;
        for (const role of roles) {
          const prompt = evolutionBranchPrompt({
            basePrompt: direction.trim(),
            role,
            canon: projectTasteMemory.canon,
            personalTaste,
            projectTaste: projectTasteMemory.taste,
            dimensions: dna.shared,
            modality: generationIntent,
          });
          const values: Record<string, WorkflowScalar> = Object.fromEntries(workflowPromptParameters.map((parameter) => [parameter.id, prompt]));
          const variant = generationIntent === "video"
            ? role === "discovery" ? videoVersions?.[1].variant : videoVersions?.[0].variant
            : undefined;
          if (workflowSeedParameter && variant?.seed !== null && variant?.seed !== undefined) values[workflowSeedParameter.id] = variant.seed;
          branchWorkflow = await saveWorkflowRevision(branchWorkflow.id, branchWorkflow.currentRevision.id, values);
          const evolution: EvolutionJobContext = {
            schemaVersion: "creative-studio-evolution-request/1.0",
            studyId: evolutionStudyId,
            role,
            sourceId: quickSource.id,
            source: quickSource.source,
          };
          await submitWorkflowJob(
            branchWorkflow,
            effectiveInputBindings,
            prompt,
            dna.artifactId,
            effectiveVideoOperation ?? undefined,
            generationIntent === "image" ? imagePerformanceMode : undefined,
            variant,
            evolution,
            generationIntent === "video" ? videoDurationSeconds : undefined,
          );
        }
        setValuesRevisionId(branchWorkflow.currentRevision.id);
        setWorkflowValues(Object.fromEntries(branchWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
        setNotice("Refine, Correct, and Discovery queued as one durable evolution study. Review the three retained branches together in Artifacts.");
        if (openQueueAfter) onQueued();
        return;
      }
      if (videoVersions && workflowPromptParameter) {
        const [aligned, discovery] = videoVersions;
        const discoveryValues: Record<string, WorkflowScalar> = Object.fromEntries(workflowPromptParameters.map((parameter) => [parameter.id, discovery.prompt]));
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
          direction.trim(),
          dna.artifactId,
          effectiveVideoOperation ?? undefined,
          undefined,
          aligned.variant,
          undefined,
          videoDurationSeconds,
        );
        await submitWorkflowJob(
          discoveryWorkflow,
          effectiveInputBindings,
          discovery.prompt,
          dna.artifactId,
          effectiveVideoOperation ?? undefined,
          undefined,
          discovery.variant,
          undefined,
          videoDurationSeconds,
        );
        setNotice("Aligned and Discovery queued as 2 durable video jobs. They will render one after the other on the Local Runner.");
        if (openQueueAfter) onQueued();
        return;
      }
      setValuesRevisionId(runWorkflow.currentRevision.id);
      setWorkflowValues(Object.fromEntries(runWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
      await submitWorkflowJob(
        runWorkflow,
        effectiveInputBindings,
        direction.trim(),
        dna.artifactId,
        effectiveVideoOperation ?? undefined,
        generationIntent === "image" ? imagePerformanceMode : undefined,
        undefined,
        undefined,
        generationIntent === "video" ? videoDurationSeconds : undefined,
      );
      setNotice(`${effectiveVideoOperation ? "Video extension" : runWorkflow.name} queued. You can keep creating while it runs.`);
      if (openQueueAfter) onQueued();
    } catch {
      // The provider exposes a normalized visible error.
    }
  };
  useEffect(() => {
    queueWorkflowRef.current = queueWorkflow;
  });

  useEffect(() => {
    if (!autoStartRequested.current || busy || !snapshot) return;
    const stopAutoStart = (message: string) => {
      autoStartRequested.current = false;
      void Promise.resolve().then(() => {
        setNotice("");
        setLocalError(message);
      });
    };
    if (uiOnlyDevelopment) {
      stopAutoStart("One-click Animate needs the real Creative Studio backend. The labeled development adapter cannot submit simulated video as a real result.");
      return;
    }
    if (!workflow) {
      stopAutoStart("No image-to-video model is ready. Connect a one-image video workflow in Models, then tap Animate again.");
      return;
    }
    if (!workflowReady) {
      stopAutoStart("The available video model needs more than one source. Connect a one-image image-to-video workflow for one-click Animate.");
      return;
    }
    if (!directionReady || !workflowPromptParameter) {
      stopAutoStart("The selected video model must expose a prompt input before one-click Animate can create two distinct versions.");
      return;
    }
    autoStartRequested.current = false;
    void queueWorkflowRef.current(true);
  }, [busy, directionReady, snapshot, uiOnlyDevelopment, workflow, workflowPromptParameter, workflowReady]);

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
  const generationLabel = generationIntent === "music" ? "song" : generationIntent;
  const basePrimaryLabel = !workflow
    ? "Choose a model"
    : !workflowReady
      ? `Choose ${sourceRequirement ?? "source"}`
      : evolutionEnabled
        ? `Generate 3 ${generationLabel} branches`
      : settingsChanged
        ? effectiveVideoOperation ? "Save & extend 2 versions" : generationIntent === "video" ? "Save & generate 2 videos" : `Save & generate ${generationLabel}`
        : effectiveVideoOperation
          ? "Extend into 2 versions"
          : generationIntent === "video" ? "Generate 2 videos" : `Generate ${generationLabel}`;
  const primaryLabel = generationIntent === "image" && workflow
    ? `${basePrimaryLabel}${imagePerformanceMode === "fast-default" ? " · fast" : imagePerformance?.requiresExplicitCustom ? " · can be slow" : " · custom"}`
    : generationIntent === "music" && workflow
      ? `${basePrimaryLabel} · model-tuned`
      : generationIntent === "video" && workflow
        ? `${basePrimaryLabel} · ${videoDurationLabel(videoDurationSeconds)} each`
      : basePrimaryLabel;
  const sourcePickerLabel = videoOperation ? "Video to extend" : intent === "music" ? "Artwork inspiration" : intent === "train" ? "Training source" : "Use retained work";
  const uploadSourceLabel = intent === "train" ? "Upload training media" : videoOperation ? "Upload video" : intent === "music" ? "Upload artwork" : "Upload new";

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

        {evolutionEnabled && initialEvolutionSource ? <section className="evolution-create-plan" aria-label="Evolution study">
          <header><span><Icon name="star" size={16} /><strong>Evolve {initialEvolutionSource.name}</strong></span><button type="button" className="link-btn" onClick={() => setEvolutionEnabled(false)}>Use as a normal source</button></header>
          <p>One request creates three retained branches with the same source, taste evidence, model settings, and study stamp. Project canon stays in lineage; song prompts use only music-specific evidence.</p>
          <div><span><b>Refine</b><small>strengthen what already works</small></span><span><b>Correct</b><small>resolve review feedback</small></span><span><b>Discovery</b><small>take a distinct new path</small></span></div>
          <footer><span>{projectTasteMemory?.taste.signalCount ?? 0} project signals</span><span>{personalTaste?.signalCount ?? 0} personal signals</span><span>{projectTasteMemory?.canon.identity ? "Canon attached" : "Add canon in Projects"}</span></footer>
        </section> : null}

        {generationIntent === "video" ? <div className="quick-video-duration" aria-label="Video length">
          <header><span><Icon name="video" size={16} /><strong>Length</strong></span><small>{evolutionEnabled ? "Each of 3 branches" : "Each of 2 versions"}</small></header>
          <div role="group" aria-label="Video duration">
            {VIDEO_DURATION_OPTIONS.map((seconds) => <button type="button" key={seconds} className={videoDurationSeconds === seconds ? "on" : ""} aria-pressed={videoDurationSeconds === seconds} disabled={busy} onClick={() => chooseVideoDuration(seconds)}>{videoDurationLabel(seconds)}</button>)}
          </div>
          <p>{durationFallback ?? (videoDurationSeconds >= 30
            ? `${videoDurationLabel(videoDurationSeconds)} is an LTX long render and can take substantially longer on local hardware.`
            : evolutionEnabled ? "Refine, Correct, and Discovery use the same selected length." : "Aligned follows your direction; Discovery uses 70% random DNA.")}</p>
        </div> : null}

        {intent !== "train" ? <div className="quick-model-picker">
          <div className="quick-model-head"><span>Model</span><button className="link-btn" onClick={onWorkflows}>Manage models</button></div>
          {intentWorkflows.length ? <div className="quick-models" role="group" aria-label={`${intent === "music" ? "Song" : intent} model`}>
            {intentWorkflows.map((item) => {
              const durationUnsupported = generationIntent === "video" && !workflowSupportsVideoDuration(item, videoDurationSeconds);
              const durationProfile = generationIntent === "video" ? videoWorkflowDurationProfile(item) : null;
              return <button key={item.id} className={workflow?.id === item.id ? "on" : ""} aria-pressed={workflow?.id === item.id} disabled={busy || durationUnsupported} title={durationUnsupported && durationProfile ? `${durationProfile.label} supports up to ${videoDurationLabel(durationProfile.maxSeconds)}` : undefined} onClick={() => chooseWorkflow(item.id)}><Icon name={item.modality === "music" || item.modality === "audio" ? "music" : item.modality === "video" ? "video" : "image"} size={17} /><span><strong>{item.name}</strong><small>{modelSummary(item)}{durationProfile ? ` · max ${videoDurationLabel(durationProfile.maxSeconds)}` : ""}</small></span></button>;
            })}
          </div> : <button className="quick-model-empty" onClick={onWorkflows}><Icon name="flows" size={16} /><span><strong>No {intent === "music" ? "song" : intent} model is ready</strong><small>Manage models</small></span><Icon name="chevron" size={14} /></button>}
          {musicPromptProfile ? <small className="quick-model-prompt-profile">Gemma formats this for {musicPromptProfile.targetModel}: {musicPromptProfile.outputFormat === "structured-caption" ? "Global Metadata + Vocal Details + section-by-section Arrangement" : "one concise natural-language audio prompt"}.</small> : null}
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

        {workflow ? <section className="quick-render-setup" aria-label="Canvas and render settings">
          <header>
            <span><Icon name="settings" size={15} /><strong>{showGraphicalRenderControls ? "Canvas & render" : "Render estimate"}</strong></span>
            <small>{workflowWorkload?.facts.slice(0, 3).join(" · ") || "Stamped with every result"}</small>
          </header>
          {showAspectControls ? <div className="quick-render-group quick-aspect-group">
            <span>Shape</span>
            <div role="group" aria-label="Canvas shape">
              {GENERATION_ASPECT_PRESETS.map((preset) => <button type="button" key={preset.id} className={displayedAspectRatio === preset.id ? "on" : ""} aria-label={`${preset.id} ${preset.label}`} aria-pressed={displayedAspectRatio === preset.id} disabled={busy} onClick={() => chooseCanvasAspect(preset.id)}><i style={{ aspectRatio: preset.id.replace(":", " / ") }} /><strong>{preset.id}</strong><small>{preset.label}</small></button>)}
            </div>
          </div> : null}
          {showResolutionControls ? <div className="quick-render-group quick-resolution-group">
            <span>Detail</span>
            <div role="group" aria-label="Render detail">
              {megapixelPresets.map((megapixels, index) => <button type="button" key={megapixels} className={displayedMegapixels !== null && Math.abs(displayedMegapixels - megapixels) < 0.035 ? "on" : ""} aria-pressed={displayedMegapixels !== null && Math.abs(displayedMegapixels - megapixels) < 0.035} disabled={busy} onClick={() => chooseCanvasMegapixels(megapixels)}><strong>{index === 0 ? "Quick" : index === 1 ? "Balanced" : "Detail"}</strong><small>{megapixels} MP</small></button>)}
            </div>
          </div> : null}
          {stepsParameter || fpsParameter || workflowSeedParameter ? <details className="quick-render-more">
            <summary><strong>Fine tune</strong><small>{[stepsParameter ? `${parameterValue(stepsParameter)} steps` : "", fpsParameter ? `${parameterValue(fpsParameter)} fps` : "", workflowSeedParameter ? "seed ready" : ""].filter(Boolean).join(" · ")}</small></summary>
            <div className="quick-render-tuning">
              {stepsParameter ? <div className="quick-render-group"><span>Steps</span><div role="group" aria-label="Sampling steps">{GENERATION_STEP_PRESETS.map((steps) => <button type="button" key={steps} className={Number(parameterValue(stepsParameter)) === steps ? "on" : ""} aria-pressed={Number(parameterValue(stepsParameter)) === steps} disabled={busy} onClick={() => chooseGraphicalValue(stepsParameter, steps)}>{steps}</button>)}</div></div> : null}
              {fpsParameter ? <div className="quick-render-group"><span>Motion</span><div role="group" aria-label="Frames per second">{GENERATION_FPS_PRESETS.map((fps) => <button type="button" key={fps} className={Number(parameterValue(fpsParameter)) === fps ? "on" : ""} aria-pressed={Number(parameterValue(fpsParameter)) === fps} disabled={busy} onClick={() => chooseGraphicalValue(fpsParameter, fps)}>{fps}<small>fps</small></button>)}</div></div> : null}
              {workflowSeedParameter ? <div className="quick-seed-control"><span>Variation</span><button type="button" disabled={busy} onClick={() => chooseGraphicalValue(workflowSeedParameter, randomUint32())}><Icon name="rerun" size={13} /><strong>New seed</strong><small>{String(parameterValue(workflowSeedParameter))}</small></button></div> : null}
            </div>
          </details> : null}
          <div className={`quick-render-estimate${runtimeEstimate ? " measured" : ""}`}>
            <Icon name="analytics" size={16} />
            {runtimeEstimate && runtimeEvidence ? <span><strong>About {durationRange(runtimeEstimate.perOutputLowMs, runtimeEstimate.perOutputHighMs)} {estimatedOutputCount > 1 ? "each" : "to render"}</strong><small>{estimatedOutputCount > 1 ? `${durationRange(runtimeEstimate.totalLowMs, runtimeEstimate.totalHighMs)} total for ${estimatedOutputCount} outputs · ` : ""}Based on {runtimeEvidence.count} completed {runtimeEvidence.exactRevision ? "revision" : "model"} {runtimeEvidence.count === 1 ? "run" : "runs"}. Cold model loads and queue time can add time.</small></span> : <span><strong>Estimate starts after the first completed run</strong><small>Creative Studio will learn this model’s local render time from retained job evidence.</small></span>}
          </div>
        </section> : null}

        <section className={`quick-source-gallery${sourceGalleryExpanded ? " expanded" : ""}`} aria-label={sourcePickerLabel}>
          <header><span><strong>{sourcePickerLabel}</strong><small>{quickSource ? quickSource.name : `${sourceChoices.length} compatible retained`}</small></span>{sourceChoices.length > SOURCE_GALLERY_LIMIT ? <button type="button" className="link-btn" disabled={busy} onClick={() => setSourceGalleryExpanded((current) => !current)}>{sourceGalleryExpanded ? "Show newest" : `View all ${sourceChoices.length}`}</button> : null}</header>
          <div className="quick-source-gallery-grid" role="group" aria-label={`${sourcePickerLabel} gallery`}>
            <label className={`quick-source-card quick-source-upload${uiOnlyDevelopment ? " disabled" : ""}`}>
              <input ref={mediaInputRef} type="file" aria-label={uploadSourceLabel} accept={videoOperation ? "video/mp4,video/webm,video/quicktime" : intent === "music" ? ACCEPTED_ART : ACCEPTED_MEDIA} disabled={busy || uiOnlyDevelopment} onChange={(event) => void uploadAndUseMedia(event.target.files?.[0] ?? null)} />
              <span className="quick-source-visual"><Icon name="plus" size={22} /></span>
              <span className="quick-source-copy"><strong>{busy ? "Working…" : uploadSourceLabel}</strong><small>{uiOnlyDevelopment ? "Worker required" : "From this device"}</small></span>
            </label>
            {intent !== "train" ? <button type="button" className={`quick-source-card quick-source-none${quickSource ? "" : " on"}`} aria-label="Use no retained source" aria-pressed={!quickSource} disabled={busy} onClick={() => { setQuickSourceId(""); setInputBindings({}); setSourceGalleryExpanded(false); }}>
              <span className="quick-source-visual"><Icon name="generate" size={22} /></span>
              <span className="quick-source-copy"><strong>No source</strong><small>Start from prompt</small></span>
              {!quickSource ? <span className="quick-source-selected"><Icon name="check" size={11} /></span> : null}
            </button> : null}
            {visibleSourceChoices.map((source) => <button type="button" key={source.id} className={`quick-source-card${quickSource?.id === source.id ? " on" : ""}`} aria-label={`Use ${source.name} ${source.source === "upload" ? "upload" : "generated work"}`} aria-pressed={quickSource?.id === source.id} disabled={busy} onClick={() => { setQuickSourceId(source.id); setInputBindings({}); setSourceGalleryExpanded(false); }}>
              <span className={`quick-source-visual ${source.kind}`} style={{ background: `linear-gradient(135deg, ${source.colors[0]}, ${source.colors[1]})` }}><QuickSourceVisual source={source} /><span className="quick-source-kind"><Icon name={source.kind === "audio" ? "music" : source.kind} size={11} /></span></span>
              <span className="quick-source-copy"><strong>{source.name}</strong><small>{source.source === "upload" ? "Upload" : "Generated"} · {source.kind}</small></span>
              {quickSource?.id === source.id ? <span className="quick-source-selected"><Icon name="check" size={11} /></span> : null}
            </button>)}
          </div>
        </section>

        {intent === "music" && songPromptRecommendations.length ? <section className="quick-song-prompts" aria-label="Recommended song prompts">
          <header><span><Icon name="star" size={15} /><strong>Prompt ideas</strong></span><small>{songArtDescription ? "Uploaded art + CreativeDNA" : "CreativeDNA"}</small></header>
          <div>{songPromptRecommendations.map((recommendation) => <button type="button" key={recommendation.id} disabled={busy} aria-label={`Use ${recommendation.label} song prompt`} onClick={() => { setDirection(recommendation.prompt); setNotice(`${recommendation.label} prompt is ready to edit.`); }}><span><strong>{recommendation.label}</strong><small>{recommendation.focus}</small></span><p>{recommendation.prompt}</p><em>Use</em></button>)}</div>
        </section> : null}

        {intent === "music" && quickSource?.source === "upload" && !songArtDescription ? <div className="quick-song-analysis">
          <span><strong>Analyze this art to include what is actually in it</strong><small>Until then, recommendations use CreativeDNA only.</small></span>
          <button type="button" className="btn btn-ghost" onClick={() => quickSource.trainingEligible ? onTrain([quickSource.id]) : onMedia()}>{quickSource.trainingEligible ? "Analyze art" : "Review consent"}</button>
        </div> : null}

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
          {intent === "music" && workflowLyricsParameter ? <details className="quick-song-lyrics"><summary><span><Icon name="music" size={14} /><strong>Lyrics</strong></span><small>{lyrics.trim() ? "Included" : "Optional · instrumental when empty"}</small></summary><textarea aria-label="Song lyrics" value={lyrics} maxLength={8_000} onChange={(event) => setLyrics(event.target.value)} placeholder="Add section labels and lyrics, or leave empty for an instrumental…" /></details> : null}
          <button className="btn btn-primary quick-primary" disabled={busy || uiOnlyDevelopment || !workflow || !directionReady || !workflowReady || fastImageBlocked || (generationIntent === "video" && !workflowPromptParameter)} onClick={() => void queueWorkflow()}><Icon name="send" size={17} /> {primaryLabel}</button>
          {!workflow && developmentPreviewAvailable && generationIntent !== "video" ? <button className="btn btn-ghost quick-development" disabled={busy || !directionReady} onClick={() => void submitDevelopmentPreview()}>Create explicitly simulated development preview</button> : null}
        </>}
      </section>

      {intent !== "train" ? <details className="quick-create-advanced glass">
        <summary><span><Icon name="settings" size={15} /><strong>Advanced</strong></span><small>DNA, less-used settings, and remote route</small></summary>
        <div className="quick-advanced-body">
          <section className="quick-advanced-section quick-advanced-wide">
            <header><strong>CreativeDNA</strong><button className="link-btn" onClick={onDesign}>Edit DNA</button></header>
            {availableDna.length ? <select aria-label="CreativeDNA direction" value={selected?.artifactId ?? ""} disabled={busy} onChange={(event) => {
              const dna = availableDna.find((artifact) => artifact.artifactId === event.target.value) ?? null;
              selectDna(dna);
              if (dna) setDirection(creativeDnaGenerationPrompt(dna, generationIntent === "music" ? "music" : dna.targetModality));
            }}>{availableDna.map((artifact) => <option key={artifact.artifactId} value={artifact.artifactId}>{artifact.name} · v{artifact.version}</option>)}</select> : <button className="btn btn-ghost" onClick={onDesign}>Build detailed CreativeDNA</button>}
            <label className="create-consent"><input type="checkbox" checked={trainingEligible} disabled={busy || uiOnlyDevelopment} onChange={(event) => setTrainingEligible(event.target.checked)} /> New uploads can be used for training</label>
          </section>

          {mediaParameters.length > 1 || missingMediaParameters.length ? <section className="quick-advanced-section quick-advanced-wide"><header><strong>Workflow inputs</strong><small>{missingMediaParameters.length ? `${missingMediaParameters.length} required` : "Connected"}</small></header><div className="quick-binding-grid">{mediaParameters.map((parameter) => {
            const uploadChoices = projectMedia.filter((asset) => !parameter.mediaKind || asset.kind === parameter.mediaKind).map((asset) => ({ id: asset.id, label: `${asset.name} · upload` }));
            const artifactChoices = projectArtifacts.filter((artifact) => !parameter.mediaKind || (artifact.kind === "music" ? "audio" : artifact.kind) === parameter.mediaKind).map((artifact) => ({ id: artifact.id, label: `${artifact.name} · generated` }));
            return <label className="field" key={parameter.id}><span>{parameter.label}</span><select value={effectiveInputBindings[parameter.id] ?? ""} onChange={(event) => setInputBindings((current) => ({ ...current, [parameter.id]: event.target.value }))}><option value="">Choose {parameter.mediaKind ?? "media"}</option>{[...artifactChoices, ...uploadChoices].map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>;
          })}</div></section> : null}

          {advancedScalarParameters.length ? <section className="quick-advanced-section quick-advanced-wide"><header><strong>Exact settings</strong><small>{settingsChanged ? `Will save workflow v${(workflow?.currentRevision.version ?? 0) + 1}` : `Workflow v${workflow?.currentRevision.version}`}</small></header><div className="workflow-run-parameters">{advancedScalarParameters.map((parameter) => <WorkflowParameterField key={parameter.id} parameter={parameter} value={parameterValue(parameter)} showBinding={false} onChange={(value) => {
            if (!workflow) return;
            if (parameter.id === workflowPromptParameter?.id) {
              setDirection(String(value));
              return;
            }
            if (parameter.id === workflowLyricsParameter?.id) {
              setLyrics(String(value));
              return;
            }
            const displayedValues = Object.fromEntries(scalarParameters.map((item) => [item.id, parameterValue(item)]));
            setImagePerformanceMode("explicit-custom");
            setValuesRevisionId(workflow.currentRevision.id);
            setWorkflowValues({ ...displayedValues, [parameter.id]: value });
          }} />)}</div>{advancedSettingsChanged ? <button type="button" className="btn btn-ghost workflow-run-reset" disabled={busy} onClick={() => { if (!workflow) return; setImagePerformanceMode("fast-default"); setCanvasAspectRatio(null); setCanvasMegapixels(null); setLyrics(""); setValuesRevisionId(workflow.currentRevision.id); setWorkflowValues(Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={14} /> Return to workflow defaults</button> : null}</section> : null}

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
