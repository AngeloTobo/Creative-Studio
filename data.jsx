/* data.jsx — mock content for Angelo VA */

const PROJECTS = [
  { id: 'rebecca', name: 'Rebecca', type: 'Character System', status: 'Active',
    description: 'Nonbinary alien character and identity system.',
    note: 'Flux LoRA in training.', hue: 'var(--violet)', initials: 'RB' },
  { id: 'internet-dreams', name: 'Internet Dreams', type: 'Music / Visual', status: 'Active',
    description: 'Music, videos, cover art, and nostalgic digital worlds.',
    note: '6 tracks in progress.', hue: 'var(--pink)', initials: 'ID' },
  { id: 'easynews', name: 'EasyNews', type: 'Broadcast System', status: 'Draft',
    description: 'AI-assisted scripts, segments, and news visuals.',
    note: 'Segment 07 drafting.', hue: 'var(--cyan)', initials: 'EN' },
];

const MEDIA = [
  { id: 'm1', title: 'Internet Dreams Teaser', type: 'Video', project: 'Internet Dreams', meta: 'LTX Video', dur: '00:24', ago: '2h ago', g: ['#3a1d6e', '#c026d3'] },
  { id: 'm2', title: 'Rebecca Close Up', type: 'Image', project: 'Rebecca', meta: 'Flux Dev', ago: '3h ago', g: ['#6d28d9', '#db2777'] },
  { id: 'm3', title: 'Familiar (Demo)', type: 'Music', project: 'Internet Dreams', meta: 'AI Music', dur: '02:45', ago: '5h ago', g: ['#9d174d', '#7c3aed'] },
  { id: 'm4', title: 'Dreamscape V2', type: 'Image', project: 'Internet Dreams', meta: 'Flux Dev', ago: '1d ago', g: ['#0e7490', '#a21caf'] },
  { id: 'm5', title: 'EasyNews Segment 07', type: 'Video', project: 'EasyNews', meta: 'LTX Video', dur: '01:12', ago: '1d ago', g: ['#1e3a8a', '#0891b2'] },
  { id: 'm6', title: 'Neon Horizon Beat', type: 'Sound', project: 'Internet Dreams', meta: 'SFX', dur: '00:32', ago: '2d ago', g: ['#be123c', '#7c3aed'] },
];

const ACTIVITY = [
  { id: 'a1', title: 'LTX Text-to-Video', sub: 'Running · 68%', state: 'running', g: ['#3a1d6e', '#c026d3'] },
  { id: 'a2', title: 'Flux Image', sub: 'Completed · 7m ago', state: 'done', g: ['#6d28d9', '#db2777'] },
  { id: 'a3', title: 'Familiar (Demo)', sub: 'Completed · 22m ago', state: 'done', g: ['#9d174d', '#7c3aed'] },
  { id: 'a4', title: 'Upscale / Detail', sub: 'Completed · 1h ago', state: 'done', g: ['#0e7490', '#a21caf'] },
];

const CREATE_TYPES = [
  { id: 'video', label: 'Video', accent: 'var(--violet)', desc: 'Cinematic videos from text or images.',
    actions: ['Text to video', 'Image to video', 'Storyboard to video', 'Continue sequence'] },
  { id: 'image', label: 'Image', accent: 'var(--cyan)', desc: 'Artwork, references, covers, and concepts.',
    actions: ['Text to image', 'Image variation', 'Character reference', 'Cover art'] },
  { id: 'music', label: 'Music / Sound', accent: 'var(--pink)', desc: 'Songs, beats, SFX, ambience, and audio.',
    actions: ['Song idea', 'Instrumental', 'Sound effect', 'Ambient loop'] },
  { id: 'voice', label: 'Voice', accent: 'var(--amber)', desc: 'Narration, dialogue, and scripts.',
    actions: ['Narration', 'Dialogue', 'Character voice', 'Script read'] },
  { id: 'other', label: 'Other', accent: 'var(--teal)', desc: '3D, code, text, ideas, experiments.',
    actions: ['3D concept', 'App idea', 'Claude handoff', 'Campaign concept'] },
];

const ORB_NODES = [
  { id: 'chat',     label: 'Chat',     sub: 'Brainstorm, plan, and create', accent: 'var(--violet)', angle: 222 },
  { id: 'generate', label: 'Generate', sub: 'Create images, videos, audio', accent: 'var(--purple)', angle: 180 },
  { id: 'library',  label: 'Library',  sub: 'Prompts, assets, styles',      accent: 'var(--blue)',   angle: 138 },
  { id: 'projects', label: 'Projects', sub: 'Your worlds and systems',      accent: 'var(--teal)',   angle: 92  },
  { id: 'gallery',  label: 'Gallery',  sub: 'Explore your creations',       accent: 'var(--amber)',  angle: 50  },
  { id: 'flows',    label: 'Flows',    sub: 'Automate your process',        accent: 'var(--rose)',   angle: 8   },
  { id: 'create',   label: 'Create',   sub: 'Prompt, script, storyboard',   accent: 'var(--pink)',   angle: 312 },
];

const CHAT_CHIPS = [
  'Improve this prompt', 'Director\u2019s brief', 'Build a storyboard',
  'Create song prompt', 'Cover art prompt', 'Make variations',
  'Summarize this project', 'Claude handoff',
];

const SHORTCUTS = [
  'Director\u2019s Brief', 'Character Builder', 'Style Reference', 'Storyboard',
  'Batch Generate', 'AI Assistant', 'Song Prompt', 'Sound Design', 'Claude Handoff',
];

const LIBRARY = {
  Prompts: [
    { title: 'Cinematic alley, neon rain', tag: 'Video Prompt', body: 'Slow dolly through a rain-soaked alley, neon reflections, anamorphic flares, 35mm grain, moody teal + magenta key light.', fav: true, project: 'Internet Dreams' },
    { title: 'Rebecca — hero portrait', tag: 'Image Prompt', body: 'Iridescent nonbinary alien, chrome freckles, violet sub-surface skin glow, soft rim light, editorial fashion lighting.', fav: true, project: 'Rebecca' },
    { title: 'Lo-fi nostalgia loop', tag: 'Music Prompt', body: 'Dreamy bedroom-pop, tape saturation, 90 bpm, warm Rhodes chords, vinyl crackle, wistful and hopeful.', fav: false, project: 'Internet Dreams' },
  ],
  'Style Rules': [
    { title: 'Internet Dreams — palette', tag: 'Style Rule', body: 'Always magenta + violet + deep navy. Bloom highlights. CRT scanline texture at 6% opacity. Y2K chrome type.', fav: true, project: 'Internet Dreams' },
    { title: 'Rebecca — material rules', tag: 'Style Rule', body: 'Skin reads as living glass. Never fully opaque. Subsurface violet. Chrome accents only on brow + collarbone.', fav: false, project: 'Rebecca' },
  ],
  'Character Rules': [
    { title: 'Rebecca — identity', tag: 'Character', body: 'They/them. Calm, watchful, ancient curiosity. Speaks in short poetic fragments. Avoids harsh edges, loves symmetry.', fav: true, project: 'Rebecca' },
  ],
  'Director Briefs': [
    { title: 'Teaser — 24s cut', tag: 'Director Brief', body: 'Open on orb ignition. 3 quick worlds. End on logo bloom. Cuts on the beat. No dialogue — let the synth carry it.', fav: false, project: 'Internet Dreams' },
  ],
  'Claude Handoffs': [
    { title: 'Gallery re-run pipeline', tag: 'Claude Handoff', body: 'Spec: re-run any gallery item with edited prompt, fork into new project, keep lineage. Cloudflare R2 + D1.', fav: false, project: 'EasyNews' },
  ],
};
const LIBRARY_SECTIONS = ['All', ...Object.keys(LIBRARY)];

const QUEUE = [
  { id: 'q1', title: 'LTX Text-to-Video', type: 'Video', project: 'Internet Dreams', state: 'running', pct: 68, eta: '~2 min', g: ['#3a1d6e', '#c026d3'] },
  { id: 'q2', title: 'Flux — Rebecca v4', type: 'Image', project: 'Rebecca', state: 'running', pct: 31, eta: '~4 min', g: ['#6d28d9', '#db2777'] },
  { id: 'q3', title: 'Ambient loop — drift', type: 'Sound', project: 'Internet Dreams', state: 'waiting', pct: 0, eta: 'Queued', g: ['#be123c', '#7c3aed'] },
  { id: 'q4', title: 'Cover art — Familiar', type: 'Image', project: 'Internet Dreams', state: 'done', pct: 100, eta: 'Done', g: ['#9d174d', '#7c3aed'] },
];

Object.assign(window, {
  PROJECTS, MEDIA, ACTIVITY, CREATE_TYPES, ORB_NODES, CHAT_CHIPS,
  SHORTCUTS, LIBRARY, LIBRARY_SECTIONS, QUEUE,
});
