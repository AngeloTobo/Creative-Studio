import type { CreativeDnaDimensions } from "./creativeDna";
import type { IsoDateString } from "./domain";
import type { OvernightWorkflowSelectionRequest, OvernightWorkflowSelection } from "./overnight";
import type { VideoPromptOutputFormat } from "./promptEnhancements";

export const LOVE_LOOP_SCHEMA_VERSION = "creative-studio-love-loop/1.0" as const;
export const LOVE_LOOP_GENERATION_SCHEMA_VERSION = "creative-studio-love-loop-generation/1.0" as const;
export const LOVE_LOOP_SCHEDULE_VERSION = "three-windows/1.0" as const;
export const LOVE_LOOP_PROMPT_POLICY_VERSION = "symbolic-devotion/1.0" as const;
export const LOVE_LOOP_DAILY_COUNT = 3 as const;

export type LoveLoopModality = "image" | "video";
export type LoveLoopStatus = "active" | "paused" | "disabled" | "needs-attention";
export type LoveLoopDropStatus = "planned" | "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";
export type LoveLoopWorkflowSelection = OvernightWorkflowSelection & { modality: LoveLoopModality };
export type LoveLoopWorkflowSelectionRequest = OvernightWorkflowSelectionRequest & { modality: LoveLoopModality };

export type LoveLoopDrop = {
  id: string;
  loopId: string;
  localDate: string;
  ordinal: 1 | 2 | 3;
  scheduledFor: IsoDateString;
  modality: LoveLoopModality;
  title: string;
  conceptId: string;
  prompt: string;
  seed: number;
  status: LoveLoopDropStatus;
  jobId: string | null;
  artifactId: string | null;
  error: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type LoveLoop = {
  schemaVersion: typeof LOVE_LOOP_SCHEMA_VERSION;
  id: string;
  projectId: string;
  dnaArtifactId: string;
  timezone: string;
  dailyCount: typeof LOVE_LOOP_DAILY_COUNT;
  status: LoveLoopStatus;
  workflowSelections: LoveLoopWorkflowSelection[];
  drops: LoveLoopDrop[];
  lastError: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

export type ConfigureLoveLoopRequest = {
  projectId: string;
  dnaArtifactId: string;
  timezone: string;
  workflowSelections: LoveLoopWorkflowSelectionRequest[];
};

export type LoveLoopGenerationStamp = {
  schemaVersion: typeof LOVE_LOOP_GENERATION_SCHEMA_VERSION;
  loopId: string;
  dropId: string;
  localDate: string;
  ordinal: 1 | 2 | 3;
  scheduledFor: IsoDateString;
  title: string;
  conceptId: string;
  seed: number;
  scheduleVersion: typeof LOVE_LOOP_SCHEDULE_VERSION;
  promptPolicyVersion: typeof LOVE_LOOP_PROMPT_POLICY_VERSION;
  privacyMode: "symbolic-roles";
  subjectRole: "owner-artist";
  relationshipRole: "husband";
  likenessMode: "none";
  dnaArtifactId: string;
  recipeId: string | null;
  recipeUpdatedAt: string | null;
};

export type LoveLoopBlueprint = Pick<LoveLoopDrop,
  "localDate" | "ordinal" | "scheduledFor" | "modality" | "title" | "conceptId" | "prompt" | "seed">;

const DAILY_WINDOWS = [
  { startMinute: 8 * 60 + 15, endMinute: 10 * 60 + 45 },
  { startMinute: 13 * 60, endMinute: 16 * 60 + 30 },
  { startMinute: 19 * 60, endMinute: 22 * 60 },
] as const;

const CONCEPTS = [
  {
    id: "quiet-daily-care",
    title: "Chosen in the quiet",
    image: "a calm dawn studio where a singular artist pauses beside an unfinished work and a second place has been thoughtfully prepared for him",
    video: "a calm dawn studio framed around a cherished artist as a warm pool of light reaches his workspace and a carefully placed cup sends up a soft curl of steam",
    gesture: "a familiar object repaired by hand and returned exactly where he will find it",
    action: "he notices the small act of care, touches it, and lets one unguarded smile arrive",
    response: "fine threads of light quietly connect every tool and artwork in the room",
  },
  {
    id: "creative-work-witnessed",
    title: "Seen while becoming",
    image: "an intimate workshop in which a focused artist is surrounded by fragments of a new world taking shape",
    video: "an intimate workshop where a focused artist makes one decisive mark while the camera drifts from his hand to the world emerging around him",
    gesture: "his husband's attentive presence held just outside the focal plane, giving the work room to become itself",
    action: "he makes one decisive mark and leans back as if finally seeing the whole idea",
    response: "the unfinished fragments align into a brief living constellation",
  },
  {
    id: "shared-home-sanctuary",
    title: "A home that knows him",
    image: "a lived-in home transformed into a precise sanctuary around the artist's favorite textures, colors, and working rituals",
    video: "a single fluid passage through a lived-in home as the artist moves toward a room arranged with uncanny care for everything he loves",
    gesture: "an open doorway, softened light, and a place beside him that makes devotion tangible without displaying either person's likeness",
    action: "he crosses the threshold and the room settles into a gentle rhythm around him",
    response: "walls breathe with subtle color and ordinary objects glow with private significance",
  },
  {
    id: "playful-private-wonder",
    title: "Delight, understood",
    image: "a playful nocturnal city garden where the artist discovers a tiny impossible festival arranged only for his delight",
    video: "a nocturnal city garden where the artist follows one flickering light and discovers a tiny impossible festival unfolding at his feet",
    gesture: "a trail of specific, handmade surprises that could only come from someone who knows his sense of wonder",
    action: "he follows the light, kneels, and laughs as the miniature celebration wakes up",
    response: "paper creatures, pocket-sized lanterns, and translucent plants answer with synchronized movement",
  },
  {
    id: "cosmic-devotion",
    title: "Held by the horizon",
    image: "a vast observatory terrace where a solitary artist stands before a sky whose constellations bend gently toward him",
    video: "a continuous rooftop observatory shot beginning close on the artist and widening as the night sky reorganizes around his silhouette",
    gesture: "a steady hand resting nearby and a shared coat folded over the rail, suggesting his husband's enduring companionship",
    action: "he raises his eyes while the camera arcs slowly from profile to the immense horizon",
    response: "constellations form a sheltering architecture rather than a crown or written symbol",
  },
  {
    id: "future-and-legacy",
    title: "Everything he will make",
    image: "a future archive where rooms of unrealized artworks open outward from one artist's present-day sketch",
    video: "a close view of the artist's sketchbook that flows into a gallery of possible future works as he turns one page",
    gesture: "his husband's care expressed as the quiet preservation of every experiment, mistake, and breakthrough",
    action: "he turns the page and walks forward as one possible future after another illuminates",
    response: "doors appear in sequence, each revealing a distinct world that carries his creative signature",
  },
  {
    id: "protective-architecture",
    title: "Room enough to be whole",
    image: "an open architectural pavilion shaped around the artist with shelter, freedom, and generous negative space held in balance",
    video: "a slow architectural reveal in which moving walls unfold around the artist without enclosing him, creating safety and a clear path forward",
    gesture: "his husband's devotion translated into structure that protects without controlling and supports without directing",
    action: "he walks one measured path while the pavilion opens ahead of him",
    response: "heavy surfaces become weightless canopies and let the horizon remain completely visible",
  },
  {
    id: "living-landscape",
    title: "Loved into bloom",
    image: "a surreal living landscape responding to the artist's presence with restrained, tactile signs of recognition",
    video: "a grounded tracking shot beside the artist as a dormant landscape wakes in precise stages around his footsteps",
    gesture: "a path tended over time by his husband, visible through care rather than spectacle",
    action: "he takes three quiet steps and pauses as the landscape answers",
    response: "mineral flowers open, water lifts into delicate arcs, and wind moves through luminous grass",
  },
] as const;

const COMPOSITIONS = [
  "A decisive foreground detail leads into a spacious environment, with one unmistakable focal point",
  "The composition begins intimately and opens into generous negative space without losing the emotional center",
  "Layered depth, tactile surfaces, and one controlled asymmetry keep the scene specific rather than ornamental",
  "Close human-scale detail sits against a larger impossible environment, with clean silhouette separation",
] as const;

const LOVE_LOOP_VIDEO_SOUND = "Synchronized scene-specific ambience, tactile action sounds, and restrained original instrumental music remain active";

function hashSeed(value: string) {
  let state = 0x811c9dc5;
  for (const character of value) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193);
  }
  return state >>> 0;
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function timezoneParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

export function isValidLoveLoopTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return timezone.length > 0 && timezone.length <= 80;
  } catch {
    return false;
  }
}

export function loveLoopLocalDate(date: Date, timezone: string) {
  const parts = timezoneParts(date, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function zonedMinuteIso(localDate: string, minuteOfDay: number, timezone: string) {
  const match = localDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !isValidLoveLoopTimezone(timezone)) throw new Error("love_loop_schedule_invalid");
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0);
  let candidate = target;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = timezoneParts(new Date(candidate), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    candidate += target - represented;
  }
  const result = new Date(candidate);
  const parts = timezoneParts(result, timezone);
  if (`${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` !== localDate
    || parts.hour !== Math.floor(minuteOfDay / 60) || parts.minute !== minuteOfDay % 60) throw new Error("love_loop_schedule_invalid");
  return result.toISOString();
}

function dnaDirection(dimensions: CreativeDnaDimensions) {
  const energy = dimensions.energy >= 66 ? "a decisive kinetic gesture and visibly active atmosphere"
    : dimensions.energy <= 34 ? "near-still action with quiet, concentrated energy"
      : "measured movement with one clear moment of activation";
  const tension = dimensions.tension >= 66 ? "one charged counterforce held without menace"
    : dimensions.tension <= 34 ? "an untroubled emotional field with no artificial conflict"
      : "a gentle point of friction resolved through care";
  const contrast = dimensions.contrast >= 66 ? "bold tonal separation and a crisply legible silhouette"
    : dimensions.contrast <= 34 ? "soft tonal transitions with closely related values"
      : "controlled contrast concentrated at the focal point";
  const palette = dimensions.warmth >= 66 ? "warm amber, coral, and softened violet light"
    : dimensions.warmth <= 34 ? "cool moonlit cyan, mineral blue, and neutral silver light"
      : "balanced warm and cool light with restrained chromatic accents";
  const space = dimensions.spaciousness >= 66 ? "wide breathing room and a calm horizon"
    : dimensions.spaciousness <= 34 ? "an intimate crop and close environmental detail"
      : "a human-scale frame with a clear surrounding world";
  const material = dimensions.organicity >= 66 ? "tactile natural materials interrupted by one precise synthetic surface"
    : dimensions.organicity <= 34 ? "precise synthetic surfaces interrupted by one tactile organic element"
      : "a deliberate exchange between tactile and engineered materials";
  const finish = dimensions.polish >= 66 ? "controlled highlights and highly resolved surfaces"
    : dimensions.polish <= 34 ? "visible grain, imperfect edges, and handmade surface variation"
      : "resolved detail that keeps a trace of the hand";
  const rhythm = dimensions.rhythmicity >= 66 ? "a clear visual cadence carried by repeating forms and timed movement"
    : dimensions.rhythmicity <= 34 ? "an irregular, singular arrangement without decorative repetition"
      : "a restrained rhythm that supports rather than competes with the subject";
  return `${energy}; ${tension}; ${contrast}; ${palette}; ${space}; ${rhythm}; ${material}; ${finish}`;
}

function shuffle<T>(values: readonly T[], random: () => number) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function loveLoopDailyBlueprints(
  loopId: string,
  localDate: string,
  timezone: string,
  dimensions: CreativeDnaDimensions,
): LoveLoopBlueprint[] {
  if (!/^love_[a-z0-9_]+$/i.test(loopId) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !isValidLoveLoopTimezone(timezone)) {
    throw new Error("love_loop_schedule_invalid");
  }
  const random = seededRandom(hashSeed(`${LOVE_LOOP_SCHEDULE_VERSION}:${loopId}:${localDate}`));
  const modalities = shuffle<LoveLoopModality>(["image", "image", "video"], random);
  const conceptIndexes = shuffle(CONCEPTS.map((_, index) => index), random).slice(0, LOVE_LOOP_DAILY_COUNT);
  const style = dnaDirection(dimensions);
  return DAILY_WINDOWS.map((window, index) => {
    const minute = window.startMinute + Math.floor(random() * (window.endMinute - window.startMinute + 1));
    const modality = modalities[index];
    const concept = CONCEPTS[conceptIndexes[index]];
    const composition = COMPOSITIONS[Math.floor(random() * COMPOSITIONS.length)];
    const seed = hashSeed(`${loopId}:${localDate}:${index + 1}:${concept.id}:${modality}`);
    const sharedMeaning = "The artist appears complete, brilliant, and fully cherished exactly as he is; perfection means being completely known and still chosen, never superiority over anyone else.";
    const prompt = modality === "image"
      ? `A visual love letter: ${concept.image}. His husband's enduring love is expressed through ${concept.gesture}, never through written or spoken testimony. ${sharedMeaning} ${composition}. ${style}. Warm, emotionally precise, contemporary, and original. No words, lettering, quotations, signs, logos, crowns, trophies, recognizable public figures, or identifiable unreferenced people.`
      : `Open on ${concept.video}. Over five seconds, ${concept.action}; ${concept.response}. The camera progresses in one continuous, readable movement and resolves on a specific image of calm recognition. His husband's care is communicated through ${concept.gesture}, not invented speech. ${sharedMeaning} ${style}. No captions, logos, black frames, model names, or identifiable unreferenced people.`;
    return {
      localDate,
      ordinal: (index + 1) as 1 | 2 | 3,
      scheduledFor: zonedMinuteIso(localDate, minute, timezone),
      modality,
      title: concept.title,
      conceptId: concept.id,
      prompt,
      seed,
    };
  });
}

export function loveLoopVideoPromptForProfile(
  prompt: string,
  outputFormat: VideoPromptOutputFormat,
  durationSeconds: number,
) {
  const base = assertLoveLoopPromptPolicy(prompt);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) {
    throw new Error("love_loop_fast_video_required");
  }
  if (outputFormat === "minimax-h3-timeline") {
    return `SHOT 1 (0.00s–${durationSeconds.toFixed(2)}s): ${base}\nAudio: ${LOVE_LOOP_VIDEO_SOUND}.`;
  }
  return `${base} ${LOVE_LOOP_VIDEO_SOUND}.`;
}

export function assertLoveLoopPromptPolicy(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length < 80 || normalized.length > 4_000
    || /[\u201c\u201d]/u.test(normalized)
    || /["“”]/u.test(normalized)
    || /\b(?:angelo|comfyui|gemma|workflow|model path|language model|celebrity|worship|possess|cannot live without)\b/i.test(normalized)) {
    throw new Error("love_loop_prompt_policy_failed");
  }
  return normalized;
}
