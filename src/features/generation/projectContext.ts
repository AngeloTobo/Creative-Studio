export type CompiledProjectContext = {
  text: string;
  excludedReferenceIdentityMentions: number;
  truncated: boolean;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function withoutReferenceIdentities(value: string, identities: readonly string[]) {
  let next = clean(value);
  let excludedReferenceIdentityCount = 0;
  for (const identity of [...new Set(identities.map(clean).filter(Boolean))]) {
    // Preserve the surrounding character instead of relying on lookbehind so
    // a valid one-character identity is removed without matching that letter
    // inside an unrelated word.
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped(identity)}(?:['’]s)?(?=$|[^\\p{L}\\p{N}_])`, "giu");
    next = next.replace(pattern, (_match, prefix: string) => {
      excludedReferenceIdentityCount += 1;
      return prefix;
    });
  }
  return {
    text: clean(next.replace(/\s+([,.;:!?])/g, "$1").replace(/([(:])\s+/g, "$1")),
    excludedReferenceIdentityCount,
  };
}

function boundedAtWord(value: string, maximum: number) {
  if (value.length <= maximum) return { text: value, truncated: false };
  const candidate = value.slice(0, maximum + 1);
  const boundary = candidate.lastIndexOf(" ");
  return { text: candidate.slice(0, boundary > maximum * 0.65 ? boundary : maximum).trim(), truncated: true };
}

/**
 * Compiles only legacy Project text. Known provenance-only reference identities
 * are stripped before the text can enter a provider prompt. This is deliberately
 * neutral Project context, not persisted or promoted World canon.
 */
export function compileProjectContext(input: {
  description: string;
  note: string;
  authoredDirection: string;
  excludedReferenceIdentities?: readonly string[];
  maxCharacters?: number;
}): CompiledProjectContext {
  const identities = input.excludedReferenceIdentities ?? [];
  const redactedDescription = withoutReferenceIdentities(input.description, identities);
  const redactedNote = withoutReferenceIdentities(input.note, identities);
  const description = boundedAtWord(redactedDescription.text, 500);
  const note = boundedAtWord(redactedNote.text, 300);
  const normalizedDirection = clean(input.authoredDirection).toLocaleLowerCase();
  const normalizedDescription = description.text.toLocaleLowerCase();
  const normalizedNote = note.text.toLocaleLowerCase();
  const parts = [
    description.text && !normalizedDirection.includes(normalizedDescription) ? description.text : "",
    note.text
      && !normalizedDirection.includes(normalizedNote)
      && !normalizedDescription.includes(normalizedNote)
      ? `Current scene: ${note.text}`
      : "",
  ].filter(Boolean);
  const bounded = boundedAtWord(parts.length ? `Project context: ${parts.join(" ")}` : "", Math.max(240, Math.min(900, input.maxCharacters ?? 900)));
  return {
    text: bounded.text,
    excludedReferenceIdentityMentions: redactedDescription.excludedReferenceIdentityCount + redactedNote.excludedReferenceIdentityCount,
    truncated: description.truncated || note.truncated || bounded.truncated,
  };
}
