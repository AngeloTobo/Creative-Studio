import { constants } from "node:fs";
import { mkdir, readFile, writeFile, readdir, copyFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";

export const IMAGE_TRAINING_PROVIDER = "comfy-sd15-lora";
export const IMAGE_TRAINING_CHECKPOINT = "v1-5-pruned-emaonly-fp16.safetensors";
const REQUIRED_NODES = ["CheckpointLoaderSimple", "LoadImageTextDataSetFromFolder", "MakeTrainingDataset", "TrainLoraNode", "SaveLoRA"];
export function imageTrainingPaths() {
  return {
    input: process.env.CS_COMFY_INPUT_DIR || join(homedir(), "Documents", "ComfyUI", "input"),
    output: process.env.CS_COMFY_OUTPUT_DIR || join(homedir(), "Documents", "ComfyUI", "output"),
    loras: process.env.CS_COMFY_LORA_DIR || join(homedir(), "ComfyUI-Shared", "models", "loras"),
    retained: join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Creative Studio Runner", "adapters"),
  };
}
export async function detectImageTrainingRuntime(config) {
  try {
    const response = await fetch(`${config.comfyUrl}/object_info`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("image_training_comfy_unavailable");
    const info = await response.json();
    for (const name of REQUIRED_NODES) if (!info[name]) throw new Error(`image_training_node_missing:${name}`);
    if (!info.CheckpointLoaderSimple.input.required.ckpt_name[0].includes(IMAGE_TRAINING_CHECKPOINT)) throw new Error("image_training_sd15_checkpoint_missing");
    const paths = imageTrainingPaths();
    await Promise.all([access(paths.input, constants.W_OK), access(paths.output, constants.W_OK), access(paths.loras, constants.W_OK)]);
    return { available: true, reason: null };
  } catch (error) { return { available: false, reason: error.message }; }
}
function safeJobId(id) {
  if (!/^[a-z0-9_-]{1,100}$/i.test(id)) throw new Error("image_training_job_id_invalid");
  return id;
}
export function buildImageTrainingGraph(job, folder) {
  safeJobId(job.id);
  if (job.provider !== IMAGE_TRAINING_PROVIDER || job.recipe.baseModel.file !== IMAGE_TRAINING_CHECKPOINT || !job.dataset?.reviewedAt) throw new Error("image_training_review_required");
  const o = job.recipe.optimization;
  if (![100, 500, 1500].includes(o.steps) || o.rank !== 8 || o.resolution !== 512) throw new Error("image_training_recipe_invalid");
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: IMAGE_TRAINING_CHECKPOINT } },
    "2": { class_type: "LoadImageTextDataSetFromFolder", inputs: { folder } },
    "3": { class_type: "MakeTrainingDataset", inputs: { images: ["2", 0], texts: ["2", 1], vae: ["1", 2], clip: ["1", 1] } },
    "4": { class_type: "TrainLoraNode", inputs: { model: ["1", 0], latents: ["3", 0], positive: ["3", 1], batch_size: 1, grad_accumulation_steps: 4, steps: o.steps, learning_rate: 0.0001, rank: 8, optimizer: "AdamW", loss_function: "MSE", seed: 42, training_dtype: "bf16", lora_dtype: "bf16", quantized_backward: false, algorithm: "LoRA", gradient_checkpointing: true, checkpoint_depth: 1, offloading: true, existing_lora: "[None]", bucket_mode: false, bypass_mode: false } },
    "5": { class_type: "SaveLoRA", inputs: { lora: ["4", 0], steps: ["4", 2], prefix: `creative-studio-training/${job.id}/adapter` } },
  };
}
export function prepareImageDataset(bundle) {
  const job = bundle.modelTrainingJob;
  return { schemaVersion: "creative-studio-image-dataset/1.0", preparedAt: new Date().toISOString(), reviewedAt: null, reviewNote: null,
    items: bundle.assets.map((asset) => ({ assetId: asset.id, fileName: asset.originalFileName || asset.name, caption: `${job.concept.triggerToken}, ${job.concept.description}`, captionSource: "owner-edited", lyrics: "[Instrumental]", isInstrumental: true, durationSeconds: 1, bpm: null, keyscale: null })) };
}
export async function executeImageTraining(config, job, operations) {
  const runtime = await detectImageTrainingRuntime(config);
  if (!runtime.available) throw new Error(runtime.reason);
  const paths = imageTrainingPaths();
  const folder = `creative-studio-training-${safeJobId(job.id)}`;
  const graph = buildImageTrainingGraph(job, folder);
  const directory = join(paths.input, folder);
  // Reclaims after a crash never silently submit the same training a second time.
  const manifest = join(directory, "submitted.json");
  await mkdir(directory, { recursive: true });
  let submitted = null;
  try { submitted = JSON.parse(await readFile(manifest, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (submitted?.promptId === "submitting") throw new Error("image_training_submission_uncertain_review_comfy_history");
  for (let i = 0; i < job.dataset.items.length; i++) {
    const item = job.dataset.items[i];
    if (!job.assetIds.includes(item.assetId) || item.caption.trim().length < 20) throw new Error("image_training_dataset_invalid");
    const buffer = await operations.download(item.assetId);
    await sharp(buffer).rotate().resize(512, 512, { fit: "contain", background: "#ffffff" }).png().toFile(join(directory, `${i}.png`));
    await writeFile(join(directory, `${i}.txt`), `${job.concept.triggerToken}, ${item.caption}`, "utf8");
  }
  await writeFile(join(directory, "recipe.json"), JSON.stringify({ job, graph }, null, 2));
  let promptId = submitted?.promptId;
  if (!promptId) {
    await writeFile(manifest, JSON.stringify({ promptId: "submitting" }), { flag: "wx" });
    promptId = await operations.submit(graph);
    await writeFile(manifest, JSON.stringify({ promptId }));
  }
  try {
    const deadline = Date.now() + 6 * 60 * 60 * 1000;
    for (;;) {
      await operations.heartbeat(40, "training", promptId);
      const response = await fetch(`${config.comfyUrl}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`image_training_history_${response.status}`);
      const history = (await response.json())[promptId];
      if (history?.status?.status_str === "error") throw new Error(`image_training_comfy_failed:${JSON.stringify(history.status.messages).slice(-350)}`);
      if (history?.status?.completed) break;
      if (Date.now() > deadline) throw new Error("image_training_timeout");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  } catch (error) { await operations.cancelAndDrain(promptId); throw error; }
  await operations.heartbeat(92, "retaining", promptId);
  const output = join(paths.output, "creative-studio-training", job.id);
  const files = (await readdir(output)).filter((name) => /^adapter_\d+_steps_\d+_\.safetensors$/.test(name));
  if (files.length !== 1) throw new Error("image_training_checkpoint_missing_or_ambiguous");
  const source = join(output, files[0]);
  const relativePath = `creative-studio/${job.id}/adapter_model.safetensors`;
  const buffer = await readFile(source);
  if (!buffer.length) throw new Error("image_training_checkpoint_empty");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  for (const root of [paths.retained, paths.loras]) {
    const target = join(root, relativePath);
    await mkdir(join(root, "creative-studio", job.id), { recursive: true });
    try { await copyFile(source, target, constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== "EEXIST" || createHash("sha256").update(await readFile(target)).digest("hex") !== sha256) throw error; }
    await writeFile(join(root, "creative-studio", job.id, "training-provenance.json"), JSON.stringify({ job, graph, promptId, sha256 }, null, 2));
  }
  return { upstreamId: promptId, localFile: { relativePath, format: "safetensors", sha256, size: (await stat(source)).size }, evaluation: { schemaVersion: "creative-studio-model-adapter-evaluation/1.0", datasetItems: job.dataset.items.length, captionedItems: job.dataset.items.length, validationPromptCount: 0, notes: ["Native ComfyUI SD1.5 LoRA checkpoint retained. Training uses experimental nodes.", "No visual validation has been performed. Owner review is required before activation."] } };
}
