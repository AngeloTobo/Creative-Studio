import { useState } from "react";
import type { MediaKind, ProductionCockpitAction } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon, type IconName } from "../../components/Icon";
import { ProjectAvatar } from "../../components/Visuals";
import { LibraryView } from "../library/LibraryView";
import { MediaView } from "../media/MediaView";
import { ProjectsView, type ProjectDestination } from "../projects/ProjectsView";
import { capabilitiesNeedingAttention } from "../runtime/capabilityStatus";
import { SystemView, type SystemTab } from "../system/SystemView";
import { FlowsView } from "../workflows/FlowsView";
import "./StudioView.css";

export type StudioSection = "project" | "media" | "memory" | "models" | "system";

export type StudioViewProps = {
  initialSection?: StudioSection;
  section?: StudioSection;
  onSectionChange?: (section: StudioSection) => void;
  onOpenProject: (destination: ProjectDestination, action?: ProductionCockpitAction) => void;
  onCreate: () => void;
  onUseAsset?: (sourceId: string, kind: MediaKind) => void;
  onEvolve: (sourceId: string) => void;
  onAnimate: (sourceId: string) => void;
  onAnimateFourWay: (sourceId: string) => void;
  onAnalyze?: (sourceId: string) => void;
  onTrain?: (sourceId: string, kind: MediaKind) => void;
  initialSystemTab?: SystemTab;
};

const SECTIONS: Array<{ id: StudioSection; label: string; icon: IconName }> = [
  { id: "project", label: "Project", icon: "projects" },
  { id: "media", label: "Media", icon: "gallery" },
  { id: "memory", label: "Memory", icon: "dna" },
  { id: "models", label: "Models", icon: "flows" },
  { id: "system", label: "System", icon: "runtime" },
];

export function StudioView({
  initialSection = "project",
  section,
  onSectionChange,
  onOpenProject,
  onCreate,
  onUseAsset,
  onEvolve,
  onAnimate,
  onAnimateFourWay,
  onAnalyze,
  onTrain,
  initialSystemTab,
}: StudioViewProps) {
  const { snapshot, activeProjectId } = useStudio();
  const [selection, setSelection] = useState<{ initial: StudioSection; selected: StudioSection }>({ initial: initialSection, selected: initialSection });

  const activeProject = snapshot?.projects.find((project) => project.id === activeProjectId) ?? null;
  const internalSection = selection.initial === initialSection ? selection.selected : initialSection;
  const requestedSection = section ?? internalSection;
  const needsProject = requestedSection === "media" || requestedSection === "memory";
  const activeSection = activeProject || !needsProject ? requestedSection : "project";
  const projectMedia = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId).length ?? 0;
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId).length ?? 0;
  const projectEvidence = snapshot?.trainingExamples.filter((example) => example.projectId === activeProjectId && example.status === "training-ready").length ?? 0;
  const issueCount = capabilitiesNeedingAttention(snapshot?.capabilities ?? []).length;
  const projectCount = snapshot?.projects.filter((project) => project.status !== "archived").length ?? 0;

  const countFor = (id: StudioSection) => {
    if (id === "project") return projectCount;
    if (id === "media") return projectMedia;
    if (id === "memory") return projectDna + projectEvidence;
    if (id === "models") return snapshot?.workflows.length ?? 0;
    return issueCount;
  };

  const changeSection = (next: StudioSection) => {
    if (!activeProject && (next === "media" || next === "memory")) return;
    setSelection({ initial: initialSection, selected: next });
    onSectionChange?.(next);
  };

  return <section className="studio-hub fade-up" aria-label="Studio workspace">
    <header className="studio-hub-context glass">
      {activeProject ? <>
        <ProjectAvatar project={activeProject} size={46} />
        <span className="studio-hub-project"><small>Active project</small><strong>{activeProject.name}</strong><em>{activeProject.note || activeProject.type || "Creative project"}</em></span>
        <span className="studio-hub-facts"><b>{projectMedia}<small>media</small></b><b>{projectDna}<small>DNA</small></b><b>{projectEvidence}<small>evidence</small></b></span>
      </> : <><span className="studio-hub-empty-icon"><Icon name={activeSection === "system" ? "runtime" : activeSection === "models" ? "flows" : "projects"} size={22} /></span><span className="studio-hub-project"><small>{activeSection === "project" ? "Studio setup" : "Available before a project"}</small><strong>{activeSection === "system" ? "Local system" : activeSection === "models" ? "Model library" : "Create your first project"}</strong><em>{activeSection === "project" ? "A name is enough to begin." : activeSection === "models" ? "Browse now; select a project to import." : "No project required."}</em></span></>}
    </header>

    <nav className="studio-hub-tabs glass" role="tablist" aria-label="Studio tools">
      {SECTIONS.map((item) => {
        const disabled = !activeProject && (item.id === "media" || item.id === "memory");
        const count = countFor(item.id);
        return <button key={item.id} id={`studio-tab-${item.id}`} role="tab" aria-controls={`studio-panel-${item.id}`} aria-selected={activeSection === item.id} disabled={disabled} className={activeSection === item.id ? "on" : ""} onClick={() => changeSection(item.id)} title={disabled ? "Create a project first" : item.label}><Icon name={item.icon} size={17} /><span>{item.label}</span>{activeProject && (count || item.id === "system") ? <b className={item.id === "system" && count ? "warning" : ""}>{count}</b> : null}</button>;
      })}
    </nav>

    <div className="studio-hub-panel" id={`studio-panel-${activeSection}`} role="tabpanel" aria-labelledby={`studio-tab-${activeSection}`}>
      {activeSection === "project" ? <ProjectsView embedded onOpen={onOpenProject} /> : null}
      {activeSection === "media" ? <MediaView embedded onGenerate={onCreate} onUseAsset={onUseAsset} onEvolve={onEvolve} onAnimate={onAnimate} onAnimateFourWay={onAnimateFourWay} onAnalyze={onAnalyze} onTrain={onTrain} /> : null}
      {activeSection === "memory" ? <LibraryView embedded /> : null}
      {activeSection === "models" ? <FlowsView embedded /> : null}
      {activeSection === "system" ? <SystemView key={initialSystemTab} embedded initialTab={initialSystemTab} /> : null}
    </div>
  </section>;
}
