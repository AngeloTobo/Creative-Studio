import type { Artifact, Job, Project } from "../../shared/contracts";
import { Icon } from "./Icon";

export function Orb({ size = 260 }: { size?: number }) {
  const particles = Array.from({ length: 12 }, (_, index) => ({
    x: 42 + ((index * 37) % 17),
    y: 41 + ((index * 53) % 19),
    px: -42 + ((index * 29) % 84),
    py: -48 + ((index * 41) % 88),
    delay: -((index * 0.47) % 7),
    duration: 7 + (index % 5),
  }));
  return (
    <div className="orb-wrap" style={{ "--orb-size": `${size}px` } as React.CSSProperties} aria-label="Creative Studio portal">
      <div className="orb-halo" />
      <div className="orb-orbits"><div className="ring" /><div className="ring r2" /><div className="ring r3" /></div>
      <div className="orb-ring a" /><div className="orb-ring b" />
      <div className="orb-sphere"><div className="orb-plasma" /><div className="orb-plasma p2" /></div>
      <div className="orb-core" /><div className="orb-glass" />
      {particles.map((particle, index) => <i key={index} className="orb-particle" style={{ left: `${particle.x}%`, top: `${particle.y}%`, "--px": `${particle.px}px`, "--py": `${particle.py}px`, "--pdelay": `${particle.delay}s`, "--pd": particle.duration } as React.CSSProperties} />)}
      <div className="orb-logo">CS</div>
    </div>
  );
}

export function ProjectAvatar({ project, size = 44 }: { project: Project; size?: number }) {
  return (
    <div className="proj-av" style={{
      width: size,
      height: size,
      fontSize: size * 0.34,
      background: `linear-gradient(140deg, color-mix(in oklab, ${project.hue} 75%, #1a1136), color-mix(in oklab, ${project.hue} 30%, #140c2c))`,
      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${project.hue} 50%, transparent), 0 0 18px -6px ${project.hue}`,
    }}>{project.initials}</div>
  );
}

export function StatusDot({ status }: { status: Job["status"] }) {
  const color = status === "completed" ? "var(--cyan)" : status === "failed" ? "var(--rose)" : status === "queued" ? "var(--amber)" : "var(--green)";
  return <span className="dot" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}

export function ArtifactThumb({ artifact, compact = false }: { artifact: Artifact; compact?: boolean }) {
  const [from, to] = artifact.preview.colors;
  const hasImage = artifact.kind === "image" && artifact.preview.kind === "remote-media" && Boolean(artifact.preview.url);
  const hasAudio = artifact.kind === "music" && artifact.preview.kind === "remote-media" && Boolean(artifact.preview.url);
  const hasVideo = artifact.kind === "video" && artifact.preview.kind === "remote-media" && Boolean(artifact.preview.url);
  return (
    <div className={`thumb${compact ? " artifact-thumb-compact" : ""}`} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <div className="thumb-tex" />
      <span className="thumb-type"><Icon name={artifact.kind} size={15} /></span>
      {hasImage ? <img className="artifact-media" src={artifact.preview.url ?? undefined} alt={`${artifact.name} preview`} /> : null}
      {hasAudio ? <span className="artifact-audio-visual" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</span> : null}
      {hasVideo ? <video className="artifact-media" src={artifact.preview.url ?? undefined} muted playsInline preload="metadata" aria-label={`${artifact.name} video preview`} /> : null}
      {!hasImage && !hasAudio && !hasVideo ? <span className="artifact-monogram">{artifact.kind === "music" ? "WAVE" : artifact.kind === "video" ? "MOTION" : "FRAME"}</span> : null}
    </div>
  );
}

export function SectionHead({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return <div className="sec-head"><span className="eyebrow">{label}</span>{action ? <button className="link-btn" onClick={onAction}>{action}</button> : null}</div>;
}
