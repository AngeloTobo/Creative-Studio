# Backend contract

The browser-facing namespace is fixed to `/api/creative-studio/*`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/creative-studio/session` | Same-origin session descriptor |
| `GET` | `/api/creative-studio/projects` | List Creative Studio projects |
| `GET` | `/api/creative-studio/dna` | List versioned CreativeDNA artifacts |
| `POST` | `/api/creative-studio/dna` | Create a root or child DNA version |
| `GET` | `/api/creative-studio/jobs` | List and reconcile durable jobs |
| `POST` | `/api/creative-studio/jobs` | Submit one music or image job |
| `GET` | `/api/creative-studio/artifacts` | List artifacts and acceptance history |
| `GET` | `/api/creative-studio/artifacts/:id/media` | Serve retained R2 media or mediate allowlisted temporary media |
| `POST` | `/api/creative-studio/artifacts/:id/{accepted,rejected,archived}` | Record an explicit decision |
| `GET` | `/api/creative-studio/capabilities` | Report bounded runtime health |

Every other Creative Studio API path returns `404`. There is no arbitrary forwarding route.

## AFDFW allowlist

The Worker adapter permits only:

- `GET /api/me`
- `POST /api/profile-song/generate`
- `GET /api/profile-song/generations`
- `GET /api/profile-song/media/:id`
- `POST /api/profile-image/generate`
- `GET /api/profile-image/generations`
- `GET /api/profile-image/media/:id`

Cookies, verified Cloudflare Access identity, and Access assertions may be relayed server-side. A service token, when configured, stays in Worker secrets. The adapter validates a configured base origin and rejects non-allowlisted methods and paths before any fetch.

CreativeDNA and artifact decisions are stored in Creative Studio D1 only. Accepted remote media is retained in Creative Studio R2 before the decision is committed. No CreativeDNA, accept, profile, feed, admin, or raw ComfyUI route is on the AFDFW allowlist.

## Runtime validation

- Unknown browser adapter modes fail closed instead of silently becoming an HTTP adapter.
- Unknown Worker backend modes fail closed.
- AFDFW mode requires either a service binding or a valid base URL.
- Non-local base URLs must use HTTPS.
- AFDFW `401` and `403` responses become a same-origin `approved_login_required` response without seeding owner data.
- `npm run check:env:production` blocks a release while the D1 ID is a placeholder, backend mode is development, the R2/custom-domain boundary is missing, `workers.dev` is enabled, or no protected AFDFW target exists.
