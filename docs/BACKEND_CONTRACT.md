# Backend contract

The browser-facing namespace is fixed to `/api/creative-studio/*`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creative-studio/snapshot` | Load the complete owner read model in one request |
| `GET` | `/api/creative-studio/session` | Same-origin session descriptor |
| `GET` | `/api/creative-studio/projects` | List Creative Studio projects |
| `POST` | `/api/creative-studio/projects` | Create an owned project from user input |
| `PATCH` | `/api/creative-studio/projects/:id` | Edit an owned active or paused project |
| `POST` | `/api/creative-studio/projects/:id/archive` | Archive an owned project without deleting history |
| `GET` | `/api/creative-studio/dna` | List versioned CreativeDNA artifacts |
| `POST` | `/api/creative-studio/dna` | Create a root or child DNA version |
| `GET` | `/api/creative-studio/jobs` | List durable jobs without driving their lifecycle |
| `POST` | `/api/creative-studio/jobs` | Persist one idempotent ComfyUI workflow job or explicitly selected optional AFDFW image/music job |
| `POST` | `/api/creative-studio/jobs/:id/retry` | Create a lineage-linked retry of a failed or cancelled job |
| `POST` | `/api/creative-studio/jobs/:id/cancel` | Stop Creative Studio tracking for an active job |
| `GET` | `/api/creative-studio/artifacts` | List artifacts and acceptance history |
| `GET` | `/api/creative-studio/artifacts/:id/media` | Serve retained R2 media, with temporary mediation only while retention is pending |
| `POST` | `/api/creative-studio/artifacts/:id/{accepted,rejected,archived}` | Record an explicit decision |
| `GET` | `/api/creative-studio/media` | List owner-scoped retained project uploads |
| `POST` | `/api/creative-studio/media` | Stream one allowlisted image, audio, or video upload to verified R2 storage |
| `GET` | `/api/creative-studio/media/:id/content` | Serve an owned uploaded asset from Creative Studio R2 |
| `GET` | `/api/creative-studio/runners` | List paired machine state without returning credentials |
| `POST` | `/api/creative-studio/runners/enroll` | Create a hashed registration and return its token once |
| `POST` | `/api/creative-studio/runners/:id/revoke` | Revoke a machine and release its unfinished local jobs |
| `GET` | `/api/creative-studio/capabilities` | Report bounded runtime health |

Every other Creative Studio API path returns `404`. There is no arbitrary forwarding route.

When `BACKEND_MODE=development` and `LOCAL_HARDWARE_ONLY=true`, the BFF is a localhost hardware runtime rather than a media simulator. A generation request without an owned executable ComfyUI workflow returns `local_comfyui_workflow_required`; reuse and retry enforce the same boundary. Capabilities identify local D1/R2, Local Runner, and ComfyUI as the providers, while AFDFW remains unavailable. Production requires `LOCAL_HARDWARE_ONLY=false` and retains the remote allowlist below.

The generation request chooses exactly one execution route. A `workflow` bundle creates a Creative Studio `local-comfyui` job and cannot also name a provider. A direct production image/music request must include `provider: "afdfw"`; omitting it returns `generation_provider_required`, so AFDFW can never become an implicit fallback. The browser-storage and simulated Worker development paths likewise require the explicit `development-preview` provider label.

Project lists may be empty. The Worker never creates seeded projects, and archived projects remain available for historical counts while being excluded from new DNA and generation writes.

## AFDFW allowlist

The Worker adapter permits only:

- `GET /api/me`
- `POST /api/profile-song/generate`
- `GET /api/profile-song/generations`
- `GET /api/profile-song/generations/:id`
- `GET /api/profile-song/media/:id`
- `POST /api/profile-image/generate`
- `GET /api/profile-image/generations`
- `GET /api/profile-image/generations/:id`
- `GET /api/profile-image/media/:id`

Interactive calls may relay cookies, verified Cloudflare Access identity, and Access assertions server-side. Background jobs store only the normalized Access-verified email captured at job creation and use it through the same-account service binding; they do not retain a cookie or Access JWT. A service token, when configured, stays in Worker secrets. The adapter validates a configured base origin and rejects non-allowlisted methods and paths before any fetch.

CreativeDNA and artifact decisions are stored in Creative Studio D1 only. Every upstream completion is streamed into Creative Studio R2 and size-verified before its Creative Studio job is marked completed. Retention is independent of accept, reject, or archive decisions. No CreativeDNA, accept, profile, feed, admin, or raw ComfyUI route is on the AFDFW allowlist.

Media uploads never traverse AFDFW. The upload route requires an owned, non-archived project; an allowlisted MIME type; a 100 MB or smaller declared size; and an explicit `true` or `false` future-training consent value. It writes to a project-scoped R2 key, verifies the stored byte count, and only then commits D1 metadata. The media contract records provenance and consent; the owner separately selects eligible inputs when starting a durable CreativeDNA training run.

## Local Runner allowlist

The separate runner hostname accepts only bearer-authenticated machine routes:

- `POST /api/creative-studio/runner/work/claim`
- `POST /api/creative-studio/runner/heartbeat`
- `POST /api/creative-studio/runner/jobs/claim`
- `POST /api/creative-studio/runner/jobs/:id/heartbeat`
- `POST /api/creative-studio/runner/jobs/:id/complete`
- `POST /api/creative-studio/runner/jobs/:id/fail`
- `GET /api/creative-studio/runner/media/:id`
- `POST /api/creative-studio/runner/training/claim`
- `POST /api/creative-studio/runner/training/:id/heartbeat`
- `POST /api/creative-studio/runner/training/:id/complete`
- `POST /api/creative-studio/runner/training/:id/fail`

Tokens are generated with 256 bits of randomness, returned once, stored only as SHA-256 hashes in D1, owner-scoped, and revocable. The unified work claim renews the machine heartbeat and returns at most one generation or training bundle; the older separate claim and heartbeat routes remain allowlisted for compatibility but Local Runner 1.4 does not idle-poll them. A generation claim carries an immutable API-format workflow revision plus only the retained inputs bound in its settings stamp. A training claim carries only its selected consented uploads, training-ready accepted-result records, and optional base DNA. Both job types use renewable two-minute leases. Generation heartbeats can report only allowlisted preparation, submission, render, output-download, and retention stages. Generation completion accepts only allowlisted image, audio, or video MIME types up to 100 MB, writes to a deterministic R2 key, verifies the byte count, and only then completes the D1 job and training candidate. Training completion must contain complete bounded source evidence for the claimed bundle; media-description v1.1 requires separate `longSummary` analysis and `shortSummary` generation fields. The Worker replaces runner-supplied identity labels with canonical D1 metadata before writing an immutable trained DNA artifact. The runner hostname returns `404` for the product shell and every non-runner route.

Direct AFDFW image jobs use a versioned, narrow provider-evidence profile matching the allowlisted Z-Image bridge graph. Their settings stamp records the requested portrait resolution, 32 sampling steps, one still frame, batch size, medium, and exact three-file model inventory; width, height, size, and medium from the generation response override the request profile when the upstream job is attached. Existing Creative Studio AFDFW image stamps receive the same non-destructive compatibility projection at read time. The UI identifies this as provider-profile evidence and does not claim measured per-model load time without ComfyUI node profiling.

## Runtime validation

- Unknown browser adapter modes fail closed instead of silently becoming an HTTP adapter.
- Unknown Worker backend modes fail closed.
- AFDFW mode requires either a service binding or a valid base URL.
- Non-local base URLs must use HTTPS.
- AFDFW `401` and `403` responses become a same-origin `approved_login_required` response without seeding owner data.
- `npm run check:env:production` blocks a release while the D1 ID is a placeholder, backend mode is development, the R2/custom-domain boundary is missing, Worker-first asset routing is absent, `workers.dev` is enabled, or no protected AFDFW target exists.
- The same production preflight requires the dedicated queue producer/consumer, capped Queue retries, the hourly recovery trigger, and the free-tier budget guard.
