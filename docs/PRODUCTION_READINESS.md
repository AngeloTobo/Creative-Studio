# Production release state

Creative Studio is deployed independently at `https://cs.angelotoborg.com`.

## Provisioned resources

- Worker: `creative-studio`
- D1: `creative-studio` (`DB` binding)
- R2: `creative-studio-artifacts` (`ARTIFACTS` binding)
- Service binding: `AFDFW` -> `art-feed-dfw`
- Custom domain: `cs.angelotoborg.com`
- Cloudflare Access: application `Creative Studio`, destination `cs.angelotoborg.com/*`, policy `Angelo only`
- Production Worker version verified on 2026-08-16: `cd92d0f5-95ab-4a85-b7ee-2533d55be3c5`

## Release sequence

```powershell
npm run deploy:production
```

This runs the complete local verification suite, validates the production contract, applies pending remote D1 migrations, and deploys the named production environment. It does not deploy AFDFW.

## Required post-deploy verification

1. `npx wrangler deployments list --name creative-studio --env production` shows the expected version at 100%.
2. `npx wrangler d1 migrations list creative-studio --remote --env production` reports no pending migrations.
3. Anonymous requests to both `/` and `/api/creative-studio/session` redirect to Cloudflare Access.
4. The Access destination remains `cs.angelotoborg.com/*`; a hostname-only destination protects `/` but not deeper API paths.
5. An authenticated Runtime-page check reports CreativeDNA, music generation, image generation, artifact review, artifact retention, and AFDFW session as available.

## Rollback

Use Cloudflare Workers version rollback for Worker/assets regressions. D1 and R2 are independent product-owned resources and must not be deleted during a code rollback. Access must continue to cover `cs.angelotoborg.com/*`.
