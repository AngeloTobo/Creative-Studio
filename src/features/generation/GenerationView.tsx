import { useEffect, useMemo, useRef, useState } from "react";
import { creativeDnaCanGenerate, useStudio, type SubmitWorkflowJobInput } from "../../app/StudioProvider";
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
  assessVideoPerformance,
  canonicalGenerationPerformanceParameters,
  analyzeGenerationWorkload,
  compileVideoPromptWithSpeech,
  createFourWayVideoGenerationVersions,
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
  assessTrustedVideoPresetExecution,
  assessTrustedVideoPresetSupport,
  THIRTY_SECOND_VIDEO_STRATEGY_SIMULATION,
  TRUSTED_LTX_25_I2V_PORTRAIT_30S,
  trustedVideoPresetById,
  trustedVideoPresetParameterOverrides,
  generationWorkflowPromptParameters,
  compileContinuityDirective,
  GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION,
  musicWorkflowLyricsParameter,
  musicWorkflowPromptProfile,
  primaryWorkflowPromptParameter,
  VIDEO_DURATION_OPTIONS,
  videoDurationLabel,
  videoWorkflowDurationParameters,
  videoWorkflowDurationProfile,
  workflowSupportsVideoDuration,
  workflowRuntimeHistory,
  VIDEO_PROMPT_ENHANCED_MAX_LENGTH,
  VIDEO_SPEECH_TEXT_MAX_LENGTH,
  storyRecommendationSelection,
  videoScriptWordRange,
  videoWorkflowPromptProfile,
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
  type GenerationRecipe,
  type GenerationContinuitySelection,
  type GenerationPromptReferenceSelection,
  type VideoSpeechMode,
  type VideoSpeechStamp,
  type VideoScriptUse,
  type TrustedVideoPresetId,
  type StoryRecommendationSelection,
} from "../../../shared/contracts";
import { WorkflowParameterField } from "../workflows/WorkflowParameterField";
import { sameWorkflowValue } from "../workflows/workflowValues";
import { useCreativeSessions, type CreativeSession } from "../sessions";
import { compileProjectContext } from "./projectContext";
import {
  failedQuickWorkflowRecipeSignatures,
  preferredQuickWorkflow,
  quickAnimationDirection,
  quickGenerationSourceUsage,
  quickInputBindings,
  quickParameterValue,
  quickWorkflowRecipeSignature,
  workflowCreateIntent,
  type CreateIntent,
  type QuickSourceKind,
} from "./quickCreate";
import {
  GENERATION_GOALS,
  GENERATION_OUTPUT_COUNTS,
  generationBatchAttempt,
  generationBatchIdempotencyKey,
  generationBatchSeed,
  generationGoalCanScout,
  generationGoalOutputCount,
  generationGoalRunLabel,
  type GenerationGoal,
  type GenerationOutputCount,
} from "./generationGoals";
import {
  ONE_CLICK_VIDEO_DURATION_SECONDS,
  ONE_CLICK_VIDEO_MEGAPIXELS,
  oneClickVideoSettings,
  videoPerformanceModeForArmedConsent,
  videoRenderConsentSignature,
  videoRenderFrameCount,
  type VideoCreateEntryMode,
} from "./createEntry";
import { VideoScriptBuilderSheet } from "./VideoScriptBuilderSheet";
import { CreateResultRail } from "./CreateResultRail";
import { resolveCompletedVideoScriptEditor, restoredVideoScriptEditorIsDirty } from "./videoScriptEditorState";
import { videoScriptErrorMessage } from "./videoScriptErrorMessage";
import { directVideoEnhancementDecision, videoPairIdForOutputBatch } from "./directVideo";
import { RecommendedDirectionsRail, type StoryRecommendationHandoff } from "../stories/StoryBankRail";
import "./GenerationView.css";

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

function videoScriptSeedPhrases(value: string) {
  return value
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/[\n,;]+/)
    .map((phrase) => phrase.replace(/^[*•\s-]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((phrase, index, phrases) => phrases.indexOf(phrase) === index)
    .slice(0, 20);
}

function durationRange(lowMs: number, highMs: number) {
  const low = formatGenerationDuration(lowMs);
  const high = formatGenerationDuration(highMs);
  return low === high ? low : `${low}–${high}`;
}

function creativeSessionHasHiddenControls(session: CreativeSession | null) {
  if (!session) return false;
  const settings = session.graphicalSettings;
  const hasExactWorkflowState = Object.keys(settings).some((key) => key.startsWith("value:") || key.startsWith("binding:"));
  const hasExplicitMusicModel = session.mediaKind === "music"
    && settings.workflowSelectionMode === "explicit"
    && Boolean(session.workflowId);
  return session.intentTier !== "explore"
    || settings.projectContextEnabled === true
    || settings.worldContinuityEnabled === true
    || settings.imagePerformanceMode === "explicit-custom"
    || (typeof settings.lyrics === "string" && settings.lyrics.trim().length > 0)
    || settings.videoSpeechMode === "short-natural-line"
    || settings.videoSpeechMode === "exact-script"
    || Boolean(trustedVideoPresetById(settings.trustedVideoPresetId))
    || settings.videoOperationKind === "extend"
    || hasExactWorkflowState
    || hasExplicitMusicModel;
}

export function GenerationView({
  onQueued,
  onMedia,
  onArtifacts,
  onWorkflows,
  onDesign,
  onTrain,
  initialVideoExtensionArtifactId,
  initialEvolutionSourceId,
  initialSourceId,
  initialCreateIntent,
  initialAutoStart = false,
  initialVideoCreateMode = "standard",
  initialStoryRecommendation,
  embedded = false,
}: {
  onQueued: () => void;
  onMedia: () => void;
  onArtifacts: () => void;
  onWorkflows: () => void;
  onDesign: () => void;
  onTrain: (assetIds?: string[], path?: "analyze" | "model") => void;
  initialVideoExtensionArtifactId?: string;
  initialEvolutionSourceId?: string;
  initialSourceId?: string;
  initialCreateIntent?: CreateIntent;
  initialAutoStart?: boolean;
  initialVideoCreateMode?: VideoCreateEntryMode;
  initialStoryRecommendation?: StoryRecommendationHandoff;
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
    submitWorkflowBatch,
    saveWorkflowRevision,
    createGenerationRecipe,
    enhanceVideoPrompt,
    getVideoPromptEnhancement,
    createVideoScriptDraft,
    getVideoScriptDraft,
    updateVideoScriptDraft,
    busy,
    error,
  } = useStudio();
  const { latest: latestSession, save: saveSession, clear: clearSession } = useCreativeSessions(activeProjectId);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const sourcePickerRef = useRef<HTMLDetailsElement>(null);
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const availableDna = snapshot ? projectDna.filter((artifact) => creativeDnaCanGenerate(snapshot, artifact)) : [];
  const selected = snapshot && activeDna && creativeDnaCanGenerate(snapshot, activeDna) ? activeDna : availableDna[0] ?? null;
  const projectMedia = useMemo(() => snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.mediaAssets]);
  const allProjectArtifacts = useMemo(() => snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.artifacts]);
  const projectArtifacts = useMemo(() => allProjectArtifacts.filter((artifact) => artifact.retention.state === "retained"), [allProjectArtifacts]);
  const recentCreateArtifacts = useMemo(() => [...projectArtifacts]
    .filter((artifact) => artifact.status !== "archived")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 8), [projectArtifacts]);
  const workflows = useMemo(
    () => snapshot?.workflows.filter((item) => item.executionState === "ready" && item.modality !== "3d") ?? [],
    [snapshot?.workflows],
  );
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
  const autoFourWay = autoAnimate && initialVideoCreateMode === "four-way";
  const initialVideoSettings = initialIntent === "video" ? oneClickVideoSettings(initialVideoCreateMode) : null;
  const initialRecommendedWorkflow = initialStoryRecommendation?.recommendation.workflowId
    ? workflows.find((item) => item.id === initialStoryRecommendation.recommendation.workflowId) ?? null
    : null;
  const initialRecommendedDuration = initialStoryRecommendation?.recommendation.modality === "video"
    && typeof initialStoryRecommendation.recommendation.durationSeconds === "number"
    && VIDEO_DURATION_OPTIONS.includes(initialStoryRecommendation.recommendation.durationSeconds as VideoDurationSeconds)
    ? initialStoryRecommendation.recommendation.durationSeconds as VideoDurationSeconds
    : null;
  const hasInitialIncomingAction = Boolean(
    initialVideoExtensionArtifactId
    || initialEvolutionSourceId
    || initialSourceId
    || initialCreateIntent
    || initialAutoStart
    || initialStoryRecommendation,
  );
  const initialDirection = initialStoryRecommendation?.recommendation.prompt ?? (autoAnimate
    ? quickAnimationDirection(initialDirectArtifact?.prompt ?? initialDirectDescription)
    : initialEvolutionArtifact?.prompt ?? selected?.source.directive ?? "");
  const autoStartRequested = useRef(autoAnimate);
  const autoEnhancementAttempted = useRef(false);
  const armedVideoRenderSignature = useRef("");
  const queueWorkflowRef = useRef<(openQueueAfter?: boolean) => Promise<void>>(async () => undefined);
  const requestVideoPromptEnhancementRef = useRef<() => Promise<void>>(async () => undefined);
  const directionInitialized = useRef(Boolean(initialStoryRecommendation || initialVideoSource || initialEvolutionSource || initialDirectSource));
  const directionProjectId = useRef<string | null>(activeProjectId);
  const [intent, setIntent] = useState<CreateIntent>(initialIntent);
  const [direction, setDirection] = useState(initialDirection);
  const [selectedStoryRecommendation, setSelectedStoryRecommendation] = useState<StoryRecommendationSelection | undefined>(() => initialStoryRecommendation && initialRecommendedWorkflow
    ? storyRecommendationSelection(initialStoryRecommendation.story, initialStoryRecommendation.recommendation)
    : undefined);
  const [promptEnhancementId, setPromptEnhancementId] = useState("");
  const [originalVideoDirection, setOriginalVideoDirection] = useState<string | null>(null);
  const [appliedPromptEnhancementId, setAppliedPromptEnhancementId] = useState("");
  const handledPromptEnhancementId = useRef("");
  const handledVideoScriptDraftId = useRef("");
  const [lyrics, setLyrics] = useState("");
  const [videoSpeechMode, setVideoSpeechMode] = useState<VideoSpeechMode>("no-speech");
  const [videoSpeechText, setVideoSpeechText] = useState("");
  const [videoScriptBuilderOpen, setVideoScriptBuilderOpen] = useState(false);
  const [videoScriptSeedIdeas, setVideoScriptSeedIdeas] = useState("");
  const [videoScriptProposal, setVideoScriptProposal] = useState("");
  const [videoScriptProposalSpokenText, setVideoScriptProposalSpokenText] = useState("");
  const [videoScriptProposalDirty, setVideoScriptProposalDirty] = useState(false);
  const [videoScriptDraftId, setVideoScriptDraftId] = useState("");
  const [appliedVideoScriptDraftId, setAppliedVideoScriptDraftId] = useState("");
  const [appliedVideoScriptRevision, setAppliedVideoScriptRevision] = useState<number | null>(null);
  const [videoScriptError, setVideoScriptError] = useState("");
  const [quickSourceId, setQuickSourceId] = useState(initialVideoSource?.id ?? initialEvolutionSource?.id ?? initialDirectSource?.id ?? "");
  const [evolutionEnabled, setEvolutionEnabled] = useState(Boolean(initialEvolutionSource));
  const [generationGoal, setGenerationGoal] = useState<GenerationGoal>(initialEvolutionSource?.kind === "image" ? "scout" : "explore");
  const [evolutionStudyId, setEvolutionStudyId] = useState(() => `evolve_${crypto.randomUUID()}`);
  const [videoPairId, setVideoPairId] = useState(() => `video_pair_${crypto.randomUUID()}`);
  const [outputBatchId, setOutputBatchId] = useState(() => `output_batch_${crypto.randomUUID()}`);
  const [workflowId, setWorkflowId] = useState(initialRecommendedWorkflow?.id ?? "");
  const [workflowRestoreBlocked, setWorkflowRestoreBlocked] = useState("");
  const [inputBindings, setInputBindings] = useState<Record<string, string>>({});
  const [workflowValues, setWorkflowValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const [imagePerformanceMode, setImagePerformanceMode] = useState<ImagePerformanceMode>("fast-default");
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<VideoDurationSeconds>(initialRecommendedDuration ?? initialVideoSettings?.durationSeconds ?? 5);
  const [outputCount, setOutputCount] = useState<GenerationOutputCount>(initialVideoSettings?.outputCount ?? (autoFourWay ? 4 : initialIntent === "video" ? 2 : 1));
  const [canvasAspectRatio, setCanvasAspectRatio] = useState<GenerationAspectRatio | null>(initialStoryRecommendation?.recommendation.aspectRatio ?? null);
  const [canvasMegapixels, setCanvasMegapixels] = useState<number | null>(initialVideoSettings?.megapixels ?? null);
  const [selectedTrustedVideoPresetId, setSelectedTrustedVideoPresetId] = useState<TrustedVideoPresetId | null>(null);
  const [heavyRenderConfirmationOpen, setHeavyRenderConfirmationOpen] = useState(false);
  const [sourceGalleryExpanded, setSourceGalleryExpanded] = useState(false);
  const [creativeToolsOpen, setCreativeToolsOpen] = useState(() => !hasInitialIncomingAction && creativeSessionHasHiddenControls(latestSession));
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [projectContextEnabled, setProjectContextEnabled] = useState(false);
  const [worldContinuityEnabled, setWorldContinuityEnabled] = useState(false);
  const [selectedWorldId, setSelectedWorldId] = useState("");
  const [selectedWorldEntityIds, setSelectedWorldEntityIds] = useState<string[]>([]);
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState(initialStoryRecommendation
    ? `${initialStoryRecommendation.recommendation.title} is ready${initialRecommendedWorkflow ? " exactly as recommended" : ", but its original model revision is no longer ready"}${initialDirectSource ? ` with ${initialDirectSource.name}` : initialStoryRecommendation.recommendation.sourceId ? "; its original source is no longer retained" : ""}.`
    : autoFourWay
    ? `Preparing Exact, Enhanced, Left Field, and Awe versions from ${initialDirectSource?.name ?? "this image"}…`
    : autoAnimate ? `Preparing ${initialDirectSource?.name ?? "image"} for animation…` : initialVideoSource ? `${initialVideoSource.name} is ready to extend from its final frame.` : initialEvolutionSource ? `${initialEvolutionSource.name} is ready to evolve as a grouped study.` : initialDirectSource ? `${initialDirectSource.name} is selected; model compatibility is checked below.` : "");
  const [videoOperation, setVideoOperation] = useState<VideoGenerationOperation | null>(initialVideoSource ? {
    kind: "extend",
    sourceId: initialVideoSource.id,
    source: "artifact",
    sourceFrame: "last",
    outputMode: "combined",
    transitionSeconds: 0.5,
    audioMode: "keep-source",
  } : null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionProjectRef = useRef("");
  const sessionReadyRef = useRef(false);
  const sessionSaveTimerRef = useRef(0);
  const sessionSubmittingRef = useRef(false);
  const sessionPersistRef = useRef<() => void>(() => undefined);
  const outgoingSessionProjectRef = useRef(activeProjectId);
  const sessionCompletionBaselineRef = useRef(0);
  const [sessionCompletionVersion, setSessionCompletionVersion] = useState(0);
  const lastSavedSessionSignature = useRef("");
  const lastSubmittedSessionSignature = useRef("");
  const evolutionBatchAttemptRef = useRef({ id: evolutionStudyId, signature: "" });
  const videoBatchAttemptRef = useRef({ id: videoPairId, signature: "" });
  const outputBatchAttemptRef = useRef({ id: outputBatchId, signature: "" });
  const trustedVideoRestoreRef = useRef<{
    requestedWorkflowId: string;
    resolvedWorkflowId: string;
    workflowRevisionId: string;
    workflowValues: Record<string, WorkflowScalar>;
    inputBindings: Record<string, string>;
    durationSeconds: VideoDurationSeconds;
    outputCount: GenerationOutputCount;
    aspectRatio: GenerationAspectRatio | null;
    megapixels: number | null;
  } | null>(null);

  useEffect(() => {
    const previousProjectId = outgoingSessionProjectRef.current;
    if (previousProjectId && previousProjectId !== activeProjectId) sessionPersistRef.current();
    outgoingSessionProjectRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (directionProjectId.current !== activeProjectId) {
      directionProjectId.current = activeProjectId;
      directionInitialized.current = false;
      setDirection("");
      setSelectedStoryRecommendation(undefined);
      setPromptEnhancementId("");
      setOriginalVideoDirection(null);
      setAppliedPromptEnhancementId("");
      handledPromptEnhancementId.current = "";
      setLyrics("");
      setVideoSpeechMode("no-speech");
      setVideoSpeechText("");
      setVideoScriptBuilderOpen(false);
      setVideoScriptSeedIdeas("");
      setVideoScriptProposal("");
      setVideoScriptProposalSpokenText("");
      setVideoScriptProposalDirty(false);
      setVideoScriptDraftId("");
      setAppliedVideoScriptDraftId("");
      setAppliedVideoScriptRevision(null);
      setVideoScriptError("");
      handledVideoScriptDraftId.current = "";
      setIntent("image");
      setQuickSourceId("");
      setWorkflowId("");
      setWorkflowRestoreBlocked("");
      setInputBindings({});
      setWorkflowValues({});
      setValuesRevisionId("");
      setImagePerformanceMode("fast-default");
      setVideoDurationSeconds(5);
      setOutputCount(1);
      setCanvasAspectRatio(null);
      setCanvasMegapixels(null);
      setSelectedTrustedVideoPresetId(null);
      trustedVideoRestoreRef.current = null;
      setSourceGalleryExpanded(false);
      setNotice("");
      setVideoOperation(null);
      setEvolutionEnabled(false);
      setGenerationGoal("explore");
      const nextEvolutionStudyId = `evolve_${crypto.randomUUID()}`;
      const nextVideoPairId = `video_pair_${crypto.randomUUID()}`;
      const nextOutputBatchId = `output_batch_${crypto.randomUUID()}`;
      evolutionBatchAttemptRef.current = { id: nextEvolutionStudyId, signature: "" };
      videoBatchAttemptRef.current = { id: nextVideoPairId, signature: "" };
      outputBatchAttemptRef.current = { id: nextOutputBatchId, signature: "" };
      setEvolutionStudyId(nextEvolutionStudyId);
      setVideoPairId(nextVideoPairId);
      setOutputBatchId(nextOutputBatchId);
      setProjectContextEnabled(false);
      setWorldContinuityEnabled(false);
      setSelectedWorldId("");
      setSelectedWorldEntityIds([]);
    }
    if (!selected || directionInitialized.current) return;
    directionInitialized.current = true;
    setDirection(selected.source.directive || creativeDnaGenerationPrompt(selected, selected.targetModality));
    setIntent(selected.targetModality);
  }, [activeProjectId, selected]);

  useEffect(() => {
    if (!activeProjectId || sessionProjectRef.current === activeProjectId) return;
    sessionProjectRef.current = activeProjectId;
    sessionReadyRef.current = false;
    lastSavedSessionSignature.current = "";
    lastSubmittedSessionSignature.current = "";
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const hasIncomingAction = Boolean(
        initialVideoExtensionArtifactId
        || initialEvolutionSourceId
        || initialSourceId
        || initialCreateIntent
        || initialAutoStart
        || initialStoryRecommendation,
      );
      if (!hasIncomingAction && latestSession) {
        const settings = latestSession.graphicalSettings;
        const restoredSelectionMode = settings.workflowSelectionMode === "automatic" || !latestSession.workflowId
          ? "automatic"
          : "explicit";
        const restoredWorkflowId = restoredSelectionMode === "explicit"
          ? latestSession.workflowId
          : typeof settings.automaticWorkflowId === "string" ? settings.automaticWorkflowId : null;
        const restoredWorkflow = restoredWorkflowId
          ? workflows.find((item) => item.id === restoredWorkflowId) ?? null
          : null;
        const savedRevisionId = typeof settings.workflowRevisionId === "string" ? settings.workflowRevisionId : "";
        const restoredValues: Record<string, WorkflowScalar> = {};
        const restoredBindings: Record<string, string> = {};
        for (const [key, value] of Object.entries(settings)) {
          if (key.startsWith("value:") && value !== null) restoredValues[key.slice(6)] = value;
          if (key.startsWith("binding:") && typeof value === "string") restoredBindings[key.slice(8)] = value;
        }
        const restoredAspect = typeof settings.canvasAspectRatio === "string"
          && GENERATION_ASPECT_PRESETS.some((preset) => preset.id === settings.canvasAspectRatio)
          ? settings.canvasAspectRatio as GenerationAspectRatio
          : null;
        const restoredHasHiddenControls = creativeSessionHasHiddenControls(latestSession);
        setSessionId(latestSession.id);
        lastSavedSessionSignature.current = "restored-session";
        setIntent(latestSession.mediaKind);
        setDirection(latestSession.direction);
        setPromptEnhancementId(typeof settings.promptEnhancementId === "string" ? settings.promptEnhancementId : "");
        setOriginalVideoDirection(typeof settings.originalVideoDirection === "string" ? settings.originalVideoDirection : null);
        setAppliedPromptEnhancementId(typeof settings.appliedPromptEnhancementId === "string" ? settings.appliedPromptEnhancementId : "");
        setQuickSourceId(latestSession.retainedArtifactId ?? latestSession.sourceAssetIds[0] ?? "");
        setWorkflowId(restoredSelectionMode === "explicit" ? latestSession.workflowId ?? "" : "");
        setWorkflowRestoreBlocked(restoredSelectionMode === "explicit" && latestSession.workflowId && !restoredWorkflow ? latestSession.workflowId : "");
        setInputBindings(restoredBindings);
        setWorkflowValues(restoredValues);
        setValuesRevisionId(restoredWorkflow?.currentRevision.id ?? "");
        setLyrics(typeof settings.lyrics === "string" ? settings.lyrics : "");
        setVideoSpeechMode(settings.videoSpeechMode === "short-natural-line" || settings.videoSpeechMode === "exact-script"
          ? settings.videoSpeechMode
          : "no-speech");
        setVideoSpeechText(typeof settings.videoSpeechText === "string" ? settings.videoSpeechText : "");
        const restoredVideoScriptDraftId = typeof settings.videoScriptDraftId === "string" ? settings.videoScriptDraftId : "";
        const restoredVideoScriptProposal = typeof settings.videoScriptProposal === "string" ? settings.videoScriptProposal : "";
        setVideoScriptSeedIdeas(typeof settings.videoScriptSeedIdeas === "string" ? settings.videoScriptSeedIdeas : "");
        setVideoScriptProposal(restoredVideoScriptProposal);
        setVideoScriptProposalSpokenText(typeof settings.videoScriptProposalSpokenText === "string" ? settings.videoScriptProposalSpokenText : "");
        setVideoScriptProposalDirty(restoredVideoScriptEditorIsDirty(
          settings.videoScriptProposalDirty,
          restoredVideoScriptDraftId,
          restoredVideoScriptProposal,
        ));
        setVideoScriptDraftId(restoredVideoScriptDraftId);
        setAppliedVideoScriptDraftId(typeof settings.appliedVideoScriptDraftId === "string" ? settings.appliedVideoScriptDraftId : "");
        setAppliedVideoScriptRevision(typeof settings.appliedVideoScriptRevision === "number" && Number.isInteger(settings.appliedVideoScriptRevision)
          ? settings.appliedVideoScriptRevision : null);
        setGenerationGoal(latestSession.intentTier);
        setEvolutionEnabled(latestSession.intentTier === "scout");
        setProjectContextEnabled(settings.projectContextEnabled === true);
        setWorldContinuityEnabled(settings.worldContinuityEnabled === true);
        setSelectedWorldId(typeof settings.worldId === "string" ? settings.worldId : "");
        setSelectedWorldEntityIds(typeof settings.worldEntityIds === "string"
          ? settings.worldEntityIds.split(",").map((value) => value.trim()).filter(Boolean)
          : []);
        setImagePerformanceMode(settings.imagePerformanceMode === "explicit-custom" ? "explicit-custom" : "fast-default");
        setVideoDurationSeconds(VIDEO_DURATION_OPTIONS.includes(Number(settings.videoDurationSeconds) as VideoDurationSeconds)
          ? Number(settings.videoDurationSeconds) as VideoDurationSeconds
          : 5);
        const restoredOutputCount = Number(settings.outputCount);
        setOutputCount(latestSession.mediaKind === "music" ? 1 : GENERATION_OUTPUT_COUNTS.includes(restoredOutputCount as GenerationOutputCount)
          ? restoredOutputCount as GenerationOutputCount
          : latestSession.mediaKind === "video" ? 2 : 1);
        setCanvasAspectRatio(restoredAspect);
        setCanvasMegapixels(typeof settings.canvasMegapixels === "number" && Number.isFinite(settings.canvasMegapixels) ? settings.canvasMegapixels : null);
        setSelectedTrustedVideoPresetId(trustedVideoPresetById(settings.trustedVideoPresetId)?.id ?? null);
        setCreativeToolsOpen(restoredHasHiddenControls);
        trustedVideoRestoreRef.current = null;
        const restoredTransition = settings.videoOperationTransitionSeconds;
        const restoredVideoOperation: VideoGenerationOperation | null = settings.videoOperationKind === "extend"
          && typeof settings.videoOperationSourceId === "string"
          && (settings.videoOperationSource === "upload" || settings.videoOperationSource === "artifact")
          && (settings.videoOperationOutputMode === "combined" || settings.videoOperationOutputMode === "continuation")
          && (restoredTransition === 0 || restoredTransition === 0.25 || restoredTransition === 0.5 || restoredTransition === 1)
          && (settings.videoOperationAudioMode === "keep-source" || settings.videoOperationAudioMode === "mute")
          ? {
            kind: "extend" as const,
            sourceId: settings.videoOperationSourceId,
            source: settings.videoOperationSource as VideoGenerationOperation["source"],
            sourceFrame: "last" as const,
            outputMode: settings.videoOperationOutputMode as VideoGenerationOperation["outputMode"],
            transitionSeconds: restoredTransition as VideoGenerationOperation["transitionSeconds"],
            audioMode: settings.videoOperationAudioMode as VideoGenerationOperation["audioMode"],
          }
          : null;
        setVideoOperation(restoredVideoOperation);
        const restoredAt = new Date(latestSession.updatedAt).toLocaleString();
        const restoredControlsNotice = restoredHasHiddenControls ? " Creative controls are open so every restored non-default setting is visible before generation." : "";
        if (restoredSelectionMode === "explicit" && latestSession.workflowId && !restoredWorkflow) {
          setNotice(`Resumed your draft from ${restoredAt}, but its model is no longer available. Choose a model and review the settings before generating.${restoredControlsNotice}`);
        } else if (restoredWorkflow && savedRevisionId && savedRevisionId !== restoredWorkflow.currentRevision.id) {
          setNotice(`Resumed your draft from ${restoredAt}. Its model recipe changed, so the saved settings were migrated to the current revision; review them before generating.${restoredControlsNotice}`);
        } else {
          setNotice(`Resumed your ${latestSession.intentTier} ${latestSession.mediaKind} draft from ${restoredAt}.${restoredControlsNotice}`);
        }
      } else {
        setSessionId(null);
        setWorkflowRestoreBlocked("");
      }
      sessionReadyRef.current = true;
    });
    return () => {
      cancelled = true;
      // React StrictMode immediately replays effects in development. Allow the
      // replay to initialize the same project when the first microtask was cancelled.
      if (!sessionReadyRef.current && sessionProjectRef.current === activeProjectId) sessionProjectRef.current = "";
    };
  }, [activeProjectId, initialAutoStart, initialCreateIntent, initialDirectSource, initialEvolutionSource, initialEvolutionSourceId, initialSourceId, initialStoryRecommendation, initialVideoExtensionArtifactId, initialVideoSource, latestSession, workflows]);

  useEffect(() => {
    if (!autoAnimate) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const safe = oneClickVideoSettings(initialVideoCreateMode);
      setVideoDurationSeconds(safe.durationSeconds);
      setCanvasMegapixels(safe.megapixels);
      setOutputCount(safe.outputCount);
      armedVideoRenderSignature.current = "";
      setHeavyRenderConfirmationOpen(false);
    });
    return () => { cancelled = true; };
  }, [autoAnimate, initialVideoCreateMode]);

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
  const selectedSourcePool = newestQuickSources([
    ...(initialVideoSource ? [sourceFromArtifact(initialVideoSource)] : []),
    ...(initialEvolutionSource ? [initialEvolutionSource] : []),
    ...(initialDirectSource ? [initialDirectSource] : []),
    ...projectArtifacts.map(sourceFromArtifact),
    ...projectMedia.map(sourceFromAsset),
  ]);
  const quickSource = selectedSourcePool.find((source) => source.id === quickSourceId) ?? null;
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
  const activeProject = snapshot?.projects.find((project) => project.id === activeProjectId) ?? null;
  const projectWorlds = (snapshot?.worlds ?? [])
    .filter((world) => world.projectId === activeProjectId && world.status === "active")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const selectedWorld = projectWorlds.find((world) => world.id === selectedWorldId) ?? projectWorlds[0] ?? null;
  const selectedWorldEntitiesAvailable = (snapshot?.worldEntities ?? [])
    .filter((entity) => entity.worldId === selectedWorld?.id && entity.status === "active");
  const validSelectedWorldEntityIds = selectedWorldEntityIds.filter((id) => selectedWorldEntitiesAvailable.some((entity) => entity.id === id));
  const effectiveSelectedWorldEntityIds = validSelectedWorldEntityIds.length
    ? validSelectedWorldEntityIds
    : selectedWorldEntitiesAvailable.map((entity) => entity.id);
  const selectedWorldEntities = selectedWorldEntitiesAvailable
    .filter((entity) => effectiveSelectedWorldEntityIds.includes(entity.id));

  const projectRecipes = (snapshot?.recipes ?? [])
    .filter((recipe) => !recipe.archivedAt && recipe.mediaKind === generationIntent && (recipe.projectId === activeProjectId || recipe.projectId === null))
    .sort((left, right) => right.evidenceSummary.accepted - left.evidenceSummary.accepted
      || (left.evidenceSummary.medianDurationMs ?? Number.MAX_SAFE_INTEGER) - (right.evidenceSummary.medianDurationMs ?? Number.MAX_SAFE_INTEGER)
      || right.updatedAt.localeCompare(left.updatedAt));
  const excludedProjectReferenceIdentities = projectDna.flatMap((artifact) => artifact.rights.referenceStoredAsProvenanceOnly && artifact.source.referenceLabel
    ? [artifact.source.referenceLabel]
    : []);
  const projectContext = activeProject && generationIntent !== "music" ? compileProjectContext({
    description: activeProject.description,
    note: activeProject.note,
    authoredDirection: direction,
    excludedReferenceIdentities: excludedProjectReferenceIdentities,
  }) : null;
  const authoredProjectDirection = generationIntent !== "music" && projectContextEnabled && !worldContinuityEnabled && projectContext?.text
    ? `${direction.trim().replace(/[.\s]+$/, "")}. ${projectContext.text}`
    : direction.trim();
  const selectedWorldRules = (snapshot?.continuityRules ?? []).filter((rule) => rule.worldId === selectedWorld?.id
    && rule.status === "active"
    && rule.modalities.includes(generationIntent)
    && (rule.entityIds.length === 0 || rule.entityIds.some((entityId) => selectedWorldEntities.some((entity) => entity.id === entityId))));
  const selectedWorldReferences = (snapshot?.canonReferences ?? []).filter((reference) => reference.worldId === selectedWorld?.id
    && reference.status === "canonical"
    && selectedWorldEntities.some((entity) => entity.id === reference.entityId));
  const worldReferences = (snapshot?.canonReferences ?? []).filter((reference) => reference.worldId === selectedWorld?.id);
  const compiledWorldDirective = selectedWorld && generationIntent !== "music"
    ? compileContinuityDirective({
      world: selectedWorld,
      entities: selectedWorldEntitiesAvailable,
      rules: selectedWorldRules,
      references: worldReferences,
      selectedEntityIds: selectedWorldEntities.map((entity) => entity.id),
      selectedRuleIds: selectedWorldRules.map((rule) => rule.id),
      selectedReferenceIds: selectedWorldReferences.map((reference) => reference.id),
      modality: generationIntent,
    })
    : null;
  const continuityTooLarge = Boolean(worldContinuityEnabled && compiledWorldDirective?.truncated);
  const continuityDirective = worldContinuityEnabled && !continuityTooLarge ? compiledWorldDirective : null;
  const continuitySelection: GenerationContinuitySelection | undefined = continuityDirective?.text && selectedWorld
    ? {
      schemaVersion: GENERATION_CONTINUITY_SELECTION_SCHEMA_VERSION,
      modality: generationIntent,
      world: { id: selectedWorld.id, version: selectedWorld.version },
      entities: selectedWorldEntities.map((entity) => ({ id: entity.id, version: entity.version })),
      rules: selectedWorldRules.map((rule) => ({ id: rule.id, version: rule.version })),
      references: selectedWorldReferences.map((reference) => ({ id: reference.id, version: reference.version })),
    }
    : undefined;
  const appendContinuity = (prompt: string) => {
    if (!continuityDirective?.text) return prompt.trim();
    const authoredLimit = Math.max(4, 4_000 - continuityDirective.text.length - 2);
    const authored = prompt.trim().slice(0, authoredLimit).replace(/[.\s]+$/, "");
    return `${authored}. ${continuityDirective.text}`;
  };
  const providerDirection = appendContinuity(authoredProjectDirection);
  const exactAuthoredVideoDirection = generationIntent === "video" && originalVideoDirection
    ? projectContextEnabled && !worldContinuityEnabled && projectContext?.text
      ? `${originalVideoDirection.trim().replace(/[.\s]+$/, "")}. ${projectContext.text}`
      : originalVideoDirection
    : authoredProjectDirection;
  const projectTasteMemory = snapshot?.tasteMemory?.projects[activeProjectId];
  const personalTaste = snapshot?.tasteMemory?.personal;
  const intentWorkflows = workflows.filter((item) => workflowCreateIntent(item.modality) === generationIntent);
  const trustedVideoWorkflow = generationIntent === "video"
    ? intentWorkflows.find((item) => assessTrustedVideoPresetSupport(item, TRUSTED_LTX_25_I2V_PORTRAIT_30S).supported) ?? null
    : null;
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
  const runtimeMsByWorkflowId: Record<string, number | null> = Object.fromEntries(Object.entries(runtimeHistoryByWorkflowId).map(([id, history]) => [id, history.medianMs]));
  if (trustedVideoWorkflow && runtimeMsByWorkflowId[trustedVideoWorkflow.id] === null) {
    runtimeMsByWorkflowId[trustedVideoWorkflow.id] = TRUSTED_LTX_25_I2V_PORTRAIT_30S.evidence.medianMs;
  }
  const failedRecipeSignatures = failedQuickWorkflowRecipeSignatures(snapshot?.jobs ?? []);
  const automaticRecipeSignatureByWorkflowId = Object.fromEntries(durationCompatibleWorkflows.map((item) => [
    item.id,
    quickWorkflowRecipeSignature({
      workflowId: item.id,
      revisionId: item.currentRevision.id,
      durationSeconds: generationIntent === "video" ? videoDurationSeconds : null,
      megapixels: generationIntent === "video" ? canvasMegapixels ?? ONE_CLICK_VIDEO_MEGAPIXELS : null,
    }),
  ]));
  const requestedWorkflow = workflows.find((item) => item.id === workflowId && workflowCreateIntent(item.modality) === generationIntent) ?? null;
  const preferredWorkflow = preferredQuickWorkflow(
    durationCompatibleWorkflows,
    generationIntent,
    videoOperation ? "image" : quickSource?.kind ?? null,
    runtimeMsByWorkflowId,
    { failedRecipeSignatures, recipeSignatureByWorkflowId: automaticRecipeSignatureByWorkflowId },
  );
  const workflow = workflowRestoreBlocked
    ? null
    : requestedWorkflow && (generationIntent !== "video" || workflowSupportsVideoDuration(requestedWorkflow, videoDurationSeconds))
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
  const sourceUsage = quickGenerationSourceUsage(generationIntent, bindingSource);
  const effectiveInputBindings = quickInputBindings(mediaParameters, inputBindings, sourceUsage.rendererSource);
  const selectedSourceConnected = !quickSource || intent === "train" || sourceUsage.promptOnly || Object.values(effectiveInputBindings).includes(quickSource.id);
  const selectedSourceCompatibilityError = Boolean(quickSource && intent !== "train" && workflow && !selectedSourceConnected);
  const promptReference: GenerationPromptReferenceSelection | undefined = sourceUsage.promptOnly && quickSource ? {
    schemaVersion: "creative-studio-prompt-reference-request/1.0",
    purpose: "music-prompt-inspiration",
    sourceId: quickSource.id,
    source: quickSource.source,
    kind: quickSource.kind,
  } : undefined;
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
        ? providerDirection
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
  const workflowSeedParameters = generationControls.seed;
  const workflowSeedParameter = workflowSeedParameters[0] ?? null;
  const outputCountNeedsSeed = !evolutionEnabled && (
    (generationIntent === "image" && outputCount > 1)
    || (generationIntent === "video" && outputCount === 4)
  );
  const outputCountSeedBlocked = outputCountNeedsSeed && !workflowSeedParameter;
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
  const promptEnhancementCapability = snapshot?.capabilities.find((capability) => capability.key === "prompt-enhancement") ?? null;
  const activePromptEnhancement = snapshot?.promptEnhancements.find((request) => request.id === promptEnhancementId) ?? null;
  const appliedPromptEnhancement = snapshot?.promptEnhancements.find((request) => request.id === appliedPromptEnhancementId) ?? null;
  const promptEnhancementPending = Boolean(promptEnhancementId && (!activePromptEnhancement
    || activePromptEnhancement.status === "waiting-for-runner"
    || activePromptEnhancement.status === "running"));
  const promptEnhancementAvailable = promptEnhancementCapability?.state === "available";
  const videoScriptCapability = snapshot?.capabilities.find((capability) => capability.key === "script-builder") ?? null;
  const activeVideoScriptDraft = snapshot?.videoScriptDrafts?.find((draft) => draft.id === videoScriptDraftId) ?? null;
  const activeFullVideoScriptDraft = activeVideoScriptDraft?.scriptFormat === "full-script-v2" ? activeVideoScriptDraft : null;
  const appliedVideoScriptDraft = snapshot?.videoScriptDrafts?.find((draft) => draft.id === appliedVideoScriptDraftId) ?? null;
  const videoScriptPending = Boolean(videoScriptDraftId && (!activeVideoScriptDraft
    || activeVideoScriptDraft.status === "waiting-for-runner"
    || activeVideoScriptDraft.status === "running"));
  const videoScriptAvailable = videoScriptCapability?.state === "available";
  const promptEnhancementInputMode = videoOperation ? "video-extension" : quickSource?.kind === "image" ? "image-to-video" : "text-to-video";
  const promptEnhancementSourceId = promptEnhancementInputMode === "text-to-video" ? null : quickSource?.id ?? null;
  const videoPromptProfile = generationIntent === "video" && workflow
    ? videoWorkflowPromptProfile(workflow, promptEnhancementInputMode)
    : null;
  const videoSpeechPreview = (() => {
    if (generationIntent !== "video" || videoSpeechMode === "no-speech" || !videoSpeechText.trim()) return "";
    if (!videoPromptProfile) return videoSpeechMode === "exact-script"
      ? videoSpeechText.trim()
      : videoSpeechText.trim().split(/\s+/).slice(0, 14).join(" ");
    try {
      return compileVideoPromptWithSpeech("The subject remains in view.", {
        mode: videoSpeechMode,
        text: videoSpeechText,
      }, videoPromptProfile).speech.spokenText ?? "";
    } catch {
      return "";
    }
  })();
  const videoSpeechWordCount = videoSpeechPreview.trim() ? videoSpeechPreview.trim().split(/\s+/).length : 0;
  const videoSpeechWordBudget = videoScriptWordRange(videoDurationSeconds);
  const videoSpeechFitsDuration = videoSpeechMode === "no-speech" || videoSpeechWordCount <= videoSpeechWordBudget.maximum;
  const videoSpeechReady = generationIntent !== "video" || videoSpeechMode === "no-speech"
    || (videoSpeechText.trim().length > 0 && videoSpeechPreview.length > 0 && videoSpeechFitsDuration);
  const compileVideoSpeech = (prompt: string, exactScriptOverride?: string): { prompt: string; speech: VideoSpeechStamp } => {
    if (!videoPromptProfile) throw new Error("video_prompt_profile_required");
    return compileVideoPromptWithSpeech(prompt, {
      mode: videoSpeechMode,
      text: videoSpeechMode === "no-speech" ? undefined : exactScriptOverride ?? videoSpeechText,
    }, videoPromptProfile);
  };
  const promptEnhancementMatchesWorkflow = Boolean(workflow && activePromptEnhancement
    && activePromptEnhancement.workflowId === workflow.id
    && activePromptEnhancement.workflowRevisionId === workflow.currentRevision.id
    && activePromptEnhancement.videoDurationSeconds === videoDurationSeconds
    && activePromptEnhancement.inputMode === promptEnhancementInputMode
    && (activePromptEnhancement.sourceId ?? null) === promptEnhancementSourceId);
  const appliedPromptEnhancementMatchesContext = Boolean(workflow && appliedPromptEnhancement
    && appliedPromptEnhancement.status === "completed"
    && appliedPromptEnhancement.workflowId === workflow.id
    && appliedPromptEnhancement.videoDurationSeconds === videoDurationSeconds
    && appliedPromptEnhancement.inputMode === promptEnhancementInputMode
    && (appliedPromptEnhancement.sourceId ?? null) === promptEnhancementSourceId);
  const appliedVideoScriptMatchesContext = Boolean(appliedVideoScriptDraft
    && appliedVideoScriptDraft.status === "completed"
    && appliedVideoScriptDraft.projectId === activeProjectId
    && appliedVideoScriptDraft.videoDurationSeconds === videoDurationSeconds
    && (appliedVideoScriptDraft.scriptFormat === "dialogue-v1" || (workflow
      && videoPromptProfile
      && appliedVideoScriptDraft.workflowId === workflow.id
      && appliedVideoScriptDraft.promptProfile.id === videoPromptProfile.id
      && appliedVideoScriptDraft.promptProfile.outputFormat === videoPromptProfile.outputFormat
      && appliedVideoScriptDraft.inputMode === promptEnhancementInputMode
      && (appliedVideoScriptDraft.source?.id ?? null) === promptEnhancementSourceId)));
  const fourWayBoardRequested = generationIntent === "video" && !evolutionEnabled && outputCount === 4;
  const fourWayEnhancementReady = Boolean(fourWayBoardRequested
    && appliedPromptEnhancementMatchesContext
    && appliedPromptEnhancementId
    && originalVideoDirection?.trim()
    && direction.trim()
    && originalVideoDirection.trim().replace(/\s+/g, " ").toLowerCase() !== direction.trim().replace(/\s+/g, " ").toLowerCase());
  const promptEnhancementApplication = (appliedPrompt: string) => generationIntent === "video"
    && appliedPromptEnhancementMatchesContext
    && appliedPromptEnhancement
    ? { requestId: appliedPromptEnhancement.id, basePrompt: direction.trim(), appliedPrompt }
    : undefined;
  const trainingSource = quickSource?.source === "upload" && quickSource.trainingEligible ? quickSource : null;

  useEffect(() => {
    if (!promptEnhancementId || !promptEnhancementPending) return;
    let cancelled = false;
    let timer = 0;
    let failures = 0;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        schedule(4_000);
        return;
      }
      try {
        const result = await getVideoPromptEnhancement(promptEnhancementId);
        failures = 0;
        if (result.status === "waiting-for-runner" || result.status === "running") schedule(4_000);
      } catch {
        failures += 1;
        if (failures < 4) schedule(Math.min(30_000, 4_000 * (2 ** failures)));
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    document.addEventListener("visibilitychange", visibility);
    schedule(2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [getVideoPromptEnhancement, promptEnhancementId, promptEnhancementPending]);

  useEffect(() => {
    if (!videoScriptDraftId || !videoScriptPending) return;
    let cancelled = false;
    let timer = 0;
    let failures = 0;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        schedule(4_000);
        return;
      }
      try {
        const result = await getVideoScriptDraft(videoScriptDraftId);
        failures = 0;
        if (result.status === "waiting-for-runner" || result.status === "running") schedule(4_000);
      } catch {
        failures += 1;
        if (failures < 4) schedule(Math.min(30_000, 4_000 * (2 ** failures)));
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    document.addEventListener("visibilitychange", visibility);
    schedule(2_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [getVideoScriptDraft, videoScriptDraftId, videoScriptPending]);

  useEffect(() => {
    if (!activeVideoScriptDraft || activeVideoScriptDraft.status !== "completed" || !activeVideoScriptDraft.currentScript) return;
    if (handledVideoScriptDraftId.current === activeVideoScriptDraft.id) return;
    handledVideoScriptDraftId.current = activeVideoScriptDraft.id;
    const timer = window.setTimeout(() => {
      if (activeVideoScriptDraft.scriptFormat === "full-script-v2") {
        const editor = resolveCompletedVideoScriptEditor({
          proposal: videoScriptProposal,
          spokenText: videoScriptProposalSpokenText,
        }, activeVideoScriptDraft, videoScriptProposalDirty);
        setVideoScriptProposal(editor.proposal);
        setVideoScriptProposalSpokenText(editor.spokenText);
      } else {
        setVideoScriptProposal("");
        setVideoScriptProposalSpokenText("");
        setVideoScriptProposalDirty(false);
        setVideoScriptError("This saved draft used the older dialogue-only builder. Write a new full video script from your idea.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeVideoScriptDraft, videoScriptProposal, videoScriptProposalDirty, videoScriptProposalSpokenText]);

  useEffect(() => {
    if (!activePromptEnhancement || activePromptEnhancement.status !== "completed" || !activePromptEnhancement.enhancedPrompt) return;
    if (handledPromptEnhancementId.current === activePromptEnhancement.id) return;
    handledPromptEnhancementId.current = activePromptEnhancement.id;
    if (!promptEnhancementMatchesWorkflow || direction.trim() !== activePromptEnhancement.sourcePrompt.trim()) return;
    const timer = window.setTimeout(() => {
      setOriginalVideoDirection((current) => current ?? activePromptEnhancement.sourcePrompt);
      setDirection(activePromptEnhancement.enhancedPrompt!);
      setAppliedPromptEnhancementId(activePromptEnhancement.id);
      setNotice("Gemma 4 enhanced the motion direction locally. You can edit it, restore your original, or enhance it again.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activePromptEnhancement, direction, promptEnhancementMatchesWorkflow]);
  const displayedScalarParameters = scalarParameters.map((parameter) => ({ ...parameter, value: parameterValue(parameter) }));
  const performanceParameters = canonicalGenerationPerformanceParameters(displayedScalarParameters);
  const imagePerformance = generationIntent === "image" && workflow ? assessImagePerformance(performanceParameters) : null;
  const fastImageBlocked = imagePerformanceMode === "fast-default" && Boolean(imagePerformance?.requiresExplicitCustom);
  const workflowWorkload = workflow ? analyzeGenerationWorkload({
    parameters: performanceParameters,
    models: workflow.currentRevision.models,
    inputAssetIds: Object.values(effectiveInputBindings),
    inputArtifactIds: [],
    prompt: workflowPromptParameter ? String(parameterValue(workflowPromptParameter)).trim() : providerDirection,
    videoDurationSeconds: generationIntent === "video" ? videoDurationSeconds : undefined,
  }) : null;
  const baselineWorkload = workflow ? analyzeGenerationWorkload({
    parameters: canonicalGenerationPerformanceParameters(scalarParameters),
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
  const estimatedOutputCount = generationGoalOutputCount(generationGoal, generationIntent, evolutionEnabled, outputCount);
  const runtimeEstimate = estimateGenerationRuntime(runtimeEvidence?.medianMs ?? null, workflowWorkload, baselineWorkload, estimatedOutputCount);
  const displayedAspectRatio = inferGenerationAspectRatio(displayedScalarParameters);
  const displayedMegapixels = workflowWorkload?.megapixels ?? null;
  const stepsParameter = generationControls.steps[0] ?? null;
  const fpsParameter = generationControls.fps[0] ?? null;
  const exposedVideoFps = fpsParameter && Number.isFinite(Number(parameterValue(fpsParameter)))
    ? Number(parameterValue(fpsParameter))
    : workflowWorkload?.fps ?? null;
  const videoFrameCount = generationIntent === "video" ? videoRenderFrameCount({
    durationSeconds: videoDurationSeconds,
    fps: exposedVideoFps,
    exposedFrames: workflowWorkload?.frames ?? null,
  }) : null;
  const currentVideoPerformance = generationIntent === "video" && workflow ? assessVideoPerformance({
    parameters: performanceParameters,
    models: workflow.currentRevision.models,
    inputAssetIds: Object.values(effectiveInputBindings),
    inputArtifactIds: [],
    prompt: providerDirection,
    videoDurationSeconds,
  }) : null;
  const selectedTrustedVideoPreset = trustedVideoPresetById(selectedTrustedVideoPresetId);
  const trustedCurrentWorkflow = generationIntent === "video" && workflow ? {
    ...workflow,
    currentRevision: {
      ...workflow.currentRevision,
      parameters: [
        ...mediaParameters,
        ...displayedScalarParameters,
      ],
    },
  } : null;
  const trustedVideoPresetAssessment = selectedTrustedVideoPreset && trustedCurrentWorkflow
    ? assessTrustedVideoPresetExecution(trustedCurrentWorkflow, estimatedOutputCount, selectedTrustedVideoPreset)
    : null;
  const trustedVideoPresetActive = Boolean(trustedVideoPresetAssessment?.matches && !evolutionEnabled);
  // Keep the trusted comparison tied to the versioned simulation evidence.
  // Arbitrary job-history records must not silently re-rank a trusted recipe.
  const thirtySecondSimulations = THIRTY_SECOND_VIDEO_STRATEGY_SIMULATION;
  const heavyVideoRender = Boolean(currentVideoPerformance?.requiresExplicitHeavy);
  const videoRenderSignature = generationIntent === "video" ? videoRenderConsentSignature({
    workflowRevisionId: workflow?.currentRevision.id ?? null,
    workload: currentVideoPerformance?.workload ?? null,
    outputCount: estimatedOutputCount,
  }) : "";
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
  const activeSessionWorkflowId = workflow?.id ?? workflowId;
  const workflowSelectionMode = workflowId ? "explicit" : "automatic";
  const persistedSessionWorkflowId = workflowSelectionMode === "explicit" ? workflowId : null;
  const effectiveSessionRevisionId = valuesRevisionId || workflow?.currentRevision.id || null;
  const sessionSourceType = quickSource?.source ?? null;
  const creativeSessionSignature = JSON.stringify({
    projectId: activeProjectId,
    sourceId: quickSourceId,
    direction,
    intent: generationIntent,
    workflowId: activeSessionWorkflowId,
    workflowSelectionMode,
    workflowRevisionId: effectiveSessionRevisionId,
    generationGoal,
    evolutionEnabled,
    lyrics,
    videoSpeechMode,
    videoSpeechText,
    videoScriptSeedIdeas,
    videoScriptProposal,
    videoScriptProposalSpokenText,
    videoScriptProposalDirty,
    videoScriptDraftId,
    appliedVideoScriptDraftId,
    appliedVideoScriptRevision,
    imagePerformanceMode,
    videoDurationSeconds,
    outputCount,
    canvasAspectRatio,
    canvasMegapixels,
    selectedTrustedVideoPresetId,
    projectContextEnabled,
    worldContinuityEnabled,
    worldId: selectedWorld?.id ?? null,
    worldEntityIds: selectedWorldEntities.map((entity) => entity.id),
    providerDirection,
    inputBindings,
    workflowValues,
    videoOperation,
    promptEnhancementId,
    appliedPromptEnhancementId,
    originalVideoDirection,
  });
  const generationRequestSignature = JSON.stringify({
    projectId: activeProjectId,
    sourceId: quickSourceId,
    direction,
    providerDirection,
    intent: generationIntent,
    workflowId: activeSessionWorkflowId,
    workflowModels: workflow?.currentRevision.models ?? [],
    generationGoal,
    evolutionEnabled,
    lyrics,
    videoSpeechMode,
    videoSpeechText,
    videoScriptDraftId,
    appliedVideoScriptDraftId,
    appliedVideoScriptRevision,
    imagePerformanceMode,
    videoDurationSeconds,
    outputCount,
    canvasAspectRatio,
    canvasMegapixels,
    selectedTrustedVideoPresetId,
    projectContextEnabled,
    worldContinuityEnabled,
    worldId: selectedWorld?.id ?? null,
    worldEntityIds: selectedWorldEntities.map((entity) => entity.id),
    inputBindings,
    workflowValues,
    videoOperation,
    appliedPromptEnhancementId,
  });

  useEffect(() => {
    sessionPersistRef.current = () => {
      if (!activeProjectId || !sessionReadyRef.current || sessionSubmittingRef.current || intent === "train") return;
      if (!direction.trim() && !quickSourceId && !workflowId) return;
      if (creativeSessionSignature === lastSavedSessionSignature.current || creativeSessionSignature === lastSubmittedSessionSignature.current) return;
      const graphicalSettings = {
        workflowSelectionMode,
        automaticWorkflowId: workflowSelectionMode === "automatic" ? activeSessionWorkflowId || null : null,
        workflowRevisionId: effectiveSessionRevisionId,
        lyrics,
        videoSpeechMode,
        videoSpeechText,
        videoScriptSeedIdeas,
        videoScriptProposal,
        videoScriptProposalSpokenText,
        videoScriptProposalDirty,
        videoScriptDraftId: videoScriptDraftId || null,
        appliedVideoScriptDraftId: appliedVideoScriptDraftId || null,
        appliedVideoScriptRevision,
        imagePerformanceMode,
        videoDurationSeconds,
        outputCount,
        canvasAspectRatio,
        canvasMegapixels,
        trustedVideoPresetId: selectedTrustedVideoPreset?.id ?? null,
        projectContextEnabled,
        worldContinuityEnabled,
        worldId: selectedWorld?.id ?? null,
        worldEntityIds: selectedWorldEntities.map((entity) => entity.id).join(","),
        videoOperationKind: videoOperation?.kind ?? null,
        videoOperationSourceId: videoOperation?.sourceId ?? null,
        videoOperationSource: videoOperation?.source ?? null,
        videoOperationOutputMode: videoOperation?.outputMode ?? null,
        videoOperationTransitionSeconds: videoOperation?.transitionSeconds ?? null,
        videoOperationAudioMode: videoOperation?.audioMode ?? null,
        promptEnhancementId: promptEnhancementId || null,
        appliedPromptEnhancementId: appliedPromptEnhancementId || null,
        originalVideoDirection,
        ...Object.fromEntries(Object.entries(inputBindings).map(([id, value]) => [`binding:${id}`, value])),
        ...Object.fromEntries(Object.entries(workflowValues).map(([id, value]) => [`value:${id}`, value])),
      };
      const saved = saveSession({
        id: sessionId ?? undefined,
        sourceAssetIds: sessionSourceType === "upload" && quickSourceId ? [quickSourceId] : [],
        retainedArtifactId: sessionSourceType === "artifact" ? quickSourceId : null,
        direction,
        mediaKind: generationIntent,
        workflowId: persistedSessionWorkflowId,
        graphicalSettings,
        intentTier: generationGoal,
      });
      if (saved) {
        lastSavedSessionSignature.current = creativeSessionSignature;
        if (saved.id !== sessionId) setSessionId(saved.id);
      }
    };
  }, [activeProjectId, activeSessionWorkflowId, appliedPromptEnhancementId, appliedVideoScriptDraftId, appliedVideoScriptRevision, canvasAspectRatio, canvasMegapixels, creativeSessionSignature, direction, effectiveSessionRevisionId, generationGoal, generationIntent, imagePerformanceMode, inputBindings, intent, lyrics, originalVideoDirection, outputCount, persistedSessionWorkflowId, projectContextEnabled, promptEnhancementId, quickSourceId, saveSession, selectedTrustedVideoPreset?.id, selectedWorld?.id, selectedWorldEntities, sessionId, sessionSourceType, videoDurationSeconds, videoOperation, videoScriptDraftId, videoScriptProposal, videoScriptProposalDirty, videoScriptProposalSpokenText, videoScriptSeedIdeas, videoSpeechMode, videoSpeechText, workflowId, workflowSelectionMode, workflowValues, worldContinuityEnabled]);

  useEffect(() => {
    if (sessionCompletionVersion !== sessionCompletionBaselineRef.current) {
      sessionCompletionBaselineRef.current = sessionCompletionVersion;
      lastSavedSessionSignature.current = creativeSessionSignature;
      lastSubmittedSessionSignature.current = creativeSessionSignature;
      sessionSubmittingRef.current = false;
      return;
    }
    if (!activeProjectId || !sessionReadyRef.current || intent === "train") return;
    if (!direction.trim() && !quickSourceId && !workflowId) return;
    if (lastSavedSessionSignature.current === "restored-session") {
      lastSavedSessionSignature.current = creativeSessionSignature;
      return;
    }
    if (creativeSessionSignature === lastSavedSessionSignature.current) return;
    if (creativeSessionSignature === lastSubmittedSessionSignature.current) return;
    window.clearTimeout(sessionSaveTimerRef.current);
    const timer = window.setTimeout(() => {
      sessionSaveTimerRef.current = 0;
      sessionPersistRef.current();
    }, 650);
    sessionSaveTimerRef.current = timer;
    return () => {
      if (sessionSaveTimerRef.current === timer) sessionSaveTimerRef.current = 0;
      window.clearTimeout(timer);
    };
  }, [activeProjectId, creativeSessionSignature, direction, intent, quickSourceId, sessionCompletionVersion, workflowId]);

  useEffect(() => {
    const flush = () => sessionPersistRef.current();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  const beginCreativeSessionSubmission = () => {
    sessionSubmittingRef.current = true;
    window.clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = 0;
  };

  const completeCreativeSession = () => {
    window.clearTimeout(sessionSaveTimerRef.current);
    sessionSaveTimerRef.current = 0;
    lastSubmittedSessionSignature.current = creativeSessionSignature;
    if (sessionId) clearSession(sessionId);
    setSessionId(null);
    setSessionCompletionVersion((version) => version + 1);
  };

  const resumeCreativeSessionAutosave = () => {
    sessionSubmittingRef.current = false;
    sessionPersistRef.current();
  };

  const clearVideoPromptEnhancement = () => {
    setPromptEnhancementId("");
    setOriginalVideoDirection(null);
    setAppliedPromptEnhancementId("");
    handledPromptEnhancementId.current = "";
  };

  const resetWorkflowOverrides = () => {
    setWorkflowId("");
    setWorkflowRestoreBlocked("");
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setImagePerformanceMode("fast-default");
    setCanvasAspectRatio(null);
    setCanvasMegapixels(null);
    setSelectedTrustedVideoPresetId(null);
    trustedVideoRestoreRef.current = null;
    setLyrics("");
    setNotice("");
    armedVideoRenderSignature.current = "";
    setHeavyRenderConfirmationOpen(false);
  };

  const leaveTrustedVideoPreset = (options: {
    standardDefaults?: boolean;
    durationSeconds?: VideoDurationSeconds;
    aspectRatio?: GenerationAspectRatio | null;
    megapixels?: number | null;
    outputCount?: GenerationOutputCount;
    workflowParameter?: { parameter: WorkflowParameter; value: WorkflowScalar };
    notice?: string;
  } = {}) => {
    if (!selectedTrustedVideoPresetId) return false;
    const restore = trustedVideoRestoreRef.current;
    const currentTarget = workflow ?? trustedVideoWorkflow;
    const restoredTarget = restore
      ? workflows.find((item) => item.id === restore.resolvedWorkflowId) ?? null
      : null;
    const target = options.standardDefaults ? restoredTarget ?? currentTarget : currentTarget;
    const canRestoreTarget = Boolean(restore && target
      && restore.resolvedWorkflowId === target.id
      && restore.workflowRevisionId === target.currentRevision.id);
    const restoredValues = canRestoreTarget && restore ? { ...restore.workflowValues } : {};
    if (options.workflowParameter && target) {
      restoredValues[options.workflowParameter.parameter.id] = canonicalWorkflowParameterValue(
        options.workflowParameter.parameter,
        options.workflowParameter.value,
      );
    }
    const hasDuration = Object.prototype.hasOwnProperty.call(options, "durationSeconds");
    const hasAspect = Object.prototype.hasOwnProperty.call(options, "aspectRatio");
    const hasMegapixels = Object.prototype.hasOwnProperty.call(options, "megapixels");
    const nextDuration = hasDuration
      ? options.durationSeconds!
      : options.standardDefaults
        ? ONE_CLICK_VIDEO_DURATION_SECONDS
        : canRestoreTarget && restore ? restore.durationSeconds : ONE_CLICK_VIDEO_DURATION_SECONDS;
    const nextAspect = hasAspect
      ? options.aspectRatio!
      : options.standardDefaults
        ? null
        : canRestoreTarget && restore ? restore.aspectRatio : null;
    const nextMegapixels = hasMegapixels
      ? options.megapixels!
      : options.standardDefaults
        ? ONE_CLICK_VIDEO_MEGAPIXELS
        : canRestoreTarget && restore ? restore.megapixels : ONE_CLICK_VIDEO_MEGAPIXELS;

    setWorkflowId(options.standardDefaults && restore ? restore.requestedWorkflowId : target?.id ?? "");
    setWorkflowRestoreBlocked("");
    setValuesRevisionId(options.workflowParameter && target
      ? target.currentRevision.id
      : canRestoreTarget && restore ? restore.workflowRevisionId : "");
    setWorkflowValues(restoredValues);
    setInputBindings(canRestoreTarget && restore ? { ...restore.inputBindings } : inputBindings);
    setVideoDurationSeconds(nextDuration);
    setCanvasAspectRatio(nextAspect);
    setCanvasMegapixels(nextMegapixels);
    setOutputCount(options.outputCount ?? 2);
    setSelectedTrustedVideoPresetId(null);
    trustedVideoRestoreRef.current = null;
    armedVideoRenderSignature.current = "";
    setHeavyRenderConfirmationOpen(false);
    setLocalError("");
    setNotice(options.notice ?? "Standard Pair restored: Aligned + Discovery will render with trusted overrides cleared.");
    return true;
  };

  const chooseGraphicalValue = (parameter: WorkflowParameter, value: WorkflowScalar) => {
    if (!workflow) return;
    if (generationIntent === "video" && leaveTrustedVideoPreset({
      workflowParameter: { parameter, value },
      outputCount: 2,
      notice: "Fast 30s exited. This setting will use the normal Aligned + Discovery pair.",
    })) return;
    const displayedValues = Object.fromEntries(scalarParameters.map((item) => [item.id, parameterValue(item)]));
    if (generationIntent === "image" && generationControls.steps.some((item) => item.id === parameter.id) && Number(value) > FAST_IMAGE_MAX_STEPS) {
      setImagePerformanceMode("explicit-custom");
    }
    setValuesRevisionId(workflow.currentRevision.id);
    setWorkflowValues({ ...displayedValues, [parameter.id]: canonicalWorkflowParameterValue(parameter, value) });
  };

  const chooseCanvasAspect = (aspect: GenerationAspectRatio) => {
    if (generationIntent === "video" && leaveTrustedVideoPreset({
      aspectRatio: aspect,
      outputCount: 2,
      notice: "Fast 30s exited. This frame shape will use the normal Aligned + Discovery pair.",
    })) return;
    setCanvasAspectRatio(aspect);
    setLocalError("");
  };

  const chooseCanvasMegapixels = (megapixels: number) => {
    if (generationIntent === "video" && leaveTrustedVideoPreset({
      megapixels,
      outputCount: 2,
      notice: "Fast 30s exited. This detail level will use the normal Aligned + Discovery pair.",
    })) return;
    setCanvasMegapixels(megapixels);
    if (generationIntent === "image" && megapixels > 512 * 512 / 1_000_000) setImagePerformanceMode("explicit-custom");
    setLocalError("");
  };

  const chooseIntent = (nextIntent: CreateIntent) => {
    if (nextIntent !== intent) {
      setSelectedStoryRecommendation(undefined);
      clearVideoPromptEnhancement();
      setDirection("");
      setEvolutionEnabled(false);
      setVideoSpeechMode("no-speech");
      setVideoSpeechText("");
      setVideoScriptBuilderOpen(false);
      setVideoScriptSeedIdeas("");
      setVideoScriptProposal("");
      setVideoScriptProposalSpokenText("");
      setVideoScriptProposalDirty(false);
      setVideoScriptDraftId("");
      setAppliedVideoScriptDraftId("");
      setAppliedVideoScriptRevision(null);
      setVideoScriptError("");
      handledVideoScriptDraftId.current = "";
      setOutputCount(nextIntent === "video" ? 2 : 1);
      const nextOutputBatchId = `output_batch_${crypto.randomUUID()}`;
      outputBatchAttemptRef.current = { id: nextOutputBatchId, signature: "" };
      setOutputBatchId(nextOutputBatchId);
    }
    setIntent(nextIntent);
    if (nextIntent !== "image" && generationGoal === "scout") {
      setGenerationGoal("explore");
      setEvolutionEnabled(false);
    }
    setVideoOperation(null);
    setSourceGalleryExpanded(false);
    resetWorkflowOverrides();
    if (nextIntent === "video") setCanvasMegapixels(ONE_CLICK_VIDEO_MEGAPIXELS);
    armedVideoRenderSignature.current = "";
    setHeavyRenderConfirmationOpen(false);
  };

  const chooseGenerationGoal = (nextGoal: GenerationGoal) => {
    setGenerationGoal(nextGoal);
    setLocalError("");
    if (nextGoal === "scout") {
      setEvolutionEnabled(true);
      setImagePerformanceMode("fast-default");
      setNotice(generationGoalCanScout(generationIntent, quickSource?.kind ?? null)
        ? "Scout will render Refine, Correct, and Discovery as three fast retained directions."
        : "Choose an image source to scout three directions.");
      return;
    }
    setEvolutionEnabled(false);
    if (nextGoal === "master" && generationIntent === "image") setImagePerformanceMode("explicit-custom");
    if (nextGoal === "explore" && generationIntent === "image") setImagePerformanceMode("fast-default");
    setNotice(nextGoal === "master"
      ? "Master uses your exact quality settings and keeps the complete recipe."
      : "Explore uses the recommended local model and fastest safe settings.");
  };

  const chooseWorkflow = (id: string) => {
    if (id !== workflow?.id) {
      setSelectedStoryRecommendation(undefined);
      clearVideoPromptEnhancement();
      detachAssistedVideoScript();
    }
    setWorkflowId(id);
    setWorkflowRestoreBlocked("");
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setImagePerformanceMode("fast-default");
    setCanvasAspectRatio(null);
    setCanvasMegapixels(generationIntent === "video" ? ONE_CLICK_VIDEO_MEGAPIXELS : null);
    setSelectedTrustedVideoPresetId(null);
    trustedVideoRestoreRef.current = null;
    setLyrics("");
    setNotice("");
    armedVideoRenderSignature.current = "";
    setHeavyRenderConfirmationOpen(false);
  };

  const requestVideoPromptEnhancement = async () => {
    if (!workflow || generationIntent !== "video" || !directionReady || !promptEnhancementAvailable || promptEnhancementPending) return;
    setLocalError("");
    const sourcePrompt = direction.trim();
    setOriginalVideoDirection((current) => current ?? sourcePrompt);
    try {
      const request = await enhanceVideoPrompt({
        workflowId: workflow.id,
        workflowRevisionId: workflow.currentRevision.id,
        sourcePrompt,
        videoDurationSeconds,
        inputMode: promptEnhancementInputMode,
        sourceId: promptEnhancementSourceId,
      });
      handledPromptEnhancementId.current = "";
      setPromptEnhancementId(request.id);
      setNotice("");
    } catch {
      // StudioProvider keeps the normalized error visible; the authored prompt is untouched.
    }
  };

  useEffect(() => {
    requestVideoPromptEnhancementRef.current = requestVideoPromptEnhancement;
  });

  const keepCurrentVideoPrompt = () => {
    setPromptEnhancementId("");
    setNotice("Keeping your current prompt. The local enhancement result will not replace it.");
  };

  const applyCompletedVideoPromptEnhancement = () => {
    if (!activePromptEnhancement?.enhancedPrompt || activePromptEnhancement.status !== "completed") return;
    setOriginalVideoDirection((current) => current ?? activePromptEnhancement.sourcePrompt);
    setDirection(activePromptEnhancement.enhancedPrompt);
    setAppliedPromptEnhancementId(activePromptEnhancement.id);
    setNotice("Gemma 4 enhancement applied. You can still edit it before generating.");
  };

  const restoreOriginalVideoPrompt = () => {
    if (originalVideoDirection === null) return;
    setDirection(originalVideoDirection);
    setAppliedPromptEnhancementId("");
    setPromptEnhancementId("");
    setNotice("Original prompt restored.");
  };

  const requestVideoScriptDraft = async (mode: "build" | "tighten") => {
    if (videoScriptPending || !videoScriptAvailable) return;
    setVideoScriptError("");
    setLocalError("");
    if (!workflow || !videoPromptProfile) {
      setVideoScriptError("Choose a video model first so Gemma can write the script in the format that model understands.");
      return;
    }
    if (direction.trim().length > 4_000) {
      setVideoScriptError("Shorten the scene direction before using Script Builder. Your current prompt is unchanged.");
      return;
    }
    try {
      const request = mode === "build"
        ? await (() => {
          const seedPhrases = videoScriptSeedPhrases(videoScriptSeedIdeas);
          if (!seedPhrases.length || seedPhrases.some((phrase) => phrase.length > 180)) {
            throw new Error("Add shorter seed phrases, separated by commas or new lines.");
          }
          return createVideoScriptDraft({
            scriptFormat: "full-script-v2",
            mode: "build",
            seedPhrases,
            workflowId: workflow.id,
            workflowRevisionId: workflow.currentRevision.id,
            inputMode: promptEnhancementInputMode,
            sourceId: promptEnhancementSourceId,
            sceneDirection: direction.trim(),
            videoDurationSeconds,
          });
        })()
        : await (() => {
          const sourceScript = direction.trim();
          if (sourceScript.length < 2) throw new Error("Write a video direction first, then ask Gemma to polish it.");
          return createVideoScriptDraft({
            scriptFormat: "full-script-v2",
            mode: "tighten",
            sourceScript,
            workflowId: workflow.id,
            workflowRevisionId: workflow.currentRevision.id,
            inputMode: promptEnhancementInputMode,
            sourceId: promptEnhancementSourceId,
            sceneDirection: direction.trim(),
            videoDurationSeconds,
          });
        })();
      handledVideoScriptDraftId.current = "";
      setVideoScriptDraftId(request.id);
      setVideoScriptProposal("");
      setVideoScriptProposalSpokenText("");
      setVideoScriptProposalDirty(false);
      setVideoScriptBuilderOpen(true);
      setNotice("");
    } catch (requestError) {
      setVideoScriptError(videoScriptErrorMessage(requestError));
    }
  };

  const applyVideoScriptProposal = async () => {
    if (!activeFullVideoScriptDraft || activeFullVideoScriptDraft.status !== "completed") return;
    const proposal = videoScriptProposal.replace(/\r\n?/g, "\n").trim();
    const spokenText = videoScriptProposalSpokenText.replace(/\s+/g, " ").trim();
    const spokenWordCount = spokenText ? spokenText.split(/\s+/).length : 0;
    if (proposal.length < 20 || proposal.length > 4_000) {
      setVideoScriptError("Keep the full video script between 20 and 4,000 characters.");
      return;
    }
    if (spokenWordCount > videoSpeechWordBudget.maximum) {
      setVideoScriptError(`Dialogue is too long for ${videoDurationSeconds} seconds. Keep it under ${videoSpeechWordBudget.maximum} spoken words.`);
      return;
    }
    setVideoScriptError("");
    try {
      const currentSpokenText = spokenText || null;
      const saved = proposal === activeFullVideoScriptDraft.currentScript
        && currentSpokenText === activeFullVideoScriptDraft.currentSpokenText
        ? activeFullVideoScriptDraft
        : await updateVideoScriptDraft(activeFullVideoScriptDraft.id, {
          scriptFormat: "full-script-v2",
          currentScript: proposal,
          currentSpokenText,
          expectedRevision: activeFullVideoScriptDraft.editRevision,
        });
      if (saved.scriptFormat !== "full-script-v2") throw new Error("video_script_context_mismatch");
      setVideoScriptProposal(saved.currentScript ?? proposal);
      const savedSpokenText = saved.currentSpokenText;
      setVideoScriptProposalSpokenText(savedSpokenText ?? "");
      setVideoScriptProposalDirty(false);
      clearVideoPromptEnhancement();
      setDirection(saved.currentScript ?? proposal);
      setVideoSpeechMode(savedSpokenText ? "exact-script" : "no-speech");
      setVideoSpeechText(savedSpokenText ?? "");
      setAppliedVideoScriptDraftId(saved.id);
      setAppliedVideoScriptRevision(saved.editRevision);
      setVideoScriptBuilderOpen(false);
      setNotice(saved.currentScript === saved.generatedScript && savedSpokenText === saved.generatedSpokenText
        ? `Full video script applied${savedSpokenText ? ` · ${spokenWordCount} spoken words` : " · no dialogue"}. You can still edit it before generating.`
        : "Your edited full script is applied. Its scene, sound, dialogue choice, and revision will be retained with every result.");
    } catch (updateError) {
      setVideoScriptError(videoScriptErrorMessage(updateError));
    }
  };

  const prepareVideoScriptUse = async (): Promise<VideoScriptUse | undefined> => {
    if (!appliedVideoScriptDraftId) return undefined;
    let draft = appliedVideoScriptDraft ?? await getVideoScriptDraft(appliedVideoScriptDraftId);
    if (draft.status !== "completed" || draft.projectId !== activeProjectId
      || draft.videoDurationSeconds !== videoDurationSeconds || !draft.currentScript) {
      throw new Error("video_script_context_mismatch");
    }
    if (draft.scriptFormat === "dialogue-v1") {
      if (videoSpeechMode !== "exact-script") return undefined;
      const appliedScript = videoSpeechText.replace(/\s+/g, " ").trim();
      if (draft.currentScript !== appliedScript) {
        draft = await updateVideoScriptDraft(draft.id, {
          scriptFormat: "dialogue-v1",
          currentScript: appliedScript,
          expectedRevision: draft.editRevision,
        });
        setVideoScriptProposal(draft.currentScript ?? appliedScript);
        setVideoScriptProposalDirty(false);
        setAppliedVideoScriptRevision(draft.editRevision);
      }
      return { scriptFormat: "dialogue-v1", requestId: draft.id, appliedScript, editRevision: draft.editRevision };
    }
    if (!workflow || !videoPromptProfile || draft.workflowId !== workflow.id
      || draft.promptProfile.id !== videoPromptProfile.id || draft.promptProfile.outputFormat !== videoPromptProfile.outputFormat
      || draft.inputMode !== promptEnhancementInputMode || (draft.source?.id ?? null) !== promptEnhancementSourceId
      || videoSpeechMode === "short-natural-line") {
      throw new Error("video_script_context_mismatch");
    }
    const appliedPrompt = direction.replace(/\r\n?/g, "\n").trim();
    const appliedSpokenText = videoSpeechMode === "exact-script" ? videoSpeechText.replace(/\s+/g, " ").trim() || null : null;
    if (draft.currentScript !== appliedPrompt || draft.currentSpokenText !== appliedSpokenText) {
      draft = await updateVideoScriptDraft(draft.id, {
        scriptFormat: "full-script-v2",
        currentScript: appliedPrompt,
        currentSpokenText: appliedSpokenText,
        expectedRevision: draft.editRevision,
      });
      setVideoScriptProposal(draft.currentScript ?? appliedPrompt);
      setVideoScriptProposalSpokenText(draft.scriptFormat === "full-script-v2" ? draft.currentSpokenText ?? "" : "");
      setVideoScriptProposalDirty(false);
      setAppliedVideoScriptRevision(draft.editRevision);
    }
    return {
      scriptFormat: "full-script-v2",
      requestId: draft.id,
      appliedPrompt,
      appliedSpokenText,
      editRevision: draft.editRevision,
    };
  };

  const detachAssistedVideoScript = () => {
    if (!videoScriptDraftId && !appliedVideoScriptDraftId) return false;
    setVideoScriptDraftId("");
    setVideoScriptProposal("");
    setVideoScriptProposalSpokenText("");
    setVideoScriptProposalDirty(false);
    setAppliedVideoScriptDraftId("");
    setAppliedVideoScriptRevision(null);
    handledVideoScriptDraftId.current = "";
    return true;
  };

  const applyStoryRecommendation = ({ story, recommendation }: StoryRecommendationHandoff) => {
    if (recommendation.modality !== intent) chooseIntent(recommendation.modality);
    else {
      clearVideoPromptEnhancement();
      detachAssistedVideoScript();
    }
    const recommendedSource = recommendation.sourceId
      ? selectedSourcePool.find((source) => source.id === recommendation.sourceId) ?? null
      : null;
    const recommendedWorkflow = recommendation.workflowId
      ? workflows.find((item) => item.id === recommendation.workflowId) ?? null
      : null;
    setIntent(recommendation.modality);
    setDirection(recommendation.prompt);
    setSelectedStoryRecommendation(recommendedWorkflow ? storyRecommendationSelection(story, recommendation) : undefined);
    setQuickSourceId(recommendedSource?.id ?? "");
    setInputBindings({});
    setWorkflowId(recommendedWorkflow?.id ?? "");
    setWorkflowRestoreBlocked("");
    setWorkflowValues({});
    setValuesRevisionId(recommendedWorkflow?.currentRevision.id ?? "");
    setSelectedTrustedVideoPresetId(null);
    trustedVideoRestoreRef.current = null;
    setEvolutionEnabled(false);
    if (generationGoal === "scout") setGenerationGoal("explore");
    setProjectContextEnabled(false);
    setWorldContinuityEnabled(false);
    setVideoOperation(null);
    setCanvasAspectRatio(recommendation.aspectRatio);
    if (recommendation.modality === "video" && typeof recommendation.durationSeconds === "number" && VIDEO_DURATION_OPTIONS.includes(recommendation.durationSeconds as VideoDurationSeconds)) {
      setVideoDurationSeconds(recommendation.durationSeconds as VideoDurationSeconds);
    }
    setNotice(`${recommendation.title} is ready${recommendedWorkflow ? " exactly as recommended" : ", but its original model revision is no longer ready"}${recommendedSource ? ` with ${recommendedSource.name}` : recommendation.sourceId ? "; its original source is no longer retained" : ""}.`);
    setLocalError("");
  };

  const detachAssistedScriptForDuration = (seconds: VideoDurationSeconds) => (
    seconds !== videoDurationSeconds && detachAssistedVideoScript()
  );

  const applyTrustedThirtySecondPreset = () => {
    const target = trustedVideoWorkflow;
    const preset = TRUSTED_LTX_25_I2V_PORTRAIT_30S;
    if (!target) {
      setLocalError("The measured LTX 2.5 image-to-video graph is not ready on this machine.");
      return;
    }
    if (!selectedTrustedVideoPresetId) {
      trustedVideoRestoreRef.current = {
        requestedWorkflowId: workflowId,
        resolvedWorkflowId: workflow?.id ?? "",
        workflowRevisionId: workflow?.currentRevision.id ?? "",
        workflowValues: { ...workflowValues },
        inputBindings: { ...inputBindings },
        durationSeconds: videoDurationSeconds,
        outputCount,
        aspectRatio: canvasAspectRatio,
        megapixels: canvasMegapixels,
      };
    }
    const detachedAssistedScript = detachAssistedScriptForDuration(preset.settings.durationSeconds);
    const overrides = trustedVideoPresetParameterOverrides(target.currentRevision.parameters, preset);
    const preserveCurrentWorkflowState = workflow?.id === target.id;
    const currentScalarValues = preserveCurrentWorkflowState
      ? Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameterValue(parameter)]))
      : {};
    const scalarValues = Object.fromEntries(target.currentRevision.parameters
      .filter((parameter) => parameter.kind !== "media")
      .map((parameter) => [
        parameter.id,
        Object.prototype.hasOwnProperty.call(overrides, parameter.id)
          ? overrides[parameter.id]
          : Object.prototype.hasOwnProperty.call(currentScalarValues, parameter.id)
            ? currentScalarValues[parameter.id]
            : parameter.value,
      ]));
    clearVideoPromptEnhancement();
    setWorkflowId(target.id);
    setWorkflowRestoreBlocked("");
    setValuesRevisionId(target.currentRevision.id);
    setWorkflowValues(scalarValues);
    setInputBindings(preserveCurrentWorkflowState ? inputBindings : {});
    setVideoDurationSeconds(preset.settings.durationSeconds);
    setCanvasAspectRatio(preset.settings.aspectRatio);
    setCanvasMegapixels(preset.settings.megapixels);
    setOutputCount(preset.settings.outputCount);
    setEvolutionEnabled(false);
    if (generationGoal === "scout") setGenerationGoal("explore");
    setSelectedTrustedVideoPresetId(preset.id);
    armedVideoRenderSignature.current = "";
    setHeavyRenderConfirmationOpen(false);
    setLocalError("");
    setNotice(`Fast 30s selected explicitly: one native portrait render at 0.20 MP, 24 fps, and 721 frames.${detachedAssistedScript ? " Your direction remains; write a new full script for 30 seconds if needed." : ""}`);
  };

  const applyGenerationRecipe = (recipe: GenerationRecipe) => {
    if (recipe.worldId) {
      setLocalError(`${recipe.name} uses legacy World text without an exact versioned continuity selection. Build it again from the current World before generating.`);
      return;
    }
    const recipeWorkflow = workflows.find((item) => item.id === recipe.workflowId && workflowCreateIntent(item.modality) === recipe.mediaKind);
    if (!recipeWorkflow) {
      setLocalError(`${recipe.name} uses a model that is no longer ready on this machine.`);
      return;
    }
    const detachedAssistedScript = detachAssistedVideoScript();
    clearVideoPromptEnhancement();
    const promptParameter = primaryWorkflowPromptParameter(recipeWorkflow.currentRevision.parameters, recipeWorkflow.modality);
    const lyricsParameter = musicWorkflowLyricsParameter(recipeWorkflow.currentRevision.parameters, recipeWorkflow.modality);
    const recipeDuration = videoWorkflowDurationParameters(recipeWorkflow.currentRevision.parameters)
      .map((parameter) => Number(recipe.parameters[parameter.id]))
      .find((seconds) => VIDEO_DURATION_OPTIONS.includes(seconds as VideoDurationSeconds));
    setWorkflowId(recipeWorkflow.id);
    setWorkflowRestoreBlocked("");
    setValuesRevisionId(recipeWorkflow.currentRevision.id);
    setWorkflowValues(recipe.parameters);
    setInputBindings({});
    setCanvasAspectRatio(null);
    setCanvasMegapixels(null);
    setGenerationGoal(recipe.intentTier);
    setEvolutionEnabled(recipe.intentTier === "scout");
    setImagePerformanceMode(recipe.intentTier === "master" ? "explicit-custom" : "fast-default");
    setSelectedTrustedVideoPresetId(null);
    trustedVideoRestoreRef.current = null;
    if (promptParameter && recipe.parameters[promptParameter.id] !== undefined) {
      setSelectedStoryRecommendation(undefined);
      setDirection(String(recipe.parameters[promptParameter.id]));
    }
    if (lyricsParameter && recipe.parameters[lyricsParameter.id] !== undefined) setLyrics(String(recipe.parameters[lyricsParameter.id]));
    if (recipeDuration) setVideoDurationSeconds(recipeDuration as VideoDurationSeconds);
    setLocalError("");
    const revisionNotice = recipe.workflowRevisionId === recipeWorkflow.currentRevision.id
      ? ""
      : " Its original immutable model revision is retained, but Create is applying the saved values to the model's current revision; review them before generating.";
    setNotice(`${recipe.name} loaded · ${recipe.evidenceSummary.runs ? `${recipe.evidenceSummary.runs} proven runs` : "ready for its first evidence run"}.${revisionNotice}${detachedAssistedScript ? " The recipe direction is preserved, and the previous assisted-script lineage was detached; write a new full script for this setup if needed." : ""}`);
  };

  const saveCurrentRecipe = async () => {
    if (!workflow || !workflowReady || !workflowPromptParameter) return;
    setLocalError("");
    if (generationIntent !== "music" && worldContinuityEnabled && selectedWorld) {
      setLocalError("World-backed recipes need typed continuity replay before they can be saved safely. Turn continuity off to save only these model settings.");
      return;
    }
    try {
      const modified = Object.fromEntries(scalarParameters
        .filter((parameter) => !sameWorkflowValue(parameter.value, parameterValue(parameter)))
        .map((parameter) => [parameter.id, parameterValue(parameter)]));
      const recipeWorkflow = Object.keys(modified).length
        ? await saveWorkflowRevision(workflow.id, workflow.currentRevision.id, modified)
        : workflow;
      const profileIdentity = musicPromptProfile?.id ?? `creative-studio-${generationIntent}-direct-prompt/1.0`;
      const profileSeparator = profileIdentity.lastIndexOf("/");
      const sourceKinds = [...new Set([
        ...(workflowPromptParameter ? ["prompt" as const] : []),
        ...mediaParameters.flatMap((parameter) => parameter.mediaKind ? [parameter.mediaKind] : []),
      ])];
      const recipe = await createGenerationRecipe({
        name: `${shortDnaName(direction, generationIntent)} · ${GENERATION_GOALS.find((goal) => goal.id === generationGoal)?.shortLabel ?? generationGoal}`,
        description: `${GENERATION_GOALS.find((goal) => goal.id === generationGoal)?.label ?? generationGoal} recipe saved from Create.`,
        projectId: activeProjectId,
        worldId: null,
        mediaKind: generationIntent,
        workflowId: recipeWorkflow.id,
        workflowRevisionId: recipeWorkflow.currentRevision.id,
        modelIdentifier: recipeWorkflow.currentRevision.models[0] ?? null,
        promptProfile: {
          id: profileSeparator > 0 ? profileIdentity.slice(0, profileSeparator) : profileIdentity,
          version: profileSeparator > 0 ? profileIdentity.slice(profileSeparator + 1) : "1.0",
          targetModel: musicPromptProfile?.targetModel ?? recipeWorkflow.currentRevision.models[0] ?? recipeWorkflow.name,
        },
        parameters: Object.fromEntries(recipeWorkflow.currentRevision.parameters
          .filter((parameter) => parameter.kind !== "media")
          .map((parameter) => [parameter.id, parameter.value])),
        sourceKinds,
        intentTier: generationGoal,
      });
      setWorkflowId(recipeWorkflow.id);
      setValuesRevisionId(recipeWorkflow.currentRevision.id);
      setWorkflowValues(Object.fromEntries(recipeWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
      setNotice(`${recipe.name} saved as a reusable recipe. Future review evidence will show whether it is fast and strong.`);
    } catch {
      // The provider exposes a normalized visible error.
    }
  };

  const chooseVideoDuration = (seconds: VideoDurationSeconds) => {
    const detachedAssistedScript = detachAssistedScriptForDuration(seconds);
    const exitedFastThirty = leaveTrustedVideoPreset({
      durationSeconds: seconds,
      outputCount: 2,
      notice: "Fast 30s exited. This length will use the normal Aligned + Discovery pair.",
    });
    if (!exitedFastThirty) setVideoDurationSeconds(seconds);
    setLocalError("");
    if (!workflow || workflowSupportsVideoDuration(workflow, seconds)) {
      setNotice(detachedAssistedScript
        ? "Video length changed. Your current direction is preserved; write a new full script for this length."
        : exitedFastThirty
          ? "Fast 30s exited. This length will use the normal Aligned + Discovery pair."
          : "");
      return;
    }
    const replacement = preferredQuickWorkflow(
      intentWorkflows.filter((item) => workflowSupportsVideoDuration(item, seconds)),
      "video",
      videoOperation ? "image" : quickSource?.kind ?? null,
      runtimeMsByWorkflowId,
      {
        failedRecipeSignatures,
        recipeSignatureByWorkflowId: Object.fromEntries(intentWorkflows
          .filter((item) => workflowSupportsVideoDuration(item, seconds))
          .map((item) => [item.id, quickWorkflowRecipeSignature({
            workflowId: item.id,
            revisionId: item.currentRevision.id,
            durationSeconds: seconds,
            megapixels: canvasMegapixels ?? ONE_CLICK_VIDEO_MEGAPIXELS,
          })])),
      },
    );
    // A duration-driven fallback remains automatic. Keeping the replacement in
    // workflowId would make it look like an owner-selected model and prevent a
    // return to the preferred short-animation route when the length changes back.
    setWorkflowId("");
    setInputBindings({});
    setWorkflowValues({});
    setValuesRevisionId("");
    setCanvasAspectRatio(null);
    setCanvasMegapixels(null);
    const profile = videoWorkflowDurationProfile(workflow);
    const workflowNotice = replacement
      ? `${profile.label} supports up to ${videoDurationLabel(profile.maxSeconds)}. ${replacement.name} selected for ${videoDurationLabel(seconds)}.`
      : `No ready video model exposes a supported ${videoDurationLabel(seconds)} duration control.`;
    setNotice(detachedAssistedScript
      ? `${workflowNotice} Your current direction is preserved; write a new full script for this length.`
      : workflowNotice);
  };

  const chooseVideoOutputCount = (count: GenerationOutputCount) => {
    if (selectedTrustedVideoPresetId) {
      leaveTrustedVideoPreset(count === 2
        ? {
          standardDefaults: true,
          outputCount: 2,
          notice: "Standard Pair restored: Aligned + Discovery will render at the fast 5s / 0.20 MP default.",
        }
        : {
          outputCount: count,
          notice: `Fast 30s exited. ${count} normal ${count === 1 ? "version" : "versions"} selected with trusted overrides cleared.`,
        });
      return;
    }
    setOutputCount(count);
    setLocalError("");
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
      if (asset.id !== quickSourceId) detachAssistedVideoScript();
      setSelectedStoryRecommendation(undefined);
      setQuickSourceId(asset.id);
      setSourceGalleryExpanded(false);
      if (sourcePickerRef.current) sourcePickerRef.current.open = false;
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      if (intent === "train") {
        onTrain([asset.id]);
        return;
      }
      setNotice(`${asset.name} uploaded and selected; model compatibility is checked below.`);
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

  const requireHeavyRenderConfirmation = () => {
    if (trustedVideoPresetActive) return false;
    if (!heavyVideoRender || armedVideoRenderSignature.current === videoRenderSignature) return false;
    autoStartRequested.current = false;
    setHeavyRenderConfirmationOpen(true);
    setLocalError("");
    setNotice("Review and confirm this heavier local render before it enters the queue.");
    return true;
  };

  const videoPerformanceModeForSubmission = (submittedWorkflow: WorkflowDefinition) => {
    if (generationIntent !== "video") return undefined;
    const submittedParameters = canonicalGenerationPerformanceParameters(submittedWorkflow.currentRevision.parameters);
    const submittedPerformance = assessVideoPerformance({
      parameters: submittedParameters,
      models: submittedWorkflow.currentRevision.models,
      inputAssetIds: Object.values(effectiveInputBindings),
      inputArtifactIds: [],
      prompt: providerDirection,
      videoDurationSeconds,
    });
    const currentWorkload = currentVideoPerformance?.workload ?? null;
    if (JSON.stringify(submittedPerformance.workload) !== JSON.stringify(currentWorkload)) {
      throw new Error("video_performance_revision_mismatch");
    }
    if (selectedTrustedVideoPreset) {
      const trustedAssessment = assessTrustedVideoPresetExecution(submittedWorkflow, estimatedOutputCount, selectedTrustedVideoPreset);
      if (trustedAssessment.matches) return "explicit-heavy";
    }
    const mode = videoPerformanceModeForArmedConsent({
      requiresExplicitHeavy: submittedPerformance.requiresExplicitHeavy,
      currentSignature: videoRenderSignature,
      armedSignature: armedVideoRenderSignature.current,
    });
    if (!mode) throw new Error("video_heavy_mode_required");
    return mode;
  };

  const trustedVideoPresetIdForSubmission = (submittedWorkflow: WorkflowDefinition) => {
    if (generationIntent !== "video" || !selectedTrustedVideoPreset) return undefined;
    const assessment = assessTrustedVideoPresetExecution(submittedWorkflow, estimatedOutputCount, selectedTrustedVideoPreset);
    return assessment.matches ? selectedTrustedVideoPreset.id : undefined;
  };

  const clearHeavyRenderConfirmation = () => {
    armedVideoRenderSignature.current = "";
    setHeavyRenderConfirmationOpen(false);
  };

  const queueWorkflow = async (openQueueAfter = false) => {
    if (!workflow || !workflowReady) return;
    if (requireHeavyRenderConfirmation()) return;
    setLocalError("");
    if (continuityTooLarge) {
      setLocalError("This World continuity cannot fit without omitting canon. Select fewer elements, then generate again.");
      return;
    }
    if (selectedSourceCompatibilityError) {
      setLocalError(`${workflow.name} cannot use ${quickSource?.name ?? "the selected source"}. Choose a compatible model or continue without the source.`);
      return;
    }
    if (videoOperation && !effectiveVideoOperation) {
      setLocalError("Choose a retained video to extend.");
      return;
    }
    if (generationIntent === "video" && !workflowPromptParameter) {
      setLocalError("This video model does not expose a prompt, so Creative Studio cannot direct distinct outputs. Map its prompt input in Models first.");
      return;
    }
    if (generationIntent === "video" && !videoSpeechReady) {
      setLocalError(!videoSpeechFitsDuration
        ? `${videoSpeechWordCount} spoken words is too long for ${videoDurationSeconds} seconds. Keep it under ${videoSpeechWordBudget.maximum} words or choose a longer video.`
        : videoSpeechMode === "exact-script"
          ? "Add the exact words the subject should say, or choose No dialogue."
          : "Add the idea for one simple spoken line, or choose No dialogue.");
      return;
    }
    if (generationIntent === "video") {
      try {
        compileVideoSpeech(providerDirection);
      } catch (speechError) {
        setLocalError(speechError instanceof Error && speechError.message === "video_speech_prompt_too_long"
          ? "Shorten the motion prompt or spoken line so the complete model prompt stays within its safe limit."
          : "Use a short, plain spoken line, or choose No dialogue.");
        return;
      }
    }
    if (fourWayBoardRequested && !fourWayEnhancementReady) {
      setLocalError("The four-way board needs a completed local Gemma enhancement so its Enhanced version is truthful. Start the board again after Gemma is ready.");
      return;
    }
    if (outputCountSeedBlocked) {
      setLocalError(`This model does not expose its renderer seed, so Creative Studio cannot guarantee ${outputCount} distinct ${generationIntent} outputs. Choose 1${generationIntent === "video" ? " or 2" : ""}, or map the sampler seed in Models.`);
      return;
    }
    if (evolutionEnabled && (!quickSource || !workflowPromptParameter || !projectTasteMemory || !personalTaste)) {
      setLocalError(!quickSource
        ? "Choose a compatible source before generating this three-direction board."
        : !workflowPromptParameter
          ? "This model must expose a prompt before Creative Studio can create three distinct directions."
          : "Creative taste memory is still loading. Try again in a moment.");
      return;
    }
    beginCreativeSessionSubmission();
    try {
      let attemptEvolutionStudyId = evolutionStudyId;
      if (evolutionEnabled) {
        if (evolutionBatchAttemptRef.current.id !== evolutionStudyId) {
          evolutionBatchAttemptRef.current = { id: evolutionStudyId, signature: "" };
        }
        const attempt = generationBatchAttempt(
          evolutionBatchAttemptRef.current,
          generationRequestSignature,
          () => `evolve_${crypto.randomUUID()}`,
        );
        evolutionBatchAttemptRef.current = attempt;
        attemptEvolutionStudyId = attempt.id;
        if (attempt.id !== evolutionStudyId) setEvolutionStudyId(attempt.id);
      }
      let attemptVideoPairId = videoPairId;
      if (generationIntent === "video" && evolutionEnabled) {
        if (videoBatchAttemptRef.current.id !== videoPairId) {
          videoBatchAttemptRef.current = { id: videoPairId, signature: "" };
        }
        const attempt = generationBatchAttempt(
          videoBatchAttemptRef.current,
          generationRequestSignature,
          () => `video_pair_${crypto.randomUUID()}`,
        );
        videoBatchAttemptRef.current = attempt;
        attemptVideoPairId = attempt.id;
        if (attempt.id !== videoPairId) setVideoPairId(attempt.id);
      }
      let attemptOutputBatchId = outputBatchId;
      if (!evolutionEnabled && (generationIntent === "image" || generationIntent === "video")) {
        if (outputBatchAttemptRef.current.id !== outputBatchId) {
          outputBatchAttemptRef.current = { id: outputBatchId, signature: "" };
        }
        const attempt = generationBatchAttempt(
          outputBatchAttemptRef.current,
          generationRequestSignature,
          () => `output_batch_${crypto.randomUUID()}`,
        );
        outputBatchAttemptRef.current = attempt;
        attemptOutputBatchId = attempt.id;
        if (attempt.id !== outputBatchId) setOutputBatchId(attempt.id);
      }
      const videoScriptUse = generationIntent === "video" ? await prepareVideoScriptUse() : undefined;
      const dna = await ensureDna();
      if (!dna) {
        resumeCreativeSessionAutosave();
        return;
      }
      selectDna(dna);
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
            direction: authoredProjectDirection,
            dimensions: dna.shared,
            pairId: attemptVideoPairId,
            discoverySeed: generationBatchSeed(attemptEvolutionStudyId, 1),
            hasSource: Boolean(quickSource),
          })
          : null;
        let branchWorkflow = runWorkflow;
        for (const role of roles) {
          const branchDirection = evolutionBranchPrompt({
            basePrompt: authoredProjectDirection,
            role,
            canon: { identity: "", currentDirection: "" },
            personalTaste,
            projectTaste: projectTasteMemory.taste,
            dimensions: dna.shared,
            modality: generationIntent,
          });
          const branchPrompt = appendContinuity(branchDirection);
          const assistedSpokenText = videoScriptUse?.scriptFormat === "dialogue-v1"
            ? videoScriptUse.appliedScript
            : videoScriptUse?.appliedSpokenText ?? undefined;
          const compiledSpeech = generationIntent === "video" ? compileVideoSpeech(branchPrompt, assistedSpokenText) : null;
          const prompt = compiledSpeech?.prompt ?? branchPrompt;
          const values: Record<string, WorkflowScalar> = Object.fromEntries(workflowPromptParameters.map((parameter) => [parameter.id, prompt]));
          const variant = generationIntent === "video"
            ? role === "discovery" ? videoVersions?.[1].variant : videoVersions?.[0].variant
            : undefined;
          if (workflowSeedParameter && variant?.seed !== null && variant?.seed !== undefined) values[workflowSeedParameter.id] = variant.seed;
          branchWorkflow = await saveWorkflowRevision(branchWorkflow.id, branchWorkflow.currentRevision.id, values);
          const evolution: EvolutionJobContext = {
            schemaVersion: "creative-studio-evolution-request/1.0",
            studyId: attemptEvolutionStudyId,
            role,
            sourceId: quickSource.id,
            source: quickSource.source,
          };
          await submitWorkflowJob({
            workflow: branchWorkflow,
            inputBindings: effectiveInputBindings,
            expectedPrompt: prompt,
            dnaArtifactId: dna.artifactId,
            videoOperation: effectiveVideoOperation ?? undefined,
            performanceMode: generationIntent === "image" ? imagePerformanceMode : undefined,
            videoPerformanceMode: videoPerformanceModeForSubmission(branchWorkflow),
            trustedVideoPresetId: trustedVideoPresetIdForSubmission(branchWorkflow),
            videoVariant: variant,
            videoSpeech: compiledSpeech?.speech,
            videoScript: videoScriptUse,
            evolution,
            videoDurationSeconds: generationIntent === "video" ? videoDurationSeconds : undefined,
            idempotencyKey: generationBatchIdempotencyKey(attemptEvolutionStudyId, role),
            continuity: continuitySelection,
            promptEnhancement: promptEnhancementApplication(prompt),
            storyRecommendation: selectedStoryRecommendation,
          });
        }
        setValuesRevisionId(branchWorkflow.currentRevision.id);
        setWorkflowValues(Object.fromEntries(branchWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
        setNotice("Refine, Correct, and Discovery queued as one durable evolution study. Review the three retained branches together in Artifacts.");
        const nextEvolutionStudyId = `evolve_${crypto.randomUUID()}`;
        const nextVideoPairId = `video_pair_${crypto.randomUUID()}`;
        evolutionBatchAttemptRef.current = { id: nextEvolutionStudyId, signature: "" };
        videoBatchAttemptRef.current = { id: nextVideoPairId, signature: "" };
        setEvolutionStudyId(nextEvolutionStudyId);
        setVideoPairId(nextVideoPairId);
        clearHeavyRenderConfirmation();
        completeCreativeSession();
        if (openQueueAfter) onQueued();
        return;
      }
      if (generationIntent === "video" && workflowPromptParameter) {
        const videoOutputs = outputCount === 4
          ? createFourWayVideoGenerationVersions({
            exactPrompt: exactAuthoredVideoDirection,
            enhancedPrompt: authoredProjectDirection,
            dimensions: dna.shared,
            pairId: videoPairIdForOutputBatch(attemptOutputBatchId, "board"),
            boardSeed: generationBatchSeed(attemptOutputBatchId, 0),
            hasSource: Boolean(quickSource),
          })
          : Array.from({ length: Math.ceil(outputCount / 2) }, (_, pairIndex) => createVideoGenerationVersions({
            direction: authoredProjectDirection,
            dimensions: dna.shared,
            pairId: videoPairIdForOutputBatch(attemptOutputBatchId, pairIndex + 1),
            discoverySeed: generationBatchSeed(attemptOutputBatchId, pairIndex * 2 + 1),
            hasSource: Boolean(quickSource),
          })).flat().slice(0, outputCount);
        let outputWorkflow = runWorkflow;
        const videoJobs: SubmitWorkflowJobInput[] = [];
        for (let index = 0; index < videoOutputs.length; index += 1) {
          const output = videoOutputs[index];
          const assistedSpokenText = videoScriptUse?.scriptFormat === "dialogue-v1"
            ? videoScriptUse.appliedScript
            : videoScriptUse?.appliedSpokenText ?? undefined;
          const compiledSpeech = compileVideoSpeech(appendContinuity(output.prompt), assistedSpokenText);
          const prompt = compiledSpeech.prompt;
          const values: Record<string, WorkflowScalar> = Object.fromEntries(workflowPromptParameters.map((parameter) => [parameter.id, prompt]));
          if (workflowSeedParameters.length && (outputCount === 4 || output.variant.seed !== null)) {
            workflowSeedParameters.forEach((parameter, seedIndex) => {
              values[parameter.id] = seedIndex === 0 && outputCount !== 4 && output.variant.seed !== null
                ? output.variant.seed
                : generationBatchSeed(attemptOutputBatchId, 100 + index * workflowSeedParameters.length + seedIndex);
            });
          }
          const mustSaveOutputRevision = Object.entries(values).some(([id, value]) => {
            const parameter = outputWorkflow.currentRevision.parameters.find((item) => item.id === id);
            return !parameter || !sameWorkflowValue(parameter.value, value);
          });
          if (mustSaveOutputRevision) {
            outputWorkflow = await saveWorkflowRevision(outputWorkflow.id, outputWorkflow.currentRevision.id, values);
          }
          videoJobs.push({
            workflow: outputWorkflow,
            inputBindings: effectiveInputBindings,
            expectedPrompt: prompt,
            dnaArtifactId: dna.artifactId,
            videoOperation: effectiveVideoOperation ?? undefined,
            videoPerformanceMode: videoPerformanceModeForSubmission(outputWorkflow),
            trustedVideoPresetId: trustedVideoPresetIdForSubmission(outputWorkflow),
            videoVariant: output.variant,
            videoSpeech: compiledSpeech.speech,
            videoScript: videoScriptUse,
            videoDurationSeconds,
            idempotencyKey: generationBatchIdempotencyKey(attemptOutputBatchId, `output_${index + 1}`),
            outputBatch: {
              schemaVersion: "creative-studio-output-batch/1.0",
              batchId: attemptOutputBatchId,
              index: index + 1,
              count: outputCount,
            },
            continuity: continuitySelection,
            promptEnhancement: outputCount === 4 && output.variant.role !== "enhanced"
              ? undefined
              : promptEnhancementApplication(prompt),
            storyRecommendation: selectedStoryRecommendation,
          });
        }
        const batchResult = videoJobs.length > 1
          ? await submitWorkflowBatch({ batchId: attemptOutputBatchId, jobs: videoJobs })
          : null;
        if (!batchResult) await submitWorkflowJob(videoJobs[0]!);
        setValuesRevisionId(outputWorkflow.currentRevision.id);
        setWorkflowValues(Object.fromEntries(outputWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
        setNotice(batchResult?.batch.status === "waiting"
          ? `${batchResult.batch.completedLanes} of ${batchResult.batch.laneCount} video jobs were created immediately. The durable set is saved and Local Runner will resume every missing version automatically.`
          : outputCount === 4
            ? "Exact, Enhanced, Left Field, and Awe are queued as four durable videos with separate prompt, seed, speech, and settings evidence."
            : `${outputCount} durable video ${outputCount === 1 ? "job" : "jobs"} queued${outputCount > 1 ? " as one resumable Aligned + Discovery set" : ""}. They will render one after another on the Local Runner.`);
        const nextOutputBatchId = `output_batch_${crypto.randomUUID()}`;
        outputBatchAttemptRef.current = { id: nextOutputBatchId, signature: "" };
        setOutputBatchId(nextOutputBatchId);
        clearHeavyRenderConfirmation();
        completeCreativeSession();
        if (openQueueAfter) onQueued();
        return;
      }
      let outputWorkflow = runWorkflow;
      const outputJobs: SubmitWorkflowJobInput[] = [];
      for (let index = 0; index < outputCount; index += 1) {
        if (generationIntent === "image" && outputCount > 1 && workflowSeedParameters.length) {
          outputWorkflow = await saveWorkflowRevision(outputWorkflow.id, outputWorkflow.currentRevision.id, Object.fromEntries(
            workflowSeedParameters.map((parameter, seedIndex) => [
              parameter.id,
              generationBatchSeed(attemptOutputBatchId, index * workflowSeedParameters.length + seedIndex),
            ]),
          ));
        }
        const outputJob: SubmitWorkflowJobInput = {
          workflow: outputWorkflow,
          inputBindings: effectiveInputBindings,
          expectedPrompt: providerDirection,
          dnaArtifactId: dna.artifactId,
          performanceMode: generationIntent === "image" ? imagePerformanceMode : undefined,
          videoPerformanceMode: videoPerformanceModeForSubmission(outputWorkflow),
          trustedVideoPresetId: trustedVideoPresetIdForSubmission(outputWorkflow),
          idempotencyKey: generationBatchIdempotencyKey(attemptOutputBatchId, `output_${index + 1}`),
          outputBatch: generationIntent === "image" ? {
            schemaVersion: "creative-studio-output-batch/1.0",
            batchId: attemptOutputBatchId,
            index: index + 1,
            count: outputCount,
          } : undefined,
          promptReference,
          continuity: continuitySelection,
          storyRecommendation: selectedStoryRecommendation,
        };
        if (generationIntent === "image" && outputCount > 1) outputJobs.push(outputJob);
        else await submitWorkflowJob(outputJob);
      }
      const batchResult = outputJobs.length
        ? await submitWorkflowBatch({ batchId: attemptOutputBatchId, jobs: outputJobs })
        : null;
      setValuesRevisionId(outputWorkflow.currentRevision.id);
      setWorkflowValues(Object.fromEntries(outputWorkflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
      setNotice(batchResult?.batch.status === "waiting"
        ? `${batchResult.batch.completedLanes} of ${batchResult.batch.laneCount} image jobs were created immediately. The durable set is saved and Local Runner will resume every missing version automatically.`
        : `${outputCount} durable ${generationIntent === "music" ? "song" : generationIntent} ${outputCount === 1 ? "job" : "jobs"} queued${outputCount > 1 ? " with distinct retained seeds" : ""}. You can keep creating while they run.`);
      const nextOutputBatchId = `output_batch_${crypto.randomUUID()}`;
      outputBatchAttemptRef.current = { id: nextOutputBatchId, signature: "" };
      setOutputBatchId(nextOutputBatchId);
      completeCreativeSession();
      if (openQueueAfter) onQueued();
    } catch (queueError) {
      resumeCreativeSessionAutosave();
      if (queueError instanceof Error && queueError.message.startsWith("video_script")) {
        setLocalError(queueError.message === "video_script_context_mismatch"
          ? "This full script was written for a different model, source, or video length. Write it again for the current setup."
          : videoScriptErrorMessage(queueError));
      }
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
    if (outputCount === 4 && outputCountSeedBlocked) {
      stopAutoStart("This model does not expose a renderer seed, so Creative Studio cannot guarantee four distinct videos. Map the sampler seed in Models, then tap Animate 4 ways again.");
      return;
    }
    if (!directionReady || !workflowPromptParameter) {
      stopAutoStart(`The selected video model must expose a prompt input before one-click Animate can create ${outputCount === 4 ? "the four-way board" : "two distinct versions"}.`);
      return;
    }
    if (!videoSpeechReady) {
      stopAutoStart("Add the spoken line or choose No dialogue before creating the video board.");
      return;
    }
    if (outputCount === 4 && !fourWayEnhancementReady) {
      if (!promptEnhancementAvailable) {
        stopAutoStart("The four-way board needs Local Gemma for its Enhanced version. Start the Local Runner and ComfyUI, then tap Animate 4 ways again.");
        return;
      }
      if (activePromptEnhancement?.status === "failed") {
        stopAutoStart(`Gemma could not prepare the Enhanced version${activePromptEnhancement.error ? `: ${activePromptEnhancement.error}` : "."} Your image and exact prompt are unchanged.`);
        return;
      }
      const completedEnhancementDecision = directVideoEnhancementDecision({
        completed: activePromptEnhancement?.status === "completed",
        contextMatches: promptEnhancementMatchesWorkflow,
        sourcePrompt: activePromptEnhancement?.sourcePrompt ?? "",
        enhancedPrompt: activePromptEnhancement?.enhancedPrompt,
        currentPrompt: direction,
      });
      if (completedEnhancementDecision === "apply" && activePromptEnhancement?.enhancedPrompt) {
        const completedEnhancement = activePromptEnhancement;
        void Promise.resolve().then(() => {
          setOriginalVideoDirection((current) => current ?? completedEnhancement.sourcePrompt);
          setDirection(completedEnhancement.enhancedPrompt!);
          setAppliedPromptEnhancementId(completedEnhancement.id);
          setNotice("Gemma 4 enhancement applied. Preparing the four-way video board now.");
        });
        return;
      }
      if (completedEnhancementDecision === "stop-edited") {
        stopAutoStart("Gemma finished the four-way enhancement, but your prompt changed while it was running. Your edit was kept. Use the enhanced prompt, or enhance your edited prompt again.");
        return;
      }
      if (!promptEnhancementPending && !autoEnhancementAttempted.current) {
        autoEnhancementAttempted.current = true;
        void requestVideoPromptEnhancementRef.current();
      }
      return;
    }
    autoStartRequested.current = false;
    void queueWorkflowRef.current(true);
  }, [activePromptEnhancement, busy, direction, directionReady, fourWayEnhancementReady, outputCount, outputCountSeedBlocked, promptEnhancementAvailable, promptEnhancementMatchesWorkflow, promptEnhancementPending, snapshot, uiOnlyDevelopment, videoSpeechReady, workflow, workflowPromptParameter, workflowReady]);

  const startWorkflowGeneration = async () => {
    if (requireHeavyRenderConfirmation()) return;
    if (!fourWayBoardRequested || fourWayEnhancementReady) {
      await queueWorkflow();
      return;
    }
    setLocalError("");
    if (!promptEnhancementAvailable) {
      setLocalError("The four-way board needs Local Gemma for its Enhanced version. Start the Local Runner and ComfyUI, then try again.");
      return;
    }
    if (!videoSpeechReady) {
      setLocalError(videoSpeechMode === "exact-script"
        ? "Add the exact words the subject should say, or choose No dialogue."
        : "Add the idea for one simple spoken line, or choose No dialogue.");
      return;
    }
    autoStartRequested.current = true;
    autoEnhancementAttempted.current = false;
    const completedEnhancementDecision = directVideoEnhancementDecision({
      completed: activePromptEnhancement?.status === "completed",
      contextMatches: promptEnhancementMatchesWorkflow,
      sourcePrompt: activePromptEnhancement?.sourcePrompt ?? "",
      enhancedPrompt: activePromptEnhancement?.enhancedPrompt,
      currentPrompt: direction,
    });
    if (completedEnhancementDecision === "apply") {
      applyCompletedVideoPromptEnhancement();
      return;
    }
    if (completedEnhancementDecision === "stop-edited") {
      autoStartRequested.current = false;
      setLocalError("Gemma finished the four-way enhancement, but your prompt changed while it was running. Your edit was kept. Use the enhanced prompt, or enhance your edited prompt again.");
      return;
    }
    if (!promptEnhancementPending) {
      autoEnhancementAttempted.current = true;
      await requestVideoPromptEnhancement();
    }
  };

  const submitRemote = async () => {
    if (generationIntent === "video") return;
    setLocalError("");
    beginCreativeSessionSubmission();
    try {
      const dna = await ensureDna();
      if (!dna) {
        resumeCreativeSessionAutosave();
        return;
      }
      selectDna(dna);
      await submitAfdfwJob(generationIntent, dna.artifactId);
      setNotice(`Optional AFDFW ${generationIntent} job queued.`);
      completeCreativeSession();
    } catch {
      resumeCreativeSessionAutosave();
      // The provider exposes a normalized visible error.
    }
  };

  const submitDevelopmentPreview = async () => {
    if (generationIntent === "video") return;
    setLocalError("");
    beginCreativeSessionSubmission();
    try {
      const dna = await ensureDna();
      if (!dna) {
        resumeCreativeSessionAutosave();
        return;
      }
      selectDna(dna);
      await submitDevelopmentPreviewJob(generationIntent, dna.artifactId);
      setNotice(`Development ${generationIntent} preview queued. This is simulated media.`);
      completeCreativeSession();
    } catch {
      resumeCreativeSessionAutosave();
      // The provider exposes a normalized visible error.
    }
  };

  const sourceRequirement = missingMediaParameters[0]?.mediaKind;
  const generationLabel = generationIntent === "music" ? "song" : generationIntent;
  const countedGenerationLabel = outputCount === 1 ? generationLabel : `${outputCount} ${generationLabel}s`;
  const scoutReady = generationGoal !== "scout" || generationGoalCanScout(generationIntent, quickSource?.kind ?? null);
  const evolutionReady = !evolutionEnabled || Boolean(quickSource && workflowPromptParameter && projectTasteMemory && personalTaste);
  const generationBlocker: { message: string; action: "controls" | "direction" | "models" | "outputs" | "source" | null; actionLabel?: string } | null = uiOnlyDevelopment
    ? { message: "Real generation needs the Creative Studio Worker. The labeled simulated preview remains available below for UI testing only.", action: null }
    : !workflow
      ? { message: `No ready ${generationLabel} model is connected.`, action: "models", actionLabel: "Models" }
      : !directionReady
        ? { message: `Describe the ${generationLabel} in at least a few words.`, action: "direction", actionLabel: "Write prompt" }
        : selectedSourceCompatibilityError
          ? { message: `${workflow.name} cannot use this source. Choose another source or continue without it.`, action: "source", actionLabel: "Choose source" }
          : !workflowReady
            ? { message: `This model still needs a ${sourceRequirement ?? "source"}.`, action: "source", actionLabel: "Choose source" }
            : !scoutReady
              ? { message: "Scout Board needs one retained image as its starting point.", action: "source", actionLabel: "Choose image" }
              : !evolutionReady
                ? { message: "Evolution needs a retained source plus reviewed project and personal taste evidence.", action: "controls", actionLabel: "Review setup" }
                : !videoSpeechReady
                  ? { message: videoSpeechText.trim() ? `Shorten the spoken line to ${videoSpeechWordBudget.maximum} words for this clip.` : "Add the spoken words, or choose No dialogue while keeping sound on.", action: "controls", actionLabel: "Review sound" }
                  : fastImageBlocked
                    ? { message: "These restored image settings exceed Fast mode. Choose Custom only if you accept the longer render.", action: "controls", actionLabel: "Review speed" }
                    : outputCountSeedBlocked
                      ? { message: "This model needs a mapped sampler seed for distinct versions. Choose one version or update the model.", action: "outputs", actionLabel: "Use one" }
                      : continuityTooLarge
                        ? { message: "The selected World continuity is too large for one prompt. Select fewer characters, places, or rules.", action: "controls", actionLabel: "Narrow World" }
                        : generationIntent === "video" && !workflowPromptParameter
                          ? { message: "This video model has no mapped prompt input. Repair its model mapping before generation.", action: "models", actionLabel: "Models" }
                          : null;
  const resolveGenerationBlocker = () => {
    if (!generationBlocker?.action) return;
    if (generationBlocker.action === "models") {
      onWorkflows();
      return;
    }
    if (generationBlocker.action === "direction") {
      document.getElementById("creative-studio-direction")?.focus();
      return;
    }
    if (generationBlocker.action === "source") {
      if (sourcePickerRef.current) {
        sourcePickerRef.current.open = true;
        sourcePickerRef.current.scrollIntoView({ block: "nearest" });
      }
      return;
    }
    if (generationBlocker.action === "outputs") {
      setOutputCount(1);
      setLocalError("");
      return;
    }
    setCreativeToolsOpen(true);
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(videoSpeechReady
        ? continuityTooLarge ? ".quick-world-continuity button:not(:disabled)" : fastImageBlocked ? ".quick-speed-panel > summary" : ".quick-generation-goal-options button:not(:disabled)"
        : ".quick-video-speech button:not(:disabled)");
      target?.scrollIntoView({ block: "nearest" });
      target?.focus({ preventScroll: true });
    });
  };
  const basePrimaryLabel = !workflow
    ? "Choose a model"
    : selectedSourceCompatibilityError
      ? "Resolve source or model"
    : !workflowReady
      ? `Choose ${sourceRequirement ?? "source"}`
      : evolutionEnabled
        ? generationGoal === "scout" ? generationGoalRunLabel(generationGoal, generationIntent) : `Generate 3 ${generationLabel} branches`
      : fourWayBoardRequested
        ? settingsChanged ? "Save & generate 4-way board" : "Generate 4-way video board"
      : settingsChanged
        ? effectiveVideoOperation ? `Save & extend ${outputCount} ${outputCount === 1 ? "version" : "versions"}` : `Save & generate ${countedGenerationLabel}`
        : effectiveVideoOperation
          ? `Extend into ${outputCount} ${outputCount === 1 ? "version" : "versions"}`
          : `Generate ${countedGenerationLabel}`;
  const primaryLabel = generationIntent === "image" && workflow
    ? `${basePrimaryLabel}${imagePerformanceMode === "fast-default" ? " · fast" : imagePerformance?.requiresExplicitCustom ? " · can be slow" : " · custom"}`
    : generationIntent === "music" && workflow
      ? `${basePrimaryLabel} · model-tuned`
      : generationIntent === "video" && workflow
        ? trustedVideoPresetActive
          ? `${basePrimaryLabel} · trusted 30s`
          : `${basePrimaryLabel} · ${videoDurationLabel(videoDurationSeconds)}${estimatedOutputCount > 1 ? " each" : ""}`
      : basePrimaryLabel;
  const sourcePickerLabel = videoOperation ? "Video to extend" : intent === "music" ? "Artwork inspiration" : intent === "train" ? "Training source" : "Use retained work";
  const uploadSourceLabel = intent === "train" ? "Upload training media" : videoOperation ? "Upload video" : intent === "music" ? "Upload artwork" : "Upload new";
  const trustedPresetEvidence = TRUSTED_LTX_25_I2V_PORTRAIT_30S.evidence;
  const trustedSimulationWinner = thirtySecondSimulations[0] ?? null;
  const compactEstimate = trustedVideoPresetActive
    ? `Median ${formatGenerationDuration(trustedPresetEvidence.medianMs)} · 1 local render`
    : runtimeEstimate && runtimeEvidence
    ? `${durationRange(runtimeEstimate.perOutputLowMs, runtimeEstimate.perOutputHighMs)}${estimatedOutputCount > 1 ? ` each / ${durationRange(runtimeEstimate.totalLowMs, runtimeEstimate.totalHighMs)} total` : ""}`
    : "Estimate after first run";
  const compactSettings = [
    generationIntent === "video" ? videoDurationLabel(videoDurationSeconds) : null,
    displayedAspectRatio,
    displayedMegapixels ? `${displayedMegapixels.toFixed(displayedMegapixels < 1 ? 2 : 1)} MP` : null,
    trustedVideoPresetActive ? "Runtime trusted" : null,
    generationIntent === "image" ? imagePerformanceMode === "fast-default" ? "Fast" : "Custom" : null,
  ].filter(Boolean) as string[];
  const videoResolutionSummary = workflowWorkload?.width && workflowWorkload.height
    ? `${Math.round(workflowWorkload.width)}x${Math.round(workflowWorkload.height)} / ${displayedMegapixels?.toFixed(2) ?? "?"} MP`
    : displayedMegapixels !== null ? `${displayedMegapixels.toFixed(2)} MP` : "Not exposed by model";
  const videoFrameSummary = videoFrameCount !== null
    ? `${videoFrameCount.toLocaleString()}${exposedVideoFps ? ` @ ${exposedVideoFps} fps` : ""}`
    : exposedVideoFps ? `${exposedVideoFps} fps / frame total not exposed` : "Not exposed by model";
  const heavyRenderTimeSummary = trustedVideoPresetActive
    ? `Measured median ${formatGenerationDuration(trustedPresetEvidence.medianMs)} · observed ${durationRange(trustedPresetEvidence.fastestMs, trustedPresetEvidence.slowestMs)}`
    : runtimeEstimate && runtimeEvidence
    ? `${durationRange(runtimeEstimate.perOutputLowMs, runtimeEstimate.perOutputHighMs)} each / ${durationRange(runtimeEstimate.totalLowMs, runtimeEstimate.totalHighMs)} total`
    : "No measured estimate yet; the first retained run will teach Creative Studio";
  const consentedAudioCount = projectMedia.filter((asset) => asset.kind === "audio" && asset.trainingEligible).length;
  const promptEnhancementApplied = Boolean(appliedPromptEnhancement && appliedPromptEnhancementId === appliedPromptEnhancement.id);
  const promptEnhancementContextChanged = promptEnhancementApplied && !appliedPromptEnhancementMatchesContext;
  const promptEnhancementButtonLabel = !promptEnhancementAvailable
    ? "Local Gemma offline"
    : promptEnhancementPending
      ? activePromptEnhancement?.status === "running" ? "Enhancing…" : "Waiting for Gemma…"
      : activePromptEnhancement?.status === "failed"
        ? "Try again"
        : promptEnhancementApplied ? "Enhance again" : "Enhance prompt";
  const promptEnhancementButtonTitle = !promptEnhancementAvailable
    ? promptEnhancementCapability?.detail ?? "Start the Local Runner and ComfyUI to enhance with Gemma 4."
    : !directionReady ? "Write a motion direction first." : undefined;
  const videoScriptApplied = Boolean(appliedVideoScriptDraftId && appliedVideoScriptDraft);
  const videoScriptContextChanged = videoScriptApplied && !appliedVideoScriptMatchesContext;
  const appliedFullVideoScriptDraft = appliedVideoScriptDraft?.scriptFormat === "full-script-v2" ? appliedVideoScriptDraft : null;
  const appliedFullScriptEdited = Boolean(appliedFullVideoScriptDraft && (
    direction.trim() !== appliedFullVideoScriptDraft.currentScript?.trim()
    || (videoSpeechMode === "exact-script" ? videoSpeechText.trim() : "") !== (appliedFullVideoScriptDraft.currentSpokenText ?? "")
    || videoSpeechMode === "short-natural-line"
  ));
  const videoScriptButtonLabel = videoScriptPending
    ? activeVideoScriptDraft?.status === "running" ? "Writing…" : "Waiting…"
    : activeFullVideoScriptDraft?.status === "completed" && appliedVideoScriptDraftId !== activeFullVideoScriptDraft.id
      ? "Review full script"
      : "Write full script";
  const videoScriptStatus = videoScriptPending
    ? "Local Gemma is writing the full scene"
    : activeVideoScriptDraft?.status === "failed"
      ? "Full script failed · your direction is safe"
      : videoScriptContextChanged
        ? "Model, source, or length changed · write this script again"
        : appliedFullVideoScriptDraft
          ? appliedFullScriptEdited
            ? "Full script edited after Gemma"
            : `Full script applied · ${appliedFullVideoScriptDraft.currentSpokenText ? `${appliedFullVideoScriptDraft.currentSpokenText.split(/\s+/).filter(Boolean).length} spoken words` : "no dialogue"}`
          : videoScriptApplied && videoSpeechMode === "exact-script"
            ? videoSpeechText.trim() === appliedVideoScriptDraft?.currentScript?.trim()
              ? "Legacy Gemma dialogue applied"
              : "Edited after Local Gemma"
            : "";

  return (
    <section className={`generation-section create-surface quick-create${embedded ? " embedded" : " fade-up"}`} id="creative-dna-generation" aria-label="Create with Creative Studio">
      {activeJobs.length ? <button className="create-active-queue" onClick={onQueued}><StatusDot status={activeJobs[0].status} /><span><strong>{activeJobs.length} active {activeJobs.length === 1 ? "job" : "jobs"}</strong><small>View queue</small></span><Icon name="chevron" size={15} /></button> : null}

      <div className="quick-intents" role="group" aria-label="What do you want to make?">
        {INTENTS.map((item) => <button key={item.id} className={intent === item.id ? "on" : ""} aria-pressed={intent === item.id} onClick={() => chooseIntent(item.id)}><Icon name={item.icon} size={18} /><span>{item.label}</span></button>)}
      </div>

      <section className={`quick-create-card simple-create glass${generationIntent === "video" ? " video-create" : ""}${creativeToolsOpen ? " power-open" : ""}`}>
        <div className="quick-create-head">
          <div className={`create-output-icon ${intent}`}><Icon name={intent === "train" ? "dna" : intent} size={22} /></div>
          <div><span className="eyebrow">{intent === "train" ? "Learn from your work" : videoOperation ? "Continue retained motion" : `New ${intent === "music" ? "song" : intent}`}</span><h2>{intent === "train" ? "Train music or analyze DNA" : videoOperation ? "Extend video" : "Create"}</h2></div>
          {intent !== "train" ? <em className={runnerOnline ? "online" : "offline"}>{runnerOnline ? "Runner online" : "Will wait for runner"}</em> : null}
        </div>

        {intent !== "train" ? <section
          className={`quick-create-stage${quickSource ? " has-source" : " is-empty"}`}
          aria-label="Create canvas"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = busy || uiOnlyDevelopment ? "none" : "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (busy || uiOnlyDevelopment) return;
            void uploadAndUseMedia(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <div className={`quick-create-stage-media${quickSource ? ` ${quickSource.kind}` : ""}`} style={quickSource ? { background: `linear-gradient(135deg, ${quickSource.colors[0]}, ${quickSource.colors[1]})` } : undefined}>
            {quickSource?.kind === "image" && quickSource.previewUrl ? <img src={quickSource.previewUrl} alt={`${quickSource.name} source`} decoding="async" /> : null}
            {quickSource?.kind === "video" && quickSource.previewUrl ? <video key={quickSource.id} src={quickSource.previewUrl} poster={quickSource.posterUrl ?? undefined} controls playsInline preload="metadata" aria-label={`${quickSource.name} source video`} /> : null}
            {quickSource?.kind === "audio" && quickSource.previewUrl ? <div className="quick-create-stage-audio"><span><Icon name="music" size={34} /></span><strong>{quickSource.name}</strong><audio key={quickSource.id} src={quickSource.previewUrl} controls preload="none" aria-label={`${quickSource.name} source audio`} /></div> : null}
            {quickSource && !quickSource.previewUrl ? <div className="quick-create-stage-fallback"><QuickSourceVisual source={quickSource} /><strong>{quickSource.name}</strong></div> : null}
            {!quickSource ? <div className="quick-create-stage-empty"><span><Icon name={generationIntent === "music" ? "music" : generationIntent} size={30} /></span><strong>Drop in a spark—or start with words</strong><small>{uiOnlyDevelopment ? "Choose retained work or write the idea below. Uploads need the Creative Studio Worker." : "Upload, choose retained work, or write the idea below. Creative Studio handles the model."}</small></div> : null}
            <span className="quick-create-stage-kind"><Icon name={quickSource?.kind === "audio" ? "music" : quickSource?.kind ?? generationIntent} size={13} />{quickSource ? `${quickSource.source === "upload" ? "Uploaded" : "Generated"} ${quickSource.kind}` : "Prompt only is ready"}</span>
          </div>
          <footer>
            <span><small>{quickSource ? "STARTING POINT" : "OPTIONAL SOURCE"}</small><strong>{quickSource?.name ?? "Your next idea"}</strong></span>
            <div>
              {quickSource ? <button type="button" className="btn btn-ghost stage-remove" disabled={busy} onClick={() => { detachAssistedVideoScript(); setSelectedStoryRecommendation(undefined); setQuickSourceId(""); setInputBindings({}); setLocalError(""); }}><Icon name="close" size={14} /> Remove</button> : null}
              <button type="button" className="btn btn-ghost stage-change" disabled={busy} onClick={() => { if (!sourcePickerRef.current) return; sourcePickerRef.current.open = true; sourcePickerRef.current.scrollIntoView({ block: "nearest" }); }}><Icon name="library" size={14} /> {quickSource ? "Change" : "Retained work"}</button>
              <button type="button" className="btn btn-primary stage-upload" disabled={busy || uiOnlyDevelopment} onClick={() => mediaInputRef.current?.click()}><Icon name="plus" size={14} /> Upload</button>
            </div>
          </footer>
        </section> : null}

        <details ref={sourcePickerRef} className="quick-compose-panel quick-compose-source">
          <summary>
            <span className={`quick-compose-preview${quickSource ? ` ${quickSource.kind}` : " empty"}`} style={quickSource ? { background: `linear-gradient(135deg, ${quickSource.colors[0]}, ${quickSource.colors[1]})` } : undefined}>{quickSource ? <QuickSourceVisual source={quickSource} /> : <Icon name="plus" size={18} />}</span>
            <span className="quick-compose-summary-copy"><small>Source</small><strong>{quickSource?.name ?? (intent === "train" ? "Choose media" : "Prompt only")}</strong><em>{quickSource ? `${quickSource.source === "upload" ? "Upload" : "Generated"} / ${quickSource.kind}` : `${sourceChoices.length} retained available`}</em></span>
            <span className="quick-compose-change">{quickSource ? "Change" : "Choose"}</span><Icon name="chevronDown" size={14} />
          </summary>
          <div className="quick-compose-panel-body">
            <section className={`quick-source-gallery${sourceGalleryExpanded ? " expanded" : ""}`} aria-label={sourcePickerLabel}>
              <header><span><strong>{sourcePickerLabel}</strong><small>{quickSource ? quickSource.name : `${sourceChoices.length} compatible retained`}</small></span>{sourceChoices.length > SOURCE_GALLERY_LIMIT ? <button type="button" className="link-btn" disabled={busy} onClick={() => setSourceGalleryExpanded((current) => !current)}>{sourceGalleryExpanded ? "Show newest" : `View all ${sourceChoices.length}`}</button> : null}</header>
              <div className="quick-source-gallery-grid" role="group" aria-label={`${sourcePickerLabel} gallery`}>
                <label className={`quick-source-card quick-source-upload${uiOnlyDevelopment ? " disabled" : ""}`}>
                  <input ref={mediaInputRef} type="file" aria-label={uploadSourceLabel} accept={videoOperation ? "video/mp4,video/webm,video/quicktime" : intent === "music" ? ACCEPTED_ART : ACCEPTED_MEDIA} disabled={busy || uiOnlyDevelopment} onChange={(event) => void uploadAndUseMedia(event.target.files?.[0] ?? null)} />
                  <span className="quick-source-visual"><Icon name="plus" size={22} /></span>
                  <span className="quick-source-copy"><strong>{busy ? "Working…" : uploadSourceLabel}</strong><small>{uiOnlyDevelopment ? "Worker required" : "From this device"}</small></span>
                </label>
                {intent !== "train" ? <button type="button" className={`quick-source-card quick-source-none${quickSource ? "" : " on"}`} aria-label="Use no retained source" aria-pressed={!quickSource} disabled={busy} onClick={() => { if (quickSourceId) detachAssistedVideoScript(); setSelectedStoryRecommendation(undefined); setQuickSourceId(""); setInputBindings({}); setSourceGalleryExpanded(false); if (sourcePickerRef.current) sourcePickerRef.current.open = false; }}>
                  <span className="quick-source-visual"><Icon name="generate" size={22} /></span>
                  <span className="quick-source-copy"><strong>No source</strong><small>Start from prompt</small></span>
                  {!quickSource ? <span className="quick-source-selected"><Icon name="check" size={11} /></span> : null}
                </button> : null}
                {visibleSourceChoices.map((source) => <button type="button" key={source.id} className={`quick-source-card${quickSource?.id === source.id ? " on" : ""}`} aria-label={`Use ${source.name} ${source.source === "upload" ? "upload" : "generated work"}`} aria-pressed={quickSource?.id === source.id} disabled={busy} onClick={() => { if (source.id !== quickSourceId) { detachAssistedVideoScript(); setSelectedStoryRecommendation(undefined); } setQuickSourceId(source.id); setInputBindings({}); setSourceGalleryExpanded(false); if (sourcePickerRef.current) sourcePickerRef.current.open = false; }}>
                  <span className={`quick-source-visual ${source.kind}`} style={{ background: `linear-gradient(135deg, ${source.colors[0]}, ${source.colors[1]})` }}><QuickSourceVisual source={source} /><span className="quick-source-kind"><Icon name={source.kind === "audio" ? "music" : source.kind} size={11} /></span></span>
                  <span className="quick-source-copy"><strong>{source.name}</strong><small>{source.source === "upload" ? "Upload" : "Generated"} · {source.kind}</small></span>
                  {quickSource?.id === source.id ? <span className="quick-source-selected"><Icon name="check" size={11} /></span> : null}
                </button>)}
              </div>
              <button type="button" className="link-btn quick-source-library" onClick={onMedia}>Open full media library</button>
            </section>
          </div>
        </details>
        {selectedSourceCompatibilityError ? <div className="quick-source-conflict" role="alert"><Icon name="shield" size={16} /><span><strong>{workflow?.name} cannot use {quickSource?.name}.</strong><small>Choose a compatible model or continue without this source. Creative Studio will not silently drop it.</small></span><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { detachAssistedVideoScript(); setSelectedStoryRecommendation(undefined); setQuickSourceId(""); setInputBindings({}); setLocalError(""); setNotice("Continuing without a source."); }}>Continue without source</button></div> : null}

        {intent === "train" ? <div className="quick-training-paths" role="group" aria-label="Choose how Creative Studio learns">
          <button type="button" disabled={busy} onClick={() => onTrain(trainingSource ? [trainingSource.id] : [], "analyze")}><span><Icon name="image" size={19} /></span><strong>Analyze media</strong><small>Describe files and evolve a reviewable CreativeDNA version.</small><em>{trainingSource ? `Use ${trainingSource.name}` : "Images, audio, or video"}</em></button>
          <button type="button" disabled={busy} onClick={() => onTrain([], "model")}><span><Icon name="music" size={19} /></span><strong>Train music LoRA</strong><small>Train real ACE-Step weights from consented recordings.</small><em>{consentedAudioCount >= 3 ? `${consentedAudioCount} tracks ready` : `${3 - consentedAudioCount} more tracks needed`}</em></button>
        </div> : <>
          <div className="quick-direction">
            <div className="quick-direction-head">
              <label htmlFor="creative-studio-direction">{intent === "music" ? "Describe the song" : videoOperation ? "Describe what happens next" : intent === "video" ? "Describe the video" : "Describe the image"}</label>
              {generationIntent === "video" ? <button type="button" className="quick-enhance-action" disabled={busy || promptEnhancementPending || !promptEnhancementAvailable || !workflow || !workflowPromptParameter || !directionReady} title={promptEnhancementButtonTitle} onClick={() => void requestVideoPromptEnhancement()}><Icon name="wand" size={14} />{promptEnhancementButtonLabel}</button> : null}
              {generationIntent !== "video" ? <small className="quick-autosave-state">{sessionId ? "Draft autosaved on this device." : "Changes autosave on this device."}</small> : null}
            </div>
            <textarea id="creative-studio-direction" value={direction} maxLength={VIDEO_PROMPT_ENHANCED_MAX_LENGTH} onChange={(event) => setDirection(event.target.value)} placeholder={intent === "music" ? "Tempo, feeling, instruments, structure, and vocals…" : videoOperation ? "Continue the action, camera motion, lighting, and timing…" : intent === "video" ? "Subject, action, camera movement, light, and atmosphere…" : "Subject, composition, materials, light, color, and atmosphere…"} />
            {generationIntent === "video" && (promptEnhancementPending || activePromptEnhancement || promptEnhancementApplied) ? <div className={`quick-prompt-enhancement-state${activePromptEnhancement?.status === "failed" ? " failed" : promptEnhancementApplied ? " applied" : ""}`} role="status">
              <span><Icon name={activePromptEnhancement?.status === "failed" ? "close" : promptEnhancementPending ? "history" : "wand"} size={13} /><small>{promptEnhancementPending
                ? activePromptEnhancement?.status === "running" ? "Gemma 4 is adding motion, camera, timing, and atmosphere on your machine." : "Waiting for local Gemma 4. Your prompt is safe and unchanged."
                : activePromptEnhancement?.status === "failed"
                  ? "Gemma couldn’t enhance this prompt. Your current prompt is unchanged."
                  : activePromptEnhancement?.status === "completed" && appliedPromptEnhancementId !== activePromptEnhancement.id
                    ? promptEnhancementMatchesWorkflow ? "Enhancement ready. Use it, or keep your current prompt." : "Length, source, or model changed. Enhance again for this setup."
                    : promptEnhancementContextChanged
                      ? "Length, source, or model changed. Enhance again for this setup."
                      : direction.trim() === appliedPromptEnhancement?.enhancedPrompt?.trim() ? "Enhanced locally · Gemma 4" : "Edited after enhancement · Gemma 4"}</small></span>
              <span className="quick-prompt-enhancement-actions">
                {promptEnhancementPending ? <button type="button" onClick={keepCurrentVideoPrompt}>Keep current</button> : null}
                {activePromptEnhancement?.status === "completed" && appliedPromptEnhancementId !== activePromptEnhancement.id && promptEnhancementMatchesWorkflow ? <button type="button" onClick={applyCompletedVideoPromptEnhancement}>Use enhanced</button> : null}
                {originalVideoDirection !== null && direction.trim() !== originalVideoDirection.trim() ? <button type="button" onClick={restoreOriginalVideoPrompt}>Restore original</button> : null}
              </span>
            </div> : null}
          </div>

          {generationIntent === "video" ? <section className="quick-video-essentials quick-duration-panel" aria-label="Video setup">
            <header>
              <span><Icon name="video" size={16} /><span><small>{requestedWorkflow ? "YOUR MODEL" : "AUTO MODEL"}</small><strong>{workflow?.name ?? "Choose a ready video model"}</strong></span></span>
              <em>{compactEstimate}</em>
            </header>
            <div className="quick-video-essential quick-video-duration" aria-label="Video length">
              <span><strong>Length</strong><small>{estimatedOutputCount === 1 ? "One retained output" : `Each of ${estimatedOutputCount} outputs`}</small></span>
              <div role="group" aria-label="Video duration">
                {VIDEO_DURATION_OPTIONS.map((seconds) => <button type="button" key={seconds} className={videoDurationSeconds === seconds ? "on" : ""} aria-pressed={videoDurationSeconds === seconds} disabled={busy} onClick={() => chooseVideoDuration(seconds)}>{videoDurationLabel(seconds)}</button>)}
              </div>
              <p>{durationFallback ?? (videoDurationSeconds === 30 && trustedVideoPresetActive
                ? "Explicit Fast 30s: one native portrait render at 0.20 MP."
                : videoDurationSeconds >= 30
                  ? `${videoDurationLabel(videoDurationSeconds)} is a longer local render; exact settings and elapsed time stay visible.`
                  : evolutionEnabled ? "Refine, Correct, and Discovery use the same selected length." : "Aligned follows your direction; Discovery uses 70% random DNA.")}</p>
            </div>
            {showAspectControls ? <div className="quick-video-essential quick-video-shape">
              <span><strong>Shape</strong><small>Frame</small></span>
              <div role="group" aria-label="Canvas shape">
                {GENERATION_ASPECT_PRESETS.map((preset) => <button type="button" key={preset.id} className={displayedAspectRatio === preset.id ? "on" : ""} aria-label={`${preset.id} ${preset.label}`} aria-pressed={displayedAspectRatio === preset.id} disabled={busy} onClick={() => chooseCanvasAspect(preset.id)}><i style={{ aspectRatio: preset.id.replace(":", " / ") }} /><strong>{preset.id}</strong></button>)}
              </div>
            </div> : null}
            {!evolutionEnabled ? <div className="quick-video-essential quick-video-outputs">
              <span><strong>Versions</strong><small>Every result retained</small></span>
              <div role="group" aria-label="Number of video outputs">
                {GENERATION_OUTPUT_COUNTS.map((count) => {
                  const unavailable = count === 4 && !workflowSeedParameter;
                  return <button type="button" key={count} className={outputCount === count ? "on" : ""} aria-pressed={outputCount === count} disabled={busy || unavailable} title={unavailable ? "Map this model's sampler seed to guarantee four distinct outputs." : `${count} retained video ${count === 1 ? "output" : "outputs"}`} onClick={() => chooseVideoOutputCount(count)}>{count}</button>;
                })}
              </div>
            </div> : null}
            <footer>
              <span>{outputCountSeedBlocked ? "Four versions need a mapped sampler seed." : `${estimatedOutputCount} durable ${estimatedOutputCount === 1 ? "result" : "results"} with exact settings retained.`}</span>
              <small>{requestedWorkflow ? "Explicit model choice retained" : workflow ? `Fastest measured compatible model · ${workflow.name}` : "Choose a ready compatible model"}</small>
            </footer>
            {fourWayBoardRequested ? <div className="quick-four-way-roles" aria-label="Four-way video roles"><span><b>Exact</b> your motion</span><span><b>Enhanced</b> local Gemma</span><span><b>Left Field</b> new direction</span><span><b>Awe</b> beautiful strange</span></div> : null}
          </section> : null}

          {generationIntent === "image" && workflow && !evolutionEnabled ? <section className="quick-image-essentials" aria-label="Image setup">
            <header><span><Icon name="image" size={16} /><span><small>{requestedWorkflow ? "YOUR MODEL" : "AUTO MODEL"}</small><strong>{workflow.name}</strong></span></span><em>{compactEstimate}</em></header>
            {showAspectControls ? <div className="quick-image-essential quick-image-shape"><span><strong>Shape</strong><small>Tap once to change</small></span><div role="group" aria-label="Image canvas shape">{GENERATION_ASPECT_PRESETS.map((preset) => <button type="button" key={preset.id} className={displayedAspectRatio === preset.id ? "on" : ""} aria-label={`${preset.id} ${preset.label}`} aria-pressed={displayedAspectRatio === preset.id} disabled={busy} onClick={() => chooseCanvasAspect(preset.id)}><i style={{ aspectRatio: preset.id.replace(":", " / ") }} /><strong>{preset.id}</strong></button>)}</div></div> : null}
            <div className="quick-image-essential quick-image-outputs"><span><strong>Versions</strong><small>Every result is retained</small></span><div role="group" aria-label="Number of image outputs">{GENERATION_OUTPUT_COUNTS.map((count) => {
              const unavailable = count > 1 && !workflowSeedParameter;
              return <button type="button" key={count} className={outputCount === count ? "on" : ""} aria-pressed={outputCount === count} disabled={busy || unavailable} title={unavailable ? "Map this model's sampler seed to make distinct versions." : `${count} retained image ${count === 1 ? "version" : "versions"}`} onClick={() => { setOutputCount(count); setLocalError(""); }}>{count}</button>;
            })}</div></div>
            <footer><span><Icon name="generate" size={13} />{imagePerformanceMode === "fast-default" ? "Fast local image" : "Custom render"}</span><small>{requestedWorkflow ? "Model pinned by you" : "Fastest compatible model selected automatically"}</small></footer>
          </section> : null}

          {heavyRenderConfirmationOpen && heavyVideoRender ? <section className="quick-heavy-render-confirmation" role="alert" aria-label="Confirm heavy video render">
            <header><Icon name="analytics" size={17} /><span><strong>Confirm this longer local render</strong><small>These settings are intentionally outside the one-click 5s / 0.20 MP fast path.</small></span></header>
            <div className="quick-heavy-render-facts">
              <span><small>CLIP</small><strong>{videoDurationLabel(videoDurationSeconds)}</strong></span>
              <span><small>FRAMES</small><strong>{videoFrameSummary}</strong></span>
              <span><small>SIZE</small><strong>{videoResolutionSummary}</strong></span>
              <span><small>VERSIONS</small><strong>{estimatedOutputCount}</strong></span>
            </div>
            <p><strong>{heavyRenderTimeSummary}</strong><small>The Local Runner renders these {estimatedOutputCount} versions one after another, so later versions wait for earlier ones to finish.</small></p>
            <footer><button type="button" className="btn btn-ghost" onClick={() => { armedVideoRenderSignature.current = ""; setHeavyRenderConfirmationOpen(false); }}>Keep editing</button><button type="button" className="btn btn-primary" onClick={() => { armedVideoRenderSignature.current = videoRenderSignature; setHeavyRenderConfirmationOpen(false); void startWorkflowGeneration(); }}><Icon name="send" size={15} /> Confirm &amp; queue</button></footer>
          </section> : null}
          <div className={`quick-generate-dock${localError || error ? " has-error" : ""}`}>
            {localError || error ? <div className="quick-generate-error" role="status" aria-live="polite"><Icon name="close" size={15} /><span><strong>Generation needs attention</strong><small>{localError || error}</small></span></div> : null}
            {!localError && !error && generationBlocker ? <div className="quick-generation-blocker" role="status"><Icon name="shield" size={15} /><span>{generationBlocker.message}</span>{generationBlocker.action ? <button type="button" onClick={resolveGenerationBlocker}>{generationBlocker.actionLabel ?? "Review"}</button> : null}</div> : null}
            <span><Icon name="analytics" size={13} /><span><strong>{compactEstimate}</strong><small>{continuityTooLarge ? "Narrow World continuity first" : fourWayBoardRequested ? "Exact / Enhanced / Left Field / Awe" : `${estimatedOutputCount} ${estimatedOutputCount === 1 ? "output" : "outputs"} / exact settings retained`}</small></span></span><button className="btn btn-primary quick-primary" disabled={busy || promptEnhancementPending || Boolean(generationBlocker)} onClick={() => void startWorkflowGeneration()}><Icon name="send" size={17} /> {primaryLabel}</button>
          </div>
          {!workflow && developmentPreviewAvailable && generationIntent !== "video" ? <button className="btn btn-ghost quick-development" disabled={busy || !directionReady} onClick={() => void submitDevelopmentPreview()}>Create explicitly simulated development preview</button> : null}
          <button type="button" className="quick-more-toggle" aria-expanded={creativeToolsOpen} aria-controls="creative-studio-power-tools" onClick={() => {
            const opening = !creativeToolsOpen;
            setCreativeToolsOpen(opening);
            if (opening) requestAnimationFrame(() => {
              const target = document.querySelector<HTMLElement>("#creative-studio-power-tools .quick-generation-goal-options button:not(:disabled), #creative-studio-power-tools .quick-world-continuity button:not(:disabled), #creative-studio-power-tools .quick-project-context button:not(:disabled), #creative-studio-power-tools .quick-evolution-brief summary, #creative-studio-power-tools .quick-trusted-video button:not(:disabled), #creative-studio-power-tools .quick-recipe-tools select:not(:disabled), #creative-studio-power-tools .quick-setting-panel summary, #creative-studio-power-tools .quick-compose-model summary, #creative-studio-power-tools .quick-video-speech button:not(:disabled), #creative-studio-power-tools .quick-song-lyrics summary");
              target?.scrollIntoView({ block: "nearest" });
              target?.focus({ preventScroll: true });
            });
          }}><span><Icon name={creativeToolsOpen ? "close" : "settings"} size={15} /><span><strong>{creativeToolsOpen ? "Hide creative controls" : "More creative controls"}</strong><small>{creativeToolsOpen ? "Return to the focused canvas" : "Ideas, sound, model, World, recipes, and exact settings"}</small></span></span><Icon name={creativeToolsOpen ? "chevronDown" : "chevron"} size={14} /></button>
        </>}

        {intent !== "train" ? <div className="quick-power-tools" id="creative-studio-power-tools" hidden={!creativeToolsOpen}>
        {!(evolutionEnabled && initialEvolutionSource) ? <section className="quick-generation-goals" aria-label="Creation goal">
          <div className="quick-generation-goal-options" role="group" aria-label="Choose creation goal">
            {GENERATION_GOALS.map((goal) => {
              const unavailable = goal.id === "scout" && !generationGoalCanScout(generationIntent, quickSource?.kind ?? null);
              return <button type="button" key={goal.id} className={generationGoal === goal.id ? "on" : ""} aria-pressed={generationGoal === goal.id} disabled={busy || (goal.id === "scout" && generationIntent !== "image")} onClick={() => chooseGenerationGoal(goal.id)} title={goal.id === "scout" && generationIntent !== "image" ? "Scout Board begins with images; video already creates two directions." : goal.description}><span>{goal.shortLabel}</span><small>{goal.id === "scout" ? unavailable ? "Choose an image" : "3 fast directions" : goal.id === "explore" ? "Recommended" : "Exact settings"}</small></button>;
            })}
          </div>
          <p>{generationIntent === "video" && generationGoal === "explore"
            ? outputCount === 4
              ? "Four retained directions: Exact, Enhanced, Left Field, and Awe."
              : outputCount === 2
                ? "Two fast retained directions: Aligned follows your prompt; Discovery takes a distinct DNA-led path."
                : "One retained video using the selected local settings."
            : GENERATION_GOALS.find((goal) => goal.id === generationGoal)?.description}<small>{sessionId ? "Draft autosaved on this device." : "Changes autosave on this device."}</small></p>
        </section> : null}

        {generationIntent !== "music" && workflow && !uiOnlyDevelopment && selectedWorld ? <section className={`quick-world-continuity${worldContinuityEnabled ? " on" : ""}`}>
          <button type="button" className="quick-project-context-toggle" aria-pressed={worldContinuityEnabled} onClick={() => setWorldContinuityEnabled((current) => !current)}>
            <Icon name="projects" size={15} /><span><strong>{selectedWorld.name} continuity</strong><small>{worldContinuityEnabled ? "Version-stamped into this generation" : "Optional · tap to keep your world consistent"}</small></span><em>{worldContinuityEnabled ? "On" : "Off"}</em>
          </button>
          <div className="quick-world-controls">
            {projectWorlds.length > 1 ? <label><span>World</span><select aria-label="Creative World" value={selectedWorld.id} onChange={(event) => {
              const worldId = event.target.value;
              setSelectedWorldId(worldId);
              setSelectedWorldEntityIds((snapshot?.worldEntities ?? []).filter((entity) => entity.worldId === worldId && entity.status === "active").map((entity) => entity.id));
            }}>{projectWorlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label> : null}
            {selectedWorldEntitiesAvailable.length ? <div className="quick-world-entities" role="group" aria-label="World characters and places">
              {selectedWorldEntitiesAvailable.map((entity) => {
                const selectedEntity = effectiveSelectedWorldEntityIds.includes(entity.id);
                return <button type="button" key={entity.id} className={selectedEntity ? "on" : ""} aria-pressed={selectedEntity} onClick={() => setSelectedWorldEntityIds((current) => {
                  const availableIds = selectedWorldEntitiesAvailable.map((item) => item.id);
                  const baseline = current.filter((id) => availableIds.includes(id));
                  const selectedIds = baseline.length ? baseline : availableIds;
                  const next = selectedEntity ? selectedIds.filter((id) => id !== entity.id) : [...selectedIds, entity.id];
                  return next.length ? [...new Set(next)] : selectedIds;
                })}><Icon name={entity.kind === "character" ? "dna" : entity.kind === "place" ? "projects" : "cube"} size={13} />{entity.name}</button>;
              })}
            </div> : null}
            <small>{selectedWorldRules.length} active {selectedWorldRules.length === 1 ? "rule" : "rules"} · {selectedWorldReferences.length} canon {selectedWorldReferences.length === 1 ? "reference" : "references"}{compiledWorldDirective?.truncated ? " · too large: select fewer elements" : " · all applied exactly"}</small>
          </div>
          {compiledWorldDirective?.text ? <details className={compiledWorldDirective.truncated ? "continuity-overflow" : ""}><summary>{compiledWorldDirective.truncated ? "Continuity is too large" : "Inspect exact continuity"}</summary><p>{compiledWorldDirective.text}</p>{compiledWorldDirective.truncated ? <small>Nothing will generate until every selected rule and canon reference can fit. Select fewer elements above.</small> : null}</details> : <p className="quick-world-empty">Add a premise, character detail, rule, or canon note in Studio › Project before turning continuity on.</p>}
        </section> : null}

        {generationIntent !== "music" && workflow && !uiOnlyDevelopment && !selectedWorld && projectContext?.text ? <section className={`quick-project-context${projectContextEnabled ? " on" : ""}`}>
          <button type="button" className="quick-project-context-toggle" aria-pressed={projectContextEnabled} onClick={() => setProjectContextEnabled((current) => !current)}>
            <Icon name="projects" size={15} /><span><strong>{activeProject?.name} project context</strong><small>{projectContextEnabled ? "Added to this local Comfy prompt" : "Optional · off by default"}{projectContext.excludedReferenceIdentityMentions ? ` · ${projectContext.excludedReferenceIdentityMentions} provenance identity ${projectContext.excludedReferenceIdentityMentions === 1 ? "mention" : "mentions"} excluded` : ""}</small></span><em>{projectContextEnabled ? "On" : "Off"}</em>
          </button>
          <details><summary>Inspect exact added text</summary><p>{projectContext.text}</p></details>
        </section> : null}

        {evolutionEnabled && initialEvolutionSource ? <details className="quick-evolution-brief">
          <summary><span><Icon name="star" size={15} /><strong>Evolving {quickSource?.name ?? initialEvolutionSource.name}</strong><small>Refine + Correct + Discovery</small></span><Icon name="chevronDown" size={14} /></summary>
          <section className="evolution-create-plan" aria-label="Evolution study">
          <header><span><Icon name="star" size={16} /><strong>Evolve {quickSource?.name ?? initialEvolutionSource.name}</strong></span><button type="button" className="link-btn" onClick={() => { setEvolutionEnabled(false); if (generationGoal === "scout") setGenerationGoal("explore"); }}>Use as a normal source</button></header>
          <p>One request creates three retained branches with the same source, taste evidence, model settings, and study stamp. Project canon stays in lineage; song prompts use only music-specific evidence.</p>
          <div><span><b>Refine</b><small>strengthen what already works</small></span><span><b>Correct</b><small>resolve review feedback</small></span><span><b>Discovery</b><small>take a distinct new path</small></span></div>
          <footer><span>{projectTasteMemory?.taste.signalCount ?? 0} project signals</span><span>{personalTaste?.signalCount ?? 0} personal signals</span><span>{projectTasteMemory?.canon.identity ? "Canon attached" : "Add canon in Projects"}</span></footer>
          </section>
        </details> : null}

        {generationIntent === "video" && trustedVideoWorkflow ? <section className={`quick-trusted-video${trustedVideoPresetActive ? " active" : ""}`} aria-label="Fast 30 second single-render option">
          <header>
            <span><Icon name="star" size={17} /><span><small>EXPLICIT SINGLE RENDER · RTX 3090 VERIFIED</small><strong>Fast 30s · one version</strong></span></span>
            <em>{trustedPresetEvidence.completedRuns}/{trustedPresetEvidence.terminalRuns} portrait</em>
          </header>
          <div className="quick-trusted-video-facts" aria-label="Trusted video settings">
            <span><small>CLIP</small><strong>30s</strong></span>
            <span><small>SHAPE</small><strong>9:16</strong></span>
            <span><small>DETAIL</small><strong>0.20 MP</strong></span>
            <span><small>MOTION</small><strong>24 fps</strong></span>
            <span><small>FRAMES</small><strong>721</strong></span>
            <span><small>OUTPUTS</small><strong>1</strong></span>
          </div>
          <div className="quick-trusted-video-action">
            <span><strong>Median {formatGenerationDuration(trustedPresetEvidence.medianMs)}</strong><small>Observed {durationRange(trustedPresetEvidence.fastestMs, trustedPresetEvidence.slowestMs)} · prompt and source stay yours</small></span>
            <button type="button" className={`btn ${trustedVideoPresetActive ? "btn-ghost" : "btn-primary"}`} aria-pressed={trustedVideoPresetActive} disabled={busy} onClick={() => trustedVideoPresetActive
              ? leaveTrustedVideoPreset({ standardDefaults: true, outputCount: 2 })
              : applyTrustedThirtySecondPreset()}><Icon name={trustedVideoPresetActive ? "rerun" : "generate"} size={15} />{trustedVideoPresetActive ? "Return to Standard Pair" : "Use Fast 30s · one"}</button>
          </div>
          <details>
            <summary><span>Why one native render wins</span><small>{trustedSimulationWinner ? `${formatGenerationDuration(trustedSimulationWinner.simulatedMedianMs)} simulated median` : "Measured local evidence"}</small><Icon name="chevronDown" size={13} /></summary>
            <div className="quick-video-simulations">{thirtySecondSimulations.map((simulation, index) => <span key={simulation.id} className={index === 0 ? "winner" : ""}><b>{simulation.label}</b><strong>{formatGenerationDuration(simulation.simulatedMedianMs)}</strong><small>{simulation.evidence === "interpolated" ? "interpolated" : `${simulation.sampleCount} measured samples`}{simulation.excludesJoinOverhead ? " · before joining" : ""}</small></span>)}</div>
            <p>Graph {TRUSTED_LTX_25_I2V_PORTRAIT_30S.graphFamily.sha256.slice(0, 8)} is pinned to 8 + 3 sampling steps, Euler ancestral, 2× latent upscale, and tiled VAE decode. The simulated median is about 34% faster than 2×15s and avoids seams and repeated setup. Runtime is verified; visual quality still needs your accept/reject review.</p>
          </details>
        </section> : null}

        {workflow && !uiOnlyDevelopment ? <section className="quick-recipe-tools" aria-label="Reusable generation recipes">
          <label><Icon name="star" size={14} /><span><strong>Recipe</strong><small>{projectRecipes.length ? `${projectRecipes.length} saved · best evidence first` : "Save these exact settings"}</small></span><select aria-label="Load a generation recipe" defaultValue="" disabled={busy || !projectRecipes.length} onChange={(event) => { const recipe = projectRecipes.find((item) => item.id === event.target.value); if (recipe) applyGenerationRecipe(recipe); event.currentTarget.value = ""; }}><option value="">{projectRecipes.length ? "Choose saved recipe" : "No saved recipes yet"}</option>{projectRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}{recipe.evidenceSummary.runs ? ` · ${recipe.evidenceSummary.accepted}/${recipe.evidenceSummary.runs} accepted` : " · untested"}</option>)}</select></label>
          <button type="button" className="btn btn-ghost" disabled={busy || !workflowReady || !directionReady || (generationIntent !== "music" && worldContinuityEnabled && Boolean(selectedWorld))} title={generationIntent !== "music" && worldContinuityEnabled && selectedWorld ? "World continuity recipes require typed replay and cannot be saved yet." : undefined} onClick={() => void saveCurrentRecipe()}><Icon name="plus" size={14} /> Save recipe</button>
        </section> : null}

        {generationIntent === "image" && workflow ? <details className="quick-setting-panel quick-speed-panel">
          <summary><span><Icon name="generate" size={14} /><strong>Speed</strong></span><em>{imagePerformanceMode === "fast-default" ? "Fast" : "Custom"}</em><small>{fastImageBlocked ? "Needs custom" : compactEstimate}</small><Icon name="chevronDown" size={13} /></summary>
          <div className={`quick-image-speed${fastImageBlocked ? " blocked" : ""}`}>
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
          </div>
        </details> : null}

        {workflow ? <details className="quick-setting-panel quick-render-panel">
          <summary><span><Icon name="settings" size={14} /><strong>Canvas &amp; render</strong></span><span className="quick-setting-chips">{compactSettings.map((item) => <em key={item}>{item}</em>)}</span><small>{compactEstimate}</small><Icon name="chevronDown" size={13} /></summary>
          <section className="quick-render-setup" aria-label="Canvas and render settings">
          <header>
            <span><Icon name="settings" size={15} /><strong>{showGraphicalRenderControls ? "Canvas & render" : "Render estimate"}</strong></span>
            <small>{workflowWorkload?.facts.slice(0, 3).join(" · ") || "Stamped with every result"}</small>
          </header>
          {showAspectControls && generationIntent !== "video" ? <div className="quick-render-group quick-aspect-group">
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
          </section>
        </details> : null}

        {intent === "music" && songPromptRecommendations.length ? <details className="quick-prompt-ideas"><summary><span><Icon name="star" size={14} /><strong>Song prompt ideas</strong></span><small>{songArtDescription ? "Art + CreativeDNA" : "CreativeDNA"} / {songPromptRecommendations.length}</small></summary><section className="quick-song-prompts" aria-label="Recommended song prompts">
          <header><span><Icon name="star" size={15} /><strong>Prompt ideas</strong></span><small>{songArtDescription ? "Uploaded art + CreativeDNA" : "CreativeDNA"}</small></header>
          <div>{songPromptRecommendations.map((recommendation) => <button type="button" key={recommendation.id} disabled={busy} aria-label={`Use ${recommendation.label} song prompt`} onClick={() => { setSelectedStoryRecommendation(undefined); setDirection(recommendation.prompt); setNotice(`${recommendation.label} prompt is ready to edit.`); }}><span><strong>{recommendation.label}</strong><small>{recommendation.focus}</small></span><p>{recommendation.prompt}</p><em>Use</em></button>)}</div>
        </section></details> : null}

        {intent === "music" && quickSource?.source === "upload" && !songArtDescription ? <div className="quick-song-analysis">
          <span><strong>Analyze this art to include what is actually in it</strong><small>Until then, recommendations use CreativeDNA only.</small></span>
          <button type="button" className="btn btn-ghost" onClick={() => quickSource.trainingEligible ? onTrain([quickSource.id], "analyze") : onMedia()}>{quickSource.trainingEligible ? "Analyze art" : "Review consent"}</button>
        </div> : null}

        {videoOperation ? <details className="quick-setting-panel quick-extension-panel">
          <summary><span><Icon name="video" size={14} /><strong>Extension</strong></span><em>{videoOperation.outputMode === "combined" ? "Join to source" : "Clip only"}</em><small>{videoOperation.transitionSeconds ? `${videoOperation.transitionSeconds}s dissolve` : "Clean cut"}</small><Icon name="chevronDown" size={13} /></summary>
          <section className="quick-video-tools" aria-label="Video extension settings">
          <header><span><Icon name="video" size={16} /><strong>Final-frame continuation</strong></span><small>Local FFmpeg + ComfyUI</small></header>
          <div>
            <label><span>Result</span><select value={videoOperation.outputMode} disabled={busy} onChange={(event) => setVideoOperation((current) => current ? { ...current, outputMode: event.target.value as VideoGenerationOperation["outputMode"], transitionSeconds: event.target.value === "combined" ? 0.5 : 0, audioMode: event.target.value === "combined" ? "keep-source" : "mute" } : current)}><option value="combined">One longer video</option><option value="continuation">Continuation clip only</option></select></label>
            <label><span>Join</span><select value={videoOperation.transitionSeconds} disabled={busy || videoOperation.outputMode !== "combined"} onChange={(event) => setVideoOperation((current) => current ? { ...current, transitionSeconds: Number(event.target.value) as VideoGenerationOperation["transitionSeconds"] } : current)}><option value="0">Clean cut</option><option value="0.25">0.25s dissolve</option><option value="0.5">0.5s dissolve</option><option value="1">1s dissolve</option></select></label>
            <label className="quick-video-audio"><input type="checkbox" checked={videoOperation.audioMode === "keep-source"} disabled={busy || videoOperation.outputMode !== "combined"} onChange={(event) => setVideoOperation((current) => current ? { ...current, audioMode: event.target.checked ? "keep-source" : "mute" } : current)} /><span><strong>Keep source audio</strong><small>Silence continues after the original track ends.</small></span></label>
          </div>
          </section>
        </details> : null}

        <RecommendedDirectionsRail threads={snapshot?.storyThreads ?? []} projectId={activeProjectId} modality={generationIntent} activeRecommendationId={selectedStoryRecommendation?.recommendationId} onUse={applyStoryRecommendation} />
        <details className={`quick-compose-panel quick-compose-model${workflow ? "" : " no-ready"}`}>
            <summary>
              <span className="quick-compose-model-icon"><Icon name={generationIntent === "music" ? "music" : generationIntent} size={17} /></span>
              <span className="quick-compose-summary-copy"><small>{requestedWorkflow ? "Selected model" : "Recommended model"}</small><strong>{workflow?.name ?? `No ${generationLabel} model ready`}</strong><em>{workflow ? modelSummary(workflow) : "Choose or import a compatible Comfy workflow"}</em></span>
              <span className="quick-compose-change">{workflow ? "Change" : "Manage"}</span><Icon name="chevronDown" size={14} />
            </summary>
            <div className="quick-compose-panel-body quick-model-picker">
            <div className="quick-model-head"><span>Model</span><button className="link-btn" onClick={onWorkflows}>Manage models</button></div>
            {intentWorkflows.length ? <div className="quick-models" role="group" aria-label={`${intent === "music" ? "Song" : intent} model`}>
              {intentWorkflows.map((item) => {
                const durationUnsupported = generationIntent === "video" && !workflowSupportsVideoDuration(item, videoDurationSeconds);
                const durationProfile = generationIntent === "video" ? videoWorkflowDurationProfile(item) : null;
                return <button key={item.id} className={workflow?.id === item.id ? "on" : ""} aria-pressed={workflow?.id === item.id} disabled={busy || durationUnsupported} title={durationUnsupported && durationProfile ? `${durationProfile.label} supports up to ${videoDurationLabel(durationProfile.maxSeconds)}` : undefined} onClick={() => chooseWorkflow(item.id)}><Icon name={item.modality === "music" || item.modality === "audio" ? "music" : item.modality === "video" ? "video" : "image"} size={17} /><span><strong>{item.name}</strong><small>{modelSummary(item)}{durationProfile ? ` · max ${videoDurationLabel(durationProfile.maxSeconds)}` : ""}</small></span></button>;
              })}
            </div> : <button className="quick-model-empty" onClick={onWorkflows}><Icon name="flows" size={16} /><span><strong>No {intent === "music" ? "song" : intent} model is ready</strong><small>Manage models</small></span><Icon name="chevron" size={14} /></button>}
            {musicPromptProfile ? <small className="quick-model-prompt-profile">Gemma formats this for {musicPromptProfile.targetModel}: {musicPromptProfile.outputFormat === "structured-caption" ? "Global Metadata + Vocal Details + section-by-section Arrangement" : "one concise natural-language audio prompt"}.</small> : null}
            </div>
          </details>

          {generationIntent === "video" ? <section className="quick-video-speech" aria-label="Dialogue and sound">
            <div className="quick-video-speech-head"><span><Icon name="music" size={14} /><strong>Dialogue & sound</strong></span><small>{videoSpeechMode === "no-speech" ? "Sound on · no dialogue" : `${videoSpeechWordCount} / ${videoSpeechWordBudget.maximum} words`}</small></div>
            <div className="quick-video-speech-modes" role="group" aria-label="Dialogue mode">
              {([
                ["no-speech", "No dialogue"],
                ["short-natural-line", "Simple line"],
                ["exact-script", "Exact script"],
              ] as const).map(([mode, label]) => <button type="button" key={mode} className={videoSpeechMode === mode ? "on" : ""} aria-pressed={videoSpeechMode === mode} disabled={busy} onClick={() => {
                if (mode === "short-natural-line" && appliedFullVideoScriptDraft) {
                  detachAssistedVideoScript();
                  setNotice("Full scene kept as your direction. Simple line is now manual, so the assisted-script revision was detached.");
                }
                setVideoSpeechMode(mode);
                setLocalError("");
              }}>{label}</button>)}
            </div>
            <div className="quick-video-speech-compose">
              {videoSpeechMode !== "no-speech" ? <label className={`quick-video-speech-line${!videoSpeechFitsDuration ? " over" : ""}`}><span>{videoSpeechMode === "exact-script" ? "Exact spoken words" : "Spoken-line idea"}</span><input value={videoSpeechText} maxLength={VIDEO_SPEECH_TEXT_MAX_LENGTH} onChange={(event) => { setVideoSpeechText(event.target.value); setLocalError(""); }} placeholder={videoSpeechMode === "exact-script" ? "I remember this place." : "A short idea; Creative Studio removes filler and keeps one sentence."} /><small>{!videoSpeechFitsDuration ? `Shorten to ${videoSpeechWordBudget.maximum} words for ${videoDurationSeconds}s.` : videoSpeechMode === "exact-script" ? "Sent verbatim once. No improvised dialogue." : "Reduced to one clear sentence. No improvised dialogue."}</small></label> : <p className="quick-video-speech-safe">No dialogue. Ambience, effects, sparkling synth arpeggios, buoyant electronic rhythm, wistful hooks, and dreamy nocturnal-city texture stay active.</p>}
              <button type="button" className="quick-script-help" disabled={busy || videoScriptPending} title={!videoScriptAvailable ? videoScriptCapability?.detail ?? "Start Local Runner 1.12 and ComfyUI for local Gemma." : !workflow ? "Choose a video model before writing a full script." : undefined} onClick={() => { setVideoScriptBuilderOpen(true); setVideoScriptError(""); }}><Icon name="wand" size={14} />{videoScriptButtonLabel}</button>
              {videoScriptStatus ? <small className={`quick-script-status${videoScriptContextChanged || activeVideoScriptDraft?.status === "failed" ? " warn" : ""}`} role="status">{videoScriptStatus}</small> : null}
            </div>
          </section> : null}
          {intent === "music" && workflowLyricsParameter ? <details className="quick-song-lyrics"><summary><span><Icon name="music" size={14} /><strong>Lyrics</strong></span><small>{lyrics.trim() ? "Included" : "Optional · instrumental when empty"}</small></summary><textarea aria-label="Song lyrics" value={lyrics} maxLength={8_000} onChange={(event) => setLyrics(event.target.value)} placeholder="Add section labels and lyrics, or leave empty for an instrumental…" /></details> : null}
          {!evolutionEnabled && generationIntent === "image" ? <div className="quick-output-count">
            <span><strong>Outputs</strong><small>{outputCountSeedBlocked ? "This model must expose a sampler seed for that many distinct results." : "Every result is a separate durable job with its own retained settings."}</small></span>
            <div role="group" aria-label={`Number of ${generationIntent} outputs`}>
              {GENERATION_OUTPUT_COUNTS.map((count) => {
                const unavailable = count > 1 && !workflowSeedParameter;
                return <button type="button" key={count} className={outputCount === count ? "on" : ""} aria-pressed={outputCount === count} disabled={busy || unavailable} title={unavailable ? "Map this model's sampler seed in Models to guarantee distinct outputs." : `${count} retained ${generationIntent} ${count === 1 ? "output" : "outputs"}`} onClick={() => { setOutputCount(count); setLocalError(""); }}>{count}</button>;
              })}
            </div>
          </div> : null}
        <details className="quick-create-advanced glass">
        <summary><span><Icon name="settings" size={15} /><strong>Advanced</strong></span><small>DNA, less-used settings, and remote route</small></summary>
        <div className="quick-advanced-body">
          <section className="quick-advanced-section quick-advanced-wide">
            <header><strong>CreativeDNA</strong><button className="link-btn" onClick={onDesign}>Edit DNA</button></header>
            {availableDna.length ? <select aria-label="CreativeDNA direction" value={selected?.artifactId ?? ""} disabled={busy} onChange={(event) => {
              const dna = availableDna.find((artifact) => artifact.artifactId === event.target.value) ?? null;
              selectDna(dna);
              if (dna) {
                setSelectedStoryRecommendation(undefined);
                setDirection(creativeDnaGenerationPrompt(dna, generationIntent === "music" ? "music" : dna.targetModality));
              }
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
              setSelectedStoryRecommendation(undefined);
              setDirection(String(value));
              return;
            }
            if (parameter.id === workflowLyricsParameter?.id) {
              setLyrics(String(value));
              return;
            }
            if (generationIntent === "video" && leaveTrustedVideoPreset({
              workflowParameter: { parameter, value },
              outputCount: 2,
              notice: "Fast 30s exited. This exact setting will use the normal Aligned + Discovery pair.",
            })) return;
            const displayedValues = Object.fromEntries(scalarParameters.map((item) => [item.id, parameterValue(item)]));
            setImagePerformanceMode("explicit-custom");
            setValuesRevisionId(workflow.currentRevision.id);
            setWorkflowValues({ ...displayedValues, [parameter.id]: value });
          }} />)}</div>{advancedSettingsChanged ? <button type="button" className="btn btn-ghost workflow-run-reset" disabled={busy} onClick={() => { if (!workflow) return; if (generationIntent === "video" && leaveTrustedVideoPreset({ standardDefaults: true, outputCount: 2 })) return; setImagePerformanceMode("fast-default"); setCanvasAspectRatio(null); setCanvasMegapixels(null); setLyrics(""); setValuesRevisionId(workflow.currentRevision.id); setWorkflowValues(Object.fromEntries(scalarParameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={14} /> Return to workflow defaults</button> : null}</section> : null}

          {workflow && workflowWorkload ? <details className="workflow-performance create-performance quick-advanced-wide"><summary><span><Icon name="analytics" size={15} /><strong>Speed & quality evidence</strong><small>{settingsChanged ? "New settings" : workflowHistory?.count ? `Median ${formatGenerationDuration(workflowHistory.medianMs)} · ${workflowHistory.count} runs` : "No exact-revision history"}</small></span><em>{Math.round(GENERATION_LONG_RUN_THRESHOLD_MS / 60_000)}m alert</em></summary><div className="workflow-performance-body">{workflowWorkload.facts.length ? <div className="job-performance-facts">{workflowWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div> : <p>No workload controls are exposed by this workflow.</p>}{workflow.currentRevision.models.length ? <div className="job-performance-models"><small>Models</small><div>{workflow.currentRevision.models.map((model) => <code key={model}>{model}</code>)}</div></div> : null}<p>{workflowWorkload.likelyContributors.length ? `Likely cost drivers: ${workflowWorkload.likelyContributors.join(", ")}.` : "No high-cost setting stands out."}</p><small>{workflowWorkload.promptAssessment}</small></div></details> : null}

          {afdfwCapability ? <details className="generation-optional-route create-remote-route quick-advanced-wide"><summary><span>Optional remote route · AFDFW</span><em className={afdfwCapability.state}>{afdfwCapability.state}</em></summary><p>{afdfwCapability.detail}</p>{afdfwImageWorkload && afdfwImageProfile ? <div className="direct-generation-profile"><div>{afdfwImageWorkload.facts.map((fact) => <span key={fact}>{fact}</span>)}</div><details><summary>Model evidence · {afdfwImageProfile.models.length} files</summary>{afdfwImageProfile.models.map((model) => <code key={model}>{model}</code>)}</details></div> : null}<button className="btn btn-ghost" disabled={busy || afdfwCapability.state !== "available" || !directionReady} onClick={() => void submitRemote()}><Icon name="send" size={16} /> Generate remotely with AFDFW</button></details> : null}
          {selected?.rights.referenceStoredAsProvenanceOnly ? <div className="rights-panel quick-advanced-wide"><Icon name="shield" size={18} /><div><strong>Reference identity stays in lineage only.</strong></div></div> : null}
        </div>
      </details>
        </div> : null}
        {intent !== "train" ? <div className="quick-create-results"><CreateResultRail artifacts={recentCreateArtifacts} onOpenArtifacts={onArtifacts} onUseAsSource={(artifactId) => {
          const artifact = recentCreateArtifacts.find((item) => item.id === artifactId);
          if (!artifact) return;
          if (artifact.id !== quickSourceId) {
            detachAssistedVideoScript();
            setSelectedStoryRecommendation(undefined);
          }
          setQuickSourceId(artifact.id);
          setInputBindings({});
          setSourceGalleryExpanded(false);
          setLocalError("");
          setNotice(`${artifact.name} is now your starting point. Keep this format or choose Image, Video, or Song above.`);
          document.getElementById("creative-studio-direction")?.focus({ preventScroll: false });
        }} /></div> : null}
      </section>

      <VideoScriptBuilderSheet
        open={videoScriptBuilderOpen}
        duration={videoDurationSeconds}
        seedIdeas={videoScriptSeedIdeas}
        proposal={videoScriptProposal}
        proposalSpokenText={videoScriptProposalSpokenText}
        ownerScript={videoSpeechText}
        ownerDirection={direction}
        draft={activeFullVideoScriptDraft}
        available={videoScriptAvailable && Boolean(workflow && videoPromptProfile)}
        capabilityDetail={!workflow ? "Choose a video model first so the full script matches its prompt format." : videoScriptCapability?.detail}
        busy={busy}
        error={videoScriptError || (activeVideoScriptDraft?.error ? videoScriptErrorMessage(new Error(activeVideoScriptDraft.error)) : "")}
        onClose={() => setVideoScriptBuilderOpen(false)}
        onSeedIdeasChange={(value) => { setVideoScriptSeedIdeas(value); setVideoScriptError(""); }}
        onProposalChange={(value) => { setVideoScriptProposal(value); setVideoScriptProposalDirty(true); setVideoScriptError(""); }}
        onProposalSpokenTextChange={(value) => { setVideoScriptProposalSpokenText(value); setVideoScriptProposalDirty(true); setVideoScriptError(""); }}
        onBuild={() => void requestVideoScriptDraft("build")}
        onTighten={() => void requestVideoScriptDraft("tighten")}
        onUse={() => void applyVideoScriptProposal()}
      />

      {notice ? <div className="create-notice" role="status"><span>{notice}</span>{activeJobs.length || notice.includes("queued") ? <button onClick={onQueued}>View queue</button> : null}</div> : null}
      {localError || error ? <div className="inline-error" role="alert">{localError || error}</div> : null}
      <button className="quick-library-link" onClick={onMedia}><Icon name="library" size={14} /> Browse all media</button>
    </section>
  );
}
