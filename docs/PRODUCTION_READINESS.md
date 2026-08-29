# Production release state

Creative Studio is deployed independently at `https://cs.angelotoborg.com`.

## Provisioned resources

- Worker: `creative-studio`
- D1: `creative-studio` (`DB` binding)
- R2: `creative-studio-artifacts` (`ARTIFACTS` binding)
- Queue: `creative-studio-jobs` (`JOB_QUEUE` producer and consumer)
- Dead-letter queue: `creative-studio-jobs-dlq`
- Recovery trigger: hourly
- Service binding: `AFDFW` -> `art-feed-dfw`
- Custom domain: `cs.angelotoborg.com`
- Local Runner API domain: `runner.cs.angelotoborg.com` (runner routes only; no shell)
- Cloudflare Access: application `Creative Studio`, destination `cs.angelotoborg.com/*`, policy `Angelo only`
- Production Worker version verified on 2026-08-29: `e747d286-84a2-472c-bf6f-91e65394727c`
- Installed runner process: `Angelo RTX 3090 workstation`, runner `1.15.0`; D1 recorded a healthy idle heartbeat at `2026-08-29T18:25:13.152Z` with no active job or runner error

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
7. An authenticated product check reports Local Runner, video generation, multimodal CreativeDNA descriptions, Full Video Script v2, Overnight Studio, the opt-in Angelo daily Love Loop, and trusted 30-second video generation available while a recent Local Runner 1.15 heartbeat is healthy.
8. Remote D1 has no pending migration after `0021_love_loop.sql`; runner registration exists and deployment verification adds no job, artifact, training-review, overnight-session, overnight-task, Love Loop, or Love Loop drop fixtures.
9. Windows Scheduled Task `Creative Studio Local Runner` is running with sign-in and daily recovery triggers, StartWhenAvailable, WakeToRun, and 12 restart attempts; its config ACL permits only the current user and SYSTEM, and D1 reports no runner error.
10. `npm run check:cloudflare-free` reports no more than 2,904 baseline Worker invocations per day, and deployment output confirms the hourly schedule with Queue retries capped at three.

## Rollback

Use Cloudflare Workers version rollback for Worker/assets regressions. D1, R2, and Queues are independent product-owned resources and must not be deleted during a code rollback. Access must continue to cover `cs.angelotoborg.com/*`.
