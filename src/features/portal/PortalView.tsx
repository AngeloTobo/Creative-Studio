import { useMemo, useRef, useState } from "react";
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
import { ArtifactThumb, StatusDot } from "../../components/Visuals";
import type { VideoCreateEntryMode } from "../generation/createEntry";
import type { CreateIntent } from "../generation/quickCreate";
import { useCreativeSessions } from "../sessions";
import { LoveLoopHomeCard } from "../loveLoop";

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

const ACCEPTED_HOME_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_HOME_MEDIA_BYTES = 100 * 1024 * 1024;

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
  if (asset.kind === "image") return <img src={asset.contentUrl} alt={asset.name} />;
  if (asset.kind === "audio") return <div className="home-source-audio"><Icon name="music" size={40} /><strong>{asset.name}</strong><audio src={asset.contentUrl} controls preload="metadata" /></div>;
  return <video src={asset.contentUrl} controls preload="metadata" aria-label={asset.name} />;
}

export function PortalView({
  navigate,
  onCreate,
  onTrain,
  onOvernight,
  onOvernightReview,
}: {
  navigate: (view: StudioView) => void;
  onCreate: (intent: Exclude<CreateIntent, "train">, sourceId?: string, autoStart?: boolean, videoEntryMode?: VideoCreateEntryMode) => void;
  onTrain: (sourceId: string) => void;
  onOvernight: () => void;
  onOvernightReview: (sessionId: string) => void;
}) {
  const { snapshot, activeProjectId, activeDna, uploadMedia, busy, error } = useStudio();
  const { latest: latestSession } = useCreativeSessions(activeProjectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [localError, setLocalError] = useState("");
  const development = snapshot?.adapter.id === "development-local-storage";
  const sourceAssets = useMemo(() => (snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [activeProjectId, snapshot?.mediaAssets]);
  const selectedSource = sourceAssets.find((asset) => asset.id === selectedSourceId) ?? sourceAssets[0] ?? null;
  const analysisMatch = selectedSource && snapshot ? sourceAnalysis(snapshot.dnaArtifacts, selectedSource.id) : null;
  const activeJobs = snapshot?.jobs.filter((job) => job.projectId === activeProjectId && !job.settingsStamp.overnight && !job.settingsStamp.loveLoop && (job.status === "queued" || job.status === "running")) ?? [];
  const productionRunsById = new Map((snapshot?.productionCockpit.runs ?? []).map((run) => [run.id, run]));
  const recentArtifacts = (snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId && !artifact.settingsStamp.overnight) ?? [])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 4);

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
    if (file.size > MAX_HOME_MEDIA_BYTES) {
      setLocalError("Choose media no larger than 100 MB.");
      return;
    }
    if (!file.type.startsWith("image/") && !file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
      setLocalError("Choose an image, audio file, or video.");
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
        <header className="home-pane-head"><span><small>1 · SOURCE</small><strong>{selectedSource ? selectedSource.name : "Start with your work"}</strong></span><button className="btn btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy || development}><Icon name="plus" size={16} /> {selectedSource ? "Add another" : "Upload"}</button></header>
        <input ref={inputRef} className="visually-hidden" type="file" accept={ACCEPTED_HOME_MEDIA} onChange={(event) => void upload(event.target.files?.[0] ?? null)} />
        <div className={`home-source-preview${selectedSource ? " has-source" : ""}`}>
          {selectedSource ? <SourcePreview asset={selectedSource} /> : <button onClick={() => inputRef.current?.click()} disabled={development}><span className="home-source-empty-icon"><Icon name="plus" size={30} /></span><strong>Upload a work</strong><small>Image, video, or song. Analyze it, then create from it.</small></button>}
          {selectedSource ? <span className="home-source-badge"><Icon name="shield" size={13} /> Retained owner upload</span> : null}
        </div>
        {sourceAssets.length > 1 ? <div className="home-source-strip" aria-label="Retained sources">{sourceAssets.slice(0, 7).map((asset) => <button key={asset.id} className={selectedSource?.id === asset.id ? "selected" : ""} onClick={() => setSelectedSourceId(asset.id)} aria-label={`Use ${asset.name}`}>{asset.kind === "image" ? <img src={asset.contentUrl} alt="" loading="lazy" /> : <Icon name={asset.kind === "audio" ? "music" : "video"} size={18} />}</button>)}<button className="home-source-more" onClick={() => navigate("media")} aria-label="Browse all media"><Icon name="chevron" size={16} /></button></div> : null}
      </div>

      <div className="home-dna-pane">
        <header className="home-pane-head"><span><small>2 · CREATIVE DNA</small><strong>{profile?.label ?? (selectedSource ? "DNA analysis needed" : "No CreativeDNA yet")}</strong></span>{profile?.confidence !== null && profile?.confidence !== undefined ? <em>{Math.round(profile.confidence * 100)}% confidence</em> : null}</header>
        {profile ? <>
          <DnaMap profile={profile} />
          <div className="home-dna-caption"><strong>{profile.name}</strong>{sourceSummary ? <p>{sourceSummary}</p> : <p>{profile.kind === "active" ? "Project profile shown because no retained work is selected." : "Measured from this retained upload."}</p>}</div>
        </> : <div className="home-dna-unmeasured">
          <span className="home-dna-pulse"><Icon name="dna" size={30} /></span>
          <strong>{selectedSource ? "This work has not been analyzed yet." : "Upload a work to reveal its CreativeDNA."}</strong>
          <p>{selectedSource ? "Run the local Gemma + CreativeDNA workflow to measure it instead of guessing." : "The visual map works with retained images, audio, and video."}</p>
          {selectedSource?.trainingEligible ? <button className="btn btn-primary" onClick={() => onTrain(selectedSource.id)}><Icon name="dna" size={16} /> Analyze DNA</button> : selectedSource ? <button className="btn btn-ghost" onClick={() => navigate("media")}>Review training consent</button> : null}
        </div>}
      </div>

      <div className="home-action-pane">
        <header className="home-pane-head"><span><small>3 · MAKE</small><strong>Create from here</strong></span></header>
        <div className="home-action-grid">
          {CREATE_ACTIONS.map((action) => {
            const sourceCompatible = selectedSource && (action.intent === "image"
              ? selectedSource.kind === "image"
              : action.intent === "video"
                ? selectedSource.kind === "image" || selectedSource.kind === "video"
                : selectedSource.kind === "image" || selectedSource.kind === "audio");
            const detail = !selectedSource || !sourceCompatible
              ? "Start without this source"
              : action.intent === "video"
                ? selectedSource.kind === "image" ? "2 fast versions · 5 seconds" : "Open video controls"
                : action.intent === "music" && selectedSource.kind === "audio" ? "Use as an audio source" : action.detail;
            const autoAnimate = action.intent === "video" && selectedSource?.kind === "image";
            return <button key={action.intent} className={`home-action ${action.intent}`} onClick={() => onCreate(action.intent, sourceCompatible ? selectedSource.id : undefined, autoAnimate, "standard")}><span><Icon name={action.icon} size={20} /></span><strong>{action.label}</strong><small>{detail}</small><Icon name="arrow" size={15} /></button>;
          })}
        </div>
        <LoveLoopHomeCard
          onHistory={() => navigate("gallery")}
          onOpenOvernight={onOvernight}
          onManageOvernight={() => navigate("work")}
          onReviewOvernight={onOvernightReview}
        />
        <div className="home-action-footer">
          {selectedSource?.kind === "image" ? <button onClick={() => onCreate("video", selectedSource.id, true, "four-way")} title="Queue Exact, Enhanced, Left Field, and Awe versions"><Icon name="star" size={14} /> Animate 4 ways</button> : null}
          <button disabled={!selectedSource?.trainingEligible} onClick={() => selectedSource && onTrain(selectedSource.id)}><Icon name="dna" size={14} /> {selectedSource ? analysisMatch ? "Train DNA again" : "Analyze this work" : "Train DNA"}</button>
          <button onClick={() => navigate("dna")}>Open Create <Icon name="chevron" size={14} /></button>
        </div>
      </div>
    </section>

    {(localError || error) ? <div className="inline-error" role="alert">{localError || error}</div> : null}

    <section className="home-continue glass" aria-label="Continue working">
      <header><span><small>CONTINUE</small><strong>{activeJobs.length ? `${activeJobs.length} ${activeJobs.length === 1 ? "run" : "runs"} active` : latestSession ? `Resume ${latestSession.intentTier} ${latestSession.mediaKind}` : recentArtifacts.length ? "Newest work" : "Ready to make"}</strong></span><button className="link-btn" onClick={() => navigate("work")}>Open Work <Icon name="arrow" size={13} /></button></header>
      <div className="home-continue-rail">
        {activeJobs.slice(0, 3).map((job) => {
          const run = productionRunsById.get(job.id);
          return <button className="home-run-chip" key={job.id} onClick={() => navigate("queue")}><StatusDot status={job.status} /><span><strong>{job.prompt.trim() || (job.modality === "music" ? "Song" : job.modality)}</strong><small>{run?.stageLabel ?? job.status}{run?.comfyApiUnresponsive ? " · runner still active" : ""}</small></span></button>;
        })}
        {latestSession ? <button className="home-run-chip home-draft-chip" onClick={() => navigate("dna")}><Icon name="wand" size={17} /><span><strong>{latestSession.direction || `Untitled ${latestSession.mediaKind}`}</strong><small>{latestSession.intentTier} draft · saved {new Date(latestSession.updatedAt).toLocaleString()}</small></span><Icon name="arrow" size={14} /></button> : null}
        {recentArtifacts.map((artifact) => <button className="home-artifact-chip" key={artifact.id} onClick={() => navigate("gallery")}><ArtifactThumb artifact={artifact} compact /><span><strong>{artifact.name}</strong><small>{artifact.kind} · {artifact.status}</small></span></button>)}
        {!activeJobs.length && !latestSession && !recentArtifacts.length ? <button className="home-empty-continue" onClick={() => navigate("dna")}><Icon name="wand" size={17} /><span><strong>Create the first result</strong><small>Choose a model and begin.</small></span><Icon name="arrow" size={14} /></button> : null}
      </div>
    </section>
  </div>;
}
