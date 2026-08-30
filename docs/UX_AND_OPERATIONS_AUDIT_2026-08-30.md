# Creative Studio UX and operations audit

Date: 2026-08-30 (America/Chicago)

## Decision

The product should have one obvious front door: **Create**. The ordinary path is now source (optional), direction, and Create; everything else is contextual progressive disclosure.

This turn is deliberately split in two:

- The UX simplification is deployed and verified.
- The operations work below is an evidence-backed recommendation set only.

**No Local Runner, ComfyUI, workflow graph, model, queue, prompt payload, generation setting, post-processing, storage contract, or output behavior was changed. No generation job was submitted during this audit.**

## What was making the product feel complicated

The audit found two competing entry points, operational language in the creative path, and too many equally prominent controls. Before this pass, Home exposed 38 visible interactive elements and Create exposed 43 in the audited desktop state. Create occupied about 2.2 desktop viewports and 3.8 phone viewports before the prompt and secondary controls were fully traversed.

The underlying product remains intentionally capable: generation, retained sources, exact settings, model choice, CreativeDNA, Worlds, recipes, evolution, prompt enhancement, scripts, training, review, lineage, queue recovery, and artifact history are all real features. The UX problem was not their existence; it was that the interface asked the user to understand too many of them before making something.

## UX changes implemented locally

| Area | Simplification | Functionality preserved |
|---|---|---|
| Front door | Empty URLs, the brand, and the first navigation item open Create. Home is renamed **Ideas** and remains directly available. | Every prior route remains reachable. |
| Composer | A functional central orb now accepts drag/drop or upload, shows the selected source, and is surrounded by Image, Video, Song, and Train choices. | Upload, retained-source selection, remove/change source, source provenance, and prompt-only creation remain intact. |
| Primary action | The primary button says **Create**. Detailed blockers explain what is missing without turning the button label into an instruction paragraph. | Disabled states, blocker actions, workload confirmation, submission, and batch construction are unchanged. |
| Settings | Duration, shape, output count, and the selected workflow move into **Plan**. Model, goals, speech, sound, World, recipes, evolution, trusted presets, and exact settings remain under **More creative controls**. | Standard Animate remains two 5-second, 0.20 MP outputs; four-way remains four named lanes; Fast 30 remains one output; exact restored values still open and remain visible. |
| Prompt enhancement | The existing action moves into an **Experimental AI prompt assist** disclosure and is explicitly off by default. | The same capability checks, request handler, generated prompt, lineage, and application flow remain in place. |
| Results | Recent work appears only when retained artifacts exist and is collapsed until requested, except when a genuinely new result arrives. | Inspect, download, reuse as source, and full Artifact History remain available. |
| Navigation after submit | One-click Animate submissions remain on Create, where active progress is already visible, instead of redirecting again to Work. | The same durable jobs and batch requests are submitted; Work and its active queue remain one click away. |
| Runtime language | Common runner codes are translated into a human instruction. Exact raw errors remain under **Technical detail**. | Diagnostic data is not modified or discarded. |
| First project | On a 360 by 640 viewport, the one required field and **Create project** action are visible above the mobile navigation. Optional metadata remains collapsed. | The complete project schema and lifecycle controls remain available. |
| Accessibility | Active Studio tabs use theme-aware ink instead of white-on-pale styling; reduced-motion behavior and keyboard order remain covered. | No tab, section, or system capability was removed. |

## Rendered UX checks

The final 360 by 640 checks confirm:

- the central orb, creation type, prompt, Plan summary, and Create action fit in the first video-composer viewport;
- the Create action remains visible when the runner is offline, with the reason directly below it;
- first-project onboarding exposes its primary action above the fixed navigation;
- the development badge no longer overlaps the project heading or form;
- no horizontal overflow was introduced at the 320/360/390 mobile widths covered by the browser checks.

## Operations findings and safe next work

Every item in this section requires separate approval, an isolated comparison, and a rollback plan.

| Priority | Finding and evidence | User impact | Safe next experiment | Preservation gate |
|---|---|---|---|---|
| P0 | **ComfyUI is not supervised.** The scheduled runner can be healthy while ComfyUI is offline. At the audit snapshot, runner 1.18.0 was active, `127.0.0.1:8188` was unreachable, and four existing LTX jobs remained queued. The current scheduled launcher starts Node, not ComfyUI. | Work can look normally queued while the renderer is unavailable until someone starts it manually. | Design and unit-test an offline/starting/ready/restarting/degraded supervisor state machine without launching or changing the live runtime. | Do not install a service, restart ComfyUI, alter Scheduled Tasks, or touch the queued jobs without approval. |
| P0 | **Enhance then Generate evicts warm LTX.** The external Gemma enhancement hands ComfyUI to Gemma and frees it afterward. The next generation must reload LTX. The LTX graph already includes its own `TextGenerateLTX2Prompt` expansion. | A helper button can create the longest first-render wait and may expand the prompt twice. | Compare authored prompt, built-in LTX expansion, and external enhancement using an approved same-seed offline evaluation plan. | Keep Enhance and its generated prompt behavior intact until a quality study supports a change. |
| P0 | **Cold-load latency dominates perceived speed.** Existing ComfyUI logs show a cold LTX prompt taking about 19:03, followed by warm prompts at 39.72 and 56.80 seconds. | First use feels broken even when the warm pipeline is fast. | Instrument load, inference, decode, post-processing, and upload as separate benchmark phases. | No prewarm, unload, model move, or graph mutation before identical-input comparisons are approved. |
| P0 | **Generation residency is unbounded.** The runner tracks and retains a warm family but has no idle lease; its lock coordinates Creative Studio runners, not arbitrary CUDA applications. | LTX can keep the RTX 3090 unavailable after the creative session ends. | Prototype a fake-clock idle lease and a user-visible **Free GPU** control in tests only. | Never unload while ComfyUI has running or pending work. Keep the current path available for rollback. |
| P0 | **A transient Worker request can cancel expensive work.** The current request helper has no bounded retry, while a heartbeat request error triggers prompt cancellation and drain. Recent production history includes four `fetch failed` jobs. | A short network interruption can discard minutes of valid GPU work. | Add fault-injection tests that distinguish retryable transport failure from an authoritative `continue: false`. | Tests only this turn; do not change leases, retry, cancellation, or recovery semantics. |
| P1 | **Queue selection is not model-residency-aware.** Claim ordering favors video, priority, and age, but not a compatible warm model signature. | Alternating LTX, H3, and Wan jobs can force repeated unloads and inconsistent latency. | Replay anonymized queue history through an offline scheduler simulation with bounded model affinity. | Affinity must never starve older or higher-priority work; current ordering remains canonical. |
| P1 | **ComfyUI observation is chatty under strain.** Active work polls both queue and history every two seconds. | Control-plane traffic can compound an already slow ComfyUI HTTP loop. | Prototype WebSocket observation with adaptive HTTP fallback against fixtures. | Preserve cancellation responsiveness and observed state parity before any interval changes. |
| P1 | **The default LTX graph is a quality pipeline, not a preview pipeline.** The audited graph has about 50 nodes, two sampling stages, latent upscale, audio generation, and internal prompt expansion. Mute removes audio after generation. | Quick experiments pay for work the user may not need. | Perform static graph analysis and author proposed Preview and Quality variants without running them. | Preserve the current graph, audio, seeds, dimensions, duration, and encoding until approved visual comparisons exist. |
| P1 | **Current Comfy tuning is not validated specifically for LTX.** The H3-oriented profile uses two async-offload streams and substantial pinned host memory. Logs include four `HostBuffer.read_file_slice failed` events; causation is not proven. | RAM, pagefile, disk, and GPU pressure can make completion inconsistent. | Benchmark one tuning variable at a time on an isolated fixture. | Do not replace the current profile without p95 latency, failure-rate, and output-quality evidence. |
| P1 | **Prompt enhancement has no demonstrated return.** In the read-only snapshot, 15 enhancements completed; only 2 were used by generation jobs. The completed enhanced output has no review evidence, while authored outputs have actual owner decisions. | The feature adds time and a model swap without evidence that it improves results. | Run approved, same-seed blind comparisons across short and already-detailed prompts. | Require a material quality lift without continuity regression before changing the default or generated output. |
| P2 | **Timing data cannot explain the wait.** Current timing records are broad stages rather than model handoff, cold load, inference, decode, post-processing, and upload. Runner health omits residency and resource state. | Estimates remain vague and regressions are hard to isolate. | Draft an append-only phase-event schema and fixtures. | No production migration or telemetry collection without approval and retention/privacy review. |
| P2 | **System-disk headroom is critically low.** The audit snapshot found roughly 50 GB, about 2.4%, free on C:, alongside approximately 298 GiB of shared models and a 45 GiB pagefile. | Updates, downloads, caching, and pagefile growth are exposed to avoidable failure. | Produce a read-only duplicate and cold-model inventory with an explicit reclaim proposal. | Do not move or delete models; do not put hot LTX weights on the D: HDD without benchmark evidence. |

## Prompt-enhancement decision

There is not enough evidence to say prompt enhancement improves the result enough to justify its current operational cost. The correct immediate UX decision is therefore to keep the approved function, move it out of the default path, label it experimental, and make direct creation the recommendation. The correct operations decision is to measure before changing any prompt behavior.

An approved evaluation should use:

1. the same source, workflow revision, settings, and seed;
2. short, medium, and already-detailed authored prompts;
3. authored, internal-LTX, and external-Gemma variants;
4. blind owner review for prompt adherence, motion, continuity, composition, artifacts, and preference;
5. cold and warm latency plus model-load cost;
6. an explicit threshold for a quality lift large enough to justify the extra wait.

## Recommended operations order

1. Preserve the current generation behavior while shipping the simpler UX.
2. Approve measurement instrumentation before tuning.
3. Evaluate prompt enhancement and cold/warm behavior with controlled comparisons.
4. Prototype supervision, bounded residency, and transport recovery in tests.
5. Authorize one live operational change at a time only after baseline, acceptance criteria, and rollback are documented.

## Verification and preservation ledger

- `npm run check`: passed.
- App and runner unit tests: 268 passed across 46 files.
- Worker tests: 64 passed across 4 files.
- Local Runner self-test: passed against unchanged runner source.
- Lint and all TypeScript targets: passed.
- Environment and Cloudflare Free guards: passed.
- Production build: passed.
- Secret scan: clean across 245 source files.
- Browser matrix: 60 applicable desktop/mobile checks passed; 6 existing device-shape skips remained intentional.
- Standard Animate still submits exactly two Aligned/Discovery jobs.
- Animate x4 still waits for enhancement and submits exactly four named jobs.
- Fast 30 still submits exactly one proven render and returns cleanly to the standard pair.
- Upload, retained-source reuse, exact restored settings, long-render confirmation, drafts, scripts, speech, training, review, and artifact lineage remain covered.
- No files under `runner/`, `worker/`, `shared/`, migrations, scripts, or package configuration changed.
- Commit `dd31b96` was pushed and deployed as Worker `cae26f90-2ebd-4e96-8322-a9d5ea32b0ee`; remote D1 had no migration to apply. The release restarted no process, loaded or unloaded no model, mutated no queue or review state, and submitted no proof generation. The active LTX render retained its exact job and Comfy prompt mapping after publication.
