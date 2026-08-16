# Creative Studio

Creative Studio is a standalone creative workstation. It owns its React frontend, typed contracts, Worker/BFF, D1 history, and review decisions. AFDFW is an optional backend capability provider; it is not the product shell and is never exposed as a generic browser proxy.

## Run locally

Install dependencies and start the explicitly labeled browser-persistent development adapter. It starts empty and creates no example projects or artifacts:

```powershell
npm install
npm run dev
```

To run the standalone Worker/BFF with local D1 durability:

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

## Verify

```powershell
npm run check
npm run test:e2e
```

`npm run check` covers lint, browser-domain unit tests, Workers-runtime API tests with isolated D1 migrations, environment validation, TypeScript, production build, and a source secret-signature scan. The browser suite runs the entire CreativeDNA versioning and artifact acceptance loop in desktop and mobile Chrome, plus keyboard-focus and reduced-motion gates.

The production contract is configured and can be checked independently:

```powershell
npm run check:env:production
```

## Runtime modes

- `development`: explicitly labeled simulated media, with real browser-local project, job, and history persistence. The first run contains no records.
- `http`: the frontend calls only the Creative Studio BFF. The Worker uses standalone D1 and either its development renderer or narrow AFDFW adapters.
- `BACKEND_MODE=development`: no AFDFW calls; suitable for local Worker verification.
- `BACKEND_MODE=afdfw`: the production Worker uses the same-account `art-feed-dfw` service binding for approved-session handoff and generation only. Do not put tokens in Vite environment variables.

## Production

The independent production application is live at [cs.angelotoborg.com](https://cs.angelotoborg.com). Cloudflare Access protects `cs.angelotoborg.com/*` with the `Angelo only` policy.

- Worker: `creative-studio`
- D1: `creative-studio`
- R2: `creative-studio-artifacts`
- Backend service binding: `AFDFW` -> `art-feed-dfw`
- Generic `workers.dev` route: disabled in production

CreativeDNA, projects, jobs, artifacts, and decisions remain in Creative Studio D1. AFDFW supplies the approved identity and allowlisted generation capabilities. Accepting generated media first retains it in Creative Studio R2.

New accounts and cleared environments start empty. Projects are created, edited, paused, and archived only through explicit user actions; production code does not seed project or artifact records.

To run the verified release sequence:

```powershell
npm run deploy:production
```

See [docs/BUILD_REALITY.md](docs/BUILD_REALITY.md) and [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) for the live evidence and operating boundaries.
