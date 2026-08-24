# Model prompt profiles

Creative Studio compiles the editable authored brief for the selected generation model. A profile is a versioned contract, not a general-purpose “make this better” prompt. Completed music jobs retain the source brief, exact compiled prompt, profile ID, target model, Gemma provenance, and word counts.

## MiniMax Music 3

Profile: `minimax-music-3-structured-caption/1.0`

Authoritative sources:

- [MiniMax Music 3 README](https://github.com/MiniMax-AI/MiniMax-Music3)
- [MiniMax Music 3 caption-rewriter contract](https://github.com/MiniMax-AI/MiniMax-Music3/blob/main/skills/music-caption-rewriter/SKILL.md)
- [ComfyUI MiniMax Music 3 node](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_music.py)

Compiler rules:

- Output exactly `### Global Metadata`, `### Vocal Details`, and `### Arrangement`, in that order.
- Default to 250–450 English words; Creative Studio rejects clearly truncated or excessive output.
- Treat Lyrics as a separate model input. Only lyric presence and supported bracketed section tags inform the caption; lyric lines are never copied or paraphrased.
- Preserve an instrumental direction. Do not invent a singer, exact BPM, key, identity, or technique.
- Describe a section-by-section energy and instrument timeline, not a static list of gear.
- Exclude project canon, character biography, visual framing, CreativeDNA labels, review chatter, prompt commentary, and commercial identity.

## Stable Audio

Profile: `stable-audio-natural-language/1.0`

Authoritative sources:

- [Stable Audio Tools conditioning](https://github.com/Stability-AI/stable-audio-tools/blob/main/docs/conditioning.md)
- [Stable Audio model configuration](https://github.com/Stability-AI/stable-audio-tools/blob/main/stable_audio_tools/configs/model_configs/txt2audio/stable_audio_2_0.json)

Compiler rules:

- Output one concise, fluent natural-language description rather than MiniMax headings.
- Lead with style and mood, followed by defining instruments, rhythm, movement, texture, space, and production character.
- Preserve a supplied BPM or duration but do not invent either.
- Keep the prompt within the bounded text-conditioning budget and remove project/visual/meta language.

## Adding a profile

Add a typed profile ID, deterministic workflow/model detector, runner compiler contract, Worker-side independent validation, Artifact lineage label, focused tests, and authoritative primary-source links. Unknown music models use the bounded generic natural-language profile until a model-specific contract is implemented.
