# Creative Studio — Standalone Product Handoff

Updated: 2026-08-15

## Start here

Build **Creative Studio** as a new, standalone product in:

`C:\Users\angel\Documents\Creative Studio`

This directory is the product root. Do not create the application inside the AFDFW repository.

The existing AFDFW `/studio` implementation is a proven prototype and backend integration test. It is **not** the Creative Studio product, shell, brand, navigation, or long-term frontend.

## Product definition

Creative Studio is Angelo's private creative workstation, fast generator, and experimental playground.

The primary experience is:

**idea or source → CreativeDNA → make across media → review → keep evolving**

It should eventually accept text, image, audio, video, 3D, and MIDI and produce image, music, video, 3D/GLB, printable objects, MIDI, AR handoffs, and web experiences.

The first usable version should concentrate on the strongest working path:

**text direction → versioned CreativeDNA → music or image generation → durable result/history**

## Non-negotiable product boundary

Creative Studio is not AFDFW and must not feel like an AFDFW feature.

- Own application and codebase.
- Own name, browser title, visual system, navigation, project model, and deployment.
- No AFDFW logos, community copy, feed concepts, artist-wall language, routes, headers, footers, CSS, or page components.
- Do not import AFDFW React components or styles.
- Do not make Creative Studio runtime-dependent on the AFDFW frontend build.
- AFDFW may remain an implementation backend for selected capabilities until those capabilities are extracted or replaced.
- Provider/model names are replaceable adapters, not product architecture.

AFDFW should be treated as a **behavioral and backend reference**, not as a shared product runtime.

## Architecture

```text
Creative Studio
├── Standalone React application
├── Creative Studio design system and project shell
├── Versioned client/API contracts
├── Creative Studio edge Worker / backend-for-frontend
└── Tests, runtime visibility, and deployment configuration
        │
        │ narrow allowlisted service binding or protected API contract
        ▼
Existing AFDFW backend capabilities
├── approved-session/auth foundations where still useful
├── D1 and R2 persistence
├── CreativeDNA persistence
├── generation records and acceptance boundaries
└── protected ComfyUI bridge
        │
        ▼
Local and replaceable engines
├── ComfyUI
├── Stable Audio 3 / future music adapters
├── Z-Image / future image adapters
├── Wan / LTX / future video adapters
└── LM Studio or other reasoning adapters when actually available
```

### Recommended repository layout

Create this structure directly under the current directory:

```text
Creative Studio/
├── AGENTS.md
├── README.md
├── package.json
├── vite.config.ts
├── wrangler.jsonc
├── src/
│   ├── app/
│   ├── features/
│   │   ├── creative-dna/
│   │   ├── generation/
│   │   ├── projects/
│   │   └── runtime/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── styles/
├── worker/
│   ├── index.ts
│   ├── routes/
│   └── adapters/
├── shared/
│   └── contracts/
├── tests/
│   ├── unit/
│   └── e2e/
└── docs/
    ├── ARCHITECTURE.md
    ├── BACKEND_CONTRACT.md
    └── BUILD_REALITY.md
```

The standalone Worker should serve Creative Studio assets and act as a narrow backend-for-frontend. In production, prefer a Cloudflare service binding or equally protected server-side adapter to the existing backend. Do not expose a generic AFDFW proxy to the browser.

## Capability boundary

Create a versioned Creative Studio API namespace such as:

```text
/api/creative-studio/session/*
/api/creative-studio/projects/*
/api/creative-studio/dna/*
/api/creative-studio/jobs/*
/api/creative-studio/artifacts/*
/api/creative-studio/capabilities/*
```

The Creative Studio frontend should call only this contract. Its edge Worker/adapters may translate those calls to current AFDFW routes or service bindings.

Allowlist only the capabilities Creative Studio needs. Do not forward arbitrary `/api/*` requests.

### Initial contracts

- Session status and sign-in handoff.
- Create/list/version CreativeDNA artifacts.
- Submit and inspect generation jobs.
- Fetch temporary previews.
- Accept, reject, or archive results explicitly.
- List retained artifacts and lineage.
- Report available capabilities and real runtime health without exposing secrets.

## What may be reused

The following current AFDFW files are implementation references and contain working foundations:

- `C:\Users\angel\Desktop\afdfw\art-feed-dfw\shared\creativeDna.ts`
  - CreativeDNA v1 types, normalization, rights policy, translation metadata, and prompt compilation.
- `C:\Users\angel\Desktop\afdfw\art-feed-dfw\worker\routes\creative-dna.ts`
  - Approved-session API behavior and D1 persistence flow.
- `C:\Users\angel\Desktop\afdfw\art-feed-dfw\migrations\0033_creative_dna.sql`
  - Version/root/parent lineage storage.
- `C:\Users\angel\Desktop\afdfw\art-feed-dfw\tests\lib\creative-dna.test.ts`
  - Rights, lineage, versioning, and bounds regression coverage.
- `C:\Users\angel\Desktop\afdfw\art-feed-dfw\src\features\creative-dna\CreativeDnaWorkbench.tsx`
  - Prototype interaction behavior only. Rebuild it inside Creative Studio's own design system; do not copy the AFDFW page shell or styling wholesale.
- `C:\Users\angel\Desktop\afdfw\art-feed-dfw\docs\creative-os\BUILD_REALITY.md`
  - Last verified runtime and implementation state.

Extract or reimplement bounded contracts and behavior. Do not establish cross-repository source imports.

## Current verified backend reality

Verified on 2026-08-15:

- Node.js 24.16.0.
- ComfyUI 0.33.0 running on port 8188.
- Protected local generation bridge healthy on `127.0.0.1:8789`.
- Music path: Stable Audio 3 Medium with Qwen 3.5 2B prompt expansion.
- Image path: Z-Image.
- Video path: Wan 2.2 image-to-video.
- LM Studio was configured but not running.
- Ollama was not running.
- No ACE-Step model was registered in the configured model directory.
- LTX 2.3 LoRA assets were present, but no Character Core training integration was proven.
- Local D1 migration `0033_creative_dna.sql` was applied and verified.
- Existing AFDFW CreativeDNA tests, complete E2E suite, lint, build, bridge health, and secret hygiene checks passed.

Recheck all runtime facts before depending on them. Installed, configured, resident, and healthy are different states.

## CreativeDNA rules

- CreativeDNA is a versioned cross-modal protocol, not a model or a prompt string.
- Preserve native, shared, and translated DNA separately.
- Preserve evidence class, confidence, provenance, rights, translation strategy, and information-loss estimate.
- A reference identity may be retained for lineage while being excluded from downstream generation prompts.
- Commercial reference handling must block protected lyrics, identifiable melody, copied expressive passages, unpermitted vocal likeness, and raw reference audio used to reproduce a work.
- Angelo Core, Project Core, Character/Entity Core, and temporary Reference Influence are distinct layers.
- Generated output does not silently update a Core or become canon.
- New versions create lineage; do not overwrite historical DNA in place.

## Experience principles

- Lead with creation and visible output, not explanatory AI copy.
- One obvious starting action.
- Simple Mode first; Graph Mode reveals the same underlying execution graph later.
- Use progressive disclosure for dimensions, providers, provenance, and execution detail.
- Show real system state: saved, queued, running, completed, failed, accepted, rejected, archived.
- Keep provider/model detail available in runtime views, not in the primary creative workflow.
- No “AI tells,” generic dashboard filler, decorative slop, or text that merely explains a button.
- Desktop and mobile must both be first-class.
- Respect reduced motion and keyboard navigation.

## First implementation milestone

Deliver a standalone local Creative Studio application that can:

1. Start and build independently from this directory.
2. Present only Creative Studio branding and navigation.
3. Create an original or commercial-reference-aware CreativeDNA artifact.
4. Adjust shared dimensions and creative gravity.
5. Save and reopen version history with root/parent lineage.
6. Translate one DNA artifact into both music and image prompts.
7. Submit through a typed Creative Studio backend adapter.
8. Leave the page and return to visible job/result state.
9. Accept or reject outputs explicitly.
10. Show a compact runtime/capability status without leaking secrets.

If the real backend adapter is not ready during initial scaffolding, create an explicit development adapter behind the same contract. Do not let mock data become an unmarked production fallback.

## Implementation sequence

### Phase 0 — Independent foundation

- Initialize the standalone project in this directory.
- Add `AGENTS.md`, README, TypeScript, lint, unit tests, Playwright, and production build scripts.
- Establish Creative Studio tokens, shell, routing, error boundaries, and responsive behavior.
- Add environment validation and secret hygiene before any backend integration.

### Phase 1 — CreativeDNA vertical slice

- Port the versioned contract into `shared/contracts/`.
- Build the Creative Studio-native workbench.
- Add project and artifact history surfaces.
- Add rights/provenance visibility without overwhelming the main workflow.
- Test original and commercial-reference cases.

### Phase 2 — Backend-for-frontend

- Create the allowlisted Creative Studio Worker routes.
- Connect to AFDFW backend capabilities through a protected adapter/service binding.
- Keep authentication and cookies same-origin from the Creative Studio browser's perspective.
- Never expose bridge tokens, AFDFW secrets, D1, R2, or raw ComfyUI to the client.

### Phase 3 — Durable execution

- Normalize music and image generation behind job contracts.
- Persist submit/status/output/error transitions.
- Make leave-and-return behavior real.
- Record provider, capability, prompt/DNA version, source lineage, output lineage, and acceptance state.

### Phase 4 — Independent deployment

- Select the Creative Studio domain/hostname.
- Configure its own Worker/assets deployment.
- Verify rollback independently from AFDFW deployment.
- Do not deploy the AFDFW frontend as part of a Creative Studio release.

## Verification gates

Before calling the first milestone complete:

- Unit tests for CreativeDNA normalization, bounds, rights, translation, and lineage.
- API contract tests for auth, validation, ownership, and job state.
- Browser tests for create → save → version → make music/image → return to result.
- Desktop and mobile rendered inspection.
- Keyboard and reduced-motion checks.
- Lint and TypeScript clean.
- Production build clean.
- Secret scan clean.
- Real backend health check where configured.
- No visible AFDFW branding or cross-repository frontend imports.

## Deployment and safety boundaries

- Do not download large models without explicit approval.
- Do not change Cloudflare configuration or production bindings until the Creative Studio hostname and service boundary are confirmed.
- Do not deploy from a dirty AFDFW working tree.
- Keep `.env*`, credentials, runtime databases, uploads, generated media, local model paths, and build artifacts out of source control.
- Do not silently write accepted/canonical state. Acceptance remains an explicit user action.
- Do not commit or push until explicitly requested.

## Remaining owner decisions

- Whether onboarding remains backed by the existing approved-user funnel or becomes a Creative Studio-specific access flow.
- When to remove the prototype `/studio` frontend from AFDFW after standalone parity.

## Exact instruction for the next Codex session

> Read `CREATIVE_STUDIO_HANDOFF.md`, `docs\BUILD_REALITY.md`, and `docs\PRODUCTION_READINESS.md` completely. Continue Creative Studio as the standalone product in `C:\Users\angel\Documents\Creative Studio`. Preserve the product-owned D1/R2 boundary, the exact AFDFW allowlist, and Cloudflare Access coverage of `cs.angelotoborg.com/*`. Run the full verification and production preflight before any later release; do not deploy the AFDFW frontend as part of a Creative Studio release.

## Current handoff state

The standalone Vite/React/TypeScript application, shared contracts, explicit development adapter, Worker/BFF, dedicated D1/R2 resources, first CreativeDNA vertical slice, and Local Runner v1 are implemented. Production is live at `cs.angelotoborg.com` behind an Angelo-only Cloudflare Access application covering `/*`; the separate `runner.cs.angelotoborg.com` hostname serves only revocable bearer-authenticated machine routes. The real Windows/RTX 3090 agent is installed and heartbeating against localhost ComfyUI 0.33.0. Versioned API-format image, music/audio, and video workflows can execute without an open browser and every completed result must be retained and size-verified in Creative Studio R2 before its job completes. The separate CreativeDNA media-analysis/profile-synthesis trainer and 3D execution remain later integrations. Continue from `docs/BUILD_REALITY.md` and `docs/PRODUCTION_READINESS.md` for the verified release state and operating boundaries.
