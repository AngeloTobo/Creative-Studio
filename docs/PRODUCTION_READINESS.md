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
- Cloudflare Access: application `Creative Studio`, destination `cs.angelotoborg.com/*`, policy `Angelo only`
- Production Worker version verified on 2026-08-16: `5a723f6f-397f-408e-ad16-2358263fdf58`

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
6. An authenticated Runtime-page check reports CreativeDNA, media library, ComfyUI workflows, CreativeDNA training data, music generation, image generation, artifact review, artifact retention, and AFDFW session as available. CreativeDNA training is truthfully `degraded` until an authenticated local runner claims a job.
7. Remote D1 has no pending migration after `0006_creative_dna_training_jobs.sql`; the training-job table exists and contains no seeded rows.

## Rollback

Use Cloudflare Workers version rollback for Worker/assets regressions. D1, R2, and Queues are independent product-owned resources and must not be deleted during a code rollback. Access must continue to cover `cs.angelotoborg.com/*`.
