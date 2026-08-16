import type { ReactNode } from "react";
import { useStudio } from "../app/StudioProvider";
import { VIEW_TITLES, type StudioView } from "../app/views";
import { Icon, type IconName } from "./Icon";
import { ProjectAvatar, StatusDot } from "./Visuals";

const NAV_MAIN: Array<{ id: StudioView; label: string; icon: IconName; badge?: string }> = [
  { id: "portal", label: "Portal", icon: "portal" },
  { id: "dna", label: "CreativeDNA", icon: "dna", badge: "TRAIN" },
  { id: "media", label: "Media", icon: "image" },
  { id: "library", label: "Library", icon: "library" },
  { id: "gallery", label: "Artifacts", icon: "gallery" },
  { id: "projects", label: "Projects", icon: "projects" },
  { id: "flows", label: "Flows", icon: "flows" },
  { id: "queue", label: "Queue", icon: "queue" },
];

const NAV_SYSTEM: Array<{ id: StudioView; label: string; icon: IconName }> = [
  { id: "runtime", label: "Runtime", icon: "runtime" },
  { id: "settings", label: "Settings", icon: "settings" },
];

function NavItem({ item, active, navigate }: { item: (typeof NAV_MAIN)[number]; active: boolean; navigate: (view: StudioView) => void }) {
  return <button className={`nav-item${active ? " active" : ""}`} onClick={() => navigate(item.id)} title={item.label}><span className="ni-ic"><Icon name={item.icon} size={21} /></span><span>{item.label}</span>{item.badge ? <span className="ni-badge">{item.badge}</span> : null}</button>;
}

function Sidebar({ view, navigate }: { view: StudioView; navigate: (view: StudioView) => void }) {
  const { snapshot, activeProjectId } = useStudio();
  const project = snapshot?.projects.find((item) => item.id === activeProjectId);
  return <aside className="sidebar scroll">
    <button className="brand" onClick={() => navigate("portal")}><span className="brand-mark"><i className="bm-ring" /><i className="bm-orb" /></span><span className="brand-txt"><b className="bt-1">CREATIVE</b><strong className="bt-2">STUDIO</strong><small className="bt-3">private creative workstation</small></span></button>
    <div className="nav-cap eyebrow">Create</div><nav className="nav">{NAV_MAIN.map((item) => <NavItem key={item.id} item={item} active={view === item.id} navigate={navigate} />)}</nav>
    <div className="nav-cap eyebrow">System</div><nav className="nav">{NAV_SYSTEM.map((item) => <NavItem key={item.id} item={item} active={view === item.id} navigate={navigate} />)}</nav>
    <div className="sb-spacer" />
    {project ? <div className="sb-proj"><button className="sb-proj-btn" onClick={() => navigate("projects")}><ProjectAvatar project={project} size={40} /><span className="sp-meta"><strong className="sp-name">{project.name}</strong><small className="sp-sub">Active project</small></span><Icon name="chevronDown" size={16} /></button></div> : null}
    <div className="sb-user glass"><span className="su-av">A</span><span className="su-meta"><strong className="su-name">Angelo</strong><small className="su-role">Creative Director</small></span><Icon name="settings" size={17} /></div>
  </aside>;
}

function TopBar({ view }: { view: StudioView }) {
  const [title, subtitle] = VIEW_TITLES[view];
  return <header className="topbar"><div className="greet"><h1>{title}</h1><p>{subtitle}</p></div><div className="topbar-spacer" /><div className="searchbar"><Icon name="search" size={18} /><input aria-label="Search Creative Studio" placeholder="Search Studio…" /><span className="kbd">⌘K</span></div><button className="btn-icon bell" aria-label="Notifications"><Icon name="bell" size={20} /></button></header>;
}

function RightPanel({ navigate }: { navigate: (view: StudioView) => void }) {
  const { snapshot, activeProjectId, activeDna } = useStudio();
  const project = snapshot?.projects.find((item) => item.id === activeProjectId);
  const projectJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId) ?? [];
  const activeJobs = projectJobs.filter((job) => job.status === "queued" || job.status === "running");
  return <aside className="rightpanel scroll">
    {project ? <section className="rp-card glass"><div className="rp-head"><span className="eyebrow">Active Project</span><button className="link-btn" onClick={() => navigate("projects")}>View all</button></div><div className="rp-proj"><ProjectAvatar project={project} size={54} /><span className="rpp-body"><strong className="rpp-name">{project.name} <i className="badge active">{project.status}</i></strong><p className="rpp-desc">{project.description}</p></span></div></section> : null}
    <section className="rp-card glass"><div className="rp-head"><span className="eyebrow">CreativeDNA</span><button className="link-btn" onClick={() => navigate("dna")}>Open</button></div>{activeDna ? <div className="active-dna-card"><span className="dna-version">v{activeDna.version}</span><strong>{activeDna.name}</strong><small>{activeDna.targetModality} · {activeDna.source.kind === "commercial_reference" ? "rights-safe" : "original"}</small></div> : <p className="empty-copy">Select or build a blueprint.</p>}</section>
    <section className="rp-card glass"><div className="rp-head"><span className="eyebrow">Queue Overview</span><button className="link-btn" onClick={() => navigate("queue")}>View all</button></div><div className="queue-mini"><div className="qm-stat"><strong className="qm-num">{activeJobs.length}</strong><span className="qm-lab">Active</span></div><div className="qm-stat"><strong className="qm-num">{projectJobs.filter((job) => job.status === "completed").length}</strong><span className="qm-lab">Done</span></div><div className="qm-stat"><strong className="qm-num">{projectJobs.filter((job) => job.status === "failed").length}</strong><span className="qm-lab">Failed</span></div></div>{activeJobs.slice(0, 3).map((job) => <div className="act-row" key={job.id}><StatusDot status={job.status} /><span><strong>{job.modality}</strong><small>{job.status} · {job.progress}%</small></span></div>)}</section>
    <section className="rp-card glass"><div className="rp-head"><span className="eyebrow">Runtime</span><button className="link-btn" onClick={() => navigate("runtime")}>Inspect</button></div>{snapshot?.capabilities.slice(0, 4).map((capability) => <div className="runtime-row" key={capability.key}><i className={capability.state} /><span><strong>{capability.label}</strong><small>{capability.state}</small></span></div>)}</section>
  </aside>;
}

function ReviewDock({ navigate }: { navigate: (view: StudioView) => void }) {
  const { snapshot, activeProjectId } = useStudio();
  const latest = snapshot?.artifacts.find((artifact) => artifact.projectId === activeProjectId);
  return <footer className="player"><div className="pl-now"><span className="pln-thumb" style={{ background: latest ? `linear-gradient(135deg,${latest.preview.colors[0]},${latest.preview.colors[1]})` : "linear-gradient(135deg,#312e81,#831843)" }} /><span><strong className="pln-title">{latest?.name ?? "Review dock"}</strong><small className="pln-sub">{latest ? `${latest.kind} · ${latest.status}` : "Completed artifacts wait here"}</small></span></div><div className="review-dock-center"><span className="eyebrow">Creative loop</span><strong>DNA → job → artifact → decision</strong></div><button className="btn btn-ghost" onClick={() => navigate("gallery")}><Icon name="gallery" size={16} /> Review artifacts</button></footer>;
}

export function DesktopShell({ view, navigate, children }: { view: StudioView; navigate: (view: StudioView) => void; children: ReactNode }) {
  return <div className="app"><Sidebar view={view} navigate={navigate} /><main className="main"><TopBar view={view} /><div className="view-scroll scroll">{children}</div></main><RightPanel navigate={navigate} /><ReviewDock navigate={navigate} /></div>;
}

const MOBILE_TABS: Array<{ id: StudioView | "more"; label: string; icon: IconName }> = [
  { id: "portal", label: "Portal", icon: "portal" },
  { id: "dna", label: "DNA", icon: "dna" },
  { id: "media", label: "Media", icon: "image" },
  { id: "gallery", label: "Artifacts", icon: "gallery" },
  { id: "more", label: "More", icon: "more" },
];

export function MobileShell({ view, navigate, children }: { view: StudioView; navigate: (view: StudioView) => void; children: ReactNode }) {
  const moreActive = ["library", "projects", "flows", "queue", "runtime", "settings"].includes(view);
  return <div className="mshell"><header className="mtop"><span className="mt-mark"><i className="bm-orb" /></span><strong className="mt-name">Creative <b>Studio</b></strong><span className="mt-sp" /><button className="btn-icon bell" aria-label="Notifications"><Icon name="bell" size={19} /></button></header><main className="mbody scroll">{view !== "portal" ? <div className="mview-head"><h1>{VIEW_TITLES[view][0]}</h1><p>{VIEW_TITLES[view][1]}</p></div> : null}{children}</main><nav className="mtabbar">{MOBILE_TABS.map((tab) => <button key={tab.id} className={`mtab${tab.id === "more" ? moreActive ? " on" : "" : view === tab.id ? " on" : ""}`} onClick={() => navigate(tab.id === "more" ? "queue" : tab.id)}><span className="mtab-ic"><Icon name={tab.icon} size={22} /></span>{tab.label}</button>)}</nav></div>;
}
