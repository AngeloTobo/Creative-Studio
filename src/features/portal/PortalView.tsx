import { useStudio } from "../../app/StudioProvider";
import { Icon, type IconName } from "../../components/Icon";
import { ArtifactThumb, Orb, ProjectAvatar, SectionHead, StatusDot } from "../../components/Visuals";
import type { StudioView } from "../../app/views";

const NODES: Array<{ id: StudioView; label: string; sub: string; icon: IconName; accent: string; angle: number }> = [
  { id: "gallery", label: "Artifacts", sub: "Review retained outputs", icon: "gallery", accent: "var(--amber)", angle: 150 },
  { id: "projects", label: "Projects", sub: "Your creative workspaces", icon: "projects", accent: "var(--teal)", angle: 88 },
  { id: "cockpit", label: "Production", sub: "Runs, decisions, and recovery", icon: "analytics", accent: "var(--violet)", angle: 30 },
  { id: "system", label: "System", sub: "Local runner and services", icon: "runtime", accent: "var(--cyan)", angle: 320 },
];

export function PortalView({ navigate }: { navigate: (view: StudioView) => void }) {
  const { snapshot, activeProjectId } = useStudio();
  const project = snapshot?.projects.find((item) => item.id === activeProjectId);
  const activeJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId && (job.status === "queued" || job.status === "running")) ?? [];
  const recentArtifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId).slice(0, 4) ?? [];

  return (
    <div className="portal fade-up">
      <div className="orb-stage">
          <div className="orb-center"><Orb size={400} /></div>
          {NODES.map((node) => {
            const radians = node.angle * Math.PI / 180;
            const leftSide = Math.cos(radians) < -0.08;
            return <button key={node.id} className={`onode${leftSide ? " left" : ""}`} style={{ left: `${50 + Math.cos(radians) * 40}%`, top: `${47 + Math.sin(radians) * 40}%`, "--na": node.accent } as React.CSSProperties} onClick={() => navigate(node.id)}><span className="onode-ic"><Icon name={node.icon} size={24} /></span><span className="onode-tx"><strong className="ont-1">{node.label}</strong><span className="ont-2">{node.sub}</span></span></button>;
          })}
      </div>
      <button className="portal-input portal-prompt glass-strong" onClick={() => navigate("dna")}><span>Upload, choose a workflow, and create.</span><i><Icon name="arrow" size={19} /></i></button>

      <div className="portal-bottom portal-bottom-single">
        <section className="panel glass">
          <SectionHead label="Recent Artifacts" action="View all" onAction={() => navigate("gallery")} />
          <div className="recent-grid studio-recent-grid">
            {recentArtifacts.map((artifact) => <button className="rcard" key={artifact.id} onClick={() => navigate("gallery")}><ArtifactThumb artifact={artifact} /><span className="rc-meta"><span><strong className="rc-title">{artifact.name}</strong><span className="rc-sub">{artifact.provider}</span></span><span className="rc-ago">{artifact.status}</span></span></button>)}
            {!recentArtifacts.length ? <div className="empty-copy">Completed jobs will land here.</div> : null}
          </div>
        </section>
      </div>

      <div className="portal-status-row">
        {project ? <button className="mproj-card glass" onClick={() => navigate("projects")}><ProjectAvatar project={project} size={50} /><span className="mp-body"><strong className="mp-name">{project.name} <i className="badge active">{project.status}</i></strong><span className="mp-desc">{project.description}</span></span><Icon name="chevron" size={18} /></button> : null}
        <div className="mact-card glass">
          <SectionHead label="Active Production" action="View all" onAction={() => navigate("cockpit")} />
          {activeJobs.slice(0, 3).map((job) => <div className="mact-row" key={job.id}><span className="mini-job-art" style={{ background: job.modality === "music" ? "linear-gradient(135deg,#9d174d,#7c3aed)" : job.modality === "video" ? "linear-gradient(135deg,#312e81,#db2777)" : "linear-gradient(135deg,#0e7490,#a21caf)" }} /><span><strong className="ar-title">{job.modality === "music" ? "Music" : job.modality === "video" ? "Video" : "Image"} generation</strong><span className="ar-sub">{job.status} · {job.progress}%</span></span><StatusDot status={job.status} /></div>)}
          {!activeJobs.length ? <div className="empty-copy">Queue is clear.</div> : null}
        </div>
      </div>
    </div>
  );
}
