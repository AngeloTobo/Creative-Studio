import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { modelTrainingRecipe } from "../../shared/contracts";
// @ts-expect-error Node runner module is tested directly without a browser declaration.
import { buildImageTrainingGraph, prepareImageDataset } from "../../runner/imageStyleTraining.mjs";

function job() {
  return { id: "modeltrain_test", provider: "comfy-sd15-lora", recipe: modelTrainingRecipe("image-style", "proof"), concept: { triggerToken: "cs_style", description: "Rich pigment on a rough linen surface." }, dataset: { reviewedAt: "2026-09-05", items: [] } };
}
describe("image style training", () => {
  it("requires owner-reviewed captions before it builds a GPU graph", () => {
    expect(() => buildImageTrainingGraph({ ...job(), dataset: null }, "dataset")).toThrow("image_training_review_required");
    expect(() => buildImageTrainingGraph({ ...job(), id: "../escape" }, "dataset")).toThrow("image_training_job_id_invalid");
  });
  it("pins installed SD1.5 and a bounded memory-saving training recipe", () => {
    const graph = buildImageTrainingGraph(job(), "creative-studio-training-modeltrain_test");
    expect(graph["1"].inputs.ckpt_name).toBe("v1-5-pruned-emaonly-fp16.safetensors");
    expect(graph["4"].inputs).toMatchObject({ steps: 100, batch_size: 1, rank: 8, gradient_checkpointing: true, offloading: true });
    expect(graph["5"].inputs.prefix).toBe("creative-studio-training/modeltrain_test/adapter");
    expect(graph["3"].inputs.texts).toEqual(["2", 1]);
  });
  it("prepares explicit source IDs without claiming that descriptions were machine-observed", () => {
    const dataset = prepareImageDataset({ modelTrainingJob: job(), assets: [{ id: "art1", name: "Painting" }] });
    expect(dataset.reviewedAt).toBeNull();
    expect(dataset.items[0]).toMatchObject({ assetId: "art1", captionSource: "owner-edited" });
  });
  it("preserves music jobs, adapter review foreign keys, and indexes while enabling images", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("create table creative_projects (id text, owner_id text, unique(id, owner_id)); create table creative_runners (id text); insert into creative_projects values ('p', 'o');");
      db.exec(readFileSync("migrations/0013_real_model_adapter_training.sql", "utf8"));
      db.exec(`insert into creative_model_training_jobs (id,owner_id,project_id,name,target,provider,concept_json,recipe_json,asset_ids_json,status,stage,idempotency_key,created_at,updated_at) values ('j','o','p','Music','music-style','ace-step-1.5-lora','{}','{}','[]','completed','completed','k','now','now');
        insert into creative_model_adapters (id,owner_id,project_id,training_job_id,name,target,provider,status,concept_json,recipe_json,local_file_json,evaluation_json,created_at,updated_at) values ('a','o','p','j','Music','music-style','ace-step-1.5-lora','active','{}','{}','{}','{}','now','now');
        insert into creative_model_adapter_reviews values ('r','o','p','j','a','approved','good','angelo','now');`);
      db.exec("begin");
      db.exec(readFileSync("migrations/0026_image_style_training.sql", "utf8"));
      db.exec("commit");
      expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
      expect(db.prepare("select id from creative_model_adapter_reviews").all()).toEqual([{ id: "r" }]);
      expect(db.prepare("select status from creative_model_adapters").get()).toEqual({ status: "active" });
      expect(db.prepare("select name from sqlite_master where type='index' and name='idx_cs_model_training_owner_idempotency'").get()).toBeTruthy();
      db.exec("update creative_model_training_jobs set target='image-style', provider='comfy-sd15-lora' where id='j'");
    } finally { db.close(); }
  });
});
