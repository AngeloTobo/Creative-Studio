# Local-first Creative Studio

Local mode is the primary experience when this Windows workstation is available. It uses the RTX hardware and localhost services directly; it does not send generation, training, polling, uploads, or media retention through Cloudflare or AFDFW.

## Start the complete local stack

1. Start ComfyUI at `http://127.0.0.1:8188`.
2. From this repository, run:

```powershell
npm install
npm run local
```

3. Open the localhost URL printed by the launcher (`http://127.0.0.1:5173` by default; it selects the next free port when needed).

The command applies local D1 migrations, starts or reuses the Wrangler-local BFF on port 8787, enrolls a localhost-only runner credential, starts Local Runner 1.18, and starts the Vite UI. The credential is stored outside the repository at `%LOCALAPPDATA%\Creative Studio Runner\local-config.json` with a current-user/SYSTEM ACL.

Press `Ctrl+C` in that terminal to stop the processes started by the command. A previously running local BFF is reused and is not stopped.

## Local ownership boundary

| Concern | Local owner |
| --- | --- |
| UI | Vite on `127.0.0.1:5173` |
| API/BFF | Wrangler local mode on `127.0.0.1:8787` |
| Projects, DNA, jobs, workflows, decisions | Local D1 state under the repository's ignored `.wrangler` directory |
| Uploads and completed results | Wrangler-local R2 state under `.wrangler` |
| Image, audio, video generation | ComfyUI on `127.0.0.1:8188` and this machine's GPU |
| Multimodal CreativeDNA analysis | Local Runner, FFmpeg, Sharp, Gemma 4, and ComfyUI |
| Full video script writing | Local Runner 1.13, Gemma 4, exact image/final-frame conditioning when selected, model-specific prompts, separate optional dialogue, and owner-reviewed D1 revisions |
| Overnight Studio | Durable local sessions, Gemma story planning, one sequential ComfyUI render at a time, exact workflow/recipe/DNA/World provenance, hard cutoff/failure/storage limits, and manual morning review |
| ACE-Step music LoRA training | Local Runner, pinned ACE-Step 1.5 runtime under `D:\AI`, reviewed local audio/captions, and RTX 3090 |

Local mode has no development generation fallback. Image, music/audio, and video generation require a real imported ComfyUI API-format workflow. Every result still receives its immutable workflow, model, prompt, parameter, input, and lineage stamp before being retained locally.

The RTX 3090 is an exclusive local resource. One machine lock permits only one Creative Studio runner process. High-VRAM generation verifies that external LM Studio models are unloaded before submission and during video heartbeats. Standalone Gemma helper work waits behind media generation and crosses a verified ComfyUI release boundary before and after use; model components inside the selected LTX workflow remain part of that render. If LM Studio is installed in a nonstandard location, set `CS_LM_STUDIO_CLI` to the exact `lms` executable path for the runner process.

The local browser refreshes active work every two seconds and the local runner claims work every five seconds. These are localhost calls and consume no Cloudflare Worker allowance. Hidden tabs still pause browser polling.

## Create overnight

Open **Home -> Overnight Studio** after the project has an owner-reviewed CreativeDNA and at least one prompt-only API workflow for each media type you select. The default night makes one story, three fast scene images, and one soundtrack; video is opt-in because it can consume substantially more GPU time. Choose a seed or **Surprise me**, optionally anchor it to a Creative World, set the start and hard cutoff, and arm the session. The Local Runner performs the Gemma plan and then queues one bounded ComfyUI result at a time, so the browser can close.

Every completed file remains retained. In the morning, Home and **Work -> Results** show one grouped session instead of flooding the queue with child jobs. **Keep** and **Pass** both require a note; **Skip** leaves the artifact ready. No result is accepted, trained into CreativeDNA, or promoted to World canon automatically.

For remote overnight work, run `scripts/install-local-runner.ps1` once after pairing the workstation. Its Task Scheduler definition starts at sign-in, retries failures, and has a daily wake/recovery trigger at 21:45 by default. Windows must be allowed to wake the workstation and ComfyUI must be running at the configured localhost URL; Creative Studio will retain the armed session without claiming generation while ComfyUI is unavailable.

## Remote mode

`https://cs.angelotoborg.com` remains the remote experience. Its primary generation route still uses Creative Studio's authenticated workstation runner and imported ComfyUI workflows, with the protected Cloudflare BFF providing durable cloud job and artifact storage. The allowlisted AFDFW image/music capabilities are separate optional actions and are never chosen automatically. Browser and runner cadences remain constrained by the Cloudflare free-tier budget.

Local and remote D1/R2 stores are intentionally separate. Local work is not silently uploaded or synchronized to the remote account. A future explicit publish/sync action must preserve settings stamps, provenance, review decisions, and collision-safe artifact identity; it must never run as an invisible background side effect.

## UI-only development adapter

`npm run dev` without `VITE_CREATIVE_STUDIO_ADAPTER=http` still starts the explicitly labeled browser-storage development adapter for frontend work. It has no real upload or hardware execution boundary and is not the recommended creation experience.
