import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";

const PROVIDER = "ace-step-1.5-lora";

function localDataRoot() {
  return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
}

function firstExisting(paths) {
  return paths.find((path) => path && existsSync(path)) || null;
}

function containsModelWeights(directory) {
  if (!existsSync(directory)) return false;
  const names = new Set(readdirSync(directory));
  const weights = [
    "model.safetensors", "model.safetensors.index.json", "pytorch_model.bin", "pytorch_model.bin.index.json",
    "diffusion_pytorch_model.safetensors", "diffusion_pytorch_model.safetensors.index.json",
  ].some((name) => names.has(name));
  return weights && names.has("config.json");
}

export function detectAceStepRuntime(environment = process.env) {
  const home = firstExisting([
    environment.CS_ACESTEP_HOME,
    "D:\\AI\\ACE-Step-1.5",
    "C:\\AI\\ACE-Step-1.5",
    join(homedir(), "Documents", "ACE-Step-1.5"),
  ]);
  if (!home || !existsSync(join(home, "pyproject.toml")) || !existsSync(join(home, "acestep", "training_v2", "cli", "train_fixed.py"))) {
    return { available: false, provider: PROVIDER, reason: "ace_step_runtime_missing", home: home || null };
  }
  const python = firstExisting([
    environment.CS_ACESTEP_PYTHON,
    join(home, ".venv", "Scripts", "python.exe"),
    join(home, ".venv", "bin", "python"),
  ]);
  if (!python) return { available: false, provider: PROVIDER, reason: "ace_step_python_missing", home };
  const checkpointDir = environment.CS_ACESTEP_CHECKPOINTS || join(home, "checkpoints");
  const baseModelDir = join(checkpointDir, "acestep-v15-base");
  const checkpointReady = containsModelWeights(baseModelDir)
    && containsModelWeights(join(checkpointDir, "vae"))
    && containsModelWeights(join(checkpointDir, "Qwen3-Embedding-0.6B"));
  if (!checkpointReady) {
    return { available: false, provider: PROVIDER, reason: "ace_step_base_checkpoint_missing", home, python, checkpointDir };
  }
  return { available: true, provider: PROVIDER, reason: null, home, python, checkpointDir };
}

export function aceStepProviderList(runtime = detectAceStepRuntime()) {
  return runtime.available ? [PROVIDER] : [];
}

export async function aceStepGpuPreflight() {
  const result = await new Promise((resolve, reject) => {
    const child = spawn("nvidia-smi", ["--query-gpu=memory.total,memory.free,name", "--format=csv,noheader,nounits"], { shell: false, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error("ace_step_gpu_query_failed")));
  });
  const [totalValue, freeValue, ...nameParts] = String(result).trim().split(",").map((value) => value.trim());
  const totalMiB = Number(totalValue);
  const freeMiB = Number(freeValue);
  if (!Number.isFinite(totalMiB) || !Number.isFinite(freeMiB)) throw new Error("ace_step_gpu_query_invalid");
  if (totalMiB < 20 * 1024) throw new Error(`ace_step_gpu_vram_unsupported_${Math.round(totalMiB)}_mib`);
  if (freeMiB < 18 * 1024) throw new Error(`ace_step_gpu_busy_free_${Math.round(freeMiB)}_mib`);
  return { totalMiB, freeMiB, name: nameParts.join(", ") };
}

export function aceStepCaptionPrompt(label) {
  return `Listen to the audio file named "${String(label || "Untitled audio").slice(0, 160)}" and write exactly one ACE-Step 1.5 training caption of 30 to 90 words. Describe only audible musical traits: genre and subgenre, instrumentation, vocal presence and vocal style, rhythmic feel, tempo feel without inventing a numeric BPM, harmony, structure, dynamics, spatial mix, production character, and mood. Do not mention artwork, characters, CreativeDNA, projects, models, prompts, filenames, or hidden intent. Do not invent lyrics, BPM, key, language, or credits. Return only the caption.`;
}

export function validateAceStepDataset(job) {
  const items = job?.dataset?.items;
  if (!Array.isArray(items) || items.length < 3) throw new Error("ace_step_dataset_review_required");
  if (job.dataset.reviewedAt == null) throw new Error("ace_step_dataset_review_required");
  for (const item of items) {
    const caption = String(item.caption || "").trim();
    if (caption.length < 30 || caption.length > 1_500) throw new Error(`ace_step_caption_invalid_${item.assetId}`);
    if (!item.isInstrumental && !String(item.lyrics || "").trim()) throw new Error(`ace_step_lyrics_required_${item.assetId}`);
  }
  return items;
}

function safeAudioName(item, index) {
  const extension = extname(item.fileName || "").toLowerCase();
  const safeExtension = [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"].includes(extension) ? extension : ".wav";
  return `track_${String(index + 1).padStart(2, "0")}_${item.assetId.slice(-8)}${safeExtension}`;
}

export async function prepareAceStepWorkspace(job, download, jobRoot = join(localDataRoot(), "Creative Studio Runner", "training", job.id)) {
  const items = validateAceStepDataset(job);
  const audioDir = join(jobRoot, "audio");
  const tensorDir = join(jobRoot, "tensors");
  const outputDir = join(jobRoot, "output");
  await Promise.all([mkdir(audioDir, { recursive: true }), mkdir(tensorDir, { recursive: true }), mkdir(outputDir, { recursive: true })]);
  const datasetSamples = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const name = safeAudioName(item, index);
    const stem = name.slice(0, -extname(name).length);
    const bytes = await download(item.assetId);
    await writeFile(join(audioDir, name), bytes);
    await writeFile(join(audioDir, `${stem}.caption.txt`), `${job.concept.triggerToken}, ${String(item.caption).trim()}\n`, "utf8");
    await writeFile(join(audioDir, `${stem}.lyrics.txt`), `${item.isInstrumental ? "[Instrumental]" : String(item.lyrics).trim()}\n`, "utf8");
    await writeFile(join(audioDir, `${stem}.json`), JSON.stringify({
      caption: `${job.concept.triggerToken}, ${String(item.caption).trim()}`,
      bpm: item.bpm ?? null,
      keyscale: item.keyscale || "",
      custom_tag: job.concept.triggerToken,
      instrumental: item.isInstrumental,
    }, null, 2), "utf8");
    datasetSamples.push({
      audio_path: join(audioDir, name),
      filename: name,
      caption: `${job.concept.triggerToken}, ${String(item.caption).trim()}`,
      lyrics: item.isInstrumental ? "[Instrumental]" : String(item.lyrics).trim(),
      bpm: item.bpm ?? null,
      keyscale: item.keyscale || "",
      duration: item.durationSeconds,
      custom_tag: job.concept.triggerToken,
      is_instrumental: item.isInstrumental,
    });
  }
  const datasetJson = join(jobRoot, "dataset.json");
  await writeFile(datasetJson, JSON.stringify({
    metadata: { tag_position: "prepend", genre_ratio: 0, custom_tag: job.concept.triggerToken },
    samples: datasetSamples,
  }, null, 2), "utf8");
  return { jobRoot, audioDir, tensorDir, outputDir, datasetJson };
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } });
    let tail = "";
    let cancelled = false;
    const onChunk = (chunk) => {
      const value = String(chunk);
      tail = `${tail}${value}`.slice(-8_000);
      options.onOutput?.(value);
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    const timer = setInterval(async () => {
      try {
        await options.heartbeat();
      } catch {
        cancelled = true;
        child.kill();
      }
    }, 30_000);
    child.on("error", (error) => {
      clearInterval(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearInterval(timer);
      if (cancelled) reject(new Error("model_training_cancelled"));
      else if (code !== 0 || /TRAINING FAILED|PREPROCESSING FAILED|\[FAIL\]\s+(?:Training|Preprocessing) failed/i.test(tail)) {
        reject(new Error(`${options.errorCode}: ${tail.replace(/\s+/g, " ").trim().slice(-900)}`));
      }
      else resolve({ tail });
    });
  });
}

async function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

export async function executeAceStepTraining(runtime, job, workspace, heartbeat) {
  if (!runtime.available) throw new Error(runtime.reason || "ace_step_runtime_missing");
  let currentProgress = 38;
  await heartbeat(currentProgress, "preprocessing");
  const preprocessArgs = [
    "-m", "acestep.training_v2.cli.train_fixed",
    "--checkpoint-dir", runtime.checkpointDir,
    "--model-variant", "base",
    "--preprocess",
    "--dataset-json", workspace.datasetJson,
    "--tensor-output", workspace.tensorDir,
    "--device", "cuda:0",
    "--precision", job.recipe.optimization.precision,
    "--plain", "--yes",
  ];
  await runProcess(runtime.python, preprocessArgs, {
    cwd: runtime.home,
    errorCode: "ace_step_preprocessing_failed",
    heartbeat: () => heartbeat(currentProgress, "preprocessing"),
    onOutput: (line) => {
      if (/pass\s*2|dit encoder|processed/i.test(line)) currentProgress = Math.min(54, currentProgress + 2);
    },
  });

  currentProgress = 56;
  await heartbeat(currentProgress, "training");
  const optimization = job.recipe.optimization;
  const trainingArgs = [
    "-m", "acestep.training_v2.cli.train_fixed",
    "--checkpoint-dir", runtime.checkpointDir,
    "--model-variant", "base",
    "--dataset-dir", workspace.tensorDir,
    "--output-dir", workspace.outputDir,
    "--adapter-type", "lora",
    "--rank", String(optimization.rank),
    "--alpha", String(optimization.alpha),
    "--lr", String(optimization.learningRate),
    "--batch-size", "1",
    "--gradient-accumulation", String(optimization.gradientAccumulation),
    "--epochs", String(optimization.epochs),
    "--seed", String(optimization.seed),
    "--num-workers", "0",
    "--device", "cuda:0",
    "--precision", optimization.precision,
    "--gradient-checkpointing",
    "--offload-encoder",
    "--plain", "--yes",
  ];
  await runProcess(runtime.python, trainingArgs, {
    cwd: runtime.home,
    errorCode: "ace_step_training_failed",
    heartbeat: () => heartbeat(currentProgress, "training"),
    onOutput: (line) => {
      const match = String(line).match(/epoch\s+(\d+)\s*[/of]+\s*(\d+)/i);
      if (match) currentProgress = Math.max(currentProgress, 56 + Math.round((Number(match[1]) / Math.max(1, Number(match[2]))) * 34));
    },
  });

  await heartbeat(92, "retaining");
  const sourceWeights = join(workspace.outputDir, "final", "adapter_model.safetensors");
  const sourceConfig = join(workspace.outputDir, "final", "adapter_config.json");
  if (!existsSync(sourceWeights) || !existsSync(sourceConfig)) throw new Error("ace_step_adapter_output_missing");
  const relativeDirectory = join("creative-studio", job.id);
  const retainedDirectory = join(localDataRoot(), "Creative Studio Runner", "adapters", relativeDirectory);
  await mkdir(retainedDirectory, { recursive: true });
  const retainedWeights = join(retainedDirectory, "adapter_model.safetensors");
  await Promise.all([
    copyFile(sourceWeights, retainedWeights),
    copyFile(sourceConfig, join(retainedDirectory, "adapter_config.json")),
  ]);
  const comfyLoraRoot = process.env.CS_COMFY_LORA_DIR || join(homedir(), "ComfyUI-Shared", "models", "loras");
  const comfyAdapterDirectory = join(comfyLoraRoot, relativeDirectory);
  await mkdir(comfyAdapterDirectory, { recursive: true });
  await Promise.all([
    copyFile(sourceWeights, join(comfyAdapterDirectory, "adapter_model.safetensors")),
    copyFile(sourceConfig, join(comfyAdapterDirectory, "adapter_config.json")),
  ]);
  const file = await stat(retainedWeights);
  return {
    upstreamId: `ace-step:${job.id}`,
    localFile: {
      relativePath: `${relativeDirectory.replaceAll("\\", "/")}/adapter_model.safetensors`,
      format: "safetensors",
      sha256: await sha256File(retainedWeights),
      size: file.size,
    },
    evaluation: {
      schemaVersion: "creative-studio-model-adapter-evaluation/1.0",
      datasetItems: job.dataset.items.length,
      captionedItems: job.dataset.items.filter((item) => String(item.caption || "").trim()).length,
      validationPromptCount: 0,
      notes: [
        "ACE-Step 1.5 corrected LoRA training completed from review-authorized captions and lyrics.",
        "Checkpoint requires explicit Creative Studio approval before it can become the active project music adapter.",
        "No validation generation has been scored yet; run a controlled song comparison before production use.",
      ],
    },
  };
}
