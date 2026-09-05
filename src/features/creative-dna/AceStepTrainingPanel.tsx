import { useMemo, useRef, useState } from "react";
import { modelTrainingRecipe, type ModelTrainingDatasetItem, type ModelTrainingPreset } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

const PRESETS: ModelTrainingPreset[] = ["proof", "balanced", "deep"];
const AUDIO_ACCEPT = "audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,audio/aac,audio/opus,.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus";
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

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
      {!item.isInstrumental ? <label className="field"><span>Local transcript draft · verify or edit</span><textarea className="input" value={item.lyrics} onChange={(event) => patch(item.assetId, { lyrics: event.target.value })} placeholder="[Verse]\nCheck the local Whisper draft against the recording…" /></label> : null}
      <small className="ace-grounding-note">BPM and key stay empty unless you verify them; Gemma is not allowed to invent them.</small>
    </article>)}</div>
    <div className="ace-review-action"><label className="field"><span>Dataset approval note</span><input className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Captions and lyrics verified against the selected recordings." /></label><button className="btn btn-primary" disabled={busy || !valid} onClick={() => void reviewModelTrainingDataset(jobId, { items: items.map(({ assetId, caption, lyrics, isInstrumental }) => ({ assetId, caption, lyrics, isInstrumental })), note })}><Icon name="check" size={16} /> Approve dataset &amp; train</button></div>
  </div>;
}

export function AceStepTrainingPanel({ onMedia, initialAssetIds = [] }: { onMedia: () => void; initialAssetIds?: string[] }) {
  const { snapshot, activeProjectId, activeDna, busy, error, uploadMedia, startModelTraining, cancelModelTraining, reviewModelAdapter } = useStudio();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const audio = useMemo(() => (snapshot?.mediaAssets
    .filter((asset) => asset.projectId === activeProjectId && asset.kind === "audio" && asset.trainingEligible) ?? [])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)), [activeProjectId, snapshot?.mediaAssets]);
  const jobs = snapshot?.modelTrainingJobs.filter((job) => job.projectId === activeProjectId && job.target === "music-style") ?? [];
  const adapters = snapshot?.modelAdapters.filter((adapter) => adapter.projectId === activeProjectId && adapter.target === "music-style") ?? [];
  const capability = snapshot?.capabilities.find((item) => item.key === "model-adapter-training");
  const project = snapshot?.projects.find((item) => item.id === activeProjectId) ?? null;
  const [selected, setSelected] = useState<string[]>(initialAssetIds);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [preset, setPreset] = useState<ModelTrainingPreset>("proof");
  const [instrumental, setInstrumental] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [localError, setLocalError] = useState("");
  const recipe = modelTrainingRecipe("music-style", preset);
  const explicitSelectedIds = selected.filter((id) => audio.some((asset) => asset.id === id));
  const selectedIds = explicitSelectedIds.length ? explicitSelectedIds : audio.slice(0, 3).map((asset) => asset.id);
  const selectionSource = explicitSelectedIds.length ? "chosen recordings" : "newest selected automatically";
  const effectiveName = name.trim() || `${project?.name || "Creative Studio"} music LoRA`;
  const effectiveDescription = description.trim() || "Learn the recurring musical production, vocal space, rhythm, harmony, dynamics, texture, and arrangement shared across these consented recordings without retaining artist identity.";
  const canStart = selectedIds.length >= recipe.dataset.minimumItems;
  const pendingDataset = jobs.find((job) => job.status === "waiting-for-review" && job.stage === "dataset-review" && job.dataset);
  const pendingAdapter = adapters.find((adapter) => adapter.status === "review-required");
  const activeRun = jobs.find((job) => ["waiting-for-runner", "waiting-for-review", "running"].includes(job.status));
  const activeAdapter = adapters.find((adapter) => adapter.status === "active");
  const modelStep = activeAdapter
    ? 4
    : pendingAdapter
      ? 3
      : activeRun && /train|checkpoint|evaluate/i.test(activeRun.stage)
        ? 2
        : pendingDataset || activeRun
          ? 1
          : 0;

  const start = async (assetIds = selectedIds) => {
    await startModelTraining({
      dnaArtifactId: activeDna?.artifactId ?? null,
      name: effectiveName,
      target: "music-style",
      triggerToken: triggerFromName(effectiveName),
      description: effectiveDescription,
      continuityRules: rules.split("\n").map((line) => line.trim()).filter(Boolean),
      preset,
      assetIds,
      instrumental,
    });
    setSelected([]);
  };

  const uploadAndStart = async (files: FileList | null) => {
    setLocalError("");
    if (!files?.length || snapshot?.adapter.id === "development-local-storage") return;
    const chosen = Array.from(files);
    if (chosen.some((file) => file.size > MAX_AUDIO_BYTES)) {
      setLocalError("Each recording must be 100 MB or smaller.");
      return;
    }
    if (chosen.some((file) => !file.type.startsWith("audio/") && !/\.(?:mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(file.name))) {
      setLocalError("Choose MP3, WAV, FLAC, OGG, M4A, AAC, or Opus audio files.");
      return;
    }
    try {
      const uploaded = [];
      for (const file of chosen) uploaded.push(await uploadMedia(file, true));
      const nextIds = [...new Set([...selectedIds, ...uploaded.map((asset) => asset.id)])];
      setSelected(nextIds);
      if (nextIds.length >= recipe.dataset.minimumItems) await start(nextIds);
      else {
        const needed = recipe.dataset.minimumItems - nextIds.length;
        setLocalError(`${needed} more recording${needed === 1 ? "" : "s"} needed; the uploaded audio is selected and retained.`);
      }
    } catch {
      // The provider exposes the normalized upload or training error.
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  return <section className="ace-training glass" aria-labelledby="ace-training-title">
    <header className="ace-training-head">
      <div><span className="eyebrow">Real model weights</span><h2 id="ace-training-title">Train a music LoRA</h2><p>Choose three recordings. ACE-Step trains locally and keeps the run durable when this browser closes.</p></div>
      <span className={`ace-runtime ${capability?.state ?? "unavailable"}`}><i /> {capability?.state === "available" ? "ACE-Step ready" : "Setup required"}</span>
    </header>
    <ol className="training-steps" aria-label="Music model training progress">{["Sources", "Captions", "Training", "Activate"].map((label, index) => <li key={label} className={index < modelStep ? "complete" : index === modelStep ? "current" : ""}><span>{index < modelStep ? <Icon name="check" size={11} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>
    {capability?.state !== "available" ? <div className="ace-runtime-callout"><Icon name="runtime" size={19} /><span><strong>Training is honest about readiness.</strong><small>{capability?.detail ?? "Pair the Local Runner and install ACE-Step 1.5 Base checkpoints."}</small></span></div> : null}
    <div className="ace-primary-action"><div className="ace-proof-ready"><span><Icon name="dna" size={19} /></span><div><strong>{canStart ? `${selectedIds.length} tracks ready` : `${recipe.dataset.minimumItems - selectedIds.length} more needed`}</strong><small>{effectiveName} · {recipe.estimate.minimumMinutes}–{recipe.estimate.maximumMinutes} min local estimate</small></div></div><button className="btn btn-primary training-start" disabled={busy || !canStart || Boolean(activeRun) || snapshot?.adapter.id === "development-local-storage"} onClick={() => void start()}><Icon name="dna" size={17} /> {activeRun ? "Training run in progress" : `Train ${selectedIds.length} selected tracks`}</button></div>

    <div className="ace-builder">
      <div className="ace-audio-picker">
        <div className="training-section-head"><span><strong>Your recordings</strong><small>{selectedIds.length} selected · 3 minimum · {selectionSource}</small></span><div className="ace-audio-actions"><input ref={uploadInputRef} type="file" multiple accept={AUDIO_ACCEPT} disabled={busy || snapshot?.adapter.id === "development-local-storage"} onChange={(event) => void uploadAndStart(event.target.files)} /><button className="btn btn-ghost" disabled={busy || snapshot?.adapter.id === "development-local-storage"} onClick={() => uploadInputRef.current?.click()}><Icon name="plus" size={14} /> Upload &amp; start</button><button className="link-btn" onClick={onMedia}>Library</button></div></div>
        {audio.length ? <div className="ace-audio-grid">{audio.map((asset) => <article key={asset.id} className={selectedIds.includes(asset.id) ? "selected" : ""}>
          <button className="ace-audio-select" onClick={() => setSelected((current) => {
            const valid = current.filter((id) => audio.some((item) => item.id === id));
            const effective = valid.length ? valid : audio.slice(0, 3).map((item) => item.id);
            return effective.includes(asset.id) ? effective.filter((id) => id !== asset.id) : [...effective, asset.id];
          })} aria-pressed={selectedIds.includes(asset.id)}><span><Icon name={selectedIds.includes(asset.id) ? "check" : "music"} size={17} /></span><strong>{asset.name}</strong><small>{(asset.size / 1_048_576).toFixed(1)} MB</small></button>
          <audio controls preload="none" src={asset.contentUrl} />
        </article>)}</div> : <div className="training-empty"><Icon name="music" size={24} /><span><strong>No consented audio yet.</strong><small>Select three or more songs; upload and dataset preparation begin in this panel.</small></span><button className="btn btn-ghost" onClick={() => uploadInputRef.current?.click()}>Choose songs</button></div>}
      </div>

      <div className="ace-config">
        <p className="training-boundary">Gemma drafts grounded captions; local Whisper drafts lyrics. You approve both before GPU training.</p>
        <details className="ace-training-options"><summary><span>Training options</span><small>{preset} · {instrumental ? "instrumental" : "vocals + local transcript"}</small></summary><div>
          <label className="field"><span>Style name</span><input className="input" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder={effectiveName} /></label>
          <label className="field"><span>What should the LoRA learn?</span><textarea className="input" value={description} maxLength={1200} onChange={(event) => setDescription(event.target.value)} placeholder={effectiveDescription} /></label>
          <label className="field"><span>Musical invariants · one per line</span><textarea className="input compact" value={rules} onChange={(event) => setRules(event.target.value)} placeholder={"Tactile sub-bass beneath brittle percussion\nOne controlled harmonic rupture"} /></label>
          <label className="ace-instrumental"><input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} /><span>All selected files are instrumental</span></label>
          <div className="ace-presets">{PRESETS.map((value) => { const option = modelTrainingRecipe("music-style", value); return <button key={value} className={preset === value ? "selected" : ""} onClick={() => setPreset(value)}><strong>{value}</strong><span>Rank {option.optimization.rank} · {option.optimization.epochs} epochs</span><small>{option.estimate.minimumMinutes}–{option.estimate.maximumMinutes} min estimate</small></button>; })}</div>
          <div className="ace-start-summary"><span><small>Trigger</small><code>{triggerFromName(effectiveName)}</code></span><span><small>Base</small><b>ACE-Step 1.5 Base</b></span></div>
        </div></details>
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
    {localError || error ? <div className="inline-error" role="alert">{localError || error}</div> : null}
  </section>;
}
