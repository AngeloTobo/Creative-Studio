import { useEffect, useState } from "react";
import { useStudio } from "./StudioProvider";
import { type StudioView } from "./views";
import { DesktopShell, MobileShell } from "../components/Shell";
import { Icon } from "../components/Icon";
import { CreativeDnaWorkbench } from "../features/creative-dna/CreativeDnaWorkbench";
import { QueueView } from "../features/generation/QueueView";
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
    setView(next);
    window.history.pushState(null, "", `#/${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openCockpitAction = (action: ProductionCockpitAction) => {
    if (action.projectId) setActiveProjectId(action.projectId);
    setCockpitTarget(action);
    setView(action.surface);
    window.history.pushState(null, "", `#/${action.surface}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const content = (() => {
    if (!activeProjectId && view !== "cockpit" && view !== "projects" && view !== "runtime" && view !== "settings" && view !== "system") return <ProjectsView onOpen={navigate} />;
    switch (view) {
      case "portal": return <PortalView navigate={navigate} />;
      case "cockpit": return <CockpitView onOpen={openCockpitAction} />;
      case "dna": return <CreativeDnaWorkbench key={activeProjectId} onQueued={() => navigate("queue")} onMedia={() => navigate("media")} onArtifacts={() => navigate("gallery")} onWorkflows={() => navigate("flows")} initialReviewJobId={cockpitTarget?.kind === "review-training" ? cockpitTarget.entityId : undefined} onCockpitTargetHandled={() => setCockpitTarget(null)} />;
      case "media": return <MediaView onGenerate={() => navigate("dna")} />;
      case "queue": return <QueueView focusRunId={cockpitTarget?.surface === "queue" ? cockpitTarget.entityId : undefined} />;
      case "gallery": return <ArtifactsView onQueued={() => navigate("queue")} onContinueLoop={() => navigate("dna")} focusArtifactId={cockpitTarget?.kind === "review-artifact" ? cockpitTarget.entityId : undefined} />;
      case "library": return <LibraryView />;
      case "projects": return <ProjectsView onOpen={navigate} />;
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
