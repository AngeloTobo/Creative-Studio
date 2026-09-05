/** A small, reproducible SD1.5 graph. Strength stays zero until the approved adapter is bound. */
export function imageStyleWorkflowGraph(relativePath: string, triggerToken: string) {
  if (!/^creative-studio\/modeltrain_[a-z0-9]+\/adapter_model\.safetensors$/i.test(relativePath)) throw new Error("image_adapter_path_invalid");
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "v1-5-pruned-emaonly-fp16.safetensors" } },
    "2": { class_type: "LoraLoader", inputs: { model: ["1", 0], clip: ["1", 1], lora_name: relativePath, strength_model: 0, strength_clip: 0 } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: `${triggerToken}, an original artwork` } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: "" } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { model: ["2", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0], seed: 42, steps: 20, cfg: 7, sampler_name: "euler", scheduler: "normal", denoise: 1 } },
    "7": { class_type: "VAEDecode", inputs: { samples: ["6", 0], vae: ["1", 2] } },
    "8": { class_type: "SaveImage", inputs: { images: ["7", 0], filename_prefix: "CreativeStudio/Style" } },
  };
}
