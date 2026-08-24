import { useMemo, useState } from "react";
import {
  CREATIVE_DNA_DIMENSION_KEYS,
  DEFAULT_CREATIVE_DNA_DIMENSIONS,
  DEFAULT_CREATIVE_DNA_INFLUENCE,
  MAX_CREATIVE_DNA_REFERENCE_ASSETS,
  creativeDnaDescriptionSummaries,
  creativeDnaGenerationPrompt,
  type CreativeDnaArtifact,
  type CreativeDnaDimensionKey,
  type CreativeDnaDimensions,
  type CreativeDnaInfluence,
  type CreativeDnaMediaDescription,
  type CreativeDnaSourceKind,
  type CreativeDnaTarget,
  type MediaAsset,
} from "../../../shared/contracts";
import { creativeDnaCanGenerate, creativeDnaReviewDecision, useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { GenerationView } from "../generation/GenerationView";
import type { CreateIntent } from "../generation/quickCreate";
import { DnaTrainingPanel } from "./DnaTrainingPanel";
import { ProductionLoopPanel } from "./ProductionLoopPanel";

const DIMENSION_LABELS: Record<CreativeDnaDimensionKey, string> = {
  energy: "Energy",
  tension: "Tension",
  contrast: "Contrast",
  warmth: "Warmth",
  spaciousness: "Space",
  rhythmicity: "Rhythm",
  organicity: "Organic",
  polish: "Polish",
};

function SourceDescriptionSummaries({ description }: { description: CreativeDnaMediaDescription }) {
  const summaries = creativeDnaDescriptionSummaries(description);
  return <><span className="dna-description-label">Short summary</span><p>{summaries.shortSummary}</p><details className="dna-description-long"><summary>Long summary · {summaries.longSummary.length.toLocaleString()} characters</summary><p>{summaries.longSummary}</p></details></>;
}

type CreativeDnaWorkspace = "create" | "design" | "train";

function savedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ReferenceAssetPreview({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "image") return <img src={asset.contentUrl} alt="" loading="lazy" />;
  return <Icon name={asset.kind === "audio" ? "music" : "video"} size={20} />;
}

export function CreativeDnaWorkbench({ onQueued, onMedia, onArtifacts, onWorkflows, initialReviewJobId, initialVideoExtensionArtifactId, initialEvolutionSourceId, initialSourceId, initialCreateIntent, initialTrainingAssetIds = [], onCockpitTargetHandled }: { onQueued: () => void; onMedia: () => void; onArtifacts: () => void; onWorkflows: () => void; initialReviewJobId?: string; initialVideoExtensionArtifactId?: string; initialEvolutionSourceId?: string; initialSourceId?: string; initialCreateIntent?: CreateIntent; initialTrainingAssetIds?: string[]; onCockpitTargetHandled?: () => void }) {
  const { snapshot, activeProjectId, activeDna, selectDna, saveDna, busy, error } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const projectMedia = useMemo(() => snapshot?.mediaAssets.filter((asset) => asset.projectId === activeProjectId) ?? [], [activeProjectId, snapshot?.mediaAssets]);
  const [name, setName] = useState(activeDna?.name ?? "");
  const [directive, setDirective] = useState(activeDna?.source.directive ?? "");
  const [targetModality, setTargetModality] = useState<CreativeDnaTarget>(activeDna?.targetModality ?? "music");
  const [sourceKind, setSourceKind] = useState<CreativeDnaSourceKind>(activeDna?.source.kind ?? "original");
  const [referenceLabel, setReferenceLabel] = useState(activeDna?.source.referenceLabel ?? "");
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>(activeDna?.source.referenceAssetIds ?? []);
  const [dimensions, setDimensions] = useState<CreativeDnaDimensions>({ ...(activeDna?.shared ?? DEFAULT_CREATIVE_DNA_DIMENSIONS) });
  const [influence, setInfluence] = useState<CreativeDnaInfluence>({ ...(activeDna?.influence ?? DEFAULT_CREATIVE_DNA_INFLUENCE) });
  const [copied, setCopied] = useState(false);
  const [requestedReviewJobId, setRequestedReviewJobId] = useState("");
  const [trainingSeedAssetIds, setTrainingSeedAssetIds] = useState<string[]>(initialTrainingAssetIds);
  const [workspace, setWorkspace] = useState<CreativeDnaWorkspace>(initialReviewJobId || initialTrainingAssetIds.length ? "train" : "create");
  const activeReview = snapshot && activeDna ? creativeDnaReviewDecision(snapshot, activeDna) : null;
  const activeDnaReviewed = snapshot && activeDna ? creativeDnaCanGenerate(snapshot, activeDna) : true;
  const projectActiveDnaId = snapshot?.projects.find((project) => project.id === activeProjectId)?.activeDnaArtifactId ?? null;
  const productionLoop = snapshot?.productionLoops.find((loop) => loop.projectId === activeProjectId) ?? null;
  const selectedReferenceAssets = referenceAssetIds.flatMap((assetId) => {
    const asset = projectMedia.find((item) => item.id === assetId);
    return asset ? [asset] : [];
  });
  const trainableReferenceAssetIds = selectedReferenceAssets.filter((asset) => asset.trainingEligible).map((asset) => asset.id);

  const productionAction = (surface: "author" | "generation" | "queue" | "artifacts" | "training") => {
    if (surface === "queue") return onQueued();
    if (surface === "artifacts") return onArtifacts();
    if (surface === "training" && productionLoop?.pendingTrainingReviewJobId) {
      setRequestedReviewJobId(productionLoop.pendingTrainingReviewJobId);
    }
    setWorkspace(surface === "author" ? "design" : surface === "generation" ? "create" : "train");
  };

  const load = (artifact: CreativeDnaArtifact) => {
    selectDna(artifact);
    setName(artifact.name);
    setDirective(artifact.source.directive);
    setTargetModality(artifact.targetModality);
    setSourceKind(artifact.source.kind);
    setReferenceLabel(artifact.source.referenceLabel ?? "");
    setReferenceAssetIds(artifact.source.referenceAssetIds ?? []);
    setDimensions({ ...artifact.shared });
    setInfluence({ ...artifact.influence });
  };

  const startNew = () => {
    setWorkspace("design");
    selectDna(null);
    setName("");
    setDirective("");
    setTargetModality("music");
    setSourceKind("original");
    setReferenceLabel("");
    setReferenceAssetIds([]);
    setDimensions({ ...DEFAULT_CREATIVE_DNA_DIMENSIONS });
    setInfluence({ ...DEFAULT_CREATIVE_DNA_INFLUENCE });
  };

  const save = async () => {
    await saveDna({
      name,
      directive,
      targetModality,
      sourceKind,
      referenceLabel,
      referenceAssetIds,
      dimensions,
      influence,
      parentArtifactId: activeDna?.artifactId ?? null,
    });
  };

  const copyPrompt = async () => {
    if (!activeDna) return;
    await navigator.clipboard.writeText(creativeDnaGenerationPrompt(activeDna, activeDna.targetModality));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const invalid = directive.trim().length < 4
    || (sourceKind === "commercial_reference" && !referenceLabel.trim())
    || (sourceKind === "owner_uploads" && !referenceAssetIds.length);

  const toggleReferenceAsset = (assetId: string) => setReferenceAssetIds((current) => current.includes(assetId)
    ? current.filter((id) => id !== assetId)
    : current.length < MAX_CREATIVE_DNA_REFERENCE_ASSETS ? [...current, assetId] : current);

  const analyzeReferences = () => {
    setTrainingSeedAssetIds(trainableReferenceAssetIds);
    setWorkspace("train");
  };

  return (
    <section className="dna-workbench fade-up" aria-label="Creative Studio Create workspace">
      {workspace === "design" ? <div className="dna-workbench-head">
        <div>
          <span className="eyebrow">Creative Studio</span>
          <h2 id="dna-workbench-title">CreativeDNA direction</h2>
          <p>Shape the reusable visual or musical intent behind your work.</p>
        </div>
        <div className="workspace-head-actions"><button className="btn btn-ghost" onClick={() => setWorkspace("create")}><Icon name="chevron" size={16} /> Back to Create</button><button className="btn btn-ghost" onClick={startNew}><Icon name="plus" size={16} /> New DNA</button></div>
      </div> : null}

      {productionLoop && workspace !== "create" ? <ProductionLoopPanel loop={productionLoop} onAction={productionAction} compact /> : null}

      {workspace === "design" ? <><div className="dna-layout">
        <div className="form-card glass dna-compose" id="creative-dna-authoring">
          <div className="fc-head">
            <div className="fc-ic" style={{ "--ta": "var(--pink)" } as React.CSSProperties}><Icon name="dna" size={24} /></div>
            <div><div className="fc-title">Direction</div><div className="fc-sub">Original intent, provenance, and primary output.</div></div>
          </div>

          <label className="field"><span>Name</span><input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Night glass" /></label>
          <label className="field"><span>What are you making?</span><textarea className="textarea" value={directive} maxLength={1200} onChange={(event) => setDirective(event.target.value)} placeholder="A luminous late-night piece that starts intimate, opens wide, then lands with a rough human edge." /></label>

          <div className="field">
            <span>Primary output</span>
            <div className="seg">
              {(["music", "image"] as CreativeDnaTarget[]).map((target) => <button key={target} className={targetModality === target ? "on" : ""} style={{ "--ta": target === "music" ? "var(--pink)" : "var(--cyan)" } as React.CSSProperties} onClick={() => setTargetModality(target)}><Icon name={target} size={16} /> {target}</button>)}
            </div>
          </div>

          <div className="field">
            <span>Source</span>
            <div className="seg">
              <button className={sourceKind === "original" ? "on" : ""} style={{ "--ta": "var(--teal)" } as React.CSSProperties} onClick={() => setSourceKind("original")}>Original idea</button>
              <button className={sourceKind === "owner_uploads" ? "on" : ""} style={{ "--ta": "var(--cyan)" } as React.CSSProperties} onClick={() => setSourceKind("owner_uploads")}>Uploaded works</button>
              <button className={sourceKind === "commercial_reference" ? "on" : ""} style={{ "--ta": "var(--amber)" } as React.CSSProperties} onClick={() => setSourceKind("commercial_reference")}>Outside reference</button>
            </div>
          </div>

          {sourceKind === "owner_uploads" ? <div className="dna-reference-field">
            <div className="dna-reference-head"><span>Reference uploaded works</span><small>{referenceAssetIds.length}/{MAX_CREATIVE_DNA_REFERENCE_ASSETS} selected</small></div>
            {projectMedia.length ? <div className="dna-reference-grid">{projectMedia.map((asset) => {
              const selected = referenceAssetIds.includes(asset.id);
              return <label key={asset.id} className={`dna-reference-item${selected ? " selected" : ""}${!selected && referenceAssetIds.length >= MAX_CREATIVE_DNA_REFERENCE_ASSETS ? " limit" : ""}`}>
                <input type="checkbox" checked={selected} disabled={busy || (!selected && referenceAssetIds.length >= MAX_CREATIVE_DNA_REFERENCE_ASSETS)} onChange={() => toggleReferenceAsset(asset.id)} />
                <span className={`dna-reference-preview ${asset.kind}`}><ReferenceAssetPreview asset={asset} /></span>
                <span><strong>{asset.name}</strong><small>{asset.kind} · {asset.trainingEligible ? "training consent" : "lineage only"}</small></span>
                <Icon name={selected ? "check" : "plus"} size={15} />
              </label>;
            })}</div> : <div className="dna-reference-empty"><Icon name="image" size={21} /><span><strong>No uploaded works in this project.</strong><small>Upload a real image, audio file, or video, then select it here.</small></span></div>}
            <div className="dna-reference-actions">
              <button className="link-btn" onClick={onMedia}>{projectMedia.length ? "Upload more" : "Upload works"}</button>
              <button className="link-btn" disabled={!trainableReferenceAssetIds.length} onClick={analyzeReferences}>Analyze {trainableReferenceAssetIds.length || "selected"} in Train</button>
            </div>
            <small className="rights-note"><Icon name="shield" size={14} /> Selection records owner-upload lineage. Your direction controls generation until Gemma analyzes consented works in Train.</small>
          </div> : null}

          {sourceKind === "commercial_reference" ? <label className="field"><span>Reference identity · lineage only</span><input className="input" value={referenceLabel} maxLength={160} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="Title / artist" /><small className="rights-note"><Icon name="shield" size={14} /> Identity is stored as provenance and excluded from generation prompts.</small></label> : null}

          <button className="btn btn-primary dna-save" disabled={busy || invalid || !activeDnaReviewed} onClick={() => void save()}><Icon name="wand" size={17} /> {busy ? "Saving…" : activeDna ? "Save new version" : "Build CreativeDNA"}</button>
          {!activeDnaReviewed ? <p className="training-boundary">Review this trained version before creating a child version.</p> : null}
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
        </div>

        <div className="dna-shape glass">
          <div className="dna-shape-head"><div><span className="eyebrow">Shared dimensions</span><h3>Creative shape</h3></div><span className="dna-version">{activeDna ? `v${activeDna.version}` : "Draft"}</span></div>
          <div className="dna-sliders">
            {CREATIVE_DNA_DIMENSION_KEYS.map((key) => <label key={key} className="dna-slider"><span><b>{DIMENSION_LABELS[key]}</b><strong>{dimensions[key]}</strong></span><input type="range" min="0" max="100" value={dimensions[key]} onChange={(event) => setDimensions((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
          </div>
          <div className="gravity-card">
            <span className="eyebrow">Creative gravity</span>
            {([ ["angeloCore", "Angelo Core"], ["currentProject", "Project"], ["reference", "Reference"] ] as Array<[keyof CreativeDnaInfluence, string]>).map(([key, label]) => <label key={key} className="gravity-row"><span>{label}</span><input type="range" min="0" max="100" value={influence[key]} onChange={(event) => setInfluence((current) => ({ ...current, [key]: Number(event.target.value) }))} /><b>{influence[key]}</b></label>)}
          </div>

          {activeDna ? <div className="dna-result" role="status">
            <div className="dna-result-title"><div><span className="badge active">Saved · v{activeDna.version}</span>{activeReview ? <span className={`state-pill ${activeReview === "pending" ? "waiting-for-runner" : activeReview}`}>training {activeReview}</span> : null}{projectActiveDnaId === activeDna.artifactId ? <span className="badge active">Project active</span> : null}{activeDna.rights.referenceStoredAsProvenanceOnly ? <span className="badge rights">Rights-safe</span> : null}<h3>{activeDna.name}</h3></div><button className="lc-act" aria-label="Copy active prompt" onClick={() => void copyPrompt()}><Icon name={copied ? "check" : "copy"} size={17} /></button></div>
            <p>{activeDna.source.directive}</p>
            {activeDna.source.referenceAssetIds?.length ? <div className="dna-result-references"><span>Referenced uploads</span><div>{activeDna.source.referenceAssetIds.map((assetId) => {
              const asset = projectMedia.find((item) => item.id === assetId);
              return <span key={assetId}><Icon name={asset?.kind === "audio" ? "music" : asset?.kind ?? "image"} size={13} /> {asset?.name ?? "Retained work"}</span>;
            })}</div></div> : null}
            {activeDna.training?.analysis.sources.some((source) => source.detailedDescription) ? <details className="dna-source-descriptions">
              <summary>Detailed source descriptions · {activeDna.training.analysis.sources.filter((source) => source.detailedDescription).length}</summary>
              {activeDna.training.analysis.sources.filter((source) => source.detailedDescription).map((source) => <article key={source.sourceId}><strong>{source.label}</strong><small>{source.kind} · Gemma 4</small><SourceDescriptionSummaries description={source.detailedDescription!} /></article>)}
            </details> : null}
            <small className="dna-result-next">Training and generation controls use this saved version below.</small>
          </div> : <div className="dna-empty"><Icon name="dna" size={30} /><strong>Your versioned blueprint appears here.</strong><span>Build it, reopen it, then evolve it without overwriting history.</span></div>}
        </div>
      </div>

      <div className="dna-history glass">
        <div className="dna-history-head"><div><span className="eyebrow">Lineage</span><h3>Version history</h3></div><span>{projectDna.length} saved</span></div>
        <div className="dna-history-strip">
          {projectDna.map((artifact) => {
            const review = snapshot ? creativeDnaReviewDecision(snapshot, artifact) : null;
            return <button key={artifact.artifactId} className={`dna-history-item${activeDna?.artifactId === artifact.artifactId ? " on" : ""}`} onClick={() => load(artifact)}><span>{artifact.targetModality}</span><strong>{artifact.name}</strong><small>v{artifact.version} · {savedLabel(artifact.createdAt)}{artifact.source.referenceAssetIds?.length ? ` · ${artifact.source.referenceAssetIds.length} works` : ""}</small><em>{review ? `Training ${review}` : artifact.lineage.parentArtifactId ? "Evolved" : "Root"}</em></button>;
          })}
          {!projectDna.length ? <span className="empty-copy">No saved DNA yet.</span> : null}
        </div>
      </div></> : null}

      {workspace === "train" ? <><button className="workspace-return" onClick={() => setWorkspace("create")}><Icon name="chevron" size={15} /> Back to Create</button><DnaTrainingPanel onMedia={onMedia} initialAssetIds={trainingSeedAssetIds} reviewJobId={requestedReviewJobId || initialReviewJobId} onReviewJobHandled={() => { setRequestedReviewJobId(""); onCockpitTargetHandled?.(); }} /></> : null}
      {workspace === "create" ? <GenerationView onQueued={onQueued} onMedia={onMedia} onWorkflows={onWorkflows} onDesign={() => setWorkspace("design")} onTrain={(assetIds = []) => { setTrainingSeedAssetIds(assetIds); setWorkspace("train"); }} initialVideoExtensionArtifactId={initialVideoExtensionArtifactId} initialEvolutionSourceId={initialEvolutionSourceId} initialSourceId={initialSourceId} initialCreateIntent={initialCreateIntent} embedded /> : null}
    </section>
  );
}
