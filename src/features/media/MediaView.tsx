import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import type { MediaAsset, MediaKind } from "../../../shared/contracts";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_BYTES = 100 * 1024 * 1024;

export type MediaViewProps = {
  onGenerate: () => void;
  onUseAsset?: (sourceId: string, kind: MediaKind) => void;
  onEvolve: (sourceId: string) => void;
  onAnimate: (sourceId: string) => void;
  onAnimateFourWay: (sourceId: string) => void;
  onAnalyze?: (sourceId: string) => void;
  onTrain?: (sourceId: string, kind: MediaKind) => void;
  embedded?: boolean;
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function assetIcon(kind: MediaKind) {
  return kind === "audio" ? "music" : kind;
}

function MediaVisual({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "image") return <img src={asset.contentUrl} alt={asset.name} loading="lazy" decoding="async" />;
  if (asset.kind === "video") return <div className="media-video-poster"><span className="media-poster-placeholder"><span className="media-poster-play"><Icon name="play" size={18} /></span><strong>{asset.name}</strong><small>Tap to load video</small></span><span className="media-kind-corner"><Icon name="video" size={12} /> Video</span></div>;
  return <div className="media-audio-cover"><Icon name="music" size={34} /><span><strong>Audio</strong><small>{asset.originalFileName}</small></span></div>;
}

function MediaInspector({ asset, onClose }: { asset: MediaAsset; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return <dialog ref={dialogRef} className="media-inspector" aria-label={`Inspect ${asset.name}`} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header><span><Icon name={assetIcon(asset.kind)} size={18} /><strong>{asset.name}</strong></span><button type="button" className="btn-icon" aria-label="Close media inspection" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className={`media-inspector-canvas ${asset.kind}`}>
      {asset.kind === "image" ? <img src={asset.contentUrl} alt={asset.name} /> : asset.kind === "video" ? <video src={asset.contentUrl} controls playsInline preload="metadata" aria-label={asset.name} /> : <div className="media-inspector-audio"><Icon name="music" size={46} /><audio src={asset.contentUrl} controls preload="metadata" /></div>}
    </div>
    <footer><span>{asset.mimeType} · {formatBytes(asset.size)} · {new Date(asset.createdAt).toLocaleString()}</span><a className="btn btn-ghost" href={asset.contentUrl} download={asset.originalFileName}><Icon name="external" size={14} /> Download</a></footer>
  </dialog>;
}

export function MediaView({ onGenerate, onUseAsset, onEvolve, onAnimate, onAnimateFourWay, onAnalyze, onTrain, embedded = false }: MediaViewProps) {
  const { snapshot, activeProjectId, uploadMedia, busy, error } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [localError, setLocalError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | MediaKind>("all");
  const [inspected, setInspected] = useState<MediaAsset | null>(null);
  const assets = useMemo(() => (snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [])
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [activeProjectId, snapshot?.mediaAssets]);
  const visibleAssets = useMemo(() => assets.filter((asset) => {
    if (kind !== "all" && asset.kind !== kind) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${asset.name} ${asset.originalFileName} ${asset.mimeType}`.toLocaleLowerCase().includes(needle);
  }), [assets, kind, query]);
  const development = snapshot?.adapter.id === "development-local-storage";

  const choose = (next: File | null) => {
    setLocalError("");
    if (next && next.size > MAX_BYTES) {
      setFile(null);
      setLocalError("Choose a file no larger than 100 MB.");
      return;
    }
    setFile(next);
  };

  const upload = async () => {
    if (!file || development) return;
    try {
      await uploadMedia(file, trainingEligible);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      // The provider exposes a normalized, visible error.
    }
  };

  const openAssetInCreate = (asset: MediaAsset) => {
    if (onUseAsset) onUseAsset(asset.id, asset.kind);
    else onGenerate();
  };

  return <div className={`media-view media-view-smart fade-up${embedded ? " embedded" : ""}`}>
    <details className="media-upload-shell glass" open={!embedded || !assets.length}>
      <summary><span><span className="media-drop-icon"><Icon name="plus" size={18} /></span><span><strong>Upload source media</strong><small>Image, audio, or video · up to 100 MB</small></span></span><span>{assets.length} retained</span><Icon name="chevronDown" size={16} /></summary>
      <section className="media-upload media-upload-compact">
        <div className="media-upload-copy">
          <span className="eyebrow">Project media</span>
          <h2>Add a source</h2>
          <p>Creative Studio retains the original file, project scope, consent, and provenance.</p>
        </div>
        <label className={`media-drop${development ? " disabled" : ""}`}>
          <input ref={inputRef} type="file" accept={ACCEPTED_MEDIA} disabled={development || busy} onChange={(event) => choose(event.target.files?.[0] ?? null)} />
          <span className="media-drop-icon"><Icon name="plus" size={24} /></span>
          <strong>{file?.name ?? (development ? "Real uploads require the Creative Studio Worker" : "Choose a file")}</strong>
          <small>{file ? `${file.type || "unknown type"} · ${formatBytes(file.size)}` : development ? "The browser development adapter never creates fake media." : "JPEG, PNG, WebP, GIF, MP3, WAV, FLAC, OGG, M4A, MP4, WebM, or MOV"}</small>
        </label>
        <label className="training-consent">
          <input type="checkbox" checked={trainingEligible} disabled={development || busy} onChange={(event) => setTrainingEligible(event.target.checked)} />
          <span><strong>Eligible for CreativeDNA training</strong><small>Records explicit consent with the retained asset.</small></span>
        </label>
        <div className="media-upload-actions">
          <span>{file ? `${formatBytes(file.size)} selected` : "Choose a file to continue"}</span>
          <button className="btn btn-primary" disabled={!file || development || busy} onClick={() => void upload()}><Icon name="plus" size={16} /> {busy ? "Uploading…" : "Upload and retain"}</button>
        </div>
        {localError || error ? <div className="inline-error" role="alert">{localError || error}</div> : null}
      </section>
    </details>

    <section className="media-library">
      <div className="media-library-head"><div>{!embedded ? <span className="eyebrow">Retained library</span> : null}<h2>Source media</h2><small>{assets.length} retained · newest first</small></div>{!embedded ? <button className="btn btn-ghost" onClick={onGenerate}><Icon name="wand" size={16} /> Create</button> : null}</div>
      {assets.length ? <>
        <div className="media-tools glass">
          <label><Icon name="search" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search media" aria-label="Search retained media" /></label>
          <div role="group" aria-label="Filter media type">{(["all", "image", "video", "audio"] as const).map((value) => <button type="button" key={value} aria-pressed={kind === value} className={kind === value ? "on" : ""} onClick={() => setKind(value)}>{value === "all" ? "All" : <><Icon name={assetIcon(value)} size={13} /> {value}</>}</button>)}</div>
        </div>
        {visibleAssets.length ? <div className="media-grid">{visibleAssets.map((asset) => <article className="media-card media-smart-card glass" key={asset.id}>
          <button type="button" className={`media-preview ${asset.kind}`} aria-label={`Inspect ${asset.name}`} onClick={() => setInspected(asset)}><MediaVisual asset={asset} /></button>
          <div className="media-card-body">
            <div className="media-card-title"><span><Icon name={assetIcon(asset.kind)} size={16} /><strong>{asset.name}</strong></span><i className="state-pill ready">retained</i></div>
            <p>{asset.originalFileName}</p>
            <div className="media-card-meta"><span>{formatBytes(asset.size)}</span><span>{new Date(asset.createdAt).toLocaleDateString()}</span><span>{asset.trainingEligible ? "training allowed" : "training excluded"}</span></div>
            <div className="media-card-actions media-smart-actions">
              {asset.kind === "image" ? <button className="btn btn-primary media-animate" onClick={() => onAnimate(asset.id)} title="Queue two speed-safe 5-second versions"><Icon name="video" size={15} /> Animate</button> : <button className="btn btn-primary" onClick={() => openAssetInCreate(asset)}><Icon name="wand" size={15} /> Use</button>}
              <details className="media-action-menu">
                <summary className="btn btn-ghost" aria-label={`More actions for ${asset.name}`}><Icon name="more" size={17} /></summary>
                <div role="menu">
                  <button role="menuitem" onClick={() => setInspected(asset)}><Icon name="external" size={14} /> Inspect</button>
                  {asset.kind === "image" ? <><button role="menuitem" onClick={() => openAssetInCreate(asset)}><Icon name="wand" size={14} /> Use in Create</button><button role="menuitem" onClick={() => onAnimateFourWay(asset.id)}><Icon name="star" size={14} /> Animate 4 ways</button></> : null}
                  <button role="menuitem" onClick={() => onEvolve(asset.id)}><Icon name="star" size={14} /> Evolve</button>
                  {onAnalyze ? <button role="menuitem" disabled={!asset.trainingEligible} title={asset.trainingEligible ? undefined : "This upload was excluded from training"} onClick={() => onAnalyze(asset.id)}><Icon name="dna" size={14} /> Analyze media</button> : null}
                  {asset.kind === "audio" && onTrain ? <button role="menuitem" disabled={!asset.trainingEligible} title={asset.trainingEligible ? undefined : "This upload was excluded from training"} onClick={() => onTrain(asset.id, asset.kind)}><Icon name="runtime" size={14} /> Train music LoRA</button> : null}
                  <a role="menuitem" href={asset.contentUrl} download={asset.originalFileName}><Icon name="external" size={14} /> Download</a>
                </div>
              </details>
            </div>
          </div>
        </article>)}</div> : <div className="empty-state glass"><Icon name="search" size={28} /><strong>No matching media.</strong><button className="btn btn-ghost" onClick={() => { setQuery(""); setKind("all"); }}>Clear filters</button></div>}
      </> : <div className="empty-state glass"><Icon name="image" size={32} /><strong>No media uploaded yet.</strong><p>Upload the first real source for this project. Nothing is seeded or simulated.</p></div>}
    </section>
    {inspected ? <MediaInspector asset={inspected} onClose={() => setInspected(null)} /> : null}
  </div>;
}
