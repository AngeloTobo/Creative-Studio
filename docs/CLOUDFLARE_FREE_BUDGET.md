# Cloudflare tunnel-only boundary

Creative Studio's production application, state, and generation work run on Angelo's PC. Cloudflare is limited to the authenticated tunnel and DNS edge that make that PC-hosted application reachable remotely. It is not an application execution, queue, database, object-storage, or scheduled-work plane.

The local migration, PC-host installation, Worker execution retirement, Tunnel/DNS cutover, Access denial, and authenticated remote QA are live-verified. Worker version `4ae4c678-9c2f-48f9-993d-a82926b842f6` is deployed at 100% with the fail-closed retirement variables and no application execution bindings. HomeAI Tunnel v10 independently routes `cs.angelotoborg.com` to `http://localhost:8787` before its catch-all.

The source guard `npm run check:cloudflare-free` enforces that boundary. A production configuration passes only when it explicitly declares `CLOUD_EXECUTION_MODE=retired` and has all of the following:

- `workers.dev` and preview URLs disabled;
- no Worker routes or custom domains;
- no Queue producer or consumer;
- no cron trigger;
- no D1 or R2 binding;
- no service binding; and
- a dormant `BACKEND_MODE=retired` sentinel so an accidentally exposed API fails closed.

Any newly added production setting or variable also fails the guard until its effect is deliberately reviewed. The Cloudflare Tunnel hostname is managed outside `wrangler.jsonc` and points to the fixed PC gateway; it does not restore any Worker binding. The DNS dashboard records `Tunnel` / `HomeAI` / `Proxied` / `Auto`; at cutover verification, independent Cloudflare and Google DoH queries resolved `104.21.18.119` and `172.67.181.206`.

## Request and write budget

The configured baseline is **zero Cloudflare Worker invocations per day**. Browser refreshes, runner claims, generation polling, archive browsing, background recovery, D1 reads/writes, and R2 reads/writes all stay on the PC. Explicit owner actions through the remote hostname traverse Cloudflare Tunnel and Access but execute against the same PC-hosted gateway and local persistence as localhost. The gateway accepts only the exact public hostname and pinned Access owner and normalizes route case before applying owner/Runner boundaries. Anonymous remote access receives the expected Access `302`; the live gateway returns `401` without trusted headers, `200` for the approved root, and `404` for the Runner route under otherwise approved headers, including mixed-case variants.

The historical D1 database and R2 bucket are retained as an immutable rollback snapshot. Normal build, install, start, and production-deploy commands do not migrate, update, or delete them. `npm run db:production` is a hard refusal, not a remote migration alias. Post-cutover Cloudflare analytics report zero D1 write queries and zero rows written; cloud R2 remains unchanged at 233 objects and 315,823,973 bytes.

The one-time `npm run cloud:retire` command was intentionally separate from the normal PC-host deployment. It published the route-free, trigger-free, binding-free `wrangler.retired.jsonc` configuration as version `4ae4c678-9c2f-48f9-993d-a82926b842f6`. The dedicated file cannot inherit local-development D1, R2, or static-assets bindings and avoids Wrangler's misleading prompt to add them back. Republishing retirement is now a deliberate recovery action, not part of normal PC-host updates.

## Archive protection

The retired `0025_archive_index.sql` schema remains immutable applied history. A prior 17,353-item mirror consumed 192,000 billed D1 row writes after indexes and retries were counted. Production runtime code may not mutate its catalog, batch, entry, or materialization tables.

Archive-to-Create reads the verified Art Index receipts directly from local storage. They describe 17,353 records, of which 1,767 currently meet the explicit image-materialization rules. Browsing creates no application rows; choosing one eligible record copies only that file into a local Creative Studio project with provenance. It does not construct a row-per-file D1 catalog, upload the archive to cloud R2, or run an autonomous cloud sync.

The guard preserves this boundary by fingerprinting the applied migration, scanning later migrations for per-item archive tables, scanning Worker SQL for writes to the retired tables, and scanning the Runner for retired autonomous-sync markers.

Run the two source contracts locally before every PC-host release or any deliberate retirement republish:

```powershell
npm run check:env:production
npm run check:cloudflare-free
```

Expected results state that the production Cloudflare execution plane is deliberately retired and that zero Worker routes, Queue consumers, cron triggers, D1 bindings, R2 bindings, or service bindings are configured.
