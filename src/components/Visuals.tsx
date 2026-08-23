import { useState } from "react";
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

function firstFrameSource(url: string) {
  return url.includes("#") ? url : `${url}#t=0.001`;
}

function ArtifactVideo({ artifact, playable }: { artifact: Artifact; playable: boolean }) {
  const mediaUrl = artifact.preview.url ?? "";
  const retainedPoster = artifact.preview.posterUrl ?? null;
  const [browserPoster, setBrowserPoster] = useState<string | null>(null);

  const captureFirstFrame = (video: HTMLVideoElement) => {
    if (retainedPoster || browserPoster || !video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const scale = Math.min(1, 720 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    try {
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      setBrowserPoster(canvas.toDataURL("image/jpeg", 0.78));
    } catch {
      // The media-fragment source still asks the browser to display frame zero.
    }
  };

  return (
    <video
      className={`artifact-media artifact-video${playable ? " artifact-video-player" : ""}`}
      src={firstFrameSource(mediaUrl)}
      poster={retainedPoster ?? browserPoster ?? undefined}
      controls={playable}
      playsInline
      preload="metadata"
      aria-label={`${artifact.name} video${playable ? " player" : " preview"}`}
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        if (!retainedPoster && video.duration > 0 && video.currentTime === 0) video.currentTime = Math.min(0.001, video.duration / 2);
      }}
      onLoadedData={(event) => captureFirstFrame(event.currentTarget)}
      onSeeked={(event) => captureFirstFrame(event.currentTarget)}
    >
      Your browser does not support video playback.
    </video>
  );
}

export function ArtifactThumb({ artifact, compact = false, playable = false }: { artifact: Artifact; compact?: boolean; playable?: boolean }) {
  const [from, to] = artifact.preview.colors;
  const hasImage = artifact.kind === "image" && artifact.preview.kind === "remote-media" && Boolean(artifact.preview.url);
  const hasAudio = artifact.kind === "music" && artifact.preview.kind === "remote-media" && Boolean(artifact.preview.url);
  const hasVideo = artifact.kind === "video" && artifact.preview.kind === "remote-media" && Boolean(artifact.preview.url);
  return (
    <div className={`thumb${compact ? " artifact-thumb-compact" : ""}${hasImage || hasVideo ? " has-media" : ""}`} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
      <div className="thumb-tex" />
      <span className="thumb-type"><Icon name={artifact.kind} size={15} /></span>
      {hasImage ? <img className="artifact-media" src={artifact.preview.url ?? undefined} alt={`${artifact.name} preview`} /> : null}
      {hasAudio ? <span className="artifact-audio-visual" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <i key={index} />)}</span> : null}
      {hasVideo ? <ArtifactVideo artifact={artifact} playable={playable} /> : null}
      {!hasImage && !hasAudio && !hasVideo ? <span className="artifact-monogram">{artifact.kind === "music" ? "WAVE" : artifact.kind === "video" ? "MOTION" : "FRAME"}</span> : null}
    </div>
  );
}

export function SectionHead({ label, action, onAction }: { label: string; action?: string; onAction?: () => void }) {
  return <div className="sec-head"><span className="eyebrow">{label}</span>{action ? <button className="link-btn" onClick={onAction}>{action}</button> : null}</div>;
}
