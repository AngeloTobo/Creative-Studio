import type { ReactNode } from "react";
import { useStudio } from "../app/StudioProvider";
import { VIEW_TITLES, type StudioView } from "../app/views";
import { Icon, type IconName } from "./Icon";
import { ProjectAvatar } from "./Visuals";

const NAV_MAIN: Array<{ id: StudioView; label: string; icon: IconName; badge?: string }> = [
  { id: "dna", label: "Create", icon: "wand" },
  { id: "portal", label: "Ideas", icon: "portal" },
  { id: "work", label: "Work", icon: "analytics" },
  { id: "studio", label: "Studio", icon: "projects" },
];

function primaryView(view: StudioView): StudioView {
  if (view === "cockpit" || view === "queue" || view === "gallery") return "work";
  if (view === "media" || view === "library" || view === "projects" || view === "flows" || view === "runtime" || view === "settings" || view === "system") return "studio";
  return view;
}

function NavItem({ item, active, navigate }: { item: (typeof NAV_MAIN)[number]; active: boolean; navigate: (view: StudioView) => void }) {
  return <button className={`nav-item${active ? " active" : ""}`} onClick={() => navigate(item.id)} title={item.label}><span className="ni-ic"><Icon name={item.icon} size={21} /></span><span>{item.label}</span>{item.badge ? <span className="ni-badge">{item.badge}</span> : null}</button>;
}

function Sidebar({ view, navigate }: { view: StudioView; navigate: (view: StudioView) => void }) {
  const { snapshot, activeProjectId, setActiveProjectId, busy } = useStudio();
  const projects = snapshot?.projects.filter((item) => item.status !== "archived") ?? [];
  const project = snapshot?.projects.find((item) => item.id === activeProjectId);
  const activeView = primaryView(view);
  return <aside className="sidebar scroll">
    <button className="brand" onClick={() => navigate("dna")}><span className="brand-mark"><i className="bm-ring" /><i className="bm-orb" /></span><span className="brand-txt"><b className="bt-1">CREATIVE</b><strong className="bt-2">STUDIO</strong><small className="bt-3">private creative workstation</small></span></button>
    <div className="nav-cap eyebrow">Studio</div><nav className="nav">{NAV_MAIN.map((item) => <NavItem key={item.id} item={item} active={activeView === item.id} navigate={navigate} />)}</nav>
    <div className="sb-spacer" />
    {project ? <div className="sb-proj"><div className="sb-proj-btn sb-project-switch"><button className="sb-project-manage" aria-label={`Manage ${project.name}`} disabled={busy} onClick={() => navigate("projects")}><ProjectAvatar project={project} size={40} /></button><label className="sp-meta"><span className="sp-sub">Active project</span><select aria-label="Active project" value={activeProjectId} disabled={busy} onChange={(event) => setActiveProjectId(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Icon className="sp-chev" name="chevronDown" size={16} /></div></div> : null}
    <button className="sb-user glass" onClick={() => navigate("studio")}><span className="su-av">A</span><span className="su-meta"><strong className="su-name">Angelo</strong><small className="su-role">Creative Director</small></span><Icon name="settings" size={17} /></button>
  </aside>;
}

function NotificationButton({ navigate, size }: { navigate: (view: StudioView) => void; size: number }) {
  const { snapshot } = useStudio();
  const count = snapshot?.productionCockpit.summary.actionRequired ?? 0;
  return <button className="btn-icon bell" aria-label={`Work notifications${count ? `, ${count} actions required` : ""}`} onClick={() => navigate("work")}><Icon name="bell" size={size} />{count ? <b className="notification-count">{count > 9 ? "9+" : count}</b> : null}</button>;
}

function TopBar({ view, navigate }: { view: StudioView; navigate: (view: StudioView) => void }) {
  const activeView = primaryView(view);
  const [title, subtitle] = VIEW_TITLES[activeView];
  const contentOwnsHeading = activeView === "dna" || activeView === "work" || activeView === "studio";
  return <header className={`topbar${contentOwnsHeading ? " topbar-compact" : ""}`}>{contentOwnsHeading ? null : <div className="greet"><h1>{title}</h1><p>{subtitle}</p></div>}<div className="topbar-spacer" /><NotificationButton navigate={navigate} size={20} /></header>;
}

export function DesktopShell({ view, navigate, children }: { view: StudioView; navigate: (view: StudioView) => void; children: ReactNode }) {
  return <div className="app no-right no-player"><Sidebar view={view} navigate={navigate} /><main className="main"><TopBar view={view} navigate={navigate} /><div className="view-scroll scroll">{children}</div></main></div>;
}

const MOBILE_TABS: Array<{ id: StudioView; label: string; icon: IconName }> = [
  { id: "dna", label: "Create", icon: "wand" },
  { id: "portal", label: "Ideas", icon: "portal" },
  { id: "work", label: "Work", icon: "analytics" },
  { id: "studio", label: "Studio", icon: "projects" },
];

const CONTENT_OWNS_MOBILE_HEADING = new Set<StudioView>(["work", "studio", "cockpit", "dna", "gallery", "projects"]);

export function MobileShell({ view, navigate, children }: { view: StudioView; navigate: (view: StudioView) => void; children: ReactNode }) {
  const { snapshot, activeProjectId, setActiveProjectId, busy } = useStudio();
  const activeView = primaryView(view);
  const showHeading = view !== "portal" && !CONTENT_OWNS_MOBILE_HEADING.has(activeView);
  const projects = snapshot?.projects.filter((project) => project.status !== "archived") ?? [];
  return <div className="mshell"><header className="mtop"><button className="mt-brand" aria-label="Create" onClick={() => navigate("dna")}><span className="mt-mark"><i className="bm-orb" /></span><strong className="mt-name">Creative <b>Studio</b></strong></button><span className="mt-sp" />{projects.length ? <label className="mobile-project-switch"><span className="visually-hidden">Active project</span><select aria-label="Active project" value={activeProjectId} disabled={busy} onChange={(event) => setActiveProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><Icon name="chevronDown" size={13} /></label> : null}<NotificationButton navigate={navigate} size={19} /></header><main className={`mbody scroll mbody-${view}`}>{showHeading ? <div className="mview-head"><h1>{VIEW_TITLES[view][0]}</h1><p>{VIEW_TITLES[view][1]}</p></div> : null}{children}</main><nav className="mtabbar" aria-label="Primary navigation">{MOBILE_TABS.map((tab) => <button key={tab.id} className={`mtab${activeView === tab.id ? " on" : ""}`} aria-current={activeView === tab.id ? "page" : undefined} onClick={() => navigate(tab.id)}><span className="mtab-ic"><Icon name={tab.icon} size={22} /></span>{tab.label}</button>)}</nav></div>;
}
