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

The command applies local D1 migrations, starts or reuses the Wrangler-local BFF on port 8787, enrolls a localhost-only runner credential, starts Local Runner 1.3, and starts the Vite UI. The credential is stored outside the repository at `%LOCALAPPDATA%\Creative Studio Runner\local-config.json` with a current-user/SYSTEM ACL.

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

Local mode has no development generation fallback. Image, music/audio, and video generation require a real imported ComfyUI API-format workflow. Every result still receives its immutable workflow, model, prompt, parameter, input, and lineage stamp before being retained locally.

The local browser refreshes active work every two seconds and the local runner claims work every five seconds. These are localhost calls and consume no Cloudflare Worker allowance. Hidden tabs still pause browser polling.

## Remote mode

`https://cs.angelotoborg.com` remains the remote experience. It uses Creative Studio's protected Cloudflare BFF, durable cloud storage, the allowlisted AFDFW image/music capabilities, and the authenticated workstation runner for imported ComfyUI workflows. Its browser and runner cadences remain constrained by the Cloudflare free-tier budget.

Local and remote D1/R2 stores are intentionally separate. Local work is not silently uploaded or synchronized to the remote account. A future explicit publish/sync action must preserve settings stamps, provenance, review decisions, and collision-safe artifact identity; it must never run as an invisible background side effect.

## UI-only development adapter

`npm run dev` without `VITE_CREATIVE_STUDIO_ADAPTER=http` still starts the explicitly labeled browser-storage development adapter for frontend work. It has no real upload or hardware execution boundary and is not the recommended creation experience.
