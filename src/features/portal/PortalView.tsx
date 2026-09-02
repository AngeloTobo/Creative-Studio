import { useMemo, useState } from "react";
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
import { Icon } from "../../components/Icon";
import { LoveLoopHomeCard } from "../loveLoop";
import { StoryBankRail, type StoryRecommendationHandoff } from "../stories/StoryBankRail";

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

type DnaProfile = {
  kind: "source" | "active";
  label: string;
  name: string;
  dimensions: Partial<CreativeDnaDimensions>;
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

  return <div className="ideas-dna-map">
    <svg viewBox="0 0 200 200" role="img" aria-label={`${profile.label}: ${ariaValues}`}>
      <defs>
        <linearGradient id="ideas-dna-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#2ee9ff" /><stop offset=".52" stopColor="#a855f7" /><stop offset="1" stopColor="#ff3d9a" /></linearGradient>
        <filter id="ideas-dna-glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {[.25, .5, .75, 1].map((scale) => <polygon key={scale} points={ringPoints(scale)} className="ideas-dna-ring" />)}
      {CREATIVE_DNA_DIMENSION_KEYS.map((key, index) => {
        const [x, y] = point(index, 100).split(",");
        return <line key={key} x1="100" y1="100" x2={x} y2={y} className="ideas-dna-axis" />;
      })}
      {complete ? <polygon points={values.map((value, index) => point(index, value!)).join(" ")} className="ideas-dna-shape" filter="url(#ideas-dna-glow)" /> : null}
      {values.map((value, index) => {
        if (typeof value !== "number") return null;
        const [x, y] = point(index, value).split(",");
        return <circle key={CREATIVE_DNA_DIMENSION_KEYS[index]} cx={x} cy={y} r="3.3" className="ideas-dna-point" />;
      })}
      <circle cx="100" cy="100" r="3" className="ideas-dna-center" />
    </svg>
    <dl className="ideas-dna-values" aria-hidden="true">
      {CREATIVE_DNA_DIMENSION_KEYS.map((key) => <div key={key}><dt>{DIMENSION_LABELS[key]}</dt><dd>{profile.dimensions[key] ?? "—"}</dd></div>)}
    </dl>
  </div>;
}

function sourceAnalysis(artifacts: NonNullable<ReturnType<typeof useStudio>["snapshot"]>["dnaArtifacts"], assetId: string) {
  for (const artifact of artifacts) {
    const source = artifact.training?.analysis.sources.find((item) => item.sourceType === "upload" && item.mediaId === assetId);
    if (source) return { artifact, source };
  }
  return null;
}

function ContextSourcePreview({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "image") return <img src={asset.contentUrl} alt={asset.name} loading="lazy" />;
  return <span className="ideas-source-media-icon"><Icon name={asset.kind === "audio" ? "music" : "video"} size={30} /><small>{asset.kind}</small></span>;
}

export function PortalView({
  navigate,
  onUseStoryRecommendation,
  onOvernight,
  onOvernightReview,
}: {
  navigate: (view: StudioView) => void;
  onUseStoryRecommendation: (handoff: StoryRecommendationHandoff) => void;
  onOvernight: () => void;
  onOvernightReview: (sessionId: string) => void;
}) {
  const { snapshot, activeProjectId, activeDna, refreshStoryBank, updateStoryThread, busy, error } = useStudio();
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const development = snapshot?.adapter.id === "development-local-storage";
  const sourceAssets = useMemo(() => (snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [activeProjectId, snapshot?.mediaAssets]);
  const selectedSource = sourceAssets.find((asset) => asset.id === selectedSourceId) ?? sourceAssets[0] ?? null;
  const analysisMatch = selectedSource && snapshot ? sourceAnalysis(snapshot.dnaArtifacts, selectedSource.id) : null;
  const hasProjectArtifacts = Boolean(snapshot?.artifacts.some((artifact) => artifact.projectId === activeProjectId));
  const activeStories = (snapshot?.storyThreads ?? []).filter((story) => story.projectId === activeProjectId
    && story.status !== "archived"
    && story.status !== "parked"
    && story.recommendations.some((recommendation) => recommendation.status === "ready" || recommendation.status === "used"));
  const parkedStoryCount = (snapshot?.storyThreads ?? []).filter((story) => story.projectId === activeProjectId
    && story.status === "parked"
    && story.recommendations.some((recommendation) => recommendation.status === "ready" || recommendation.status === "used")).length;
  const latestStoryRefresh = [...(snapshot?.storyBankRefreshes ?? [])]
    .filter((refresh) => refresh.projectId === activeProjectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const storyRefreshPending = latestStoryRefresh?.status === "waiting-for-runner" || latestStoryRefresh?.status === "running";
  const storyBankLabel = storyRefreshPending
    ? latestStoryRefresh?.status === "running" ? "Writing new directions locally" : "New directions are queued"
    : latestStoryRefresh?.status === "failed"
      ? "Story planning needs a retry"
      : activeStories.length ? "Directions grounded in your work"
        : parkedStoryCount ? "Ideas parked for later"
          : "Directions grounded in your work";

  const profile: DnaProfile | null = analysisMatch ? {
    kind: "source",
    label: "Measured source CreativeDNA",
    name: analysisMatch.source.label || selectedSource?.name || "Retained work",
    dimensions: analysisMatch.source.dimensions,
    source: analysisMatch.source,
  } : activeDna ? {
    kind: "active",
    label: "Active CreativeDNA",
    name: activeDna.name,
    dimensions: activeDna.shared,
    source: null,
  } : null;
  const sourceSummary = profile?.source?.detailedDescription
    ? creativeDnaDescriptionSummaries(profile.source.detailedDescription).shortSummary
    : "";
  const contextSummary = profile
    ? `${profile.name}${selectedSource && selectedSource.name !== profile.name ? ` · ${selectedSource.name}` : ""}`
    : selectedSource?.name ?? "Available after you retain and analyze work";

  return <div className="portal ideas-page fade-up">
    <header className="ideas-hero">
      <span className="ideas-kicker">Ideas</span>
      <h1>Find the next direction</h1>
      <p>Stories from your work, plus creative loops that can keep moving while you are away.</p>
    </header>

    {error ? <div className="inline-error" role="alert">{error}</div> : null}

    <div className="ideas-grid">
      <section className="ideas-story-bank glass-strong" aria-labelledby="ideas-story-title">
        <header className="ideas-section-head">
          <span>
            <small>Story Bank</small>
            <strong id="ideas-story-title">{storyBankLabel}</strong>
          </span>
          <button
            type="button"
            className={`btn btn-ghost ideas-story-refresh${latestStoryRefresh?.status === "failed" ? " failed" : ""}`}
            disabled={busy || development || !activeDna || storyRefreshPending}
            title={development
              ? "Story planning needs the real Creative Studio Worker."
              : !activeDna
                ? "Build or select CreativeDNA first."
                : latestStoryRefresh?.error ?? "Prepare four new directions locally."}
            onClick={() => void refreshStoryBank()}
          >
            <Icon name={latestStoryRefresh?.status === "failed" ? "rerun" : storyRefreshPending ? "history" : "star"} size={14} />
            {storyRefreshPending ? "Preparing…" : latestStoryRefresh?.status === "failed" ? "Retry" : "New ideas"}
          </button>
        </header>
        <div className="ideas-story-shelf">
          <StoryBankRail
            threads={snapshot?.storyThreads ?? []}
            projectId={activeProjectId}
            development={development}
            hasCreativeEvidence={Boolean(activeDna && (sourceAssets.length || hasProjectArtifacts))}
            refreshStatus={latestStoryRefresh?.status}
            onUse={onUseStoryRecommendation}
            onUpdate={(story, input) => updateStoryThread(story.id, input)}
            busy={busy}
          />
        </div>
      </section>

      <aside className="ideas-autonomy" aria-label="Love Loop and Overnight creation">
        <LoveLoopHomeCard
          onHistory={() => navigate("gallery")}
          onOpenOvernight={onOvernight}
          onManageOvernight={() => navigate("work")}
          onReviewOvernight={onOvernightReview}
        />
      </aside>
    </div>

    <details className="ideas-context glass">
      <summary>
        <span className="ideas-context-mark"><Icon name="dna" size={20} /></span>
        <span className="ideas-context-copy"><strong>Creative context</strong><small>{contextSummary}</small></span>
        <Icon name="chevron" size={16} />
      </summary>
      <div className="ideas-context-body">
        <article className="ideas-source-context">
          <header><small>Retained source</small><strong>{selectedSource?.name ?? "No source retained yet"}</strong></header>
          {sourceAssets.length > 1 ? <label className="ideas-context-source-picker"><span>Inspect another source</span><select aria-label="Creative context source" value={selectedSource?.id ?? ""} onChange={(event) => setSelectedSourceId(event.target.value)}>{sourceAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label> : null}
          {selectedSource ? <div className="ideas-source-preview"><ContextSourcePreview asset={selectedSource} /></div> : <div className="ideas-context-empty"><Icon name="image" size={22} /><p>Sources you add in Create will appear here as inspiration context.</p></div>}
        </article>
        <article className="ideas-dna-context">
          <header><small>CreativeDNA</small><strong>{profile?.name ?? "No active profile yet"}</strong></header>
          {profile ? <>
            <DnaMap profile={profile} />
            <p>{sourceSummary || (profile.kind === "source" ? "Measured from the selected retained source." : "The active project profile is shown here without changing your source.")}</p>
          </> : <div className="ideas-context-empty"><Icon name="dna" size={22} /><p>Your approved CreativeDNA will appear here without adding another creation step.</p></div>}
        </article>
      </div>
    </details>
  </div>;
}
