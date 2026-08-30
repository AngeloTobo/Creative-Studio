import { describe, expect, it } from "vitest";
import {
  normalizeStoryPlan,
  STORY_PLAN_SCHEMA_VERSION,
  STORY_SELECTION_SCHEMA_VERSION,
  storyRecommendationSelection,
  type StoryPlan,
  type StoryPromptRecommendation,
  type StoryThread,
} from "../../shared/contracts";

function validPlan(): StoryPlan {
  const roles = ["faithful", "signature", "frontier", "awe"] as const;
  return {
    schemaVersion: STORY_PLAN_SCHEMA_VERSION,
    stories: roles.map((role, index) => ({
      index: index + 1,
      role,
      title: `${role} orbit`,
      logline: `A distinct ${role} story follows one luminous form as its world changes around it.`,
      image: {
        title: `${role} still`,
        prompt: `A ${role} luminous form held in a precise still composition with tactile depth and quiet light.`,
      },
      video: {
        title: `${role} motion`,
        prompt: `A ${role} luminous form crosses one evolving space as the camera changes scale and the air begins to move.`,
      },
      music: {
        title: `${role} score`,
        prompt: `A ${role} instrumental score built from warm bass, glass percussion, suspended harmony, and a decisive final release.`,
      },
    })),
  };
}

describe("Story Bank contracts", () => {
  it("normalizes one exact four-role plan and preserves reusable model prompts", () => {
    const plan = validPlan();
    plan.stories[0].logline = "  A distinct faithful story follows one luminous form\r\n   as its world changes around it.  ";

    const normalized = normalizeStoryPlan(plan);

    expect(normalized.schemaVersion).toBe(STORY_PLAN_SCHEMA_VERSION);
    expect(normalized.stories.map((story) => story.role)).toEqual(["faithful", "signature", "frontier", "awe"]);
    expect(normalized.stories[0].logline).toBe("A distinct faithful story follows one luminous form\n as its world changes around it.");
    expect(normalized.stories.flatMap((story) => [story.image.prompt, story.video.prompt, story.music.prompt]))
      .toHaveLength(12);
  });

  it("rejects reordered roles, extra model output, short prompts, and duplicate recommendations", () => {
    const reordered = validPlan();
    reordered.stories[0].role = "signature";
    expect(() => normalizeStoryPlan(reordered)).toThrow("story_plan_story_invalid");

    const extra = validPlan() as unknown as { schemaVersion: string; stories: unknown[]; commentary: string };
    extra.commentary = "Here is the requested JSON.";
    expect(() => normalizeStoryPlan(extra)).toThrow("story_plan_invalid");

    const short = validPlan();
    short.stories[1].video.prompt = "Move faster.";
    expect(() => normalizeStoryPlan(short)).toThrow("story_plan_prompt_invalid");

    const duplicate = validPlan();
    duplicate.stories[3].music.prompt = duplicate.stories[0].image.prompt.toUpperCase();
    expect(() => normalizeStoryPlan(duplicate)).toThrow("story_plan_prompt_duplicate");
  });

  it("creates the immutable selection token from exact story and recommendation versions", () => {
    const recommendation = {
      id: "storyprompt_test_1",
      version: 3,
      modality: "video",
      role: "frontier",
      promptHash: "a".repeat(64),
    } as StoryPromptRecommendation;
    const story = { id: "story_test_1", version: 7 } as StoryThread;

    expect(storyRecommendationSelection(story, recommendation)).toEqual({
      schemaVersion: STORY_SELECTION_SCHEMA_VERSION,
      storyId: "story_test_1",
      storyVersion: 7,
      recommendationId: "storyprompt_test_1",
      recommendationVersion: 3,
      promptHash: "a".repeat(64),
      role: "frontier",
      modality: "video",
    });
  });
});
