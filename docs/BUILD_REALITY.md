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
- The Workflow surface supports uploading an existing JSON and building a customized version from detected prompts, seeds, dimensions, durations, samplers, switches, and media filenames.
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
- Eleven browser-domain unit tests cover CreativeDNA rights/lineage/project scope, empty development persistence, the no-fake-upload boundary, project lifecycle, idempotent generation, cancel/retry behavior, route rejection, adapter configuration, media-aware audio/image review rendering, failure guidance, and ComfyUI API/UI graph inspection and safe editing.
- Eighteen Workers-runtime tests cover the Worker entrypoint, AFDFW target validation, unauthenticated access, Access-header relay, empty/project lifecycle behavior, malformed input, project ownership, owner-isolated note-required review with actor/note persistence, verified owner-scoped media upload/list/playback/ranges, upload-based CreativeDNA training start/bundle/claim/complete lineage, workflow import/inspection/version/export, immutable settings reuse, CreativeDNA training-evidence state, browser-independent background generation, idempotency, cancellation/retry, verified automatic R2 retention with byte ranges, retention interruption/resume without regeneration, pending-retention repair, append-only decisions, and generic-proxy rejection.
- Local D1 migration applies successfully.
- A Worker API flow created DNA, completed a durable job, created an artifact, stored acceptance, rejected a generic proxy path, and preserved state across a Worker restart.
- A real Chromium pass against the HTTP/BFF mode completed DNA save, image job, artifact lineage, acceptance, and reload persistence with no current console errors.
- Desktop and 390px mobile rendered inspection completed; module-semantic layout regressions found during inspection were corrected.
- Playwright reports eight passing checks and four intentional mobile skips: desktop/mobile empty-first-run project creation, DNA versioning, note-required review, visible decision history, and reload persistence; a desktop durable cancel/retry flow; a desktop project edit/archive lifecycle; a no-fake-media boundary check; reduced motion in both layouts; and desktop keyboard focus/navigation.
- Production environment preflight passes with a real D1 ID, dedicated R2 and Queue bindings, queue consumer, five-minute recovery trigger, AFDFW service binding, custom domain, and disabled `workers.dev` route.
- Cloudflare deployed workflow-library Worker version `7e1282d3-3152-4b24-bfd5-f13a8c1b234b` at 100% to `cs.angelotoborg.com`.
- Remote D1 reports no pending migrations after `0005_workflow_library.sql`; the workflow, immutable revision, and CreativeDNA training-example tables were queried directly after release and contain no seeded records.
- Cloudflare reports `creative-studio-jobs` with one producer and one consumer, plus the separate `creative-studio-jobs-dlq`; deployment output confirms the five-minute schedule.
- Anonymous requests to `/` and `/api/creative-studio/session` both receive Cloudflare Access redirects.
- Authenticated live inspection opened the production UI and reported all six runtime capabilities available, including Creative Studio D1, R2 retention, and the AFDFW session/generation adapters.
- Authenticated live inspection confirmed the empty production Project screen renders `Create your first project` with no seeded project cards.
- The three legacy prototype project rows were deleted only after exact owner/ID/name/timestamp matching and dependent-record checks; the post-cleanup production counts are zero projects, DNA artifacts, jobs, artifacts, and acceptances.
- Post-release production counts are one owner-created project and zero DNA artifacts, jobs, generated artifacts, acceptances, and uploaded media. Deployment verification inserted no project, upload, job, artifact, or placeholder record.

## Current production boundary

- Production is independently deployed as Worker `creative-studio`; the AFDFW frontend and its dirty local checkout were not deployed or changed.
- The production environment uses D1 `creative-studio`, R2 `creative-studio-artifacts`, Queue `creative-studio-jobs` with a dead-letter queue, and a narrow service binding to Worker `art-feed-dfw`.
- Cloudflare Access application `Creative Studio` protects `cs.angelotoborg.com/*` with policy `Angelo only` and a 24-hour session.
- The top-level Wrangler configuration stays in development mode for isolated local tests; real bindings exist only under `env.production`.
- The browser development adapter creates only clearly labeled local metadata and a non-media visual treatment for development job artifacts; it cannot upload or claim retained media.
- This release includes the workflow library and migration `0005_workflow_library.sql`. Arbitrary workflow execution is intentionally not claimed yet: API-format graphs are ready for a future authenticated local runner, while UI-format graphs must first be exported from ComfyUI in API format.
- Consolidated CreativeDNA Studio, migration `0006_creative_dna_training_jobs.sql`, and the completed media-review/failure-recovery surface are implemented locally but are not part of the currently deployed Worker version. The site-side training protocol is real and durable; an actual local trainer must still be connected and must claim a run before its status can become `running` or `completed`.
- Removal timing for any old AFDFW prototype remains a later owner decision.

See `PRODUCTION_READINESS.md` for the verified release and rollback runbook.
