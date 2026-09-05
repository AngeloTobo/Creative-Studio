import { useEffect, useId, useRef, useState } from "react";
import type { Artifact } from "../../../shared/contracts";
import { Icon } from "../../components/Icon";
import { ArtifactThumb } from "../../components/Visuals";
import "./CreateResultRail.css";

export type CreateResultRailProps = {
  artifacts: Artifact[];
  selectedArtifactId?: string;
  onSelect?: (artifactId: string) => void;
  onUseAsSource?: (artifactId: string) => void;
  onOpenArtifacts?: () => void;
};

function artifactDownloadName(artifact: Artifact) {
  const safeName = artifact.name
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "creative-studio-artifact"}-${artifact.kind}`;
}

function artifactTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function SelectedArtifactMedia({ artifact }: { artifact: Artifact }) {
  const mediaUrl = artifact.preview.kind === "remote-media" ? artifact.preview.url : null;

  if (!mediaUrl) {
    return (
      <div className="create-result-unavailable" style={{ background: `linear-gradient(135deg, ${artifact.preview.colors[0]}, ${artifact.preview.colors[1]})` }}>
        <Icon name={artifact.kind} size={30} />
        <strong>Preview is not available yet</strong>
        <span>The retained result will appear here when its media is ready.</span>
      </div>
    );
  }

  if (artifact.kind === "3d") {
    return <div className="create-result-unavailable"><Icon name="cube" size={48} /><strong>{artifact.name}</strong><span>Retained 3D mesh  /  GLB</span><a className="btn btn-primary" href={mediaUrl} download={`${artifactDownloadName(artifact)}.glb`}>Download GLB</a><span>Open in Blender or your preferred 3D app to inspect and edit.</span></div>;
  }

  if (artifact.kind === "video") {
    return (
      <video
        key={artifact.id}
        className="create-result-player"
        src={mediaUrl}
        poster={artifact.preview.posterUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        aria-label={`Video player for ${artifact.name}`}
      />
    );
  }

  if (artifact.kind === "music") {
    return (
      <div className="create-result-audio-stage" style={{ background: `linear-gradient(135deg, ${artifact.preview.colors[0]}, ${artifact.preview.colors[1]})` }}>
        <span className="create-result-wave" aria-hidden="true">
          {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
        </span>
        <Icon name="music" size={34} />
        <audio
          key={artifact.id}
          className="create-result-audio"
          src={mediaUrl}
          controls
          preload="none"
          aria-label={`Audio player for ${artifact.name}`}
        />
      </div>
    );
  }

  return (
    <img
      key={artifact.id}
      className="create-result-player"
      src={mediaUrl}
      alt={artifact.name}
      loading="eager"
      decoding="async"
    />
  );
}

export function CreateResultRail({
  artifacts,
  selectedArtifactId,
  onSelect,
  onUseAsSource,
  onOpenArtifacts,
}: CreateResultRailProps) {
  const headingId = useId();
  const newestArtifactId = artifacts[0]?.id ?? null;
  const previousNewestId = useRef(newestArtifactId);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(newestArtifactId);

  useEffect(() => {
    if (selectedArtifactId !== undefined) {
      previousNewestId.current = newestArtifactId;
      return;
    }

    setInternalSelectedId((currentId) => {
      const currentStillExists = artifacts.some((artifact) => artifact.id === currentId);
      const wasFollowingNewest = !currentId || currentId === previousNewestId.current;
      if (!currentStillExists || wasFollowingNewest) return newestArtifactId;
      return currentId;
    });
    previousNewestId.current = newestArtifactId;
  }, [artifacts, newestArtifactId, selectedArtifactId]);

  const requestedId = selectedArtifactId ?? internalSelectedId;
  const selectedArtifact = artifacts.find((artifact) => artifact.id === requestedId) ?? artifacts[0] ?? null;

  function selectArtifact(artifactId: string) {
    if (selectedArtifactId === undefined) setInternalSelectedId(artifactId);
    onSelect?.(artifactId);
  }

  if (!selectedArtifact) {
    return (
      <section className="create-results create-results-empty" aria-labelledby={headingId}>
        <Icon name="gallery" size={22} />
        <div>
          <h2 id={headingId}>Your creations land here</h2>
          <p>Generate something above, then preview and reuse it without leaving Create.</p>
        </div>
        {onOpenArtifacts ? <button type="button" onClick={onOpenArtifacts}>Open artifacts</button> : null}
      </section>
    );
  }

  const mediaUrl = selectedArtifact.preview.kind === "remote-media" ? selectedArtifact.preview.url : null;

  return (
    <section className="create-results" aria-labelledby={headingId}>
      <div className="create-result-stage" aria-live="polite">
        <div className={`create-result-stage-media is-${selectedArtifact.kind}`}>
          <SelectedArtifactMedia artifact={selectedArtifact} />
          <span className="create-result-kind"><Icon name={selectedArtifact.kind} size={14} /> {selectedArtifact.kind}</span>
        </div>

        <div className="create-result-stage-copy">
          <div>
            <span className={`create-result-status is-${selectedArtifact.status}`}>{selectedArtifact.status}</span>
            <time dateTime={selectedArtifact.createdAt}>{artifactTime(selectedArtifact.createdAt)}</time>
          </div>
          <h2 id={headingId}>{selectedArtifact.name}</h2>
          {selectedArtifact.prompt ? <p>{selectedArtifact.prompt}</p> : null}

          <div className="create-result-actions" aria-label={`Actions for ${selectedArtifact.name}`}>
            {onUseAsSource && selectedArtifact.kind !== "3d" ? (
              <button type="button" className="create-result-primary" onClick={() => onUseAsSource(selectedArtifact.id)}>
                <Icon name="wand" size={16} /> Use as source
              </button>
            ) : null}
            {mediaUrl ? (
              <a href={mediaUrl} download={artifactDownloadName(selectedArtifact)} aria-label={`Download ${selectedArtifact.name}`}>
                <Icon name="arrow" size={16} /> Download
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="create-result-rail-head">
        <div>
          <strong>Latest creations</strong>
          <span>Newest first · choose one to preview</span>
        </div>
        {onOpenArtifacts ? (
          <button type="button" onClick={onOpenArtifacts} aria-label="Open all artifacts">
            All artifacts <Icon name="arrow" size={14} />
          </button>
        ) : null}
      </div>

      <ul className="create-result-rail" aria-label="Recent creations">
        {artifacts.map((artifact) => {
          const isSelected = artifact.id === selectedArtifact.id;
          return (
            <li key={artifact.id}>
              <button
                type="button"
                className={isSelected ? "is-selected" : ""}
                onClick={() => selectArtifact(artifact.id)}
                aria-label={`Preview ${artifact.name}`}
                aria-pressed={isSelected}
                data-result-card={artifact.kind}
              >
                <ArtifactThumb artifact={artifact} compact />
                <span>
                  <strong>{artifact.name}</strong>
                  <small>{artifact.kind} · {artifactTime(artifact.createdAt)}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
