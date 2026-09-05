import { useState } from "react";
import type { ModelTrainingJob, ModelTrainingPreset } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import "./ImageStyleTrainingPanel.css";

function ImageDatasetReview({ job }: { job: ModelTrainingJob }) {
  const { snapshot, busy, reviewModelTrainingDataset } = useStudio();
  const [items, setItems] = useState(job.dataset!.items);
  const [note, setNote] = useState("");
  return <div className="ace-dataset-review"><h3>Review the image captions</h3><p>Describe the subject in each image. Keep your style trigger in the caption. Training begins only when you approve this dataset.</p>
    <div className="image-caption-list">{items.map((item) => {
      const source = snapshot?.mediaAssets.find((asset) => asset.id === item.assetId && asset.projectId === job.projectId);
      return <div className="image-caption-card" key={item.assetId}>
        <div className="image-caption-preview">{source?.contentUrl ? <img src={source.contentUrl} alt={`Artwork for ${item.fileName}`} loading="lazy" /> : <span>Preview unavailable</span>}</div>
        <label className="field"><span>{item.fileName}</span><textarea className="input" aria-label={`Caption for ${item.fileName}`} value={item.caption} onChange={(event) => setItems((current) => current.map((value) => value.assetId === item.assetId ? { ...value, caption: event.target.value } : value))} /></label>
      </div>;
    })}</div>
    <label className="field"><span>Approval note</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="I checked these captions against my artwork." /></label>
    <button className="btn btn-primary" disabled={busy || !note.trim() || items.some((item) => item.caption.trim().length < 20)} onClick={() => void reviewModelTrainingDataset(job.id, { items, note })}>Approve dataset &amp; train locally</button>
  </div>;
}
export function ImageStyleTrainingPanel({ onMedia }: { onMedia: () => void }) {
  const { snapshot, activeProjectId, busy, startModelTraining, cancelModelTraining, reviewModelAdapter, error } = useStudio();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState<ModelTrainingPreset>("proof");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const images = snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId && asset.kind === "image" && asset.trainingEligible) ?? [];
  const selectedIds = selected.filter((id) => images.some((image) => image.id === id));
  const jobs = snapshot?.modelTrainingJobs.filter((job) => job.projectId === activeProjectId && job.target === "image-style") ?? [];
  const adapters = snapshot?.modelAdapters.filter((adapter) => adapter.projectId === activeProjectId && adapter.target === "image-style") ?? [];
  const ready = snapshot?.runners.some((runner) => runner.state === "online" && runner.modelTrainingProviders.includes("comfy-sd15-lora"));
  const active = jobs.find((job) => ["waiting-for-runner", "running", "waiting-for-review"].includes(job.status));
  const pending = adapters.find((adapter) => adapter.status === "review-required");
  const start = async () => {
    await startModelTraining({ name: name.trim(), description: description.trim(), target: "image-style", triggerToken: `cs_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 35)}`, assetIds: selectedIds, preset, instrumental: true });
    setConsent(false);
  };
  return <section className="ace-training image-style-training glass" aria-labelledby="image-style-title">
    <header className="ace-training-head"><div><h2 id="image-style-title">Train your art style</h2><p>Choose your artwork, review captions, then train a local image LoRA. Your browser can close while the PC works.</p></div><span className="state-pill">{ready ? "Local trainer ready" : "Trainer setup required"}</span></header>
    <details className="image-training-runtime"><summary>Local training details</summary><p>Stable Diffusion 1.5 · 512 px · rank 8 · one image at a time. Native ComfyUI training is experimental; this trains real weights and needs a visual review afterward.</p>
      {!ready && <p>The Runner checks the SD1.5 checkpoint, native training nodes, and local input/output/model folders. Queued work waits until they are available.</p>}
    </details>
    {active ? <div role="status"><strong>{active.name}</strong><p>{active.stage.replaceAll("-", " ")} · {active.progress}%</p><button className="btn" disabled={busy} onClick={() => void cancelModelTraining(active.id)}>Cancel this run</button></div> : <>
      <label className="field"><span>Style name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="My painted worlds" /></label>
      <label className="field"><span>What should it learn?</span><textarea className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the colors, marks, materials, and atmosphere shared by your work." /></label>
      <fieldset className="image-training-selection"><legend>Choose your artwork</legend>
        <div className="image-training-selection-head"><p>Choose 3–40 images with training consent.</p><strong role="status" aria-live="polite">{selectedIds.length} selected / {images.length} available</strong></div>
        {images.length ? <div className="image-training-grid" role="group" aria-label="Artwork for style training">{images.map((asset) => <label className={`image-training-tile${selectedIds.includes(asset.id) ? " selected" : ""}`} key={asset.id}>
          <span className="image-training-preview">{asset.contentUrl ? <img src={asset.contentUrl} alt="" loading="lazy" /> : <span>Preview unavailable</span>}</span>
          <span className="image-training-tile-label"><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><span title={asset.name}>{asset.name}</span></span>
        </label>)}</div> : <p>No training-consented images in this project yet.</p>}
        <button type="button" className="btn" onClick={onMedia}>Add or review artwork</button>
      </fieldset>
      <label className="field"><span>Training depth</span><select className="input" value={preset} onChange={(event) => setPreset(event.target.value as ModelTrainingPreset)}><option value="proof">Quick proof · 100 steps</option><option value="balanced">Balanced · 500 steps</option><option value="deep">Deep · 1,500 steps</option></select></label>
      <label className="ace-instrumental"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I own or have training rights to these selected images and authorize preparing this dataset.</span></label>
      <button className="btn btn-primary" disabled={busy || !consent || selectedIds.length < 3 || selectedIds.length > 40 || name.trim().length < 2 || description.trim().length < 20 || snapshot?.adapter.id === "development-local-storage"} onClick={() => void start()}>Prepare {selectedIds.length} selected images</button>
    </>}
    {active?.stage === "dataset-review" && active.dataset && <ImageDatasetReview key={active.id} job={active} />}
    {pending && <div className="ace-dataset-review"><h3>Checkpoint ready for your review</h3><p>{pending.name} · {Math.round(pending.localFile.size / 1024 / 1024)} MB · No validation images have been generated yet.</p><label className="field"><span>Review note</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => void reviewModelAdapter(pending.id, "approved", note)}>Activate image style</button><button className="btn" disabled={busy || !note.trim()} onClick={() => void reviewModelAdapter(pending.id, "rejected", note)}>Reject checkpoint</button></div>}
    {jobs.filter((job) => job.status === "failed").slice(0, 3).map((job) => <p role="alert" key={job.id}>{job.name}: {job.error}</p>)}
    {adapters.filter((adapter) => adapter.status === "active").map((adapter) => <p key={adapter.id}>Active image style: <strong>{adapter.name}</strong></p>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
