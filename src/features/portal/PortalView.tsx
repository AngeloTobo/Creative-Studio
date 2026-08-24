import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  CREATIVE_DNA_DIMENSION_KEYS,
  creativeDnaDescriptionSummaries,
  type CreativeDnaDimensionKey,
  type CreativeDnaDimensions,
  type CreativeDnaTrainingSourceAnalysis,
  type MediaAsset,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import type { StudioView } from "../../app/views";
import { Icon, type IconName } from "../../components/Icon";
import { ArtifactThumb, SectionHead, StatusDot } from "../../components/Visuals";
import type { CreateIntent } from "../generation/quickCreate";

const DIMENSION_LABELS: Record<CreativeDnaDimensionKey, string> = {
  energy: "Energy",
  tension: "Tension",
  contrast: "Contrast",
  warmth: "Warmth",
  spaciousness: "Space",
  rhythmicity: "Rhythm",
  organicity: "Organic",
  polish: "Polish",
};

const CREATE_ACTIONS: Array<{ intent: Exclude<CreateIntent, "train">; label: string; detail: string; icon: IconName }> = [
  { intent: "image", label: "New image", detail: "Use as a reference", icon: "image" },
  { intent: "video", label: "Animate", detail: "Start from this frame", icon: "video" },
  { intent: "music", label: "Make song", detail: "Translate art into sound", icon: "music" },
];

type DnaProfile = {
  kind: "source" | "active";
  label: string;
  name: string;
  dimensions: Partial<CreativeDnaDimensions>;
  confidence: number | null;
  source: CreativeDnaTrainingSourceAnalysis | null;
};

function point(keyIndex: number, value: number, radius = 76) {
  const angle = (-90 + keyIndex * 360 / CREATIVE_DNA_DIMENSION_KEYS.length) * Math.PI / 180;
  const distance = radius * Math.max(0, Math.min(100, value)) / 100;
  return `${100 + Math.cos(angle) * distance},${100 + Math.sin(angle) * distance}`;
}

function ringPoints(scale: number) {
  return CREATIVE_DNA_DIMENSION_KEYS.map((_, index) => point(index, scale * 100)).join(" ");
}

function DnaMap({ profile }: { profile: DnaProfile }) {
  const values = CREATIVE_DNA_DIMENSION_KEYS.map((key) => profile.dimensions[key]);
  const complete = values.every((value) => typeof value === "number");
  const ariaValues = CREATIVE_DNA_DIMENSION_KEYS
    .flatMap((key) => typeof profile.dimensions[key] === "number" ? [`${DIMENSION_LABELS[key]} ${profile.dimensions[key]}`] : [])
    .join(", ");

  return <div className="home-dna-map">
    <svg viewBox="0 0 200 200" role="img" aria-label={`${profile.label}: ${ariaValues}`}>
      <defs>
        <linearGradient id="home-dna-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#2ee9ff" /><stop offset=".52" stopColor="#a855f7" /><stop offset="1" stopColor="#ff3d9a" /></linearGradient>
        <filter id="home-dna-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {[.25, .5, .75, 1].map((scale) => <polygon key={scale} points={ringPoints(scale)} className="home-dna-ring" />)}
      {CREATIVE_DNA_DIMENSION_KEYS.map((key, index) => {
        const [x, y] = point(index, 100).split(",");
        return <line key={key} x1="100" y1="100" x2={x} y2={y} className="home-dna-axis" />;
      })}
      {complete ? <polygon points={values.map((value, index) => point(index, value!)).join(" ")} className="home-dna-shape" filter="url(#home-dna-glow)" /> : null}
      {values.map((value, index) => {
        if (typeof value !== "number") return null;
        const [x, y] = point(index, value).split(",");
        return <circle key={CREATIVE_DNA_DIMENSION_KEYS[index]} cx={x} cy={y} r="3.3" className="home-dna-point" />;
      })}
      <circle cx="100" cy="100" r="3" className="home-dna-center" />
    </svg>
    <div className="home-dna-values" aria-hidden="true">
      {CREATIVE_DNA_DIMENSION_KEYS.map((key) => <span key={key}><small>{DIMENSION_LABELS[key]}</small><strong>{profile.dimensions[key] ?? "—"}</strong></span>)}
    </div>
  </div>;
}

function sourceAnalysis(artifacts: NonNullable<ReturnType<typeof useStudio>["snapshot"]>["dnaArtifacts"], assetId: string) {
  for (const artifact of artifacts) {
    const source = artifact.training?.analysis.sources.find((item) => item.sourceType === "upload" && item.mediaId === assetId);
    if (source) return { artifact, source };
  }
  return null;
}

function SourcePreview({ asset }: { asset: MediaAsset }) {
  return <img src={asset.contentUrl} alt={asset.name} />;
}

export function PortalView({
  navigate,
  onCreate,
  onTrain,
}: {
  navigate: (view: StudioView) => void;
  onCreate: (intent: Exclude<CreateIntent, "train">, sourceId?: string) => void;
  onTrain: (sourceId: string) => void;
}) {
  const { snapshot, activeProjectId, activeDna, uploadMedia, busy, error } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [localError, setLocalError] = useState("");
  const development = snapshot?.adapter.id === "development-local-storage";
  const imageSources = useMemo(() => snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId && asset.kind === "image") ?? [], [activeProjectId, snapshot?.mediaAssets]);
  const selectedSource = imageSources.find((asset) => asset.id === selectedSourceId) ?? imageSources[0] ?? null;
  const analysisMatch = selectedSource && snapshot ? sourceAnalysis(snapshot.dnaArtifacts, selectedSource.id) : null;
  const activeJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId && (job.status === "queued" || job.status === "running")) ?? [];
  const recentArtifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId).slice(0, 4) ?? [];

  const profile: DnaProfile | null = analysisMatch ? {
    kind: "source",
    label: "Measured upload DNA",
    name: analysisMatch.source.label || selectedSource?.name || "Uploaded work",
    dimensions: analysisMatch.source.dimensions,
    confidence: analysisMatch.source.confidence,
    source: analysisMatch.source,
  } : !selectedSource && activeDna ? {
    kind: "active",
    label: "Active CreativeDNA",
    name: activeDna.name,
    dimensions: activeDna.shared,
    confidence: null,
    source: null,
  } : null;
  const sourceSummary = profile?.source?.detailedDescription ? creativeDnaDescriptionSummaries(profile.source.detailedDescription).shortSummary : "";

  const upload = async (file: File | null) => {
    setLocalError("");
    if (!file) return;
    if (development) {
      setLocalError("Real uploads are unavailable in the explicitly labeled development adapter.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setLocalError("Choose an image file.");
      return;
    }
    try {
      const asset = await uploadMedia(file, true);
      setSelectedSourceId(asset.id);
    } catch {
      // The Studio provider supplies the normalized error below.
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return <div className="portal home-studio fade-up">
    <section className="home-canvas glass-strong" aria-label="CreativeDNA canvas">
      <div className="home-source-pane">
        <header className="home-pane-head"><span><small>1 · SOURCE</small><strong>{selectedSource ? selectedSource.name : "Start with an image"}</strong></span><button className="btn btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy || development}><Icon name="plus" size={16} /> {selectedSource ? "Upload another" : "Upload image"}</button></header>
        <input ref={inputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => void upload(event.target.files?.[0] ?? null)} />
        <div className={`home-source-preview${selectedSource ? " has-source" : ""}`}>
          {selectedSource ? <SourcePreview asset={selectedSource} /> : <button onClick={() => inputRef.current?.click()} disabled={development}><span className="home-source-empty-icon"><Icon name="image" size={30} /></span><strong>Upload a work</strong><small>See it, analyze its DNA, then create from it.</small></button>}
          {selectedSource ? <span className="home-source-badge"><Icon name="shield" size={13} /> Retained owner upload</span> : null}
        </div>
        {imageSources.length > 1 ? <div className="home-source-strip" aria-label="Retained image sources">{imageSources.slice(0, 7).map((asset) => <button key={asset.id} className={selectedSource?.id === asset.id ? "selected" : ""} onClick={() => setSelectedSourceId(asset.id)} aria-label={`Use ${asset.name}`}><img src={asset.contentUrl} alt="" /></button>)}</div> : null}
      </div>

      <div className="home-dna-pane">
        <header className="home-pane-head"><span><small>2 · CREATIVE DNA</small><strong>{profile?.label ?? (selectedSource ? "DNA analysis needed" : "No CreativeDNA yet")}</strong></span>{profile?.confidence !== null && profile?.confidence !== undefined ? <em>{Math.round(profile.confidence * 100)}% confidence</em> : null}</header>
        {profile ? <>
          <DnaMap profile={profile} />
          <div className="home-dna-caption"><strong>{profile.name}</strong>{sourceSummary ? <p>{sourceSummary}</p> : <p>{profile.kind === "active" ? "Project profile shown because no uploaded image is selected." : "Measured from this retained upload."}</p>}</div>
        </> : <div className="home-dna-unmeasured">
          <span className="home-dna-pulse"><Icon name="dna" size={30} /></span>
          <strong>{selectedSource ? "This image has not been analyzed yet." : "Upload an image to reveal its CreativeDNA."}</strong>
          <p>{selectedSource ? "Run the local Gemma + CreativeDNA workflow to measure the image instead of guessing." : "The visual map will show energy, tension, contrast, warmth, space, rhythm, organicity, and polish."}</p>
          {selectedSource?.trainingEligible ? <button className="btn btn-primary" onClick={() => onTrain(selectedSource.id)}><Icon name="dna" size={16} /> Analyze DNA</button> : selectedSource ? <button className="btn btn-ghost" onClick={() => navigate("media")}>Review training consent</button> : null}
        </div>}
      </div>

      <div className="home-action-pane">
        <header className="home-pane-head"><span><small>3 · MAKE</small><strong>Create from here</strong></span></header>
        <div className="home-action-grid">
          {CREATE_ACTIONS.map((action) => <button key={action.intent} className={`home-action ${action.intent}`} onClick={() => onCreate(action.intent, selectedSource?.id)}><span><Icon name={action.icon} size={20} /></span><strong>{action.label}</strong><small>{selectedSource ? action.detail : "Start without a source"}</small><Icon name="arrow" size={15} /></button>)}
          <button className="home-action train" disabled={!selectedSource?.trainingEligible} onClick={() => selectedSource && onTrain(selectedSource.id)}><span><Icon name="dna" size={20} /></span><strong>Train DNA</strong><small>{selectedSource ? analysisMatch ? "Build another version" : "Analyze this work" : "Select an upload first"}</small><Icon name="arrow" size={15} /></button>
        </div>
        <button className="home-all-tools" onClick={() => navigate("dna")}>Open full Create controls <Icon name="chevron" size={14} /></button>
      </div>
    </section>

    {(localError || error) ? <div className="inline-error" role="alert">{localError || error}</div> : null}

    <section className="home-now" aria-label="Current production and recent work">
      <div className="home-production glass">
        <SectionHead label="Production now" action="Dashboard" onAction={() => navigate("cockpit")} />
        <div className="home-production-count"><strong>{activeJobs.length}</strong><span>{activeJobs.length === 1 ? "active run" : "active runs"}</span></div>
        <div className="home-production-list">{activeJobs.slice(0, 2).map((job) => <button key={job.id} onClick={() => navigate("cockpit")}><StatusDot status={job.status} /><span><strong>{job.modality === "music" ? "Song" : job.modality[0].toUpperCase() + job.modality.slice(1)}</strong><small>{job.status} · {job.progress}%</small></span><i style={{ "--home-progress": `${job.progress}%` } as CSSProperties} /></button>)}{!activeJobs.length ? <span className="home-queue-clear"><Icon name="check" size={16} /> Queue is clear</span> : null}</div>
      </div>
      <div className="home-recent glass">
        <SectionHead label="Newest artifacts" action="View all" onAction={() => navigate("gallery")} />
        <div className="home-recent-grid">{recentArtifacts.map((artifact) => <button key={artifact.id} onClick={() => navigate("gallery")}><ArtifactThumb artifact={artifact} /><span><strong>{artifact.name}</strong><small>{artifact.kind} · {artifact.status}</small></span></button>)}{!recentArtifacts.length ? <span className="home-queue-clear">Completed work will appear here.</span> : null}</div>
      </div>
    </section>
  </div>;
}
