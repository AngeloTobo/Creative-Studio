import { useEffect, useState } from "react";
import { useStudio } from "./StudioProvider";
import { type StudioView } from "./views";
import { DesktopShell, MobileShell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { CreativeDnaWorkbench } from "../features/creative-dna/CreativeDnaWorkbench";
import { PortalView } from "../features/portal/PortalView";
import { PlaceholderView } from "../features/placeholder/PlaceholderView";
import { WorkView } from "../features/work/WorkView";
import { StudioView as StudioHub } from "../features/studio/StudioView";
import type { ProductionCockpitAction } from "../../shared/contracts";
import type { VideoCreateEntryMode } from "../features/generation/createEntry";
import type { CreateIntent } from "../features/generation/quickCreate";
import { MorningReviewSheet, OvernightSetupSheet } from "../features/overnight";

const VIEWS = new Set<StudioView>(["portal", "dna", "work", "studio", "cockpit", "media", "library", "gallery", "projects", "flows", "queue", "runtime", "settings", "system"]);

function hashView(): StudioView {
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (raw === "generate") return "dna";
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

export function App() {
  const { snapshot, loading, error, activeProjectId, activeDna, setActiveProjectId, createOvernightSession } = useStudio();
  const [view, setView] = useState<StudioView>(hashView);
  const [cockpitTarget, setCockpitTarget] = useState<ProductionCockpitAction | null>(null);
  const [videoExtensionArtifactId, setVideoExtensionArtifactId] = useState("");
  const [evolutionSourceId, setEvolutionSourceId] = useState("");
  const [createSourceId, setCreateSourceId] = useState("");
  const [createIntent, setCreateIntent] = useState<CreateIntent | undefined>();
  const [createAutoStart, setCreateAutoStart] = useState(false);
  const [videoCreateEntryMode, setVideoCreateEntryMode] = useState<VideoCreateEntryMode>("standard");
  const [trainingSourceIds, setTrainingSourceIds] = useState<string[]>([]);
  const [trainingPath, setTrainingPath] = useState<"analyze" | "model">("analyze");
  const [overnightOpen, setOvernightOpen] = useState(false);
  const [overnightReviewSessionId, setOvernightReviewSessionId] = useState("");
  const mobile = useResponsive();
  useEffect(() => {
    const update = () => {
      setCockpitTarget(null);
      setVideoExtensionArtifactId("");
      setEvolutionSourceId("");
      setCreateSourceId("");
      setCreateIntent(undefined);
      setCreateAutoStart(false);
      setVideoCreateEntryMode("standard");
      setTrainingSourceIds([]);
      setTrainingPath("analyze");
      setView(hashView());
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    document.querySelector(mobile ? ".mbody" : ".view-scroll")?.scrollTo({ top: 0 });
  }, [activeProjectId, mobile, view]);

  const navigate = (next: StudioView) => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId("");
    setCreateIntent(undefined);
    setCreateAutoStart(false);
    setVideoCreateEntryMode("standard");
    setTrainingSourceIds([]);
    setTrainingPath("analyze");
    setView(next);
    window.history.pushState(null, "", `#/${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openVideoExtension = (artifactId: string) => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId(artifactId);
    setEvolutionSourceId("");
    setCreateSourceId("");
    setCreateIntent(undefined);
    setCreateAutoStart(false);
    setVideoCreateEntryMode("standard");
    setTrainingSourceIds([]);
    setTrainingPath("analyze");
    setView("dna");
    window.history.pushState(null, "", "#/dna");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openEvolution = (sourceId: string) => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId(sourceId);
    setCreateSourceId("");
    setCreateIntent(undefined);
    setCreateAutoStart(false);
    setVideoCreateEntryMode("standard");
    setTrainingSourceIds([]);
    setTrainingPath("analyze");
    setView("dna");
    window.history.pushState(null, "", "#/dna");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openHomeCreate = (intent: Exclude<CreateIntent, "train">, sourceId?: string, autoStart = false, videoEntryMode: VideoCreateEntryMode = "standard") => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId(sourceId ?? "");
    setCreateIntent(intent);
    setCreateAutoStart(autoStart);
    setVideoCreateEntryMode(intent === "video" ? videoEntryMode : "standard");
    setTrainingSourceIds([]);
    setTrainingPath("analyze");
    setView("dna");
    window.history.pushState(null, "", "#/dna");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openHomeTraining = (sourceId: string, path: "analyze" | "model" = "analyze") => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId("");
    setCreateIntent(undefined);
    setCreateAutoStart(false);
    setVideoCreateEntryMode("standard");
    setTrainingSourceIds([sourceId]);
    setTrainingPath(path);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openCockpitAction = (action: ProductionCockpitAction) => {
    if (action.projectId) setActiveProjectId(action.projectId);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId("");
    setCreateIntent(undefined);
    setCreateAutoStart(false);
    setVideoCreateEntryMode("standard");
    setTrainingSourceIds([]);
    setTrainingPath("analyze");
    setCockpitTarget(action);
    setView(action.surface);
    window.history.pushState(null, "", `#/${action.surface}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openFourWayAnimation = (sourceId: string) => openHomeCreate("video", sourceId, true, "four-way");

  const content = (() => {
    const studioSection = view === "media" ? "media" : view === "library" ? "memory" : view === "flows" ? "models" : view === "runtime" || view === "settings" || view === "system" ? "system" : "project";
    const studio = <StudioHub
      initialSection={studioSection}
      onOpenProject={(destination, action) => action ? openCockpitAction(action) : navigate(destination)}
      onCreate={() => navigate("dna")}
      onUseAsset={(sourceId, kind) => openHomeCreate(kind === "audio" ? "music" : kind, sourceId)}
      onEvolve={openEvolution}
      onAnimate={(sourceId) => openHomeCreate("video", sourceId, true)}
      onAnimateFourWay={openFourWayAnimation}
      onAnalyze={(sourceId) => openHomeTraining(sourceId, "analyze")}
      onTrain={(sourceId, kind) => openHomeTraining(sourceId, kind === "audio" ? "model" : "analyze")}
      initialSystemTab={view === "settings" ? "runners" : "status"}
    />;
    if (!activeProjectId && view !== "work" && view !== "cockpit" && view !== "queue") return studio;
    switch (view) {
      case "portal": return <PortalView navigate={navigate} onCreate={openHomeCreate} onTrain={openHomeTraining} onOvernight={() => setOvernightOpen(true)} onOvernightReview={setOvernightReviewSessionId} />;
      case "dna": return <CreativeDnaWorkbench key={`${activeProjectId}:${videoExtensionArtifactId}:${evolutionSourceId}:${createSourceId}:${createIntent ?? ""}:${createAutoStart}:${videoCreateEntryMode}:${trainingSourceIds.join(",")}:${trainingPath}:${cockpitTarget?.entityId ?? ""}`} onQueued={() => navigate("queue")} onMedia={() => navigate("media")} onArtifacts={() => navigate("gallery")} onWorkflows={() => navigate("flows")} initialReviewJobId={cockpitTarget?.kind === "review-training" ? cockpitTarget.entityId : undefined} initialVideoExtensionArtifactId={videoExtensionArtifactId || undefined} initialEvolutionSourceId={evolutionSourceId || undefined} initialSourceId={createSourceId || undefined} initialCreateIntent={createIntent} initialAutoStart={createAutoStart} initialVideoCreateMode={videoCreateEntryMode} initialTrainingAssetIds={trainingSourceIds} initialTrainingPath={trainingPath} onCockpitTargetHandled={() => setCockpitTarget(null)} />;
      case "work":
      case "cockpit":
      case "queue":
      case "gallery": return <WorkView
        key={view}
        initialSegment={view === "gallery" ? "results" : view === "cockpit" || view === "queue" ? "running" : undefined}
        focusRunId={cockpitTarget?.surface === "queue" ? cockpitTarget.entityId : undefined}
        focusArtifactId={cockpitTarget?.kind === "review-artifact" ? cockpitTarget.entityId : undefined}
        onOpen={openCockpitAction}
        onQueued={() => navigate("work")}
        onContinueLoop={() => navigate("dna")}
        onExtendVideo={openVideoExtension}
        onEvolve={openEvolution}
        onAnimate={(sourceId) => openHomeCreate("video", sourceId, true)}
        onAnimateFourWay={openFourWayAnimation}
        onReviewOvernight={setOvernightReviewSessionId}
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
  return <><div className="cosmos" />{snapshot?.adapter.development ? <div className="development-flag"><Icon name="wand" size={14} /> Development adapter · browser-only metadata</div> : null}{error && !snapshot ? <div className="fatal-error"><Icon name="close" size={22} /><h1>Creative Studio could not start</h1><p>{error}</p></div> : mobile ? <MobileShell view={view} navigate={navigate}>{content}</MobileShell> : <DesktopShell view={view} navigate={navigate}>{content}</DesktopShell>}
    <OvernightSetupSheet open={overnightOpen} projectId={activeProjectId} dnaArtifactId={activeDna?.artifactId ?? null} onClose={() => setOvernightOpen(false)} onArm={createOvernightSession} />
    <MorningReviewSheet open={Boolean(overnightReviewSessionId)} session={reviewSession} onClose={() => setOvernightReviewSessionId("")} />
  </>;
}
