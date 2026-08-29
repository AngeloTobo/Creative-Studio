import type { GenerationModality, IsoDateString } from "./domain";

export const OVERNIGHT_PLAN_SCHEMA_VERSION = "creative-studio-overnight-plan/1.0" as const;
export const OVERNIGHT_GENERATION_SCHEMA_VERSION = "creative-studio-overnight-generation/1.0" as const;

export type OvernightExploration = "familiar" | "exploratory" | "wild";
export type OvernightSessionStatus =
  | "armed"
  | "planning"
  | "running"
  | "paused"
  | "completed"
  | "needs-attention"
  | "failed"
  | "cancelled";
export type OvernightTaskStatus = "planned" | "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";
export type OvernightTaskRole = "scene-image" | "scene-video" | "soundtrack" | "soundscape";

export type OvernightWorkflowSelection = {
  modality: GenerationModality;
  recipeId: string | null;
  recipeUpdatedAt: string | null;
  workflowId: string;
  workflowRevisionId: string;
  workflowName: string;
  workflowVersion: number;
  targetModel: string | null;
  promptProfileId: string | null;
  promptOutputFormat: "minimax-h3-timeline" | "natural-language" | "structured-caption" | null;
  videoDurationSeconds: number | null;
  estimatedDurationMs: number | null;
};

export type OvernightWorkflowSelectionRequest = Pick<OvernightWorkflowSelection,
  "modality" | "workflowId" | "workflowRevisionId"> & {
  recipeId?: string | null;
};

export type OvernightPlanStory = {
  index: number;
  title: string;
  premise: string;
};

export type OvernightPlanOutput = {
  ordinal: number;
  storyIndex: number;
  sceneIndex: number | null;
  title: string;
  role: OvernightTaskRole;
  modality: GenerationModality;
  prompt: string;
};

export type OvernightPlan = {
  schemaVersion: typeof OVERNIGHT_PLAN_SCHEMA_VERSION;
  title: string;
  logline: string;
  stories: OvernightPlanStory[];
  outputs: OvernightPlanOutput[];
};

export type OvernightPlanSlot = Pick<OvernightPlanOutput, "ordinal" | "storyIndex" | "role" | "modality">;

export type OvernightTask = {
  id: string;
  sessionId: string;
  ordinal: number;
  storyId: string;
  storyTitle: string;
  sceneId: string | null;
  sceneTitle: string | null;
  role: OvernightTaskRole;
  modality: GenerationModality;
  prompt: string;
  seed: number;
  status: OvernightTaskStatus;
  jobId: string | null;
  artifactId: string | null;
  recipeId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type OvernightSessionProgress = {
  planned: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  readyForReview: number;
  decided: number;
  retainedBytes: number;
};

export type OvernightSession = {
  id: string;
  projectId: string;
  dnaArtifactId: string;
  worldId: string | null;
  name: string;
  storySeed: string;
  storyCount: number;
  outputCount: number;
  modalities: GenerationModality[];
  exploration: OvernightExploration;
  workflowSelections: OvernightWorkflowSelection[];
  status: OvernightSessionStatus;
  scheduledFor: IsoDateString;
  cutoffAt: IsoDateString;
  maxFailures: number;
  maxBytes: number;
  plan: OvernightPlan | null;
  planHash: string | null;
  tasks: OvernightTask[];
  progress: OvernightSessionProgress;
  runnerId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  startedAt: IsoDateString | null;
  completedAt: IsoDateString | null;
};

export type CreateOvernightSessionRequest = {
  projectId: string;
  dnaArtifactId: string;
  worldId?: string | null;
  name?: string;
  storySeed: string;
  storyCount: number;
  outputCount: number;
  modalities: GenerationModality[];
  exploration: OvernightExploration;
  workflowSelections: OvernightWorkflowSelectionRequest[];
  scheduledFor: IsoDateString;
  cutoffAt: IsoDateString;
  maxFailures: number;
  maxBytes: number;
  idempotencyKey: string;
};

export type OvernightGenerationStamp = {
  schemaVersion: typeof OVERNIGHT_GENERATION_SCHEMA_VERSION;
  sessionId: string;
  taskId: string;
  storyId: string;
  storyTitle: string;
  sceneId: string | null;
  taskTitle: string;
  role: OvernightTaskRole;
  recipeId: string | null;
  recipeUpdatedAt: string | null;
  planHash: string;
  seed: number;
};

export type OvernightPlannerContext = {
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
    entities: Array<{ kind: string; name: string; summary: string; attributes: Array<{ facet: string; value: string }> }>;
    rules: Array<{ strength: string; facet: string; instruction: string; modalities: string[] }>;
    canonNotes: Array<{ facet: string; value: string }>;
  };
};

export type OvernightPlannerBundle = {
  session: OvernightSession;
  slots: OvernightPlanSlot[];
  context: OvernightPlannerContext;
};

export type CompleteOvernightPlanRequest = {
  plan: unknown;
  comfyPromptId: string;
  plannerModel: string;
};

export type FailOvernightPlanRequest = { error: string };
export type OvernightPlanHeartbeatRequest = { progress: number };

const ROLE_MODALITY: Record<OvernightTaskRole, GenerationModality> = {
  "scene-image": "image",
  "scene-video": "video",
  soundtrack: "music",
  soundscape: "music",
};

export function minimumOvernightOutputCount(modalities: readonly GenerationModality[], storyCount: number) {
  return Math.max(0, storyCount) + Math.max(0, new Set(modalities).size - 1);
}

/**
 * Give every story a primary work and every selected medium at least one slot.
 * Extra capacity spreads secondary media across stories, then favors the fastest
 * available primary medium (normally images).
 */
export function overnightPlanSlots(
  modalities: readonly GenerationModality[],
  outputCount: number,
  storyCount: number,
  musicRole: Extract<OvernightTaskRole, "soundtrack" | "soundscape"> = "soundtrack",
): OvernightPlanSlot[] {
  const requested = new Set(modalities);
  const selected = (["image", "video", "music"] as GenerationModality[]).filter((modality) => requested.has(modality));
  const roles: Array<{ role: OvernightTaskRole; modality: GenerationModality; storyIndex: number }> = [];
  let remaining = outputCount;
  const primary = selected.includes("image") ? "image" : selected.includes("video") ? "video" : "music";
  const roleFor = (modality: GenerationModality): OvernightTaskRole => modality === "image"
    ? "scene-image"
    : modality === "video" ? "scene-video" : musicRole;
  const add = (modality: GenerationModality, storyIndex: number) => {
    if (remaining <= 0) return;
    roles.push({ modality, role: roleFor(modality), storyIndex });
    remaining -= 1;
  };

  for (let storyIndex = 1; storyIndex <= storyCount; storyIndex += 1) add(primary, storyIndex);
  const secondary = selected.filter((modality) => modality !== primary);
  secondary.forEach((modality, index) => add(modality, index % storyCount + 1));
  for (let storyIndex = 1; storyIndex <= storyCount && remaining > 0; storyIndex += 1) {
    for (const modality of secondary) {
      if (!roles.some((item) => item.storyIndex === storyIndex && item.modality === modality)) add(modality, storyIndex);
    }
  }
  let fillStoryIndex = 1;
  while (remaining > 0) {
    add(primary, fillStoryIndex);
    fillStoryIndex = fillStoryIndex % storyCount + 1;
  }
  return roles
    .sort((left, right) => left.storyIndex - right.storyIndex
      || (left.modality === "image" ? 0 : left.modality === "video" ? 1 : 2)
        - (right.modality === "image" ? 0 : right.modality === "video" ? 1 : 2))
    .map((item, index) => ({ ordinal: index + 1, ...item }));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedPlanText(value: unknown, minimum: number, maximum: number, error: string) {
  if (typeof value !== "string") throw new Error(error);
  const text = value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < minimum || text.length > maximum) throw new Error(error);
  return text;
}

export function normalizeOvernightPlan(value: unknown, slots: readonly OvernightPlanSlot[], storyCount: number): OvernightPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("overnight_plan_invalid");
  const input = value as Record<string, unknown>;
  if (!exactKeys(input, ["schemaVersion", "title", "logline", "stories", "outputs"])
    || input.schemaVersion !== OVERNIGHT_PLAN_SCHEMA_VERSION || !Array.isArray(input.stories) || !Array.isArray(input.outputs)
    || input.stories.length !== storyCount || input.outputs.length !== slots.length) throw new Error("overnight_plan_invalid");
  const stories = input.stories.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("overnight_plan_story_invalid");
    const story = raw as Record<string, unknown>;
    if (!exactKeys(story, ["index", "title", "premise"]) || story.index !== index + 1) throw new Error("overnight_plan_story_invalid");
    return {
      index: index + 1,
      title: boundedPlanText(story.title, 2, 100, "overnight_plan_story_invalid"),
      premise: boundedPlanText(story.premise, 12, 600, "overnight_plan_story_invalid"),
    };
  });
  const sceneCounts = new Map<number, number>();
  const expectedSceneIndexes = slots.map((slot) => {
    if (slot.modality === "music") return null;
    const next = (sceneCounts.get(slot.storyIndex) ?? 0) + 1;
    sceneCounts.set(slot.storyIndex, next);
    return next;
  });
  const outputs = input.outputs.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("overnight_plan_output_invalid");
    const output = raw as Record<string, unknown>;
    const slot = slots[index];
    if (!exactKeys(output, ["ordinal", "storyIndex", "sceneIndex", "title", "role", "modality", "prompt"])
      || output.ordinal !== slot.ordinal || output.storyIndex !== slot.storyIndex || output.role !== slot.role
      || output.modality !== slot.modality || ROLE_MODALITY[output.role as OvernightTaskRole] !== output.modality) {
      throw new Error("overnight_plan_output_invalid");
    }
    const sceneIndex = output.sceneIndex === null ? null : Number(output.sceneIndex);
    if (sceneIndex !== expectedSceneIndexes[index]) {
      throw new Error("overnight_plan_output_invalid");
    }
    return {
      ordinal: slot.ordinal,
      storyIndex: slot.storyIndex,
      sceneIndex,
      title: boundedPlanText(output.title, 2, 120, "overnight_plan_output_invalid"),
      role: slot.role,
      modality: slot.modality,
      prompt: boundedPlanText(output.prompt, 20, 4_000, "overnight_plan_output_invalid"),
    };
  });
  return {
    schemaVersion: OVERNIGHT_PLAN_SCHEMA_VERSION,
    title: boundedPlanText(input.title, 2, 120, "overnight_plan_invalid"),
    logline: boundedPlanText(input.logline, 12, 600, "overnight_plan_invalid"),
    stories,
    outputs,
  };
}

export function overnightTaskSeed(sessionId: string, ordinal: number) {
  let state = 0x811c9dc5;
  for (const character of `${sessionId}:${ordinal}`) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193);
  }
  return state >>> 0;
}
