# Build reality

Last verified: 2026-08-16 (America/Chicago)

## Working now

- Vite + React + TypeScript module application with the original Creative Studio visual language retained across desktop and mobile layouts.
- Typed `Project`, `CreativeDnaArtifact`, `Job`, `Artifact`, `Capability`, and `Acceptance` contracts shared by client, adapters, tests, and Worker.
- Explicit `development-local-storage` adapter that starts empty and labels development-only simulated media behavior.
- Standalone Worker/BFF serving only `/api/creative-studio/*`, plus dedicated D1 storage for projects, DNA, jobs, artifacts, retained-media metadata, and append-only decisions.
- Placeholder-free first-run onboarding with explicit project create, edit, pause, and archive actions; neither the Worker nor development adapter seeds records.
- Project-scoped CreativeDNA, queues, libraries, artifacts, portal summaries, and review-dock state.
- Deterministic CreativeDNA compilation, bounds, prompt translation, rights-safe provenance, root/parent/version lineage, and both music/image submission.
- Queue-owned production submission and per-generation reconciliation continue after the originating browser request ends; a scheduled recovery sweep re-enqueues due work.
- D1-backed idempotency, reconciliation leases, a 30-minute timeout, bounded retries, retry lineage, unique artifact creation, and explicit cancel controls.
- Every real upstream completion enters a non-cancellable `retaining` state, streams to a deterministic Creative Studio R2 key, verifies stored size, and becomes completed/ready only after that verification. Interrupted retention retries without resubmitting generation.
- Artifact history, lineage expansion, and explicit accept/reject/archive controls.
- Exact AFDFW method/path allowlist with no generic proxy.
- Same-account AFDFW service binding for identity handoff and generation; CreativeDNA remains product-owned in Creative Studio D1.
- Accept, reject, and archive are decision-only operations for real results because retention is completed first; an interactive review request also repairs an older pending-retention artifact before recording a decision.
- Fail-closed browser/Worker environment validation and a production-readiness preflight.
- Workers-runtime Vitest integration using the real D1 migrations and production Worker entrypoint.

## Verified in this build

- TypeScript, ESLint, Vitest, Vite production build, environment validation, and source secret scan pass.
- Nine browser-domain unit tests cover CreativeDNA rights/lineage/project scope, empty development persistence, project lifecycle, idempotent generation, cancel/retry behavior, route rejection, and adapter configuration.
- Thirteen Workers-runtime tests cover the Worker entrypoint, AFDFW target validation, unauthenticated access, Access-header relay, empty/project lifecycle behavior, malformed input, project ownership, owner-isolated review, browser-independent background generation, idempotency, cancellation/retry, verified automatic R2 retention, retention interruption/resume without regeneration, pending-retention repair, append-only decisions, and generic-proxy rejection.
- Local D1 migration applies successfully.
- A Worker API flow created DNA, completed a durable job, created an artifact, stored acceptance, rejected a generic proxy path, and preserved state across a Worker restart.
- A real Chromium pass against the HTTP/BFF mode completed DNA save, image job, artifact lineage, acceptance, and reload persistence with no current console errors.
- Desktop and 390px mobile rendered inspection completed; module-semantic layout regressions found during inspection were corrected.
- Playwright reports six passing checks and two intentional mobile skips: desktop/mobile empty-first-run project creation, DNA versioning, generation, review, and reload persistence; a desktop project edit/archive lifecycle; reduced motion in both layouts; and desktop keyboard focus/navigation.
- Production environment preflight passes with a real D1 ID, dedicated R2 and Queue bindings, queue consumer, five-minute recovery trigger, AFDFW service binding, custom domain, and disabled `workers.dev` route.
- Cloudflare deployed automatic-retention Worker version `673e5792-650f-4b8e-bca5-e566c5f50f45` at 100% to `cs.angelotoborg.com`.
- Remote D1 reports no pending migrations after `0003_background_jobs.sql`; the background columns and three uniqueness/due indexes were queried directly after release.
- Cloudflare reports `creative-studio-jobs` with one producer and one consumer, plus the separate `creative-studio-jobs-dlq`; deployment output confirms the five-minute schedule.
- Anonymous requests to `/` and `/api/creative-studio/session` both receive Cloudflare Access redirects.
- Authenticated live inspection opened the production UI and reported all six runtime capabilities available, including Creative Studio D1, R2 retention, and the AFDFW session/generation adapters.
- Authenticated live inspection confirmed the empty production Project screen renders `Create your first project` with no seeded project cards.
- The three legacy prototype project rows were deleted only after exact owner/ID/name/timestamp matching and dependent-record checks; the post-cleanup production counts are zero projects, DNA artifacts, jobs, artifacts, and acceptances.
- Post-release production counts remain zero across projects, DNA artifacts, jobs, artifacts, and acceptances; no verification or placeholder records were inserted.

## Current production boundary

- Production is independently deployed as Worker `creative-studio`; the AFDFW frontend and its dirty local checkout were not deployed or changed.
- The production environment uses D1 `creative-studio`, R2 `creative-studio-artifacts`, Queue `creative-studio-jobs` with a dead-letter queue, and a narrow service binding to Worker `art-feed-dfw`.
- Cloudflare Access application `Creative Studio` protects `cs.angelotoborg.com/*` with policy `Angelo only` and a 24-hour session.
- The top-level Wrangler configuration stays in development mode for isolated local tests; real bindings exist only under `env.production`.
- Development generation creates durable job/artifact metadata and visible placeholders, not real image or audio files.
- Removal timing for any old AFDFW prototype remains a later owner decision.

See `PRODUCTION_READINESS.md` for the verified release and rollback runbook.
