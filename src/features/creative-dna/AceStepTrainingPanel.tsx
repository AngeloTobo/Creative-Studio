import { useMemo, useState } from "react";
import { modelTrainingRecipe, type ModelTrainingDatasetItem, type ModelTrainingPreset } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

const PRESETS: ModelTrainingPreset[] = ["proof", "balanced", "deep"];

function triggerFromName(value: string) {
  const base = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 36);
  return /^[a-z]/.test(base) && base.length >= 3 ? `cs_${base}`.slice(0, 48) : "cs_music_style";
}

function stageLabel(value: string) {
  return value.replaceAll("-", " ");
}

function DatasetReview({ jobId, sourceItems }: { jobId: string; sourceItems: ModelTrainingDatasetItem[] }) {
  const { busy, reviewModelTrainingDataset } = useStudio();
  const [items, setItems] = useState(sourceItems);
  const [note, setNote] = useState("");
  const patch = (assetId: string, values: Partial<ModelTrainingDatasetItem>) => setItems((current) => current.map((item) => item.assetId === assetId ? { ...item, ...values } : item));
  const valid = note.trim().length > 0 && items.every((item) => item.caption.trim().length >= 20 && (item.isInstrumental || item.lyrics.trim().length >= 4));
  return <div className="ace-dataset-review">
    <header><span><strong>Review what ACE-Step will learn</strong><small>Nothing trains until every caption and lyric field is approved.</small></span><b>{items.length} tracks</b></header>
    <div className="ace-dataset-items">{items.map((item, index) => <article key={item.assetId}>
      <div className="ace-dataset-title"><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.fileName}</strong><small>{Math.round(item.durationSeconds)}s</small></div>
      <label className="field"><span>Music caption</span><textarea className="input" value={item.caption} onChange={(event) => patch(item.assetId, { caption: event.target.value, captionSource: "owner-edited" })} /></label>
      <label className="ace-instrumental"><input type="checkbox" checked={item.isInstrumental} onChange={(event) => patch(item.assetId, { isInstrumental: event.target.checked, lyrics: event.target.checked ? "[Instrumental]" : "" })} /><span>Instrumental</span></label>
      {!item.isInstrumental ? <label className="field"><span>Verified lyrics with section tags</span><textarea className="input" value={item.lyrics} onChange={(event) => patch(item.assetId, { lyrics: event.target.value })} placeholder="[Verse]\nVerified lyrics only…" /></label> : null}
      <small className="ace-grounding-note">BPM and key stay empty unless you verify them; Gemma is not allowed to invent them.</small>
    </article>)}</div>
    <div className="ace-review-action"><label className="field"><span>Dataset approval note</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Captions and lyrics verified against the selected recordings." /></label><button className="btn btn-primary" disabled={busy || !valid} onClick={() => void reviewModelTrainingDataset(jobId, { items: items.map(({ assetId, caption, lyrics, isInstrumental }) => ({ assetId, caption, lyrics, isInstrumental })), note })}><Icon name="check" size={16} /> Approve dataset &amp; train</button></div>
  </div>;
}

export function AceStepTrainingPanel({ onMedia }: { onMedia: () => void }) {
  const { snapshot, activeProjectId, activeDna, busy, error, startModelTraining, cancelModelTraining, reviewModelAdapter } = useStudio();
  const audio = useMemo(() => snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId && asset.kind === "audio" && asset.trainingEligible) ?? [], [activeProjectId, snapshot?.mediaAssets]);
  const jobs = snapshot?.modelTrainingJobs.filter((job) => job.projectId === activeProjectId) ?? [];
  const adapters = snapshot?.modelAdapters.filter((adapter) => adapter.projectId === activeProjectId) ?? [];
  const capability = snapshot?.capabilities.find((item) => item.key === "model-adapter-training");
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [preset, setPreset] = useState<ModelTrainingPreset>("balanced");
  const [instrumental, setInstrumental] = useState(true);
  const [reviewNote, setReviewNote] = useState("");
  const recipe = modelTrainingRecipe("music-style", preset);
  const selectedIds = selected.filter((id) => audio.some((asset) => asset.id === id));
  const canStart = selectedIds.length >= recipe.dataset.minimumItems && name.trim().length >= 2 && description.trim().length >= 20;
  const pendingDataset = jobs.find((job) => job.status === "waiting-for-review" && job.stage === "dataset-review" && job.dataset);
  const pendingAdapter = adapters.find((adapter) => adapter.status === "review-required");

  const start = async () => {
    await startModelTraining({
      dnaArtifactId: activeDna?.artifactId ?? null,
      name: name.trim(),
      target: "music-style",
      triggerToken: triggerFromName(name),
      description: description.trim(),
      continuityRules: rules.split("\n").map((line) => line.trim()).filter(Boolean),
      preset,
      assetIds: selectedIds,
      instrumental,
    });
    setSelected([]);
  };

  return <section className="ace-training glass" aria-labelledby="ace-training-title">
    <header className="ace-training-head">
      <div><span className="eyebrow">Actual model training</span><h2 id="ace-training-title">Train an ACE-Step music style</h2><p>Select consented songs, review music-specific captions, then let the RTX 3090 build a reusable LoRA checkpoint locally.</p></div>
      <span className={`ace-runtime ${capability?.state ?? "unavailable"}`}><i /> {capability?.state === "available" ? "ACE-Step ready" : "Setup required"}</span>
    </header>
    {capability?.state !== "available" ? <div className="ace-runtime-callout"><Icon name="runtime" size={19} /><span><strong>Training is honest about readiness.</strong><small>{capability?.detail ?? "Pair the Local Runner and install ACE-Step 1.5 Base checkpoints."}</small></span></div> : null}

    <div className="ace-builder">
      <div className="ace-audio-picker">
        <div className="training-section-head"><span><strong>Choose recordings</strong><small>{selectedIds.length} selected · 3 minimum</small></span><button className="link-btn" onClick={onMedia}>Upload audio</button></div>
        {audio.length ? <div className="ace-audio-grid">{audio.map((asset) => <article key={asset.id} className={selectedIds.includes(asset.id) ? "selected" : ""}>
          <button className="ace-audio-select" onClick={() => setSelected((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])} aria-pressed={selectedIds.includes(asset.id)}><span><Icon name={selectedIds.includes(asset.id) ? "check" : "music"} size={17} /></span><strong>{asset.name}</strong><small>{(asset.size / 1_048_576).toFixed(1)} MB</small></button>
          <audio controls preload="metadata" src={asset.contentUrl} />
        </article>)}</div> : <div className="training-empty"><Icon name="music" size={24} /><span><strong>No consented audio yet.</strong><small>Upload at least three songs or stems and keep training consent enabled.</small></span><button className="btn btn-ghost" onClick={onMedia}>Upload</button></div>}
      </div>

      <div className="ace-config">
        <label className="field"><span>Style name</span><input className="input" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Rebecca nocturnal electronics" /></label>
        <label className="field"><span>What should the LoRA learn?</span><textarea className="input" value={description} maxLength={1200} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the recurring musical identity, production language, vocals, rhythm, harmony, and emotional behavior." /></label>
        <label className="field"><span>Musical invariants · one per line</span><textarea className="input compact" value={rules} onChange={(event) => setRules(event.target.value)} placeholder={"Tactile sub-bass beneath brittle percussion\nOne controlled harmonic rupture"} /></label>
        <label className="ace-instrumental"><input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} /><span>All selected files are instrumental</span></label>
        <div className="ace-presets">{PRESETS.map((value) => { const option = modelTrainingRecipe("music-style", value); return <button key={value} className={preset === value ? "selected" : ""} onClick={() => setPreset(value)}><strong>{value}</strong><span>Rank {option.optimization.rank} · {option.optimization.epochs} epochs</span><small>{option.estimate.minimumMinutes}–{option.estimate.maximumMinutes} min estimate</small></button>; })}</div>
        <div className="ace-start-summary"><span><small>Trigger</small><code>{triggerFromName(name)}</code></span><span><small>Base</small><b>ACE-Step 1.5 Base</b></span></div>
        <button className="btn btn-primary training-start" disabled={busy || !canStart || snapshot?.adapter.id === "development-local-storage"} onClick={() => void start()}><Icon name="dna" size={17} /> Prepare reviewed dataset</button>
        <p className="training-boundary">First Gemma captions the audio. You approve those captions and any lyrics before GPU training starts.</p>
      </div>
    </div>

    {pendingDataset?.dataset ? <DatasetReview key={pendingDataset.id} jobId={pendingDataset.id} sourceItems={pendingDataset.dataset.items} /> : null}

    {pendingAdapter ? <div className="ace-adapter-review">
      <div><span className="eyebrow">Checkpoint review</span><h3>{pendingAdapter.name}</h3><p>{pendingAdapter.evaluation.notes.join(" ")}</p><dl><div><dt>Dataset</dt><dd>{pendingAdapter.evaluation.datasetItems} tracks</dd></div><div><dt>LoRA</dt><dd>Rank {pendingAdapter.recipe.optimization.rank}</dd></div><div><dt>File</dt><dd>{(pendingAdapter.localFile.size / 1_048_576).toFixed(1)} MB</dd></div><div><dt>Hash</dt><dd><code>{pendingAdapter.localFile.sha256.slice(0, 12)}</code></dd></div></dl></div>
      <label className="field"><span>Decision note</span><textarea className="input" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Describe the validation songs you compared and what this adapter preserves." /></label>
      <div><button className="btn btn-ghost" disabled={busy || !reviewNote.trim()} onClick={() => void reviewModelAdapter(pendingAdapter.id, "rejected", reviewNote)}>Reject</button><button className="btn btn-primary" disabled={busy || !reviewNote.trim()} onClick={() => void reviewModelAdapter(pendingAdapter.id, "approved", reviewNote)}><Icon name="check" size={15} /> Activate for this project</button></div>
    </div> : null}

    <div className="ace-jobs">
      <div className="training-section-head"><span><strong>ACE-Step runs</strong><small>Newest first · durable without an open browser</small></span></div>
      {jobs.slice(0, 5).map((job) => <article key={job.id}><span className={`training-status-dot ${job.status}`} /><span><strong>{job.name}</strong><small>{stageLabel(job.stage)} · {job.assetIds.length} tracks · {job.recipe.preset}</small></span><b>{job.progress}%</b>{["waiting-for-runner", "waiting-for-review", "running"].includes(job.status) ? <button className="link-btn" disabled={busy} onClick={() => void cancelModelTraining(job.id)}>Cancel</button> : <small>{job.error || stageLabel(job.status)}</small>}</article>)}
      {!jobs.length ? <p className="empty-copy">No ACE-Step training runs yet.</p> : null}
    </div>
    {error ? <div className="inline-error" role="alert">{error}</div> : null}
  </section>;
}
