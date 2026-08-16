# Build reality

Last verified: 2026-08-16 (America/Chicago)

## Working now

- Vite + React + TypeScript module application with the original Creative Studio visual language retained across desktop and mobile layouts.
- Typed `Project`, `CreativeDnaArtifact`, `Job`, `Artifact`, `MediaAsset`, `Capability`, and `Acceptance` contracts shared by client, adapters, tests, and Worker.
- Explicit `development-local-storage` adapter that starts empty, labels browser-only metadata behavior, and blocks fake uploads.
- Standalone Worker/BFF serving only `/api/creative-studio/*`, plus dedicated D1 storage for projects, DNA, jobs, uploaded-media metadata and consent, generated artifacts, retained-media pointers, and append-only decisions.
- Placeholder-free first-run onboarding with explicit project create, edit, pause, and archive actions; neither the Worker nor development adapter seeds records.
- Project-scoped CreativeDNA, queues, libraries, artifacts, portal summaries, and review-dock state.
- CreativeDNA authoring, upload-based training, generation translation, and version history are consolidated into one `CreativeDNA Studio` route; the former `#/generate` URL resolves to that workspace.
- Project-scoped image, audio, and video upload with a 100 MB limit, exact MIME allowlist, direct Creative Studio R2 retention, stored-size verification, D1 metadata, owner-scoped playback with byte ranges, and no AFDFW upload path.
- Project-scoped ComfyUI workflow JSON import with a 1 MB limit, UI-graph/API-prompt detection, safe editable-control discovery, model inventory, SHA-256 content stamps, exact JSON export, and immutable revisions. No workflow is seeded or bundled as placeholder data.
- The Workflow surface supports uploading an existing JSON and building a customized version from detected prompts, seeds, dimensions, durations, samplers, switches, and media filenames. The Generate surface exposes the same safe scalar controls, saves changed values as a new immutable revision, and queues that exact returned revision in one action.
- Local Runner v1 enrollment creates a 256-bit one-time token, stores only its SHA-256 hash in D1, and exposes revocation plus live machine/ComfyUI state through the real Settings surface. The separate runner hostname serves only six bearer-authenticated machine routes and returns `404` for its shell or owner APIs.
- API-format image, music/audio, and video workflows can create `local-comfyui` jobs from the consolidated CreativeDNA Generate surface. Each job stamps the exact workflow/revision/hash, safe parameter values, detected models, and media-parameter bindings. Compatible retained generated artifacts can be selected alongside retained uploads, with normalized source type and artifact lineage preserved.
- The Windows runner downloads only the bound owner inputs, uploads them to localhost ComfyUI, submits the immutable graph, persists the ComfyUI prompt ID, renews a two-minute lease, survives browser closure, and resumes an existing prompt after an agent restart instead of resubmitting it. Busy-history timeouts are treated as transient, and eligible retry jobs preserve an already-submitted prompt rather than duplicating GPU work.
- Modality-specific save nodes are preferred when selecting ComfyUI history output, preventing a preview file from being retained when the graph has an intended save node.
- Runner completion accepts only allowlisted image/audio/video outputs up to 100 MB, stores them at a deterministic Creative Studio R2 artifact key, verifies exact byte size, and only then completes the job and creates its CreativeDNA training candidate. Retained video has native playback and download review.
- Each uploaded asset records explicit CreativeDNA-training eligibility and owner provenance. Upload does not start training; the owner explicitly selects consented uploads and starts a separate durable training run.
- Upload-based CreativeDNA training jobs persist their exact asset IDs, accepted prompt/settings evidence, optional base-DNA lineage, target modality, idempotency key, runner identity, result DNA ID, and terminal state. An authenticated local runner can inspect the bundle, claim it, complete it into a new immutable DNA version, or report failure; cancellation remains explicit.
- Deterministic CreativeDNA compilation, bounds, prompt translation, rights-safe provenance, root/parent/version lineage, and both music/image submission.
- Queue-owned production submission and per-generation reconciliation continue after the originating browser request ends; a scheduled recovery sweep re-enqueues due work.
- D1-backed idempotency, reconciliation leases, a 30-minute timeout, bounded retries, retry lineage, unique artifact creation, and explicit cancel controls.
- Every real upstream completion enters a non-cancellable `retaining` state, streams to a deterministic Creative Studio R2 key, verifies stored size, and becomes completed/ready only after that verification. Interrupted retention retries without resubmitting generation.
- Media-aware artifact review: retained music uses a real audio player and download, retained images open into a full-size inspector, and retained R2 artifact responses support byte-range playback and seeking.
- Accept and reject require a bounded review note in the UI, typed adapter boundary, and Worker. Append-only decision history visibly includes decision, note, actor, and timestamp; archive still permits an optional note.
- Artifact history, lineage expansion, explicit accept/reject/archive controls, and failure cards that preserve the raw provider error while adding actionable recovery guidance and a durable retry action.
- Every new generation job and artifact carries an immutable settings stamp. Reuse creates a new job from the recorded prompt, provider, and settings and records its source job instead of mutating history.
- Every completed result creates a CreativeDNA training candidate containing the output artifact, prompt, and settings stamp. Accept promotes it to `training-ready`; reject marks it `excluded`; archive does not silently change its training judgment.
- Exact AFDFW method/path allowlist with no generic proxy.
- Same-account AFDFW service binding for identity handoff and generation; CreativeDNA remains product-owned in Creative Studio D1.
- Accept, reject, and archive are decision-only operations for real results because retention is completed first; an interactive review request also repairs an older pending-retention artifact before recording a decision.
- Fail-closed browser/Worker environment validation and a production-readiness preflight.
- Workers-runtime Vitest integration using the real D1 migrations and production Worker entrypoint.

## Verified in this build

- TypeScript, ESLint, Vitest, Vite production build, environment validation, and source secret scan pass.
- Twelve browser-domain unit tests cover CreativeDNA rights/lineage/project scope, empty development persistence, the no-fake-upload boundary, project lifecycle, idempotent generation, cancel/retry behavior, route rejection, adapter configuration, media-aware audio/image review rendering, failure guidance, and ComfyUI API/UI graph inspection, image/audio/video input detection, and safe editing.
- Nineteen Workers-runtime tests cover the Worker entrypoint, AFDFW target validation, unauthenticated access, Access-header relay, empty/project lifecycle behavior, malformed input, project ownership, owner-isolated note-required review with actor/note persistence, verified owner-scoped media upload/list/playback/ranges, upload-based CreativeDNA training start/bundle/claim/complete lineage, workflow import/inspection/version/export, immutable settings reuse, CreativeDNA training-evidence state, browser-independent AFDFW generation, Local Runner enrollment/auth/claim/input download/lease resume/video completion, deterministic R2 retention, idempotency, cancellation/retry, byte ranges, retention interruption/resume without regeneration, pending-retention repair, append-only decisions, runner-host shell rejection, and generic-proxy rejection.
- Local D1 migration applies successfully.
- A Worker API flow created DNA, completed a durable job, created an artifact, stored acceptance, rejected a generic proxy path, and preserved state across a Worker restart.
- A real Chromium pass against the HTTP/BFF mode completed DNA save, image job, artifact lineage, acceptance, and reload persistence with no current console errors.
- Desktop and 390px mobile rendered inspection completed; module-semantic layout regressions found during inspection were corrected.
- Local Runner Settings passed desktop and 390px mobile rendered inspection. The actual MiniMax H3 API export renders as an executable 20-node video workflow with one retained-image input, four detected models, an immutable hash, and a truthful offline/online queue state.
- A real local Z-Image Turbo API workflow was imported from `image_z_image_turbo.json`, edited and saved as revision v2, queued without a browser dependency, and executed by ComfyUI `0.33.0` on the RTX 3090. The retained PNG is 289,044 bytes and its verified stamp contains the exact 512×512 dimensions, seed `20260816`, prompt, three model names, revision ID, and SHA-256 content hash. Ranged media delivery returned `206` with `image/png` and the exact stored length, and the result entered CreativeDNA evidence as a candidate.
- Real execution exposed and corrected two truthful failure boundaries: long renders no longer fail because ComfyUI temporarily blocks history polling, and local development now binds a Wrangler-local R2 store so a job cannot report completion without retained bytes. Retry resumed the existing ComfyUI prompt after both failures and completed without another render.
- Chromium rendered inspection confirmed the real retained result in artifact history, full-size image inspection, and download UI. The known simulator-created local QA artifact was removed with its dependent candidate and job after exact-ID checks; the real retained artifact remains.
- Playwright reports eight passing checks and four intentional mobile skips: desktop/mobile empty-first-run project creation, DNA versioning, note-required review, visible decision history, and reload persistence; a desktop durable cancel/retry flow; a desktop project edit/archive lifecycle; a no-fake-media boundary check; reduced motion in both layouts; and desktop keyboard focus/navigation.
- Production environment preflight passes with a real D1 ID, dedicated R2 and Queue bindings, queue consumer, five-minute recovery trigger, AFDFW service binding, custom domain, and disabled `workers.dev` route.
- Cloudflare deployed workflow-backed generation Worker version `8bdfedf0-56ac-48de-a313-584c08e1d61d` at 100% to both the protected product hostname and the API-only runner hostname.
- Remote D1 reports no pending migrations after `0007_local_runner_v1.sql`; runner registration and local-job execution fields exist without any generated placeholder rows.
- Cloudflare reports `creative-studio-jobs` with one producer and one consumer, plus the separate `creative-studio-jobs-dlq`; deployment output confirms the five-minute schedule.
- Anonymous requests to `/` and `/api/creative-studio/session` both receive Cloudflare Access redirects.
- Authenticated live inspection reloaded the deployed production assets, confirmed the consolidated CreativeDNA Studio with upload-based training and generation on one page, and reported every connected runtime capability available. CreativeDNA training is explicitly degraded only because a local trainer has not yet claimed a run.
- Authenticated live inspection confirmed the empty production Project screen renders `Create your first project` with no seeded project cards.
- `runner.cs.angelotoborg.com/` returns `404`, an unauthenticated claim returns `401`, and the main `cs.angelotoborg.com/` path remains behind its Cloudflare Access redirect.
- The real `Angelo RTX 3090 workstation` runner is installed as an at-logon Scheduled Task with an ACL-restricted config outside the repository. After release, two orphaned v1.0.0 child processes were stopped and exactly one task-owned process remains. Its production heartbeat reports runner `1.0.1`, ComfyUI `0.33.0`, and `cuda:0 NVIDIA GeForce RTX 3090 : cudaMallocAsync`, with no active job or error.
- The three legacy prototype project rows were deleted only after exact owner/ID/name/timestamp matching and dependent-record checks; the post-cleanup production counts are zero projects, DNA artifacts, jobs, artifacts, and acceptances.
- Post-release production counts are one owner-created project, two owner-uploaded media assets, and zero DNA artifacts, generation jobs, generated artifacts, acceptances, or training jobs. Deployment verification inserted no project, upload, job, artifact, decision, training job, or placeholder record.

## Current production boundary

- Production is independently deployed as Worker `creative-studio`; the AFDFW frontend and its dirty local checkout were not deployed or changed.
- The production environment uses D1 `creative-studio`, R2 `creative-studio-artifacts`, Queue `creative-studio-jobs` with a dead-letter queue, and a narrow service binding to Worker `art-feed-dfw`.
- Local workflow execution uses the API-only custom domain `runner.cs.angelotoborg.com`. It is not an AFDFW route and cannot serve the Creative Studio shell, owner APIs, or a generic proxy.
- Cloudflare Access application `Creative Studio` protects `cs.angelotoborg.com/*` with policy `Angelo only` and a 24-hour session.
- The top-level Wrangler configuration stays in development mode and declares isolated local D1 plus Wrangler-local R2 bindings for real local retention tests. Production IDs, service binding, Queue, routes, cron, and deployed R2 resource remain only under `env.production`.
- The browser development adapter creates only clearly labeled local metadata and a non-media visual treatment for development job artifacts; it cannot upload or claim retained media.
- Local Runner v1 executes versioned API-format image, audio/music, and video workflows. UI-format graphs must still be exported from ComfyUI in API format; automatic UI-graph conversion and 3D execution are not claimed.
- Local Runner v1 is a ComfyUI generation runner. The durable CreativeDNA training-job protocol remains deployed, but the separate media-analysis/profile-synthesis trainer is not implemented or claimed by this release; training runs therefore still wait for that trainer.
- Runner source and the installed production Scheduled Task both run `1.0.1`.
- Removal timing for any old AFDFW prototype remains a later owner decision.

See `PRODUCTION_READINESS.md` for the verified release and rollback runbook.
