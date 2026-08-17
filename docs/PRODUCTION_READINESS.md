# Production release state

Creative Studio is deployed independently at `https://cs.angelotoborg.com`.

## Provisioned resources

- Worker: `creative-studio`
- D1: `creative-studio` (`DB` binding)
- R2: `creative-studio-artifacts` (`ARTIFACTS` binding)
- Queue: `creative-studio-jobs` (`JOB_QUEUE` producer and consumer)
- Dead-letter queue: `creative-studio-jobs-dlq`
- Recovery trigger: every five minutes
- Service binding: `AFDFW` -> `art-feed-dfw`
- Custom domain: `cs.angelotoborg.com`
- Local Runner API domain: `runner.cs.angelotoborg.com` (runner routes only; no shell)
- Cloudflare Access: application `Creative Studio`, destination `cs.angelotoborg.com/*`, policy `Angelo only`
- Production Worker version verified on 2026-08-16: `e1d315e6-75ad-4a96-8042-0dee14c9475a`
- Installed runner: `Angelo RTX 3090 workstation`, runner `1.2.0`, ComfyUI `0.33.0`, RTX 3090 heartbeat healthy

## Release sequence

```powershell
npm run deploy:production
```

This runs the complete local verification suite, validates the production contract, applies pending remote D1 migrations, and deploys the named production environment. It does not deploy AFDFW.

## Required post-deploy verification

1. `npx wrangler deployments list --name creative-studio --env production` shows the expected version at 100%.
2. `npx wrangler d1 migrations list creative-studio --remote --env production` reports no pending migrations.
3. `npx wrangler queues list` reports both Creative Studio queues and the production Worker remains the `creative-studio-jobs` consumer.
4. Anonymous requests to both `/` and `/api/creative-studio/session` redirect to Cloudflare Access.
5. The Access destination remains `cs.angelotoborg.com/*`; a hostname-only destination protects `/` but not deeper API paths.
6. `runner.cs.angelotoborg.com/` returns `404`; its unauthenticated claim route returns `401`; the main product root still redirects through Cloudflare Access.
7. An authenticated Runtime-page check reports Local Runner, video generation, and multimodal CreativeDNA descriptions available while a recent Local Runner 1.2 heartbeat is healthy.
8. Remote D1 has no pending migration after `0010_creative_dna_training_evidence_reservations.sql`; runner registration exists and deployment verification adds no job, artifact, or training-review fixtures.
9. Windows Scheduled Task `Creative Studio Local Runner` is running, its config ACL permits only the current user and SYSTEM, and D1 reports no runner error.

## Rollback

Use Cloudflare Workers version rollback for Worker/assets regressions. D1, R2, and Queues are independent product-owned resources and must not be deleted during a code rollback. Access must continue to cover `cs.angelotoborg.com/*`.
