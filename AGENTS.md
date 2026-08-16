# Creative Studio agent boundaries

- Treat this repository as a standalone product named Creative Studio.
- Do not import AFDFW frontend code, routes, CSS, components, shell, or branding.
- Browser code may call only `/api/creative-studio/*`.
- Worker access to AFDFW must remain method-and-path allowlisted; never add a generic proxy.
- Keep Creative Studio projects, job state, artifact history, and acceptance decisions in Creative Studio-owned storage.
- Never mutate AFDFW profile, Core, feed, or canonical state as a side effect of accepting an artifact.
- Keep the development adapter explicit in labels and capability health. Do not present development media as a real generation result.
- Preserve source/reference provenance while excluding commercial reference identity from provider prompts.
- Do not add secrets, local databases, generated media, uploads, or build output to source control.
- Do not deploy, commit, or push unless the user explicitly requests it.
- Update `docs/BUILD_REALITY.md` when runtime facts or verification results change.
