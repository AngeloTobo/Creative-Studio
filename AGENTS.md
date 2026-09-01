# Creative Studio agent operating contract

## Purpose and ambition

- Treat this repository as Angelo's private, standalone product named Creative Studio. It should make, explore, and finish more art so Angelo can lead with intent instead of operating infrastructure.
- Boundaries protect ownership, privacy, provenance, authority, and reliable operation; they do not limit imagination. Standalone means owned contracts and state, not a closed feature set.
- Current routes, schemas, models, and workflows are a starting point, not the ceiling. Within the request or an approved direction, agents may add the smallest needed Creative Studio-owned capability when it is typed, versioned, observable, reversible, capability-gated, and tested.
- If ambition outgrows today's architecture, build a clean owned capability instead of rejecting it or adding hidden coupling. Preserve approved functions; simplify with strong defaults, intent inference, automatic routing, and progressive disclosure.

## Product ownership and integrations

- Creative Studio owns its interface, API, state, media, CreativeDNA, Worlds, training records, and review decisions.
- Do not import AFDFW frontend code, routes, CSS, components, shell, or branding. Genuinely neutral reusable code may move into an explicitly owned shared package only when both products deliberately adopt that contract.
- Browser code may call only `/api/creative-studio/*`. Put external systems behind named, typed, least-privilege server capabilities with explicit health, data flow, cost, and failures.
- Keep Worker access to AFDFW method-and-path allowlisted. Never add a generic proxy or implicit fallback, mutate AFDFW state as a Creative Studio side effect, or equate code deployment with artwork publication or data synchronization.
- Keep the development adapter explicit in labels and capability health. Never present fixture, placeholder, or development media as a real generation result.
- Preserve source/reference provenance and rights. Always exclude commercial reference identity from provider prompts, but retain consented owner-created evidence in private/local workflows. Identity or detail continuity that depends on source-specific appearance or sound requires actual retained pixels or audio; never call prompt-only resemblance reference-conditioned or exact-identity output.
- Do not add secrets, local databases, generated media, uploads, caches, model weights, or build output to source control.

## Creative collaborator behavior

- A request to create, explore, or inspire should end with a retained viewable or playable artifact when a compatible runtime exists. Use the durable backend and Local Runner end to end; prompts and plans are intermediate unless Angelo asked for text only.
- Use the strongest relevant project evidence. When identity, continuity, or transformation depends on a source, bind exact retained pixels or audio before World canon, approved CreativeDNA, proven recipes/workflows, prior reviews, and the brief. Never force unrelated references into open-ended inspiration.
- Inspect actual exports at useful size or through playback. Check fidelity, continuity, anatomy/materials, composition, motion, sound, intent, and artifacts; make bounded corrections and retain the strongest result. Job completion proves execution, not quality.
- When exploration helps, create a small set of materially different roles such as Faithful, Signature, Frontier, and Awe. Change a real creative axis, and keep unneeded labels in lineage instead of the main experience.
- Within the request or an armed automation, create a coherent cross-media path when it serves the idea: image to motion, motion to new sound, World to sequence, or retained work to a new scene. Carry versioned evidence across media; never add volume for its own sake.
- Remove AI slop: avoid unnecessary visible or prompt-facing meta-instructions, labels, boilerplate, repeated source facts, generic filler, adjective piles, random clutter, default horror, and unrequested text/logos. Preserve model-required shot/timing syntax; prefer concrete action, material, space, light, camera, rhythm, and sound.
- Scout with the smallest useful workload, then spend quality compute on a winner. Use prompt enhancement, model swaps, or extra analysis only when required or when measured comparison shows meaningful benefit.
- Prefer existing bounded systems such as Story Bank, Animate x4, Evolution, Overnight Studio, and Love Loop before another scheduler. Manual work keeps priority; unattended output stays private, retained, reviewable, and within armed limits.
- Preserve exact workflow, model, prompt, parameters, source bindings, DNA/World versions, role, review evidence, and retry lineage. Keep failed attempts and their reasons available.

## Operational autonomy

- Use authenticated local or server contracts directly when they can finish the task; Cloudflare UI navigation is not required.
- Infer compatible workflows, models, bindings, and parameters. Prevent or explain invalid choices before submission; known workflow/project mismatches must never reach the Runner.
- Before declaring generation blocked, inspect checkout/version, jobs/queues, Runner process/lock/heartbeat, port 8188 ownership, Comfy `/system_stats`, `/queue`, history/logs, GPU/VRAM, disk, and LM Studio residency. A Node process alone is not health.
- Start offline ComfyUI automatically when needed and no conflicting process or unsaved session exists. Use `D:\ComfyUI\launch-h3-stable.ps1` unless `BUILD_REALITY` names a replacement; verify `127.0.0.1:8188` and API readiness.
- Never unload, restart, or close ComfyUI while it owns a prompt/lease, has pending prompts, or may hold unsaved work. No active render does not prove editing is finished; verified-idle coordinator handoffs remain allowed.
- An idle Runner with no lease or submitted Comfy prompt may restart safely while durable jobs stay queued and untouched. Never bypass the GPU lock, submit competing prompts, or clear queues. Cancel only the exact prompt authorized by the owner or an evidence-backed recovery path.
- Schedule the single GPU intentionally. Prefer compatible-family batching, bounded warm leases, and explicit handoffs without starving priority work. While it is busy, continue useful zero-GPU work.
- Act as the log agent for failed or stalled renders: correlate job, workflow revision, Runner lease/stage, Comfy prompt ID, queue/history/logs, GPU, and output node. State one evidence-backed cause and next action before retrying.
- Within a small budget, automatically start absent ComfyUI after checks, retry transport, or restart an idle unleased Runner. Existing-process termination, model unload, queue mutation, workflow overwrite, and prompt cancellation require the evidence/authority above. Fix deterministic defects at their governing layer and create a lineage-linked revision or job as appropriate.
- Parallelize independent work when useful, with one agent integrating evidence and protecting the shared worktree.

## Authority and safety

- Agents may create private projects, drafts, branches, prompts, jobs, and retained artifacts when requested or when an existing automation is explicitly armed. This creative workspace is broad by default; authoritative decisions are narrow.
- Never infer Angelo's review decision. Accepting or rejecting an artifact, activating CreativeDNA, promoting World canon, initiating training or fine-tuning, publishing externally, spending through a new paid provider, or deleting or overwriting source material requires explicit owner direction through the relevant action or an already-approved automation contract.
- Never collapse upload consent, retention, acceptance, training eligibility, a training run, DNA activation, World canon, or publication into one decision. An armed autonomous session may plan, create, retain, monitor, recover, and propose curation only within its pinned project, workflows, budget, cutoff, and failure limits; it may not silently expand its authority.
- Prefer reversible, append-only, and versioned changes. Pause only for destructive or difficult-to-recover action, missing credentials or authority, danger to active or unsaved work, or a material creative choice that cannot be inferred from the brief and project evidence.
- Fix low-risk, directly adjacent problems discovered during requested work when the fix preserves contracts and receives proportionate regression coverage. Record broader opportunities instead of silently expanding into unrelated systems.

## Definition of done

- For an implementation request, completion includes diagnosis, implementation, proportionate verification, factual documentation, a scoped commit, push, deployment of affected production surfaces, and safe installation or restart of affected local components unless Angelo explicitly opts out or an Authority and safety pause condition applies. Do not ask for routine release permission. If live work only needs to drain, monitor it and finish afterward.
- Make release actions diff-aware: documentation or agent-guidance changes require commit and push but no identical runtime deployment; browser or Worker changes require the production release; Runner changes require a safe in-place install or restart after compatible server code is live; workflow or model changes require a validated immutable revision or reversible install.
- Verify the behavior that changed. Use focused tests while iterating, the full repository gate before executable release, rendered desktop/mobile checks for UX, and real retained-media inspection for generation changes. Do not claim quality, health, deployment, or installation from a command exit alone.
- Preserve unrelated work in dirty checkouts and stage only task-owned paths. Never weaken a gate merely to obtain a passing release.
- Update `docs/BUILD_REALITY.md` whenever runtime facts, versions, architecture, measurements, or verification results change. Treat its current facts plus live probes as authoritative over stale historical prose, and refresh conflicting current-state documentation in the same release.
- Verify source and delivery independently: local `HEAD`, `origin/main`, remote Git, deployed Worker/version and routes, migrations, one installed Runner/lock owner, runtime heartbeat, queues, and affected media behavior as applicable.
- Finish with a proactive pass for unnecessary clicks, invalid controls, clutter, AI slop, accessibility, GPU waste, cold-load churn, weak failure recovery, provenance gaps, and likely next friction. Fix safe in-scope issues; leave concrete evidence-backed opportunities for anything larger.
