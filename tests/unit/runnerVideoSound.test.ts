// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error The runner is a native ESM executable.
import { buildGemmaVideoPromptGraph, buildGemmaVideoScriptGraph, buildGemmaOvernightPlanGraph, buildGemmaStoryPlanGraph } from '../../runner/index.mjs';

function checkSound(prompt: string) {
  expect(prompt).toContain('material textures and synchronized foley');
  expect(prompt).toContain('onset, rise, decay, and quiet');
  expect(prompt).toContain('close foreground detail from distant background');
  expect(prompt).toContain('No music, score, instruments, rhythmic beat, or musical risers by default');
  expect(prompt).toContain("owner's brief explicitly requests it or a visible musical source");
  expect(prompt).toContain('Do not invent a whoosh or impact for camera movement');
  expect(prompt).toContain('Preserve explicit mute, silence, or keep-source audio instructions and exact authored speech');
  expect(prompt).not.toContain('restrained original music');
  expect(prompt).not.toContain('restrained non-diegetic music');
}

describe('scene sound in video authoring', () => {
  it.each(['natural-language', 'minimax-h3-timeline'])('grounds %s enhancement in causal sound', (outputFormat) => {
    const graph = buildGemmaVideoPromptGraph('A ceramic cup settles on a wooden table.', {
      outputFormat, videoDurationSeconds: 5, promptProfileId: 'ltx-2.5-motion/1.0',
    });
    checkSound(graph['1'].inputs.prompt);
  });

  it('preserves exact authored speech separately from full-script sound design', () => {
    const graph = buildGemmaVideoScriptGraph({
      scriptFormat: 'full-script-v2', mode: 'build', seedPhrases: ['A cup is set on wood'],
      videoDurationSeconds: 10, inputMode: 'text-to-video', currentSpokenText: 'Here it is.',
      promptProfile: { id: 'generic-video-motion/1.0', label: 'Video', targetModel: 'Video', outputFormat: 'natural-language', minimumWords: 35, maximumWords: 160 },
    });
    checkSound(graph['1'].inputs.prompt);
    expect(graph['1'].inputs.prompt).toContain('Return this dialogue verbatim in spokenText only: "Here it is."');
    expect(graph['1'].inputs.prompt).toContain('spokenText is compiled separately');
  });

  it.each(['natural-language', 'minimax-h3-timeline'])('keeps overnight %s video sound separate from its soundtrack', (promptOutputFormat) => {
    const modalities = ['image', 'video', 'music'];
    const graph = buildGemmaOvernightPlanGraph({
      session: { storyCount: 1, outputCount: 3, exploration: 'familiar', storySeed: 'Rain on glass',
        workflowSelections: modalities.map(modality => ({ modality, promptOutputFormat, videoDurationSeconds: 5 })) },
      slots: modalities.map((modality, index) => ({ ordinal: index + 1, storyIndex: 1, modality, role: ['scene-image', 'scene-video', 'soundtrack'][index] })),
    });
    checkSound(graph['1'].inputs.prompt);
    expect(graph['1'].inputs.prompt).toContain('does not authorize music in the video');
    expect(graph['1'].inputs.prompt).toContain('model-ready instrumental music');
  });

  it.each([
    ['natural-language', null], ['natural-language', 'source-image'], ['minimax-h3-timeline', 'source-image'],
  ])('grounds story %s / %s audio without removing the separate song', (promptOutputFormat, sourceId) => {
    const graph = buildGemmaStoryPlanGraph({
      refresh: { id: 'sound-test' }, context: { sources: [{ id: 'source-image' }] },
      workflows: ['image', 'video', 'music'].map(modality => ({
        modality, workflowRevisionId: `revision-${modality}`, promptOutputFormat, sourceId, durationSeconds: 5,
      })),
    });
    checkSound(graph['1'].inputs.prompt);
    expect(graph['1'].inputs.prompt).toContain('does not authorize music in the video');
    expect(graph['1'].inputs.prompt).toContain('model-ready instrumental music');
  });
});
