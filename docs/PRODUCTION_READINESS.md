# PC-host production readiness

Creative Studio production runs on Angelo's Windows PC. Cloudflare Access and HomeAI Tunnel v10 provide the protected remote doorway at `https://cs.angelotoborg.com`; application functions, D1-compatible state, R2-compatible media storage, the Local Runner, Art Index browsing, and ComfyUI execution remain on the PC.

The guarded migration, local installation, supported restart, localhost health proof, Cloudflare Worker execution retirement, Tunnel/DNS cutover, Access denial, authenticated desktop/mobile rendering, gateway boundary checks, and unchanged-cloud proof completed on 2026-09-03.

## Production boundary

- The browser reaches the fixed PC gateway through localhost or the Access-protected HomeAI Tunnel.
- The gateway admits only the exact public hostname and pinned Access owner, normalizes route case before enforcing every owner/Runner boundary, and keeps runner-only routes off the public hostname.
- One installed PC-host process owns the local Worker-compatible API, persistence roots, and one Local Runner.
- Art Index manifests are read from verified local receipts: 17,353 entries are browsable and 1,767 currently pass the image-materialization rules. Only an owner-selected artwork is copied into a local project.
- The old Cloudflare D1 database and R2 bucket remain untouched as a rollback snapshot.
- The deployed production Wrangler environment has no routes, preview URL, Queue consumer, cron, D1 binding, R2 binding, assets binding, or service binding.

## Verified migration and installation

The completed one-time state is evidenced by the guarded migration and installer outputs from:

```powershell
npm run host:migrate
npm run host:install
```

`host:migrate` is a one-time, fail-closed copy into a new timestamped local root. It refuses an existing PC-host configuration, restores the legacy Runner state if the copy fails, and does not delete cloud data. `host:install` preserves the old task definition, installs one PC-host task, and accepts readiness only after the exact local Runner produces a fresh authenticated heartbeat.

The successful receipt is `%LOCALAPPDATA%\Creative Studio Host\backups\20260903T130433Z\migration-receipt.json`. It records two identical read-only D1 snapshots; 25 migrations across 40 tables; successful imported and final integrity checks; zero foreign-key violations; and 233 of 233 referenced R2 objects totaling 315,823,973 bytes. Migration-time data counts include 2 projects, 10 workflows, 224 workflow revisions, 151 jobs, 115 artifacts, 33 media assets, and 32 acceptances. Its preservation section records no cloud write or deletion.

The enabled `Creative Studio PC Host` task is running and the old `Creative Studio Local Runner` task is disabled. Loopback listeners are active on ports `8787` and `8788`; the root returns `200`, while authenticated host health returns `ok`, `authority=this-pc`, and Archive counts of 17,353 entries and 1,767 materializable images. Do not rerun `host:migrate` against this installed state.

The first supported installer restart exposed a PID-reuse race. The fix verifies process identity through `Test-SameProcessIdentity`, uses the safe skip path when the prior PID no longer identifies the same process, and adds `host:installer:check`. Node.js 24 and `node:sqlite` are now part of that pre-stop guard. Pending migrations require the receipt-pinned database/ledger plus a verified standalone recovery checkpoint; failure or interruption restores the exact prior logical state, and the same failing plan cannot loop automatically. The final controlled `host:install` restart reported no pending migration, passed SQLite integrity/foreign-key checks, and preserved the post-materialization local D1 state and its 234 R2 objects / 321,901,818 bytes unchanged.

## Normal update sequence

```powershell
npm run deploy:pc-host
```

`npm run deploy:production` is a compatibility alias for the same PC-host release. It runs the complete source and rendered-browser gate—including `host:installer:check`—builds the PC-host client, and installs or updates the Windows host. It does not deploy a Worker or write to Cloudflare D1/R2.

`npm run db:production` always refuses. Cloud migration and cloud retirement are never hidden inside the normal release workflow.

## Completed verification

- [x] HomeAI Tunnel configuration v10 places `cs.angelotoborg.com -> http://localhost:8787` before its catch-all.
- [x] The DNS dashboard record is `Tunnel` / `HomeAI` / `Proxied` / `Auto`; at cutover verification, independent Cloudflare and Google DNS-over-HTTPS checks resolved `104.21.18.119` and `172.67.181.206`.
- [x] Anonymous remote access receives Cloudflare Access `302`.
- [x] Owner-authenticated desktop and 390-by-844 mobile sessions render Creative Studio. Mobile document width equals the 390-pixel viewport and the app origin emits no console messages.
- [x] Art Index displays 1,767 eligible works, search `0015` returns three results, and the existing materialized `0015` is usable.
- [x] The live gateway returns `401` when trusted headers are absent, `200` for the approved root, and `404` for the Runner route under otherwise approved headers; mixed-case local owner and remote Runner paths cannot bypass those checks.
- [x] A controlled `host:install` restart passes after the process-identity, owner-pin, and SQLite-recovery guards, preserving the post-materialization local D1 state and its 234 R2 objects / 321,901,818 bytes unchanged.
- [x] Cloudflare post-cutover analytics report zero D1 write queries and zero rows written; cloud R2 remains unchanged at 233 objects and 315,823,973 bytes.

ComfyUI was offline during this verification, so no generation or GPU execution was attempted or claimed. That does not weaken the verified UI, Archive, gateway, persistence, or cloud-preservation cutover boundaries.

## Verified Cloudflare execution retirement

The separate one-time command has completed:

```powershell
npm run cloud:retire
```

Worker version `4ae4c678-9c2f-48f9-993d-a82926b842f6` is deployed at 100% from the dedicated route-free, trigger-free, binding-free `wrangler.retired.jsonc` configuration. It retains only the fail-closed retirement variables and has no custom domain/route, Queue producer/consumer, cron, D1/R2/service/assets bindings, or public preview route. Tunnel/DNS and authenticated remote behavior were verified separately through HomeAI v10 and Cloudflare Access. Do not delete the historical D1 database, R2 bucket, or rollback version.

## Rollback

If the PC-host or tunnel cutover fails, restore the previously captured tunnel/hostname configuration and use the preserved Cloudflare Worker version as the code rollback point. Do not remap or merge the old cloud owner into a development database, and do not delete or rewrite D1/R2 while rolling back.
