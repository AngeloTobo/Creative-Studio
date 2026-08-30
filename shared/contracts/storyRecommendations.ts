import type { GenerationModality, IsoDateString, MediaKind } from "./domain";

export const STORY_PLAN_SCHEMA_VERSION = "creative-studio-story-plan/1.0" as const;
export const STORY_SELECTION_SCHEMA_VERSION = "creative-studio-story-recommendation-selection/1.0" as const;

export type StoryRecommendationRole = "faithful" | "signature" | "frontier" | "awe";
export type StoryThreadStatus = "suggested" | "developing" | "parked" | "archived";
export type StoryPromptRecommendationStatus = "ready" | "used" | "stale" | "dismissed";
export type StoryBankRefreshStatus = "waiting-for-runner" | "running" | "completed" | "failed";
export type StoryPromptAspectRatio = "1:1" | "16:9" | "9:16";

export type StorySourceRef = {
  id: string;
  sourceType: "upload" | "artifact";
  kind: MediaKind;
};

export type StoryPromptRecommendation = {
  id: string;
  storyId: string;
  version: number;
  modality: GenerationModality;
  role: StoryRecommendationRole;
  title: string;
  prompt: string;
  promptHash: string;
  sourceId: string | null;
  sourceType: "upload" | "artifact" | null;
  sourceKind: MediaKind | null;
  workflowId: string | null;
  workflowRevisionId: string | null;
  recipeId: string | null;
  modelTarget: string | null;
  durationSeconds: number | null;
  aspectRatio: StoryPromptAspectRatio | null;
  estimatedDurationMs: number | null;
  status: StoryPromptRecommendationStatus;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type StoryThread = {
  id: string;
  projectId: string;
  worldId: string | null;
  dnaArtifactId: string;
  title: string;
  logline: string;
  status: StoryThreadStatus;
  pinned: boolean;
  version: number;
  sourceRefs: StorySourceRef[];
  evidenceFingerprint: string;
  plannerProvider: "local-comfyui";
  plannerModel: string;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  recommendations: StoryPromptRecommendation[];
};

export type StoryRecommendationSelection = {
  schemaVersion: typeof STORY_SELECTION_SCHEMA_VERSION;
  storyId: string;
  storyVersion: number;
  recommendationId: string;
  recommendationVersion: number;
  promptHash: string;
  role: StoryRecommendationRole;
  modality: GenerationModality;
};

export type StoryRecommendationStamp = StoryRecommendationSelection & {
  storyTitle: string;
  recommendationTitle: string;
  recommendedPrompt: string;
  appliedPrompt: string;
  ownerEdited: boolean;
  refreshId: string;
  evidenceFingerprint: string;
  plannerProvider: "local-comfyui";
  plannerModel: string;
};

export function storyRecommendationSelection(
  story: StoryThread,
  recommendation: StoryPromptRecommendation,
): StoryRecommendationSelection {
  return {
    schemaVersion: STORY_SELECTION_SCHEMA_VERSION,
    storyId: story.id,
    storyVersion: story.version,
    recommendationId: recommendation.id,
    recommendationVersion: recommendation.version,
    promptHash: recommendation.promptHash,
    role: recommendation.role,
    modality: recommendation.modality,
  };
}

export type StoryBankRefresh = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  worldId: string | null;
  evidenceFingerprint: string;
  status: StoryBankRefreshStatus;
  trigger: "automatic" | "manual";
  runnerId: string | null;
  plannerProvider: "local-comfyui";
  plannerModel: string | null;
  comfyPromptId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

export type StoryPlannerSource = StorySourceRef & {
  name: string;
  shortSummary: string;
  longSummary: string;
};

export type StoryPlannerWorkflow = {
  modality: GenerationModality;
  workflowId: string;
  workflowRevisionId: string;
  recipeId: string | null;
  modelTarget: string | null;
  promptProfileId: string | null;
  promptOutputFormat: string | null;
  sourceId: string | null;
  sourceType: "upload" | "artifact" | null;
  sourceKind: MediaKind | null;
  durationSeconds: number | null;
  aspectRatio: StoryPromptAspectRatio | null;
  estimatedDurationMs: number | null;
};

export type StoryPlannerContext = {
  project: { name: string; description: string; currentDirection: string };
  creativeDna: {
    name: string;
    directive: string;
    dimensions: Record<string, number>;
    imageLanguage: string;
    musicLanguage: string;
  };
  world: null | {
    name: string;
    premise: string;
    rules: string[];
    canonNotes: string[];
  };
  sources: StoryPlannerSource[];
  taste: {
    preserve: string[];
    redirect: string[];
    avoid: string[];
  };
  recentStories: Array<{ role: StoryRecommendationRole; title: string; logline: string }>;
};

export type StoryPlannerBundle = {
  refresh: StoryBankRefresh;
  context: StoryPlannerContext;
  workflows: StoryPlannerWorkflow[];
};

export type StoryPlanPrompt = { title: string; prompt: string };
export type StoryPlanStory = {
  index: number;
  role: StoryRecommendationRole;
  title: string;
  logline: string;
  image: StoryPlanPrompt;
  video: StoryPlanPrompt;
  music: StoryPlanPrompt;
};
export type StoryPlan = {
  schemaVersion: typeof STORY_PLAN_SCHEMA_VERSION;
  stories: StoryPlanStory[];
};

export type CompleteStoryPlanRequest = {
  plan: unknown;
  comfyPromptId: string;
  plannerModel: string;
};
export type StoryPlanHeartbeatRequest = { progress: number };
export type FailStoryPlanRequest = { error: string };
export type RefreshStoryBankRequest = { projectId: string; idempotencyKey: string };
export type UpdateStoryThreadRequest = {
  expectedVersion: number;
  status?: StoryThreadStatus;
  pinned?: boolean;
};

const STORY_ROLES: readonly StoryRecommendationRole[] = ["faithful", "signature", "frontier", "awe"];

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function planText(value: unknown, minimum: number, maximum: number, error: string) {
  if (typeof value !== "string") throw new Error(error);
  const normalized = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new Error(error);
  return normalized;
}

function normalizePrompt(value: unknown): StoryPlanPrompt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("story_plan_prompt_invalid");
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, ["title", "prompt"])) throw new Error("story_plan_prompt_invalid");
  return {
    title: planText(input.title, 2, 80, "story_plan_prompt_invalid"),
    prompt: planText(input.prompt, 24, 3_800, "story_plan_prompt_invalid"),
  };
}

export function normalizeStoryPlan(value: unknown): StoryPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("story_plan_invalid");
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, ["schemaVersion", "stories"])
    || input.schemaVersion !== STORY_PLAN_SCHEMA_VERSION
    || !Array.isArray(input.stories)
    || input.stories.length !== STORY_ROLES.length) throw new Error("story_plan_invalid");
  const stories = input.stories.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("story_plan_story_invalid");
    const story = raw as Record<string, unknown>;
    if (!exactKeys(story, ["index", "role", "title", "logline", "image", "video", "music"])
      || story.index !== index + 1
      || story.role !== STORY_ROLES[index]) throw new Error("story_plan_story_invalid");
    return {
      index: index + 1,
      role: STORY_ROLES[index],
      title: planText(story.title, 2, 100, "story_plan_story_invalid"),
      logline: planText(story.logline, 12, 420, "story_plan_story_invalid"),
      image: normalizePrompt(story.image),
      video: normalizePrompt(story.video),
      music: normalizePrompt(story.music),
    };
  });
  const normalizedPrompts = stories.flatMap((story) => [story.image.prompt, story.video.prompt, story.music.prompt]);
  if (new Set(normalizedPrompts.map((prompt) => prompt.toLocaleLowerCase())).size !== normalizedPrompts.length) {
    throw new Error("story_plan_prompt_duplicate");
  }
  return { schemaVersion: STORY_PLAN_SCHEMA_VERSION, stories };
}
