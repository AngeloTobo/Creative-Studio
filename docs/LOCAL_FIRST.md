# Local-first Creative Studio

Creative Studio has one application authority: Angelo's Windows PC. The built UI, API/BFF, D1-compatible records, R2-compatible media, Art Index connector, Local Runner, and ComfyUI execution all stay on that machine. Opening `cs.angelotoborg.com` reaches the same PC host through Cloudflare Access and HomeAI Tunnel v10; it does not select a second cloud backend.

## Runtime ownership

| Concern | Owner |
| --- | --- |
| UI and owner API doorway | PC gateway on `127.0.0.1:8787` |
| Worker-compatible BFF | Wrangler local mode on `127.0.0.1:8788` |
| Projects, DNA, jobs, workflows, decisions | Pinned local D1-compatible state under `%LOCALAPPDATA%\Creative Studio Host` |
| Uploads and completed results | Pinned local R2-compatible state under the same protected host root |
| Art Index discovery | Verified filesystem receipts under `D:\CreativeArchive` |
| Image, audio, and video generation | Single Local Runner, ComfyUI on `127.0.0.1:8188`, and this machine's GPU |
| Remote access | Cloudflare Access and HomeAI Tunnel v10 only |

The historical Cloudflare D1 database and R2 bucket are preserved read-only as rollback evidence. They are not synchronized with the PC host, are not deleted during cutover, and receive no writes from normal runtime, build, install, or deploy commands.

## Verified installation and cutover

Install dependencies and build the host:

```powershell
npm ci
npm run build:host
```

The guarded local sequence completed on 2026-09-03:

1. `npm run host:migrate` produced two identical read-only D1 snapshots and two stable R2 inventories, imported a fresh pinned local state, verified D1 integrity and every referenced object, and created a local-only Runner credential. The protected receipt is `%LOCALAPPDATA%\Creative Studio Host\backups\20260903T130433Z\migration-receipt.json`.
2. The receipt records 25 D1 migrations across 40 tables, zero foreign-key violations, 233 of 233 referenced R2 objects totaling 315,823,973 bytes, and no cloud write or deletion. Its migration-time rows include 2 projects, 10 workflows, 224 workflow revisions, 151 jobs, 115 artifacts, 33 media assets, and 32 acceptances.
3. The enabled `Creative Studio PC Host` Scheduled Task now owns the gateway and BFF listeners on `127.0.0.1:8787` and `127.0.0.1:8788`; the former `Creative Studio Local Runner` task is disabled. The gateway root returns `200`, and its authenticated health response reports `ok`, `authority=this-pc`, and the expected 17,353/1,767 Archive counts.
4. Cloudflare Worker version `4ae4c678-9c2f-48f9-993d-a82926b842f6` is deployed at 100% with the fail-closed retirement configuration and no application execution bindings.
5. HomeAI Tunnel v10 routes `cs.angelotoborg.com` to `http://localhost:8787` before catch-all. The DNS dashboard reports `Tunnel` / `HomeAI` / `Proxied` / `Auto`; at cutover verification, independent Cloudflare and Google DoH checks resolved `104.21.18.119` and `172.67.181.206`.
6. Anonymous remote access receives the expected Access `302`. Authenticated desktop and 390-by-844 mobile sessions render Creative Studio. The mobile document width matches its 390-pixel viewport with no app-origin console messages. Archive shows 1,767 eligible works, search `0015` returns three results, and the already materialized `0015` remains usable.
7. The gateway contract returns `401` when trusted headers are missing, `200` for the approved root, and `404` for the Runner route under otherwise approved gateway headers.
8. The first supported installer restart exposed a PID-reuse race. The `Test-SameProcessIdentity` check, safe skip, and `host:installer:check` guard correct it. The gateway now also pins the exact Access owner/public hostname and applies route checks case-insensitively. Archive retries get a new identity only after a confirmed terminal failure; ambiguous network outcomes retain the original identity. The final controlled `host:install` restart preserved the post-materialization local D1 state and its 234 R2 objects / 321,901,818 bytes unchanged.

Do not rerun the one-time migration against this installed state. Post-cutover cloud D1 analytics report zero write queries and zero rows written, while cloud R2 remains 233 objects and 315,823,973 bytes. ComfyUI was offline during final cutover QA, so generation and GPU execution were deliberately not exercised.

## Normal operation

Task Scheduler now starts the installed host at sign-in and restarts it after bounded failures. Open:

```text
http://127.0.0.1:8787
```

For a foreground diagnostic run, first stop the installed task through the runbook so there is only one owner, then run:

```powershell
npm run local
```

The host verifies its protected migration receipt, exact state root/database, local Runner credential, Access owner, free ports, Node.js 24 SQLite runtime, and single-instance lock before serving. If migrations are pending, it first validates the migration ledger, writes and verifies a protected SQLite recovery checkpoint, then verifies integrity and foreign keys after migration; a failed or interrupted update restores the checkpoint before the host can start. It then starts the loopback BFF and gateway, waits for a fresh authenticated heartbeat from the one migrated Runner, and writes a protected ready marker. A failed start never falls through to cloud storage or a development owner.

## Archive-to-Create

The Art Index is a filesystem manifest, not a D1 catalog. The verified receipts currently describe 17,353 entries; 1,767 meet the present image/materialization safety rules.

- Browsing loads and validates those receipts into PC memory.
- Search and filtering perform no D1 insert/update/delete and no R2 upload.
- Selecting an ineligible, unavailable, changed, oversized, or review-only entry fails closed.
- An explicit owner selection revalidates the exact source path and copies only that file into the active local project.
- The resulting media record carries archive provenance; the source archive is never modified.

The retired `0025_archive_index.sql` tables remain immutable historical schema. Runtime guards reject writes to them, later migrations that recreate a row-per-art catalog, and old autonomous Runner sync markers.

## GPU and creative-work boundary

Real image, music/audio, and video generation requires an imported ComfyUI API-format workflow. There is no simulated media fallback. One process-lifetime Runner lock prevents duplicate agents, and the shared GPU lock prevents overlapping local products from claiming the RTX 3090. ComfyUI remains loopback-only and may be offline while the host and durable work stay healthy.

CreativeDNA analysis, prompt enhancement, Full Video Script, Story Bank, Overnight Studio, Love Loop, and ACE-Step training all use the same local Runner/ComfyUI authority. Review, CreativeDNA activation, World canon promotion, model activation, and publication remain separate explicit owner decisions.

## Cloudflare boundary

The checked-in production retirement contract has:

- no Worker route or custom domain;
- no `workers.dev` or preview URL;
- no D1 or R2 binding;
- no Queue producer or consumer;
- no cron trigger; and
- no AFDFW service binding.

`npm run check:env:production` and `npm run check:cloudflare-free` enforce that contract. `npm run db:production` is a hard refusal. HomeAI Tunnel configuration lives outside Wrangler; version 10 routes the final Access-protected hostname to the fixed PC gateway before catch-all.

That contract is live as Worker version `4ae4c678-9c2f-48f9-993d-a82926b842f6`. Tunnel, DNS, Access denial, and authenticated remote desktop/mobile behavior have been verified independently of the retired Worker deployment.

## UI-only development adapter

`npm run dev` still starts the explicitly labeled browser-storage adapter for frontend work. It is not the production authority, cannot retain real uploads or use the migrated owner state, and must never be mistaken for the installed PC host.
