import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useStudio } from "./StudioProvider";
import { type StudioView } from "./views";
import { DesktopShell, MobileShell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { PlaceholderView } from "../features/placeholder/PlaceholderView";
import type { Artifact, ProductionCockpitAction } from "../../shared/contracts";
import type { VideoCreateEntryMode } from "../features/generation/createEntry";
import type { CreateIntent } from "../features/generation/quickCreate";
import type { StoryRecommendationHandoff } from "../features/stories/StoryBankRail";

const CreativeDnaWorkbench = lazy(async () => ({ default: (await import("../features/creative-dna/CreativeDnaWorkbench")).CreativeDnaWorkbench }));
const PortalView = lazy(async () => ({ default: (await import("../features/portal/PortalView")).PortalView }));
const WorkView = lazy(async () => ({ default: (await import("../features/work/WorkView")).WorkView }));
const StudioHub = lazy(async () => ({ default: (await import("../features/studio/StudioView")).StudioView }));
const OvernightSetupSheet = lazy(async () => ({ default: (await import("../features/overnight")).OvernightSetupSheet }));
const MorningReviewSheet = lazy(async () => ({ default: (await import("../features/overnight")).MorningReviewSheet }));

const VIEWS = new Set<StudioView>(["portal", "dna", "work", "studio", "cockpit", "media", "library", "gallery", "projects", "flows", "queue", "runtime", "settings", "system"]);

function hashView(): StudioView {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (raw === "generate") return "dna";
  if (!raw) return "dna";
  const candidate = raw as StudioView;
  return VIEWS.has(candidate) ? candidate : "portal";
}

function useResponsive() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 860);
  useEffect(() => {
    const update = () => setMobile(window.innerWidth < 860);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return mobile;
}

function StudioViewLoading() {
  return <div className="studio-view-loading" role="status" aria-live="polite"><div className="brand-mark"><i className="bm-ring" /><i className="bm-orb" /></div><strong>Opening your workspace</strong></div>;
}

class StudioViewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="studio-view-recovery" role="alert"><Icon name="rerun" size={22} /><h1>Refresh this workspace</h1><p>Creative Studio may have been updated while this tab was open. Reloading will not remove retained jobs or artifacts.</p><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload Creative Studio</button></div>;
  }
}

export function App() {
  const { snapshot, loading, error, activeProjectId, activeDna, setActiveProjectId, createOvernightSession } = useStudio();
  const [view, setView] = useState<StudioView>(hashView);
  const [cockpitTarget, setCockpitTarget] = useState<ProductionCockpitAction | null>(null);
  const [videoExtensionArtifactId, setVideoExtensionArtifactId] = useState("");
  const [evolutionSourceId, setEvolutionSourceId] = useState("");
  const [createSourceId, setCreateSourceId] = useState("");
  const [createIntent, setCreateIntent] = useState<CreateIntent | undefined>();
  const [reuseArtifact, setReuseArtifact] = useState<Artifact | null>(null);
  const [videoCreateEntryMode, setVideoCreateEntryMode] = useState<VideoCreateEntryMode>("standard");
  const [storyRecommendation, setStoryRecommendation] = useState<StoryRecommendationHandoff | null>(null);
  const [trainingSourceIds, setTrainingSourceIds] = useState<string[]>([]);
  const [trainingPath, setTrainingPath] = useState<"analyze" | "model">("analyze");
  const [overnightOpen, setOvernightOpen] = useState(false);
  const [overnightReviewSessionId, setOvernightReviewSessionId] = useState("");
  const mobile = useResponsive();
  const scopedReuseArtifact = reuseArtifact?.projectId === activeProjectId ? reuseArtifact : null;
  if (reuseArtifact && !scopedReuseArtifact) setReuseArtifact(null);

  const clearCreateHandoff = () => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId("");
    setCreateIntent(undefined);
    setReuseArtifact(null);
    setVideoCreateEntryMode("standard");
    setStoryRecommendation(null);
    setTrainingSourceIds([]);
    setTrainingPath("analyze");
  };

  useEffect(() => {
    const update = () => {
      setCockpitTarget(null);
      setVideoExtensionArtifactId("");
      setEvolutionSourceId("");
      setCreateSourceId("");
      setCreateIntent(undefined);
      setReuseArtifact(null);
      setVideoCreateEntryMode("standard");
      setStoryRecommendation(null);
      setTrainingSourceIds([]);
      setTrainingPath("analyze");
      setView(hashView());
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    const workspace = document.querySelector<HTMLElement>(mobile ? ".mbody" : ".view-scroll");
    workspace?.scrollTo({ top: 0 });
    const frame = window.requestAnimationFrame(() => {
      const target = view === "dna"
        ? document.getElementById("creative-studio-direction") ?? workspace?.querySelector<HTMLElement>("h1, h2")
        : workspace?.querySelector<HTMLElement>("h1, h2, [role='tab'][aria-selected='true']");
      if (!target) return;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLButtonElement)) {
        target.setAttribute("tabindex", "-1");
      }
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeProjectId, mobile, view]);

  const navigate = (next: StudioView) => {
    if (next === view) {
      if (next === "dna") clearCreateHandoff();
      return;
    }
    clearCreateHandoff();
    setView(next);
    window.history.pushState(null, "", `#/${next}`);
  };

  const openVideoExtension = (artifactId: string) => {
    clearCreateHandoff();
    setVideoExtensionArtifactId(artifactId);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
  };

  const openEvolution = (sourceId: string) => {
    clearCreateHandoff();
    setEvolutionSourceId(sourceId);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
  };

  const openHomeCreate = (intent: Exclude<CreateIntent, "train">, sourceId?: string, videoEntryMode: VideoCreateEntryMode = "standard", recommendation: StoryRecommendationHandoff | null = null) => {
    clearCreateHandoff();
    setCreateSourceId(sourceId ?? "");
    setCreateIntent(intent);
    // Every entry point prepares this one composer. Only its Generate button
    // may submit work; navigation and source actions never claim the GPU.
    setVideoCreateEntryMode(intent === "video" ? videoEntryMode : "standard");
    setStoryRecommendation(recommendation);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
  };

  const openHomeTraining = (sourceId: string, path: "analyze" | "model" = "analyze") => {
    clearCreateHandoff();
    setTrainingSourceIds([sourceId]);
    setTrainingPath(path);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
  };

  const openReuseSetup = (artifact: Artifact) => {
    clearCreateHandoff();
    if (artifact.projectId !== activeProjectId) setActiveProjectId(artifact.projectId);
    setReuseArtifact(artifact);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
  };

  const openCockpitAction = (action: ProductionCockpitAction) => {
    if (action.projectId) setActiveProjectId(action.projectId);
    clearCreateHandoff();
    setCockpitTarget(action);
    setView(action.surface);
    window.history.pushState(null, "", `#/${action.surface}`);
  };

  const openFourWayAnimation = (sourceId: string) => openHomeCreate("video", sourceId, "four-way");

  const content = (() => {
    const studioSection = view === "media" ? "media" : view === "library" ? "memory" : view === "flows" ? "models" : view === "runtime" || view === "settings" || view === "system" ? "system" : "project";
    const studio = <StudioHub
      initialSection={studioSection}
      onOpenProject={(destination, action) => action ? openCockpitAction(action) : navigate(destination)}
      onCreate={() => navigate("dna")}
      onUseAsset={(sourceId, kind) => openHomeCreate(kind === "audio" ? "music" : kind, sourceId)}
      onEvolve={openEvolution}
      onAnimate={(sourceId) => openHomeCreate("video", sourceId)}
      onAnimateFourWay={openFourWayAnimation}
      onAnalyze={(sourceId) => openHomeTraining(sourceId, "analyze")}
      onTrain={(sourceId, kind) => openHomeTraining(sourceId, kind === "audio" ? "model" : "analyze")}
      initialSystemTab={view === "settings" ? "runners" : "status"}
    />;
    if (!activeProjectId && view !== "work" && view !== "cockpit" && view !== "queue") return studio;
    switch (view) {
      case "portal": return <PortalView navigate={navigate} onUseStoryRecommendation={(handoff) => openHomeCreate(handoff.recommendation.modality, handoff.recommendation.sourceId ?? undefined, "standard", handoff)} onOvernight={() => setOvernightOpen(true)} onOvernightReview={setOvernightReviewSessionId} />;
      case "dna": return <CreativeDnaWorkbench key={`${activeProjectId}:${videoExtensionArtifactId}:${evolutionSourceId}:${createSourceId}:${createIntent ?? ""}:${scopedReuseArtifact?.jobId ?? ""}:${videoCreateEntryMode}:${storyRecommendation?.recommendation.id ?? ""}:${storyRecommendation?.recommendation.version ?? ""}:${trainingSourceIds.join(",")}:${trainingPath}:${cockpitTarget?.entityId ?? ""}`} onQueued={() => navigate("queue")} onMedia={() => navigate("media")} onArtifacts={() => navigate("gallery")} onWorkflows={() => navigate("flows")} initialReviewJobId={cockpitTarget?.kind === "review-training" ? cockpitTarget.entityId : undefined} initialVideoExtensionArtifactId={videoExtensionArtifactId || undefined} initialEvolutionSourceId={evolutionSourceId || undefined} initialSourceId={createSourceId || undefined} initialCreateIntent={createIntent} initialReuseArtifact={scopedReuseArtifact ?? undefined} initialVideoCreateMode={videoCreateEntryMode} initialStoryRecommendation={storyRecommendation ?? undefined} initialTrainingAssetIds={trainingSourceIds} initialTrainingPath={trainingPath} onCockpitTargetHandled={() => setCockpitTarget(null)} />;
      case "work":
      case "cockpit":
      case "queue":
      case "gallery": return <WorkView
        initialSegment={view === "gallery" ? "results" : view === "cockpit" || view === "queue" ? "running" : undefined}
        focusRunId={cockpitTarget?.surface === "queue" ? cockpitTarget.entityId : undefined}
        focusArtifactId={cockpitTarget?.kind === "review-artifact" ? cockpitTarget.entityId : undefined}
        onOpen={openCockpitAction}
        onReuse={openReuseSetup}
        onContinueLoop={() => navigate("dna")}
        onExtendVideo={openVideoExtension}
        onEvolve={openEvolution}
        onAnimate={(sourceId) => openHomeCreate("video", sourceId)}
        onAnimateFourWay={openFourWayAnimation}
        onReviewOvernight={setOvernightReviewSessionId}
        onManageLoveLoop={() => navigate("portal")}
      />;
      case "studio":
      case "media":
      case "library":
      case "projects":
      case "runtime":
      case "flows":
      case "settings":
      case "system": return studio;
      default: return <PlaceholderView view={view} goBack={() => navigate("portal")} />;
    }
  })();

  if (loading) return <div className="studio-loading"><div className="brand-mark"><i className="bm-ring" /><i className="bm-orb" /></div><strong>Opening Creative Studio</strong></div>;

  const reviewSession = (snapshot?.overnightSessions ?? []).find((session) => session.id === overnightReviewSessionId) ?? null;
  const suspenseContent = <StudioViewBoundary><Suspense fallback={<StudioViewLoading />}>{content}</Suspense></StudioViewBoundary>;
  return <><div className="cosmos" />{snapshot?.adapter.development ? <div className="development-flag"><Icon name="wand" size={14} /> Development adapter · browser-only metadata</div> : null}{error && !snapshot ? <div className="fatal-error"><Icon name="close" size={22} /><h1>Creative Studio could not start</h1><p>{error}</p></div> : mobile ? <MobileShell view={view} navigate={navigate}>{suspenseContent}</MobileShell> : <DesktopShell view={view} navigate={navigate}>{suspenseContent}</DesktopShell>}
    {overnightOpen ? <Suspense fallback={null}><OvernightSetupSheet open projectId={activeProjectId} dnaArtifactId={activeDna?.artifactId ?? null} onClose={() => setOvernightOpen(false)} onArm={createOvernightSession} /></Suspense> : null}
    {overnightReviewSessionId ? <Suspense fallback={null}><MorningReviewSheet open session={reviewSession} onClose={() => setOvernightReviewSessionId("")} /></Suspense> : null}
  </>;
}
