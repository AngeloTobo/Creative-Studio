# Creative Studio

Creative Studio is a standalone creative workstation. It owns its React frontend, typed contracts, Worker/BFF, D1 history, and review decisions. AFDFW is an optional backend capability provider; it is not the product shell and is never exposed as a generic browser proxy.

## Run locally on this hardware

Start ComfyUI at `http://127.0.0.1:8188`, then launch the complete local-first application:

```powershell
npm install
npm run local
```

Open the localhost URL printed by the launcher (`http://127.0.0.1:5173` by default). This one command runs the UI, Wrangler-local BFF, local D1/R2 stores, and Local Runner 1.9. Image, audio/music, video, multimodal CreativeDNA analysis, and reviewed ACE-Step music LoRA jobs use this machine's GPU. Cloudflare and AFDFW are not used by the local process.

Local mode requires a real imported ComfyUI API-format workflow for generation and never substitutes the development renderer. It automatically creates or reuses an ACL-protected localhost runner credential outside the repository. Local data remains local and is not silently synchronized to the remote site. See [docs/LOCAL_FIRST.md](docs/LOCAL_FIRST.md) for the exact ownership and shutdown boundaries.

For UI-only work, the explicitly labeled browser-persistent development adapter remains available. It starts empty and creates no example projects or artifacts:

```powershell
npm run dev
```

The individual local BFF commands remain available for diagnostics:

```powershell
npm run db:local
npm run dev:worker
```

Then start the UI in a second PowerShell window:

```powershell
$env:VITE_CREATIVE_STUDIO_ADAPTER = "http"
$env:VITE_CREATIVE_STUDIO_LOCAL = "true"
npm run dev
```

The Vite client calls only `http://127.0.0.1:8787/api/creative-studio/*` through its same-origin development proxy.

## Local Runner 1.9

Local Runner 1.9 executes imported ComfyUI API-format workflows, CreativeDNA evidence synthesis, and reviewed ACE-Step 1.5 music LoRA jobs on this Windows machine without keeping Creative Studio open. In the deployed app, open **Settings**, create a one-time machine token, then run from this repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local-runner.ps1
```

The installer prompts for the one-time token, writes it to `%LOCALAPPDATA%\Creative Studio Runner\config.json` with a current-user ACL, registers an at-logon task, and starts it. ComfyUI must be available at `http://127.0.0.1:8188`. Runner credentials are hashed in D1 and can be revoked in Settings. The machine agent talks only to the token-authenticated `runner.cs.angelotoborg.com` API; that hostname serves no application shell or owner-session routes.

Install the pinned official ACE-Step 1.5 runtime and Base checkpoints once. The script uses `D:\AI\ACE-Step-1.5` by default, keeps Python and model files outside this repository, and sets only user-level non-secret runtime paths:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-ace-step-training.ps1
```

The runner advertises `ace-step-1.5-lora` only after the Python environment, Base model, VAE, and text encoder all have real weight and config files. A training run unloads idle ComfyUI models, requires at least 18 GB free VRAM, runs the official corrected preprocessing/training CLI, retains the checkpoint locally, and waits for a noted owner approval before activation. Gemma captions and any lyrics are reviewable before GPU training; BPM and key are left blank unless the owner verifies them.

For a foreground diagnostic run with the installed configuration:

```powershell
$env:CS_RUNNER_CONFIG = "$env:LOCALAPPDATA\Creative Studio Runner\config.json"
npm run runner:once
```

For an isolated local-BFF diagnostic, `CS_RUNNER_API_BASE`, `CS_RUNNER_TOKEN`, `CS_COMFY_URL`, and `CS_RUNNER_POLL_MS` override the installed configuration for that process only. Do not save or print a one-time runner token.

The runner makes one unified claim at most once per minute while idle, one combined job/machine heartbeat per minute while active, and bounded heartbeats when execution changes stage. UI-format ComfyUI files remain editable and versioned, but must be exported in API format before execution. Image, music/audio, and video workflows plus ACE-Step music LoRA are supported; image/video model training and 3D execution are deliberately outside this release.

## Verify

```powershell
npm run check
npm run test:e2e
```

`npm run check` covers lint, browser-domain unit tests, Workers-runtime API tests with isolated D1 migrations, environment validation, TypeScript, production build, and a source secret-signature scan. The browser suite runs the entire CreativeDNA versioning and note-gated artifact acceptance loop in desktop and mobile Chrome, verifies the production cockpit, durable cancel/retry behavior, and the real-media boundary, and includes keyboard-focus and reduced-motion gates. Training-review, production-loop, and cockpit tests enforce that a completed trained version awaiting its first activation remains an owner action, that an unreviewed or rejected trained DNA cannot generate, become a parent, or seed another training run, that accepted prompt/settings evidence is not silently reused across durable training runs, and that retry history remains durable without leaving a resolved failure in the action inbox.

The production contract is configured and can be checked independently:

```powershell
npm run check:env:production
```

## Runtime modes

- `development`: explicitly labeled browser-local project, job, and history persistence. It contains no seeded records and never pretends that an uploaded file was retained.
- `http`: the frontend calls only the Creative Studio BFF. The Worker uses standalone D1 and either its development renderer or narrow AFDFW adapters.
- `BACKEND_MODE=development`: no AFDFW calls; suitable for local Worker verification.
- `BACKEND_MODE=afdfw`: the production Worker uses the same-account `art-feed-dfw` service binding for approved-session handoff and generation only. Do not put tokens in Vite environment variables.

## Production

The independent production application is live at [cs.angelotoborg.com](https://cs.angelotoborg.com). Cloudflare Access protects `cs.angelotoborg.com/*` with the `Angelo only` policy.

- Worker: `creative-studio`
- D1: `creative-studio`
- R2: `creative-studio-artifacts`
- Queue: `creative-studio-jobs` with `creative-studio-jobs-dlq`
- Scheduled recovery: hourly
- Backend service binding: `AFDFW` -> `art-feed-dfw`
- Generic `workers.dev` route: disabled in production
- Local runner endpoint: `runner.cs.angelotoborg.com` with revocable bearer credentials and no public application shell

The production configuration uses only Cloudflare free-plan-compatible services. Browser reads are consolidated into one snapshot, active polling runs at most once per minute only while the tab is visible, runner work polling is one request per minute, and failed refreshes back off rather than retrying into a limit. `npm run check:cloudflare-free` enforces a 2,904-request/day maximum baseline before explicit actions or active Queue deliveries. See [docs/CLOUDFLARE_FREE_BUDGET.md](docs/CLOUDFLARE_FREE_BUDGET.md) for the allowance and troubleshooting boundary.

CreativeDNA, projects, generation jobs, CreativeDNA training jobs, training reviews, runner registrations, uploaded-media records, ComfyUI workflow revisions, artifacts, training evidence, and decisions remain in Creative Studio D1. Create is one task-first surface for Image, Video, Song, and Train: choose a reusable model already in the owner's library, upload or select project media, describe the result, and generate. Workflow JSON import and maintenance live in Model Library instead of interrupting creation. Models can be reused across the owner's projects, while every job, DNA version, media binding, artifact, and decision remains scoped to the active project. Phase 3 adds a Worker-derived production loop for every project: activate a DNA version, produce through a durable job, review the retained result, and evolve from newly accepted evidence. The loop always exposes the next owner action and routes directly to it. Phase 4 adds the cross-project Production cockpit: its owner inbox, notification count, run history, queue positions, execution durations, 20-minute long-run warnings, runner/GPU state, and verified storage totals are freshly derived by the Worker from durable records. Project, modality, workflow, DNA-version, and decision filters do not create a second source of truth. Review actions route to the exact artifact or trained version; generation recovery creates a new retry job while preserving the failed run, and an already-retried failure no longer remains actionable. Accepted prompt/settings evidence is fresh until a waiting, running, or completed training job reserves it through a D1 uniqueness constraint; cancelled and failed runs atomically release that evidence, while live and completed runs prevent silent double inclusion, including concurrent requests. Project uploads stream directly to Creative Studio R2, are size-verified before metadata is committed, and retain explicit training consent plus owner provenance. Uploading alone does not train: the owner selects eligible uploads and starts a durable run for Local Runner 1.4. The paired machine downloads only that exact consented bundle, measures real image pixels or decoded audio/video samples, and uses the bundled Gemma 4 ComfyUI graph to write a detailed reusable explanation of each image, audio file, or video. The source retains its analysis prompt, exact Gemma model and settings, workflow version, and ComfyUI prompt ID; deterministic measurements and accepted-result prompt/settings evidence remain bounded inputs to the new immutable CreativeDNA version. A completed trained version remains pending: the review workspace compares it with its baseline, exposes every source description and observation, keeps technical metrics collapsed on demand, and requires an explicit noted approve or reject decision. Approval activates that exact version; rejection preserves or restores the prior active baseline. Every decision is append-only with actor, note, time, and post-decision active DNA. The Worker independently blocks pending or rejected trained DNA from generation, child-version creation, retry/reuse, or further training. This is evidence-backed profile synthesis, not LoRA or foundation-model fine-tuning. Workflow JSONs can be imported once, inspected, customized through safe detected controls, saved as immutable revisions, selected directly as models in Create, versioned by content hash, and exported exactly. Retained generated image, audio, and video artifacts can be selected as compatible inputs to later workflows without leaving Creative Studio. AFDFW remains available for its narrow image/music adapters; API-format image, music/audio, and video workflow jobs instead wait for Local Runner 1.4, which records queue, preparation, render, download, and retention stages, downloads only the bound inputs, submits the immutable graph to localhost ComfyUI, renews a lease, tolerates a busy ComfyUI history endpoint, and uploads the completed output directly into verified Creative Studio R2 retention. Local Runner 1.4.2 also extracts and retains frame zero for every new video; Artifacts displays that thumbnail and the real player in one top media frame, with a same-origin browser fallback for older retained videos. Twenty minutes is an awareness threshold, not a local cancellation. Queue combines exact stamped dimensions, steps, frames, models, inputs, and prompt length with measured exact-revision history so likely cost drivers are visible without inventing a provider bottleneck. A retry after a transient runner, download, or retention failure resumes the recorded ComfyUI prompt instead of regenerating it. Every completed result keeps its workflow revision, hash, parameters, models, input bindings, prompt, timing, and retry lineage. Acceptance does not control retention. Artifact review is media-aware for image, audio, and video. Accept and reject require a review note; every append-only decision visibly retains its note, actor, and time. Generated prompts and settings enter a CreativeDNA candidate set, and artifact acceptance or rejection explicitly makes that evidence training-ready or excluded.

New accounts and cleared environments start empty. Projects are created, edited, paused, and archived only through explicit user actions; production code does not seed project or artifact records.

To run the verified release sequence:

```powershell
npm run deploy:production
```

See [docs/BUILD_REALITY.md](docs/BUILD_REALITY.md) and [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) for the live evidence and operating boundaries.
