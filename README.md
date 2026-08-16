# Creative Studio

Creative Studio is a standalone creative workstation. It owns its React frontend, typed contracts, Worker/BFF, D1 history, and review decisions. AFDFW is an optional backend capability provider; it is not the product shell and is never exposed as a generic browser proxy.

## Run locally

Install dependencies and start the explicitly labeled browser-persistent development adapter. It starts empty and creates no example projects or artifacts:

```powershell
npm install
npm run dev
```

To run the standalone Worker/BFF with local D1 durability and a local R2 artifact store:

```powershell
npm run db:local
npm run dev:worker
```

Then, in a second PowerShell window:

```powershell
$env:VITE_CREATIVE_STUDIO_ADAPTER = "http"
npm run dev
```

The Vite client runs on its printed local URL and calls the Worker at `http://127.0.0.1:8787/api/creative-studio/*` during development.

## Local Runner 1.1

Local Runner 1.1 executes imported ComfyUI API-format workflows and CreativeDNA evidence synthesis on this Windows machine without keeping Creative Studio open. In the deployed app, open **Settings**, create a one-time machine token, then run from this repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-local-runner.ps1
```

The installer prompts for the one-time token, writes it to `%LOCALAPPDATA%\Creative Studio Runner\config.json` with a current-user ACL, registers an at-logon task, and starts it. ComfyUI must be available at `http://127.0.0.1:8188`. Runner credentials are hashed in D1 and can be revoked in Settings. The machine agent talks only to the token-authenticated `runner.cs.angelotoborg.com` API; that hostname serves no application shell or owner-session routes.

For a foreground diagnostic run with the installed configuration:

```powershell
$env:CS_RUNNER_CONFIG = "$env:LOCALAPPDATA\Creative Studio Runner\config.json"
npm run runner:once
```

For an isolated local-BFF diagnostic, `CS_RUNNER_API_BASE`, `CS_RUNNER_TOKEN`, `CS_COMFY_URL`, and `CS_RUNNER_POLL_MS` override the installed configuration for that process only. Do not save or print a one-time runner token.

UI-format ComfyUI files remain editable and versioned, but must be exported in API format before execution. Image, music/audio, and video workflows are supported; 3D execution is deliberately outside Local Runner 1.1.

## Verify

```powershell
npm run check
npm run test:e2e
```

`npm run check` covers lint, browser-domain unit tests, Workers-runtime API tests with isolated D1 migrations, environment validation, TypeScript, production build, and a source secret-signature scan. The browser suite runs the entire CreativeDNA versioning and note-gated artifact acceptance loop in desktop and mobile Chrome, verifies durable cancel/retry behavior and the real-media boundary, and includes keyboard-focus and reduced-motion gates. Training-review and production-loop tests enforce that a completed trained version awaiting its first activation remains the next action, that an unreviewed or rejected trained DNA cannot generate, become a parent, or seed another training run, and that accepted prompt/settings evidence is not silently reused across durable training runs.

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
- Scheduled recovery: every five minutes
- Backend service binding: `AFDFW` -> `art-feed-dfw`
- Generic `workers.dev` route: disabled in production
- Local runner endpoint: `runner.cs.angelotoborg.com` with revocable bearer credentials and no public application shell

CreativeDNA, projects, generation jobs, CreativeDNA training jobs, training reviews, runner registrations, uploaded-media records, ComfyUI workflow revisions, artifacts, training evidence, and decisions remain in Creative Studio D1. CreativeDNA authoring, training, review, generation, and version history share one workspace. Phase 3 adds a Worker-derived production loop for every project: activate a DNA version, produce through a durable job, review the retained result, and evolve from newly accepted evidence. The loop always exposes the next owner action and routes directly to it. Accepted prompt/settings evidence is fresh until a waiting, running, or completed training job reserves it through a D1 uniqueness constraint; cancelled and failed runs atomically release that evidence, while live and completed runs prevent silent double inclusion, including concurrent requests. Project uploads stream directly to Creative Studio R2, are size-verified before metadata is committed, and retain explicit training consent plus owner provenance. Uploading alone does not train: the owner selects eligible uploads and starts a durable run for Local Runner 1.1. The paired machine downloads only that exact consented bundle, measures real image pixels or decoded audio/video samples, combines accepted-result prompts and exact settings when selected, and completes a new immutable CreativeDNA version with per-source observations, metrics, confidence, and per-dimension provenance. A completed trained version remains pending: the review workspace compares it with its baseline, exposes every source observation and metric, and requires an explicit noted approve or reject decision. Approval activates that exact version; rejection preserves or restores the prior active baseline. Every decision is append-only with actor, note, time, and post-decision active DNA. The Worker independently blocks pending or rejected trained DNA from generation, child-version creation, retry/reuse, or further training. This is deterministic evidence synthesis, not LoRA or foundation-model fine-tuning. Workflow JSONs can be imported, inspected, customized through safe detected controls, saved as an immutable revision and queued from the Generate surface, versioned by content hash, and exported exactly. Retained generated image, audio, and video artifacts can be selected as compatible inputs to later workflows without leaving Creative Studio. AFDFW remains available for its narrow image/music adapters; API-format image, music/audio, and video workflow jobs instead wait for Local Runner 1.1, which downloads only their bound inputs, submits the immutable graph to localhost ComfyUI, renews a lease, tolerates a busy ComfyUI history endpoint, and uploads the completed output directly into verified Creative Studio R2 retention. A retry after a transient runner, download, or retention failure resumes the recorded ComfyUI prompt instead of regenerating it. Every completed result keeps its workflow revision, hash, parameters, models, input bindings, prompt, and retry lineage. Acceptance does not control retention. Artifact review is media-aware for image, audio, and video. Accept and reject require a review note; every append-only decision visibly retains its note, actor, and time. Generated prompts and settings enter a CreativeDNA candidate set, and artifact acceptance or rejection explicitly makes that evidence training-ready or excluded.

New accounts and cleared environments start empty. Projects are created, edited, paused, and archived only through explicit user actions; production code does not seed project or artifact records.

To run the verified release sequence:

```powershell
npm run deploy:production
```

See [docs/BUILD_REALITY.md](docs/BUILD_REALITY.md) and [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) for the live evidence and operating boundaries.
