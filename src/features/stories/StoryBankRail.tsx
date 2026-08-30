import type {
  GenerationModality,
  StoryBankRefreshStatus,
  StoryPromptRecommendation,
  StoryThread,
  UpdateStoryThreadRequest,
} from "../../../shared/contracts";
import { Icon, type IconName } from "../../components/Icon";
import "./StoryBankRail.css";

export type StoryRecommendationHandoff = {
  story: StoryThread;
  recommendation: StoryPromptRecommendation;
};

function usableThreads(threads: StoryThread[], projectId: string) {
  return threads
    .filter((thread) => thread.projectId === projectId
      && thread.status !== "archived"
      && thread.recommendations.some((recommendation) => recommendation.status === "ready" || recommendation.status === "used"))
    .sort((left, right) => Number(right.pinned) - Number(left.pinned)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.title.localeCompare(right.title));
}

function visibleThreads(threads: StoryThread[], projectId: string) {
  return usableThreads(threads, projectId).filter((thread) => thread.status !== "parked");
}

function modalityLabel(modality: GenerationModality) {
  return modality === "music" ? "Song" : modality[0].toUpperCase() + modality.slice(1);
}

function roleLabel(role: string) {
  return role.replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function modalityIcon(modality: GenerationModality): IconName {
  return modality === "music" ? "music" : modality;
}

function recommendationsByModality(recommendations: StoryPromptRecommendation[]) {
  const found = new Map<GenerationModality, StoryPromptRecommendation>();
  for (const recommendation of recommendations) {
    if (recommendation.status !== "ready" && recommendation.status !== "used") continue;
    if (!found.has(recommendation.modality)) found.set(recommendation.modality, recommendation);
  }
  return [...found.values()];
}

export function StoryBankRail({
  threads,
  projectId,
  development,
  hasCreativeEvidence,
  refreshStatus,
  onUse,
  onUpdate,
  busy = false,
}: {
  threads: StoryThread[];
  projectId: string;
  development: boolean;
  hasCreativeEvidence: boolean;
  refreshStatus?: StoryBankRefreshStatus | null;
  onUse: (handoff: StoryRecommendationHandoff) => void;
  onUpdate?: (story: StoryThread, input: UpdateStoryThreadRequest) => void | Promise<unknown>;
  busy?: boolean;
}) {
  const stories = visibleThreads(threads, projectId);
  const parkedStories = usableThreads(threads, projectId).filter((thread) => thread.status === "parked");
  const update = (story: StoryThread, input: UpdateStoryThreadRequest) => {
    if (!onUpdate) return;
    void Promise.resolve(onUpdate(story, input)).catch(() => undefined);
  };

  if (!stories.length && !parkedStories.length) {
    const failed = refreshStatus === "failed";
    const pending = refreshStatus === "waiting-for-runner" || refreshStatus === "running";
    return <div className="story-bank-empty" role="status">
      <span><Icon name="star" size={18} /></span>
      <span>
        <strong>{development ? "Story Bank needs the real Creative Studio Worker" : failed ? "Story planning stopped before it made usable ideas" : pending ? "Ideas are being prepared locally" : hasCreativeEvidence ? "Your work is ready to become new stories" : "Story Bank starts with your retained work"}</strong>
        <small>{development ? "The development adapter does not invent recommendations." : failed ? "Use Retry above; your retained work and CreativeDNA are unchanged." : pending ? "The Local Runner is building model-ready directions, then unloading the planner." : hasCreativeEvidence ? "Tap New ideas to prepare four grounded directions on your local runner." : "Upload and analyze a work to ground real story and prompt recommendations."}</small>
      </span>
    </div>;
  }

  return <div className="story-bank-stack">
    {stories.length ? <div className="story-bank-rail" role="list" aria-label="Evolving story and prompt recommendations">
      {stories.map((story) => {
        const recommendations = recommendationsByModality(story.recommendations);
        return <article key={story.id} className="story-bank-card" role="listitem">
          <header>
            <span>{story.pinned ? <Icon name="star" size={11} /> : null}{recommendations[0] ? roleLabel(recommendations[0].role) : story.status}</span>
            <span className="story-bank-manage">
              <small>{story.status} · v{story.version}</small>
              {onUpdate ? <>
                <button type="button" disabled={busy} aria-label={story.pinned ? `Unpin ${story.title}` : `Pin ${story.title}`} title={story.pinned ? "Unpin story" : "Keep this story first"} onClick={() => update(story, { expectedVersion: story.version, pinned: !story.pinned })}><Icon name="star" size={12} /></button>
                <button type="button" disabled={busy} aria-label={`Park ${story.title}`} title="Park for later" onClick={() => update(story, { expectedVersion: story.version, status: "parked" })}><Icon name="pause" size={11} /></button>
                <button type="button" disabled={busy} aria-label={`Archive ${story.title}`} title="Remove from Story Bank" onClick={() => update(story, { expectedVersion: story.version, status: "archived" })}><Icon name="archive" size={12} /></button>
              </> : null}
            </span>
          </header>
          <strong>{story.title}</strong>
          <p>{story.logline}</p>
          <div className="story-bank-actions">
            {recommendations.map((recommendation) => <button type="button" key={recommendation.id} onClick={() => onUse({ story, recommendation })} title={`Use ${recommendation.title}`}>
              <Icon name={modalityIcon(recommendation.modality)} size={13} />
              <span>{modalityLabel(recommendation.modality)}</span>
            </button>)}
          </div>
        </article>;
      })}
    </div> : null}
    {parkedStories.length && onUpdate ? <details className="story-bank-parked">
      <summary>Parked ideas <span>{parkedStories.length}</span></summary>
      <div>
        {parkedStories.map((story) => <article key={story.id}>
          <span><strong>{story.title}</strong><small>Saved for later · v{story.version}</small></span>
          <span>
            <button type="button" disabled={busy} onClick={() => update(story, { expectedVersion: story.version, status: "developing" })}>Restore</button>
            <button type="button" disabled={busy} aria-label={`Archive ${story.title}`} title="Remove from Story Bank" onClick={() => update(story, { expectedVersion: story.version, status: "archived" })}><Icon name="archive" size={12} /></button>
          </span>
        </article>)}
      </div>
    </details> : null}
  </div>;
}

export function RecommendedDirectionsRail({
  threads,
  projectId,
  modality,
  activeRecommendationId,
  onUse,
}: {
  threads: StoryThread[];
  projectId: string;
  modality: GenerationModality;
  activeRecommendationId?: string;
  onUse: (handoff: StoryRecommendationHandoff) => void;
}) {
  const recommendations = visibleThreads(threads, projectId)
    .flatMap((story) => story.recommendations
      .filter((recommendation) => recommendation.modality === modality && (recommendation.status === "ready" || recommendation.status === "used"))
      .map((recommendation) => ({ story, recommendation })))
    .slice(0, 8);

  if (!recommendations.length) return null;

  return <section className="quick-story-directions" aria-label={`Recommended ${modality} directions`}>
    <header><span><Icon name="star" size={14} /><strong>Recommended directions</strong></span><small>Ready now · no model load</small></header>
    <div>
      {recommendations.map(({ story, recommendation }) => <button
        type="button"
        key={recommendation.id}
        className={activeRecommendationId === recommendation.id ? "on" : ""}
        aria-pressed={activeRecommendationId === recommendation.id}
        title={recommendation.prompt}
        onClick={() => onUse({ story, recommendation })}
      >
        <span>{roleLabel(recommendation.role)}</span>
        <strong>{recommendation.title}</strong>
        <small>{story.title}{recommendation.estimatedDurationMs ? ` · about ${Math.max(1, Math.round(recommendation.estimatedDurationMs / 60_000))} min` : ""}</small>
      </button>)}
    </div>
  </section>;
}
