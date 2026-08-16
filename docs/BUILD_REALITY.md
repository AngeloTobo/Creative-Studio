# Build reality

Last verified: 2026-08-16 (America/Chicago)

## Working now

- Vite + React + TypeScript module application with the original Creative Studio visual language retained across desktop and mobile layouts.
- Typed `Project`, `CreativeDnaArtifact`, `Job`, `Artifact`, `Capability`, and `Acceptance` contracts shared by client, adapters, tests, and Worker.
- Explicit `development-local-storage` adapter containing the former mock content and labeled development-only media behavior.
- Standalone Worker/BFF serving only `/api/creative-studio/*`, plus dedicated D1 storage for projects, DNA, jobs, artifacts, retained-media metadata, and append-only decisions.
- Deterministic CreativeDNA compilation, bounds, prompt translation, rights-safe provenance, root/parent/version lineage, and both music/image submission.
- Durable job reconciliation and artifact creation in browser development mode and Worker development mode.
- Artifact history, lineage expansion, and explicit accept/reject/archive controls.
- Exact AFDFW method/path allowlist with no generic proxy.
- Same-account AFDFW service binding for identity handoff and generation; CreativeDNA remains product-owned in Creative Studio D1.
- Accepted AFDFW media is copied into owner-scoped keys in the dedicated Creative Studio R2 bucket before the acceptance decision is recorded.
- Fail-closed browser/Worker environment validation and a production-readiness preflight.
- Workers-runtime Vitest integration using the real D1 migrations and production Worker entrypoint.

## Verified in this build

- TypeScript, ESLint, Vitest, Vite production build, environment validation, and source secret scan pass.
- Seven browser-domain unit tests cover CreativeDNA rights/lineage, development persistence, route rejection, and adapter configuration.
- Nine Workers-runtime tests cover the Worker entrypoint, AFDFW target validation, unauthenticated access, Access-header relay, malformed input, project ownership, owner-isolated review, durable job transitions, R2 retention, append-only decisions, and generic-proxy rejection.
- Local D1 migration applies successfully.
- A Worker API flow created DNA, completed a durable job, created an artifact, stored acceptance, rejected a generic proxy path, and preserved state across a Worker restart.
- A real Chromium pass against the HTTP/BFF mode completed DNA save, image job, artifact lineage, acceptance, and reload persistence with no current console errors.
- Desktop and 390px mobile rendered inspection completed; module-semantic layout regressions found during inspection were corrected.
- Playwright reports five passing checks and one intentional mobile skip: desktop/mobile create, version, generate, return, accept, and reload persistence; reduced motion in both layouts; and desktop keyboard focus/navigation.
- Production environment preflight passes with a real D1 ID, dedicated R2 binding, AFDFW service binding, custom domain, and disabled `workers.dev` route.
- Cloudflare deployed Worker version `cd92d0f5-95ab-4a85-b7ee-2533d55be3c5` to `cs.angelotoborg.com`.
- Remote D1 reports no pending migrations after `0001_creative_studio.sql` and `0002_artifact_retention.sql`.
- Anonymous requests to `/` and `/api/creative-studio/session` both receive Cloudflare Access redirects.
- Authenticated live inspection opened the production UI and reported all six runtime capabilities available, including Creative Studio D1, R2 retention, and the AFDFW session/generation adapters.

## Current production boundary

- Production is independently deployed as Worker `creative-studio`; the AFDFW frontend and its dirty local checkout were not deployed or changed.
- The production environment uses D1 `creative-studio`, R2 `creative-studio-artifacts`, and a narrow service binding to Worker `art-feed-dfw`.
- Cloudflare Access application `Creative Studio` protects `cs.angelotoborg.com/*` with policy `Angelo only` and a 24-hour session.
- The top-level Wrangler configuration stays in development mode for isolated local tests; real bindings exist only under `env.production`.
- Development generation creates durable job/artifact metadata and visible placeholders, not real image or audio files.
- Removal timing for any old AFDFW prototype remains a later owner decision.

See `PRODUCTION_READINESS.md` for the verified release and rollback runbook.
