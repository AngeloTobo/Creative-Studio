import { useRef, useState } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import type { MediaAsset } from "../../../shared/contracts";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_BYTES = 100 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function MediaPreview({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "image") return <img src={asset.contentUrl} alt={asset.name} loading="lazy" />;
  if (asset.kind === "audio") return <div className="media-audio"><Icon name="music" size={34} /><audio src={asset.contentUrl} controls preload="metadata" /></div>;
  return <video src={asset.contentUrl} controls preload="metadata" aria-label={asset.name} />;
}

export function MediaView({ onGenerate, onEvolve }: { onGenerate: () => void; onEvolve: (sourceId: string) => void }) {
  const { snapshot, activeProjectId, uploadMedia, busy, error } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [trainingEligible, setTrainingEligible] = useState(true);
  const [localError, setLocalError] = useState("");
  const assets = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [];
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

  return <div className="media-view fade-up">
    <section className="media-upload glass">
      <div className="media-upload-copy">
        <span className="eyebrow">Project media</span>
        <h2>Bring real source material into the studio.</h2>
        <p>Images, audio, and video are retained by Creative Studio with project scope and provenance. Maximum file size: 100 MB.</p>
      </div>
      <label className={`media-drop${development ? " disabled" : ""}`}>
        <input ref={inputRef} type="file" accept={ACCEPTED_MEDIA} disabled={development || busy} onChange={(event) => choose(event.target.files?.[0] ?? null)} />
        <span className="media-drop-icon"><Icon name="plus" size={24} /></span>
        <strong>{file?.name ?? (development ? "Real uploads require the Creative Studio Worker" : "Choose image, audio, or video")}</strong>
        <small>{file ? `${file.type || "unknown type"} · ${formatBytes(file.size)}` : development ? "The browser development adapter never creates fake media." : "JPEG, PNG, WebP, GIF, MP3, WAV, FLAC, OGG, M4A, MP4, WebM, or MOV"}</small>
      </label>
      <label className="training-consent">
        <input type="checkbox" checked={trainingEligible} disabled={development || busy} onChange={(event) => setTrainingEligible(event.target.checked)} />
        <span><strong>Eligible for CreativeDNA training</strong><small>Records consent and asset lineage. Upload first, then explicitly start a training run from Create.</small></span>
      </label>
      <div className="media-upload-actions">
        <span>{assets.length} retained {assets.length === 1 ? "asset" : "assets"} in this project</span>
        <button className="btn btn-primary" disabled={!file || development || busy} onClick={() => void upload()}><Icon name="plus" size={16} /> {busy ? "Uploading…" : "Upload and retain"}</button>
      </div>
      {localError || error ? <div className="inline-error" role="alert">{localError || error}</div> : null}
    </section>

    <section className="media-library">
      <div className="media-library-head"><div><span className="eyebrow">Retained library</span><h2>Your source assets</h2></div><button className="btn btn-ghost" onClick={onGenerate}><Icon name="wand" size={16} /> Back to Create</button></div>
      {assets.length ? <div className="media-grid">{assets.map((asset) => <article className="media-card glass" key={asset.id}>
        <div className={`media-preview ${asset.kind}`}><MediaPreview asset={asset} /></div>
        <div className="media-card-body">
          <div className="media-card-title"><span><Icon name={asset.kind === "audio" ? "music" : asset.kind} size={16} /><strong>{asset.name}</strong></span><i className="state-pill ready">retained</i></div>
          <p>{asset.originalFileName}</p>
          <div className="media-card-meta"><span>{asset.mimeType}</span><span>{formatBytes(asset.size)}</span></div>
          <div className="media-provenance"><Icon name="shield" size={15} /><span><strong>Owner upload · provenance recorded</strong><small>{asset.trainingEligible ? "Training eligible by consent" : "Excluded from training"} · {new Date(asset.createdAt).toLocaleString()}</small></span></div>
          <button className="btn artifact-evolve media-evolve" onClick={() => onEvolve(asset.id)}><Icon name="star" size={15} /> Evolve this upload</button>
        </div>
      </article>)}</div> : <div className="empty-state glass"><Icon name="image" size={32} /><strong>No media uploaded yet.</strong><p>Upload the first real asset for this project. Nothing is seeded or simulated here.</p></div>}
    </section>
  </div>;
}
