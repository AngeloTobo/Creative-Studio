import { useEffect, useState } from "react";
import { useStudio } from "./StudioProvider";
import { type StudioView } from "./views";
import { DesktopShell, MobileShell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { CreativeDnaWorkbench } from "../features/creative-dna/CreativeDnaWorkbench";
import { ArtifactsView } from "../features/artifacts/ArtifactsView";
import { PortalView } from "../features/portal/PortalView";
import { LibraryView } from "../features/library/LibraryView";
import { ProjectsView } from "../features/projects/ProjectsView";
import { RuntimeView } from "../features/runtime/RuntimeView";
import { MediaView } from "../features/media/MediaView";
import { PlaceholderView } from "../features/placeholder/PlaceholderView";
import { FlowsView } from "../features/workflows/FlowsView";
import { SettingsView } from "../features/settings/SettingsView";
import { CockpitView } from "../features/cockpit/CockpitView";
import { SystemView } from "../features/system/SystemView";
import type { ProductionCockpitAction } from "../../shared/contracts";
import type { CreateIntent } from "../features/generation/quickCreate";

const VIEWS = new Set<StudioView>(["portal", "cockpit", "dna", "media", "library", "gallery", "projects", "flows", "queue", "runtime", "settings", "system"]);

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
  const { snapshot, loading, error, activeProjectId, setActiveProjectId } = useStudio();
  const [view, setView] = useState<StudioView>(hashView);
  const [cockpitTarget, setCockpitTarget] = useState<ProductionCockpitAction | null>(null);
  const [videoExtensionArtifactId, setVideoExtensionArtifactId] = useState("");
  const [evolutionSourceId, setEvolutionSourceId] = useState("");
  const [createSourceId, setCreateSourceId] = useState("");
  const [createIntent, setCreateIntent] = useState<CreateIntent | undefined>();
  const [createAutoStart, setCreateAutoStart] = useState(false);
  const [trainingSourceIds, setTrainingSourceIds] = useState<string[]>([]);
  const mobile = useResponsive();
  useEffect(() => {
    const update = () => setView(hashView());
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
    setTrainingSourceIds([]);
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
    setTrainingSourceIds([]);
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
    setTrainingSourceIds([]);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openHomeCreate = (intent: Exclude<CreateIntent, "train">, sourceId?: string, autoStart = false) => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId(sourceId ?? "");
    setCreateIntent(intent);
    setCreateAutoStart(autoStart);
    setTrainingSourceIds([]);
    setView("dna");
    window.history.pushState(null, "", "#/dna");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openHomeTraining = (sourceId: string) => {
    setCockpitTarget(null);
    setVideoExtensionArtifactId("");
    setEvolutionSourceId("");
    setCreateSourceId("");
    setCreateIntent(undefined);
    setCreateAutoStart(false);
    setTrainingSourceIds([sourceId]);
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
    setTrainingSourceIds([]);
    setCockpitTarget(action);
    setView(action.surface);
    window.history.pushState(null, "", `#/${action.surface}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const content = (() => {
    if (!activeProjectId && view !== "cockpit" && view !== "projects" && view !== "runtime" && view !== "settings" && view !== "system") return <ProjectsView onOpen={(destination, action) => action ? openCockpitAction(action) : navigate(destination)} />;
    switch (view) {
      case "portal": return <PortalView navigate={navigate} onCreate={openHomeCreate} onTrain={openHomeTraining} />;
      case "cockpit": return <CockpitView focusRunId={cockpitTarget?.surface === "queue" ? cockpitTarget.entityId : undefined} onOpen={openCockpitAction} />;
      case "dna": return <CreativeDnaWorkbench key={`${activeProjectId}:${videoExtensionArtifactId}:${evolutionSourceId}:${createSourceId}:${createIntent ?? ""}:${createAutoStart}:${trainingSourceIds.join(",")}:${cockpitTarget?.entityId ?? ""}`} onQueued={() => navigate("queue")} onMedia={() => navigate("media")} onArtifacts={() => navigate("gallery")} onWorkflows={() => navigate("flows")} initialReviewJobId={cockpitTarget?.kind === "review-training" ? cockpitTarget.entityId : undefined} initialVideoExtensionArtifactId={videoExtensionArtifactId || undefined} initialEvolutionSourceId={evolutionSourceId || undefined} initialSourceId={createSourceId || undefined} initialCreateIntent={createIntent} initialAutoStart={createAutoStart} initialTrainingAssetIds={trainingSourceIds} onCockpitTargetHandled={() => setCockpitTarget(null)} />;
      case "media": return <MediaView onGenerate={() => navigate("dna")} onEvolve={openEvolution} onAnimate={(sourceId) => openHomeCreate("video", sourceId, true)} />;
      case "queue": return <CockpitView focusRunId={cockpitTarget?.surface === "queue" ? cockpitTarget.entityId : undefined} onOpen={openCockpitAction} />;
      case "gallery": return <ArtifactsView onQueued={() => navigate("queue")} onContinueLoop={() => navigate("dna")} onExtendVideo={openVideoExtension} onEvolve={openEvolution} onAnimate={(sourceId) => openHomeCreate("video", sourceId, true)} focusArtifactId={cockpitTarget?.kind === "review-artifact" ? cockpitTarget.entityId : undefined} />;
      case "library": return <LibraryView />;
      case "projects": return <ProjectsView onOpen={(destination, action) => action ? openCockpitAction(action) : navigate(destination)} />;
      case "runtime": return <RuntimeView />;
      case "flows": return <FlowsView />;
      case "settings": return <SettingsView />;
      case "system": return <SystemView />;
      default: return <PlaceholderView view={view} goBack={() => navigate("portal")} />;
    }
  })();

  if (loading) return <div className="studio-loading"><div className="brand-mark"><i className="bm-ring" /><i className="bm-orb" /></div><strong>Opening Creative Studio</strong></div>;

  return <><div className="cosmos" />{snapshot?.adapter.development ? <div className="development-flag"><Icon name="wand" size={14} /> Development adapter · browser-only metadata</div> : null}{error && !snapshot ? <div className="fatal-error"><Icon name="close" size={22} /><h1>Creative Studio could not start</h1><p>{error}</p></div> : mobile ? <MobileShell view={view} navigate={navigate}>{content}</MobileShell> : <DesktopShell view={view} navigate={navigate}>{content}</DesktopShell>}</>;
}
