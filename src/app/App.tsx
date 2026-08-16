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

const VIEWS = new Set<StudioView>(["portal", "dna", "media", "library", "gallery", "projects", "flows", "queue", "runtime", "settings"]);

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
  const { snapshot, loading, error, activeProjectId } = useStudio();
  const [view, setView] = useState<StudioView>(hashView);
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
    setView(next);
    window.history.pushState(null, "", `#/${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const content = (() => {
    if (!activeProjectId && view !== "projects" && view !== "runtime" && view !== "settings") return <ProjectsView />;
    switch (view) {
      case "portal": return <PortalView navigate={navigate} />;
      case "dna": return <CreativeDnaWorkbench onQueued={() => navigate("queue")} onMedia={() => navigate("media")} onArtifacts={() => navigate("gallery")} />;
      case "media": return <MediaView onGenerate={() => navigate("dna")} />;
      case "queue": return <QueueView />;
      case "gallery": return <ArtifactsView onQueued={() => navigate("queue")} onContinueLoop={() => navigate("dna")} />;
      case "library": return <LibraryView />;
      case "projects": return <ProjectsView />;
      case "runtime": return <RuntimeView />;
      case "flows": return <FlowsView />;
      case "settings": return <SettingsView />;
      default: return <PlaceholderView view={view} goBack={() => navigate("portal")} />;
    }
  })();

  if (loading) return <div className="studio-loading"><div className="brand-mark"><i className="bm-ring" /><i className="bm-orb" /></div><strong>Opening Creative Studio</strong></div>;

  return <><div className="cosmos" />{snapshot?.adapter.development ? <div className="development-flag"><Icon name="wand" size={14} /> Development adapter · browser-only metadata</div> : null}{error && !snapshot ? <div className="fatal-error"><Icon name="close" size={22} /><h1>Creative Studio could not start</h1><p>{error}</p></div> : mobile ? <MobileShell view={view} navigate={navigate}>{content}</MobileShell> : <DesktopShell view={view} navigate={navigate}>{content}</DesktopShell>}</>;
}
