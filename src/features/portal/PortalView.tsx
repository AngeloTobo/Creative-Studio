import { useStudio } from "../../app/StudioProvider";
import { Icon, type IconName } from "../../components/Icon";
import { ArtifactThumb, Orb, ProjectAvatar, SectionHead, StatusDot } from "../../components/Visuals";
import type { StudioView } from "../../app/views";

const NODES: Array<{ id: StudioView; label: string; sub: string; icon: IconName; accent: string; angle: number }> = [
  { id: "dna", label: "CreativeDNA", sub: "Build, train, and generate", icon: "dna", accent: "var(--pink)", angle: 220 },
  { id: "media", label: "Media", sub: "Upload training sources", icon: "image", accent: "var(--purple)", angle: 178 },
  { id: "library", label: "Library", sub: "DNA, rules, and memory", icon: "library", accent: "var(--blue)", angle: 136 },
  { id: "projects", label: "Projects", sub: "Your worlds and systems", icon: "projects", accent: "var(--teal)", angle: 92 },
  { id: "gallery", label: "Gallery", sub: "Review retained artifacts", icon: "gallery", accent: "var(--amber)", angle: 50 },
  { id: "flows", label: "Workflows", sub: "Import or build a ComfyUI graph", icon: "flows", accent: "var(--rose)", angle: 8 },
  { id: "queue", label: "Queue", sub: "Durable generation state", icon: "queue", accent: "var(--violet)", angle: 312 },
];

const CREATE_CARDS: Array<{ id: StudioView; label: string; desc: string; icon: IconName; accent: string }> = [
  { id: "dna", label: "CreativeDNA", desc: "Build or train from retained uploads.", icon: "dna", accent: "var(--pink)" },
  { id: "dna", label: "Image", desc: "Translate saved DNA into a visual job.", icon: "image", accent: "var(--cyan)" },
  { id: "dna", label: "Music", desc: "Translate the same DNA into a music job.", icon: "music", accent: "var(--violet)" },
];

export function PortalView({ navigate }: { navigate: (view: StudioView) => void }) {
  const { snapshot, activeProjectId, selectDna } = useStudio();
  const project = snapshot?.projects.find((item) => item.id === activeProjectId);
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
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
      <button className="portal-input portal-prompt glass-strong" onClick={() => navigate("dna")}><span>Start with an idea… shape it into CreativeDNA.</span><i><Icon name="arrow" size={19} /></i></button>

      <div className="portal-bottom">
        <section className="panel glass">
          <SectionHead label="Create Something New" />
          <div className="create-cards studio-create-cards">
            {CREATE_CARDS.map((card, index) => <button key={`${card.label}-${index}`} className="ccard" style={{ "--ca": card.accent } as React.CSSProperties} onClick={() => {
              if (card.label !== "CreativeDNA" && projectDna[0]) selectDna(projectDna[0]);
              navigate(card.id);
            }}><span className="ccard-top"><span className="ccard-ic"><Icon name={card.icon} size={20} /></span><strong className="ccard-name">{card.label}</strong><span className="ccard-desc">{card.desc}</span></span><span className="ccard-art"><span className="cca-g" /><span className="cca-wave">{Array.from({ length: 22 }, (_, bar) => <i key={bar} style={{ height: `${18 + Math.abs(Math.sin(bar * 0.9 + card.label.length)) * 80}%` }} />)}</span></span></button>)}
          </div>
        </section>

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
          <SectionHead label="Creative Queue" action="View all" onAction={() => navigate("queue")} />
          {activeJobs.slice(0, 3).map((job) => <div className="mact-row" key={job.id}><span className="mini-job-art" style={{ background: job.modality === "music" ? "linear-gradient(135deg,#9d174d,#7c3aed)" : "linear-gradient(135deg,#0e7490,#a21caf)" }} /><span><strong className="ar-title">{job.modality === "music" ? "Music" : "Image"} generation</strong><span className="ar-sub">{job.status} · {job.progress}%</span></span><StatusDot status={job.status} /></div>)}
          {!activeJobs.length ? <div className="empty-copy">Queue is clear.</div> : null}
        </div>
      </div>
    </div>
  );
}
