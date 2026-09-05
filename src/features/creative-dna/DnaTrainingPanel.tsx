import { ImageStyleTrainingPanel } from "./ImageStyleTrainingPanel";
import { useMemo, useRef, useState } from "react";
import type { CreativeDnaTarget } from "../../../shared/contracts";
import { creativeDnaCanGenerate, useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { TrainingReviewPanel } from "./TrainingReviewPanel";
import { AceStepTrainingPanel } from "./AceStepTrainingPanel";
import "./TrainingWorkspace.css";

const ACCEPTED_MEDIA = "image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/ogg,audio/mp4,video/mp4,video/webm,video/quicktime";
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

function statusLabel(status: string) {
  if (status === "waiting-for-runner") return "Waiting for local trainer";
  return status.replaceAll("-", " ");
}

type TrainingPath = "analyze" | "model" | "image-model";

export function DnaTrainingPanel({ onMedia, initialAssetIds = [], initialPath, reviewJobId, onReviewJobHandled }: { onMedia: () => void; initialAssetIds?: string[]; initialPath?: TrainingPath; reviewJobId?: string; onReviewJobHandled?: () => void }) {
  const { snapshot, activeProjectId, activeDna, uploadMedia, startDnaTraining, cancelDnaTraining, reviewDnaTraining, busy, error } = useStudio();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const eligibleAssets = useMemo(() => snapshot?.mediaAssets
    .filter((asset) => asset.projectId === activeProjectId && asset.trainingEligible) ?? [], [activeProjectId, snapshot?.mediaAssets]);
  const productionLoop = snapshot?.productionLoops.find((loop) => loop.projectId === activeProjectId) ?? null;
  const freshExampleIds = new Set(productionLoop?.freshTrainingExampleIds ?? []);
  const trainingExamples = snapshot?.trainingExamples
    .filter((example) => example.projectId === activeProjectId && example.status === "training-ready" && freshExampleIds.has(example.id)) ?? [];
  const jobs = snapshot?.trainingJobs.filter((job) => job.projectId === activeProjectId) ?? [];
  const [selected, setSelected] = useState<string[]>(initialAssetIds);
  const [name, setName] = useState("");
  const [targetModality, setTargetModality] = useState<CreativeDnaTarget>(activeDna?.targetModality ?? "image");
  const [includeExamples, setIncludeExamples] = useState(true);
  const [reviewingJobId, setReviewingJobId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const inferredInitialPath: TrainingPath = reviewJobId
    ? "analyze"
    : initialPath ?? (initialAssetIds.length >= 3 && initialAssetIds.every((assetId) => eligibleAssets.find((asset) => asset.id === assetId)?.kind === "audio") ? "model" : "analyze");
  const [path, setPath] = useState<TrainingPath>(inferredInitialPath);
  const selectedAssetIds = selected.filter((assetId) => eligibleAssets.some((asset) => asset.id === assetId));
  const uiOnlyDevelopment = snapshot?.adapter.id === "development-local-storage";
  const consentedAudioCount = eligibleAssets.filter((asset) => asset.kind === "audio").length;
  const modelActionCount = (snapshot?.modelTrainingJobs.filter((job) => job.projectId === activeProjectId && ["waiting-for-runner", "waiting-for-review", "running"].includes(job.status)).length ?? 0)
    + (snapshot?.modelAdapters.filter((adapter) => adapter.projectId === activeProjectId && adapter.status === "review-required").length ?? 0);

  const toggle = (assetId: string) => setSelected((current) => current.includes(assetId)
    ? current.filter((id) => id !== assetId)
    : [...current, assetId]);

  const chooseUpload = (file: File | null) => {
    setUploadError("");
    if (file && file.size > MAX_MEDIA_BYTES) {
      setUploadFile(null);
      setUploadError("Choose a file no larger than 100 MB.");
      return;
    }
    setUploadFile(file);
  };

  const uploadForTraining = async () => {
    if (!uploadFile || uiOnlyDevelopment) return;
    try {
      const asset = await uploadMedia(uploadFile, true);
      setSelected((current) => current.includes(asset.id) ? current : [...current, asset.id]);
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    } catch {
      // The provider exposes a normalized, visible error.
    }
  };

  const start = async () => {
    await startDnaTraining({
      baseDnaArtifactId: activeDna?.artifactId ?? null,
      name: name.trim() || (activeDna ? `${activeDna.name} trained` : "Upload-trained CreativeDNA"),
      targetModality,
      assetIds: selectedAssetIds,
      includeTrainingExamples: includeExamples,
    });
    setSelected([]);
    setName("");
  };

  const hasInputs = selectedAssetIds.length > 0 || (includeExamples && trainingExamples.length > 0);
  const effectiveReviewingJobId = reviewingJobId || reviewJobId || "";
  const reviewingJob = jobs.find((job) => job.id === effectiveReviewingJobId && job.status === "completed" && job.resultDnaArtifactId) ?? null;
  const reviewingArtifact = reviewingJob
    ? snapshot?.dnaArtifacts.find((artifact) => artifact.artifactId === reviewingJob.resultDnaArtifactId) ?? null
    : null;
  const reviewingBase = reviewingJob?.baseDnaArtifactId
    ? snapshot?.dnaArtifacts.find((artifact) => artifact.artifactId === reviewingJob.baseDnaArtifactId) ?? null
    : null;
  const reviewingDecisions = reviewingJob
    ? snapshot?.trainingReviews.filter((review) => review.trainingJobId === reviewingJob.id) ?? []
    : [];
  const activeDnaArtifactId = snapshot?.projects.find((project) => project.id === activeProjectId)?.activeDnaArtifactId ?? null;
  const activeDnaReviewed = snapshot && activeDna ? creativeDnaCanGenerate(snapshot, activeDna) : true;
  const activeAnalysisJob = jobs.find((job) => job.status === "waiting-for-runner" || job.status === "running");
  const pendingAnalysisReview = jobs.find((job) => job.status === "completed" && job.resultDnaArtifactId && !snapshot?.trainingReviews.some((review) => review.trainingJobId === job.id));
  const analysisStep = pendingAnalysisReview || reviewingJob ? 2 : activeAnalysisJob ? 1 : activeDnaReviewed && activeDna?.training ? 3 : 0;

  return <section className="training-hub" aria-labelledby="training-hub-title">
    <header className="training-hub-head"><div><span className="eyebrow">Learn from your work</span><h2 id="training-hub-title">Train</h2></div><span className="training-hub-local"><i /> Local-first</span></header>
    <div className="training-path-tabs" role="tablist" aria-label="Training path">
      <button type="button" role="tab" aria-selected={path === "analyze"} aria-controls="creative-dna-analysis-panel" className={path === "analyze" ? "on" : ""} onClick={() => setPath("analyze")}><span><Icon name="image" size={18} /></span><strong>Analyze media</strong><small>Describe files and evolve CreativeDNA</small><em>{selectedAssetIds.length ? `${selectedAssetIds.length} selected` : `${eligibleAssets.length} eligible`}</em></button>
      <button type="button" role="tab" aria-selected={path === "model"} aria-controls="music-model-training-panel" className={path === "model" ? "on" : ""} onClick={() => setPath("model")}><span><Icon name="music" size={18} /></span><strong>Train music LoRA</strong><small>Create real ACE-Step LoRA weights</small><em>{modelActionCount ? `${modelActionCount} needs action` : consentedAudioCount >= 3 ? `${consentedAudioCount} tracks ready` : `${3 - consentedAudioCount} more needed`}</em></button>
      <button type="button" role="tab" aria-selected={path === "image-model"} aria-controls="image-model-training-panel" className={path === "image-model" ? "on" : ""} onClick={() => setPath("image-model")}><span><Icon name="image" size={18} /></span><strong>Train art style</strong><small>Create real local image LoRA weights</small></button>
    </div>
    {path === "image-model" ? <div id="image-model-training-panel" role="tabpanel"><ImageStyleTrainingPanel key={activeProjectId} onMedia={onMedia} /></div> : path === "model" ? <div id="music-model-training-panel" role="tabpanel"><AceStepTrainingPanel onMedia={onMedia} initialAssetIds={initialAssetIds} /></div> : <div id="creative-dna-analysis-panel" role="tabpanel"><section className="dna-training glass" id="creative-dna-training" aria-labelledby="dna-training-title">
    <header className="dna-training-head">
      <div><span className="eyebrow">CreativeDNA analysis</span><h2 id="dna-training-title">Analyze media</h2><p>Gemma describes each file, measures its signals, and creates a reviewable DNA version. Model weights stay unchanged.</p></div>
      <span className="training-runner-state"><i /> Local runner + Gemma 4</span>
    </header>
    <ol className="training-steps" aria-label="CreativeDNA analysis progress">{["Sources", "Analyze", "Review", "Active"].map((label, index) => <li key={label} className={index < analysisStep ? "complete" : index === analysisStep ? "current" : ""}><span>{index < analysisStep ? <Icon name="check" size={11} /> : index + 1}</span><strong>{label}</strong></li>)}</ol>

    <div className="dna-training-layout">
      <div className="dna-training-inputs">
        <div className="training-section-head"><span><strong>Sources</strong><small>{selectedAssetIds.length} selected / {eligibleAssets.length} eligible</small></span><button className="link-btn" onClick={onMedia}>Media library</button></div>
        <div className={`training-inline-upload${uiOnlyDevelopment ? " disabled" : ""}`}>
          <input ref={uploadInputRef} type="file" accept={ACCEPTED_MEDIA} disabled={busy || uiOnlyDevelopment} onChange={(event) => chooseUpload(event.target.files?.[0] ?? null)} />
          <button className="btn btn-ghost" disabled={busy || uiOnlyDevelopment} onClick={() => uploadInputRef.current?.click()}><Icon name="plus" size={15} /> Choose media</button>
          <span><strong>{uploadFile?.name ?? "Image, audio, or video"}</strong><small>{uiOnlyDevelopment ? "Real uploads require the Creative Studio Worker." : uploadFile ? `${uploadFile.type || "media"} · training consent included` : "Upload here and it is selected for this run."}</small></span>
          <button className="btn btn-primary" disabled={!uploadFile || busy || uiOnlyDevelopment} onClick={() => void uploadForTraining()}>{busy ? "Uploading…" : "Upload"}</button>
        </div>
        {uploadError ? <div className="inline-error" role="alert">{uploadError}</div> : null}
        {eligibleAssets.length ? <div className="training-asset-grid">{eligibleAssets.map((asset) => <label key={asset.id} className={`training-asset${selectedAssetIds.includes(asset.id) ? " selected" : ""}`}>
          <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} disabled={busy} onChange={() => toggle(asset.id)} />
          <span className="training-asset-icon"><Icon name={asset.kind === "audio" ? "music" : asset.kind} size={18} /></span>
          <span><strong>{asset.name}</strong><small>{asset.kind} · {asset.mimeType}</small></span>
          <Icon name={selectedAssetIds.includes(asset.id) ? "check" : "plus"} size={16} />
        </label>)}</div> : <div className="training-empty"><Icon name="image" size={25} /><span><strong>No consented uploads yet.</strong><small>Choose a real file above; it will be retained and selected for this training run.</small></span></div>}
        {eligibleAssets.length ? <button className="link-btn training-select-all" onClick={() => setSelected(selectedAssetIds.length === eligibleAssets.length ? [] : eligibleAssets.map((asset) => asset.id))}>{selectedAssetIds.length === eligibleAssets.length ? "Clear selection" : "Select all eligible uploads"}</button> : null}
      </div>

      <div className="dna-training-config">
        <label className="field"><span>Result name</span><input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={activeDna ? `${activeDna.name} trained` : "Upload-trained CreativeDNA"} /></label>
        <div className="field"><span>Primary output</span><div className="seg">{(["image", "music"] as CreativeDnaTarget[]).map((target) => <button key={target} className={targetModality === target ? "on" : ""} onClick={() => setTargetModality(target)}><Icon name={target} size={15} /> {target}</button>)}</div></div>
        <label className="training-consent training-evidence-toggle"><input type="checkbox" checked={includeExamples} disabled={busy || !trainingExamples.length} onChange={(event) => setIncludeExamples(event.target.checked)} /><span><strong>Include fresh accepted evidence</strong><small>{trainingExamples.length} prompt + exact-settings {trainingExamples.length === 1 ? "example" : "examples"} ready{productionLoop?.counts.evidenceUsed ? ` · ${productionLoop.counts.evidenceUsed} already captured` : ""}</small></span></label>
        <div className="training-base"><span className="eyebrow">Lineage</span><strong>{activeDna ? `Evolve ${activeDna.name} v${activeDna.version}` : "Create a new DNA root"}</strong><small>The completed runner result becomes a new immutable CreativeDNA version.</small></div>
        <button className="btn btn-primary training-start" disabled={busy || !hasInputs || uiOnlyDevelopment || !activeDnaReviewed} onClick={() => void start()}><Icon name="dna" size={17} /> Start analysis</button>
        {uiOnlyDevelopment ? <p className="training-boundary">Real uploads and training runs require the Creative Studio Worker.</p> : !activeDnaReviewed ? <p className="training-boundary">Review the selected trained CreativeDNA before using it as another training baseline.</p> : <p className="training-boundary">The run is durable immediately. It remains visibly waiting until your authenticated local trainer claims it.</p>}
      </div>
    </div>

    {error ? <div className="inline-error" role="alert">{error}</div> : null}
    <div className="training-runs">
      <div className="training-section-head"><span><strong>Analysis runs</strong><small>{jobs.length} recorded</small></span></div>
      {jobs.slice(0, 3).map((job) => <article className="training-run" key={job.id}>
        <span className={`state-pill ${job.status}`}>{statusLabel(job.status)}</span>
        <span><strong>{job.name}</strong><small>{job.assetIds.length} uploads · {job.trainingExampleIds.length} accepted examples · {job.targetModality}</small></span>
        <span className="training-run-progress"><b>{job.progress}%</b><small>{job.resultDnaArtifactId ? `DNA ${job.resultDnaArtifactId}` : job.runnerId ? `runner ${job.runnerId}` : "runner not claimed"}</small></span>
        {job.status === "waiting-for-runner" || job.status === "running" ? <button className="btn btn-ghost" disabled={busy} onClick={() => void cancelDnaTraining(job.id)}>Cancel</button> : null}
        {job.status === "completed" && job.resultDnaArtifactId ? <button className="btn btn-ghost" disabled={busy} onClick={() => setReviewingJobId(job.id)}>{snapshot?.trainingReviews.some((review) => review.trainingJobId === job.id) ? "Review history" : "Review result"}</button> : null}
      </article>)}
      {!jobs.length ? <p className="empty-copy">No training runs started for this project.</p> : null}
    </div>

    {reviewingJob && reviewingArtifact ? <TrainingReviewPanel
      job={reviewingJob}
      artifact={reviewingArtifact}
      baseArtifact={reviewingBase}
      reviews={reviewingDecisions}
      active={activeDnaArtifactId === reviewingArtifact.artifactId}
      busy={busy}
      onClose={() => { setReviewingJobId(""); onReviewJobHandled?.(); }}
      onDecision={(decision, note) => reviewDnaTraining(reviewingJob.id, decision, note)}
    /> : null}
  </section></div>}
  </section>;
}
