# Backend contract

The browser-facing namespace is fixed to `/api/creative-studio/*`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creative-studio/snapshot` | Load the bounded owner operational read model, including current World collections |
| `GET` | `/api/creative-studio/session` | Same-origin session descriptor |
| `GET` | `/api/creative-studio/projects` | List Creative Studio projects |
| `POST` | `/api/creative-studio/projects` | Create an owned project from user input |
| `PATCH` | `/api/creative-studio/projects/:id` | Edit an owned active or paused project |
| `POST` | `/api/creative-studio/projects/:id/archive` | Archive an owned project without deleting history |
| `GET` | `/api/creative-studio/worlds` | List owned Worlds with their entities, rules, references, and promotion records |
| `POST` | `/api/creative-studio/worlds` | Create a project-scoped World |
| `GET` | `/api/creative-studio/worlds/:id` | Read one owned World collection |
| `PATCH` | `/api/creative-studio/worlds/:id` | Update a World at an expected version |
| `POST` | `/api/creative-studio/worlds/:id/archive` | Archive a World without deleting continuity history |
| `POST` | `/api/creative-studio/worlds/:id/entities` | Create a versioned character, place, or object |
| `PATCH` | `/api/creative-studio/worlds/:id/entities/:entityId` | Update an entity at an expected version |
| `POST` | `/api/creative-studio/worlds/:id/entities/:entityId/retire` | Retire an entity without deleting its history |
| `POST` | `/api/creative-studio/worlds/:id/rules` | Create a modality-scoped continuity rule |
| `PATCH` | `/api/creative-studio/worlds/:id/rules/:ruleId` | Update a continuity rule at an expected version |
| `POST` | `/api/creative-studio/worlds/:id/rules/:ruleId/retire` | Retire a continuity rule |
| `POST` | `/api/creative-studio/worlds/:id/references` | Create a candidate provenance-bearing canon reference |
| `PATCH` | `/api/creative-studio/worlds/:id/references/:referenceId` | Update a candidate reference at an expected version |
| `POST` | `/api/creative-studio/worlds/:id/references/:referenceId/retire` | Retire a canon reference |
| `POST` | `/api/creative-studio/worlds/:id/references/:referenceId/promote` | Explicitly promote a candidate reference to canon |
| `POST` | `/api/creative-studio/worlds/:id/promote-artifact` | Explicitly promote an accepted retained artifact to canon |
| `GET` | `/api/creative-studio/dna` | List versioned CreativeDNA artifacts |
| `POST` | `/api/creative-studio/dna` | Create a root or child DNA version |
| `GET` | `/api/creative-studio/jobs` | List durable jobs without driving their lifecycle |
| `POST` | `/api/creative-studio/jobs` | Persist one idempotent ComfyUI workflow job or explicitly selected optional AFDFW image/music job |
| `POST` | `/api/creative-studio/jobs/:id/retry` | Create a lineage-linked retry of a failed or cancelled job |
| `POST` | `/api/creative-studio/jobs/:id/cancel` | Stop Creative Studio tracking for an active job |
| `GET` | `/api/creative-studio/artifacts` | Read the bounded legacy list, or a cursor-safe history page when query parameters are present |
| `GET` | `/api/creative-studio/artifacts/:id/media` | Serve retained R2 media, with temporary mediation only while retention is pending |
| `GET` | `/api/creative-studio/artifacts/:id/thumbnail` | Serve the retained first-frame JPEG for a video artifact |
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

## Creative World and canon boundary

Worlds, entities, continuity rules, references, and promotions are Creative Studio-owned records scoped to the authenticated owner and one project. Mutable records use monotonic versions and expected-version writes. Archive and retire operations preserve history.

A generation `continuity` selection contains the exact version of its World plus every selected entity, rule, and canonical reference. The Worker reloads all of them, verifies owner/project/world membership and active state, rejects stale versions, compiles a rights-safe directive, and stores an immutable `GenerationContinuityStamp` with both the compiled text and exact record snapshots. The current path permits this only for local ComfyUI image and video workflows; music and AFDFW requests fail closed if continuity is supplied.

Artifact acceptance is not canon promotion. The artifact-promotion route additionally requires an accepted decision record, durable retained media, an active entity at the expected version, selected facets, continuity notes, a bounded owner note, and the literal `promote-artifact-to-canon` confirmation. It creates a new canonical retained-artifact reference and an append-only promotion row; it does not rewrite the artifact decision or any AFDFW record. Direct reference promotion likewise requires an expected reference version, selected facets, a note, and the literal `promote-to-canon` confirmation.

## Artifact-history pagination

`GET /api/creative-studio/artifacts` without a query string preserves the bounded snapshot-era response. Supplying history query parameters returns `{ page }`, where the page contains artifacts and only their matching jobs, acceptance decisions, and CreativeDNA training examples.

Supported parameters are `projectId`, `cursorCreatedAt`, `cursorArtifactId`, `limit`, repeated or comma-separated `kind`, repeated or comma-separated `status`, `includeArchived`, and `q`. `limit` defaults to 24 and is normalized into the 1-to-50 range. The cursor pair is required together and continues the stable `created_at DESC, id DESC` ordering. The response carries `nextCursor`, `hasMore`, and the filtered `total`. Invalid cursors, kinds, and statuses fail closed.

The snapshot remains bounded so active-work refresh stays cheap. Opening Results reads its first history page, and a changed recent snapshot head may reread only that current query so a newly completed result appears without exposing an unproven cached gap. Older pages, World CRUD, and canon decisions remain explicit owner actions; this phase adds no polling timer, runner claim, cron, Queue producer, or AFDFW call. In local-first mode those requests, D1 reads/writes, and retained-history access stay on `127.0.0.1` and consume no Cloudflare allowance. Local and remote stores still do not synchronize automatically.

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
- `POST /api/creative-studio/runner/jobs/:id/thumbnail`
- `POST /api/creative-studio/runner/jobs/:id/fail`
- `GET /api/creative-studio/runner/media/:id`
- `POST /api/creative-studio/runner/training/claim`
- `POST /api/creative-studio/runner/training/:id/heartbeat`
- `POST /api/creative-studio/runner/training/:id/complete`
- `POST /api/creative-studio/runner/training/:id/fail`
- `POST /api/creative-studio/runner/model-training/:id/dataset`
- `POST /api/creative-studio/runner/model-training/:id/heartbeat`
- `POST /api/creative-studio/runner/model-training/:id/complete`
- `POST /api/creative-studio/runner/model-training/:id/fail`

Tokens are generated with 256 bits of randomness, returned once, stored only as SHA-256 hashes in D1, owner-scoped, and revocable. The unified work claim renews the machine heartbeat and returns at most one generation, CreativeDNA-analysis, or model-training bundle; the older separate claim routes remain allowlisted for compatibility but Local Runner 1.9 does not idle-poll them. A generation claim carries an immutable API-format workflow revision plus only the retained inputs bound in its settings stamp. A CreativeDNA-analysis claim carries only its selected consented uploads, training-ready accepted-result records, and optional base DNA. An ACE-Step model-training claim carries only the selected consented audio, optional DNA lineage, reviewed recipe, and Worker-canonical dataset state. Every job uses a renewable two-minute lease. Model training must stop after caption preparation for owner review, and completion accepts only a bounded runner-local safetensors identity with SHA-256 and byte size; no model bytes traverse Cloudflare. Generation heartbeats can report only allowlisted preparation, submission, render, output-download, and retention stages. Generation completion accepts only allowlisted image, audio, or video MIME types up to 100 MB, writes to a deterministic R2 key, verifies the byte count, and only then completes the D1 job and training candidate. For video, Local Runner 1.4.2 extracts frame zero locally and uploads one bounded JPEG through the dedicated thumbnail route after the video is durable; thumbnail failure never discards a valid completed result. CreativeDNA analysis completion must contain complete bounded source evidence; media-description v1.1 requires separate `longSummary` analysis and `shortSummary` generation fields. The Worker replaces runner-supplied identity labels with canonical D1 metadata before writing an immutable analyzed DNA artifact. The runner hostname returns `404` for the product shell and every non-runner route.

Direct AFDFW image jobs use a versioned, narrow provider-evidence profile matching the allowlisted Z-Image bridge graph. Their settings stamp records the requested portrait resolution, 32 sampling steps, one still frame, batch size, medium, and exact three-file model inventory; width, height, size, and medium from the generation response override the request profile when the upstream job is attached. Existing Creative Studio AFDFW image stamps receive the same non-destructive compatibility projection at read time. The UI identifies this as provider-profile evidence and does not claim measured per-model load time without ComfyUI node profiling.

## Runtime validation

- Unknown browser adapter modes fail closed instead of silently becoming an HTTP adapter.
- Unknown Worker backend modes fail closed.
- AFDFW mode requires either a service binding or a valid base URL.
- Non-local base URLs must use HTTPS.
- AFDFW `401` and `403` responses become a same-origin `approved_login_required` response without seeding owner data.
- `npm run check:env:production` blocks a release while the D1 ID is a placeholder, backend mode is development, the R2/custom-domain boundary is missing, Worker-first asset routing is absent, `workers.dev` is enabled, or no protected AFDFW target exists.
- The same production preflight requires the dedicated queue producer/consumer, capped Queue retries, the hourly recovery trigger, and the free-tier budget guard.
