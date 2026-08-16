# Backend contract

The browser-facing namespace is fixed to `/api/creative-studio/*`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creative-studio/session` | Same-origin session descriptor |
| `GET` | `/api/creative-studio/projects` | List Creative Studio projects |
| `POST` | `/api/creative-studio/projects` | Create an owned project from user input |
| `PATCH` | `/api/creative-studio/projects/:id` | Edit an owned active or paused project |
| `POST` | `/api/creative-studio/projects/:id/archive` | Archive an owned project without deleting history |
| `GET` | `/api/creative-studio/dna` | List versioned CreativeDNA artifacts |
| `POST` | `/api/creative-studio/dna` | Create a root or child DNA version |
| `GET` | `/api/creative-studio/jobs` | List durable jobs without driving their lifecycle |
| `POST` | `/api/creative-studio/jobs` | Persist and enqueue one idempotent music or image job |
| `POST` | `/api/creative-studio/jobs/:id/retry` | Create a lineage-linked retry of a failed or cancelled job |
| `POST` | `/api/creative-studio/jobs/:id/cancel` | Stop Creative Studio tracking for an active job |
| `GET` | `/api/creative-studio/artifacts` | List artifacts and acceptance history |
| `GET` | `/api/creative-studio/artifacts/:id/media` | Serve retained R2 media, with temporary mediation only while retention is pending |
| `POST` | `/api/creative-studio/artifacts/:id/{accepted,rejected,archived}` | Record an explicit decision |
| `GET` | `/api/creative-studio/media` | List owner-scoped retained project uploads |
| `POST` | `/api/creative-studio/media` | Stream one allowlisted image, audio, or video upload to verified R2 storage |
| `GET` | `/api/creative-studio/media/:id/content` | Serve an owned uploaded asset from Creative Studio R2 |
| `GET` | `/api/creative-studio/capabilities` | Report bounded runtime health |

Every other Creative Studio API path returns `404`. There is no arbitrary forwarding route.

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

Media uploads never traverse AFDFW. The upload route requires an owned, non-archived project; an allowlisted MIME type; a 100 MB or smaller declared size; and an explicit `true` or `false` future-training consent value. It writes to a project-scoped R2 key, verifies the stored byte count, and only then commits D1 metadata. The media contract records provenance and consent but does not claim or schedule a training run.

## Runtime validation

- Unknown browser adapter modes fail closed instead of silently becoming an HTTP adapter.
- Unknown Worker backend modes fail closed.
- AFDFW mode requires either a service binding or a valid base URL.
- Non-local base URLs must use HTTPS.
- AFDFW `401` and `403` responses become a same-origin `approved_login_required` response without seeding owner data.
- `npm run check:env:production` blocks a release while the D1 ID is a placeholder, backend mode is development, the R2/custom-domain boundary is missing, `workers.dev` is enabled, or no protected AFDFW target exists.
- The same production preflight requires the dedicated queue producer/consumer and the five-minute recovery trigger.
