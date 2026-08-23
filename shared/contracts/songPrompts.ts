import {
  DEFAULT_CREATIVE_DNA_DIMENSIONS,
  type CreativeDnaArtifact,
  type CreativeDnaDimensions,
} from "./creativeDna";

export type SongPromptRecommendation = {
  id: "art-dna" | "dna-forward" | "new-angle";
  label: string;
  focus: string;
  prompt: string;
  evidence: {
    artDescription: boolean;
    creativeDna: boolean;
  };
};

export type SongPromptRecommendationInput = {
  artDescription?: string | null;
  dna?: Pick<CreativeDnaArtifact, "source" | "shared"> | null;
};

function boundedSentence(value: unknown, maxLength: number) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const candidate = clean.slice(0, maxLength + 1);
  const boundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(", "));
  return (boundary >= Math.floor(maxLength * 0.55) ? candidate.slice(0, boundary + 1) : candidate.slice(0, maxLength)).trim();
}

function dnaLanguage(dimensions: CreativeDnaDimensions) {
  const tempo = 64 + Math.round((dimensions.energy * 0.58 + dimensions.rhythmicity * 0.42) * 0.86);
  const harmony = dimensions.tension >= 67
    ? "tense modal harmony with unresolved extensions"
    : dimensions.tension <= 33
      ? "open consonant harmony with an unhurried resolution"
      : "tonal harmony with one controlled point of friction";
  const temperature = dimensions.warmth >= 60 ? "warm, saturated timbre" : dimensions.warmth <= 40 ? "cool, glassy timbre" : "balanced neutral-to-warm timbre";
  const pulse = dimensions.rhythmicity >= 67 ? "a defined syncopated pulse" : dimensions.rhythmicity <= 33 ? "free timing with only a faint pulse" : "a measured pulse that can loosen between sections";
  const instruments = dimensions.organicity >= 60
    ? "tactile percussion, resonant strings, breathy tones, and imperfect room texture"
    : dimensions.organicity <= 40
      ? "synthetic bass, precise digital percussion, processed pads, and bright transient detail"
      : "hybrid drums, tactile bass, processed keys, and layered ambience";
  const space = dimensions.spaciousness >= 60 ? "wide depth, long decays, and deliberate negative space" : "close perspective, short decays, and compact stereo placement";
  const dynamics = dimensions.contrast >= 60 ? "clear section changes with one decisive drop and return" : "gradual transitions with restrained dynamic movement";
  const finish = dimensions.polish >= 60 ? "a controlled, detailed final mix" : "a textured mix that keeps rough edges and audible transitions";
  return { tempo, harmony, temperature, pulse, instruments, space, dynamics, finish };
}

function prompt(parts: string[]) {
  return parts.filter(Boolean).join("\n\n").slice(0, 2_400);
}

export function createSongPromptRecommendations(input: SongPromptRecommendationInput): SongPromptRecommendation[] {
  const art = boundedSentence(input.artDescription, 520);
  const dna = boundedSentence(input.dna?.source.directive, 360);
  if (!art && !dna) return [];
  const dimensions = input.dna?.shared ?? DEFAULT_CREATIVE_DNA_DIMENSIONS;
  const language = dnaLanguage(dimensions);
  const artLine = art ? `Visual source translated into sound: ${art}` : "";
  const duplicateDirective = Boolean(art && dna && art.toLocaleLowerCase() === dna.toLocaleLowerCase());
  const dnaLine = dna && !duplicateDirective ? `Personal CreativeDNA direction: ${dna}` : "";
  const dnaProfile = input.dna ? "Personal CreativeDNA dimensional profile." : "";
  const evidence = { artDescription: Boolean(art), creativeDna: Boolean(input.dna) };
  const vocal = dimensions.warmth >= 60
    ? "If lyrics are supplied, use an intimate human vocal with soft layered harmonies; otherwise remain instrumental."
    : "If lyrics are supplied, use a restrained close vocal with sparse processed doubles; otherwise remain instrumental.";
  const counterTempo = language.tempo >= 108 ? Math.round(language.tempo / 2) : Math.min(148, language.tempo + 28);
  const counterSpace = dimensions.spaciousness >= 50
    ? "Keep the mix unexpectedly close and dry before opening only in the final section."
    : "Begin close, then reveal an unexpectedly wide field in the middle section.";

  return [
    {
      id: "art-dna",
      label: "Art + DNA",
      focus: `${language.tempo} BPM · closest visual translation`,
      evidence,
      prompt: prompt([
        `Global Metadata: ${language.tempo} BPM, ${language.harmony}, ${language.temperature}, and ${language.pulse}. ${artLine} ${dnaLine}`,
        `Vocal Details: ${vocal}`,
        `Arrangement: ${language.instruments}. Use ${language.space}, ${language.dynamics}, and ${language.finish}.`,
      ]),
    },
    {
      id: "dna-forward",
      label: "DNA forward",
      focus: `${language.tempo} BPM · personal style leads`,
      evidence,
      prompt: prompt([
        `Global Metadata: ${dnaLine || dnaProfile || artLine} ${language.tempo} BPM with ${language.temperature}, ${language.harmony}, and ${language.pulse}.`,
        `Vocal Details: ${vocal}`,
        `Arrangement: Let the personal DNA lead through ${language.instruments}. ${art ? `Use the artwork as atmosphere and imagery rather than literal narration: ${art}` : ""} Shape the form with ${language.dynamics} and ${language.finish}.`,
      ]),
    },
    {
      id: "new-angle",
      label: "New angle",
      focus: `${counterTempo} BPM · contrasting interpretation`,
      evidence,
      prompt: prompt([
        `Global Metadata: ${counterTempo} BPM. ${artLine} ${dnaLine} Keep the emotional identity but oppose the most obvious musical reading with ${dimensions.tension >= 50 ? "a calm surface over unstable harmony" : "a tense surface over stable harmony"}.`,
        `Vocal Details: ${vocal}`,
        `Arrangement: ${counterSpace} Reframe the source through ${language.instruments}; preserve ${language.finish} while changing scale and density once.`,
      ]),
    },
  ];
}
