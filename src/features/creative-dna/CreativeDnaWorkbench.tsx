import { useState } from "react";
import {
  CREATIVE_DNA_DIMENSION_KEYS,
  DEFAULT_CREATIVE_DNA_DIMENSIONS,
  DEFAULT_CREATIVE_DNA_INFLUENCE,
  type CreativeDnaArtifact,
  type CreativeDnaDimensionKey,
  type CreativeDnaDimensions,
  type CreativeDnaInfluence,
  type CreativeDnaSourceKind,
  type CreativeDnaTarget,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

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

function savedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CreativeDnaWorkbench({ onQueued }: { onQueued: () => void }) {
  const { snapshot, activeProjectId, activeDna, selectDna, saveDna, submitJob, busy, error } = useStudio();
  const projectDna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === activeProjectId) ?? [];
  const [name, setName] = useState(activeDna?.name ?? "");
  const [directive, setDirective] = useState(activeDna?.source.directive ?? "");
  const [targetModality, setTargetModality] = useState<CreativeDnaTarget>(activeDna?.targetModality ?? "music");
  const [sourceKind, setSourceKind] = useState<CreativeDnaSourceKind>(activeDna?.source.kind ?? "original");
  const [referenceLabel, setReferenceLabel] = useState(activeDna?.source.referenceLabel ?? "");
  const [dimensions, setDimensions] = useState<CreativeDnaDimensions>({ ...(activeDna?.shared ?? DEFAULT_CREATIVE_DNA_DIMENSIONS) });
  const [influence, setInfluence] = useState<CreativeDnaInfluence>({ ...(activeDna?.influence ?? DEFAULT_CREATIVE_DNA_INFLUENCE) });
  const [copied, setCopied] = useState(false);

  const load = (artifact: CreativeDnaArtifact) => {
    selectDna(artifact);
    setName(artifact.name);
    setDirective(artifact.source.directive);
    setTargetModality(artifact.targetModality);
    setSourceKind(artifact.source.kind);
    setReferenceLabel(artifact.source.referenceLabel ?? "");
    setDimensions({ ...artifact.shared });
    setInfluence({ ...artifact.influence });
  };

  const startNew = () => {
    selectDna(null);
    setName("");
    setDirective("");
    setTargetModality("music");
    setSourceKind("original");
    setReferenceLabel("");
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
      dimensions,
      influence,
      parentArtifactId: activeDna?.artifactId ?? null,
    });
  };

  const copyPrompt = async () => {
    if (!activeDna) return;
    await navigator.clipboard.writeText(activeDna.generationPrompts[activeDna.targetModality]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const make = async (target: CreativeDnaTarget) => {
    if (!activeDna) return;
    await submitJob(target, activeDna.artifactId);
    onQueued();
  };

  const invalid = directive.trim().length < 4 || (sourceKind === "commercial_reference" && !referenceLabel.trim());

  return (
    <section className="dna-workbench fade-up" aria-labelledby="dna-workbench-title">
      <div className="dna-workbench-head">
        <div>
          <span className="eyebrow">Versioned cross-media blueprint</span>
          <h2 id="dna-workbench-title">CreativeDNA</h2>
          <p>Shape the shared intent once, then translate it into music and image jobs without flattening its lineage.</p>
        </div>
        <button className="btn btn-ghost" onClick={startNew}><Icon name="plus" size={16} /> New DNA</button>
      </div>

      <div className="dna-layout">
        <div className="form-card glass dna-compose">
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
              <button className={sourceKind === "commercial_reference" ? "on" : ""} style={{ "--ta": "var(--amber)" } as React.CSSProperties} onClick={() => setSourceKind("commercial_reference")}>Reference work</button>
            </div>
          </div>

          {sourceKind === "commercial_reference" ? <label className="field"><span>Reference identity · lineage only</span><input className="input" value={referenceLabel} maxLength={160} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="Title / artist" /><small className="rights-note"><Icon name="shield" size={14} /> Identity is stored as provenance and excluded from generation prompts.</small></label> : null}

          <button className="btn btn-primary dna-save" disabled={busy || invalid} onClick={() => void save()}><Icon name="wand" size={17} /> {busy ? "Saving…" : activeDna ? "Save new version" : "Build CreativeDNA"}</button>
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
            <div className="dna-result-title"><div><span className="badge active">Saved · v{activeDna.version}</span>{activeDna.rights.referenceStoredAsProvenanceOnly ? <span className="badge rights">Rights-safe</span> : null}<h3>{activeDna.name}</h3></div><button className="lc-act" aria-label="Copy active prompt" onClick={() => void copyPrompt()}><Icon name={copied ? "check" : "copy"} size={17} /></button></div>
            <p>{activeDna.source.directive}</p>
            <div className="dna-actions"><button className="btn btn-ghost" onClick={() => void make("music")}><Icon name="music" size={17} /> Make music</button><button className="btn btn-primary" onClick={() => void make("image")}><Icon name="image" size={17} /> Make image</button></div>
          </div> : <div className="dna-empty"><Icon name="dna" size={30} /><strong>Your versioned blueprint appears here.</strong><span>Build it, reopen it, then evolve it without overwriting history.</span></div>}
        </div>
      </div>

      <div className="dna-history glass">
        <div className="dna-history-head"><div><span className="eyebrow">Lineage</span><h3>Version history</h3></div><span>{projectDna.length} saved</span></div>
        <div className="dna-history-strip">
          {projectDna.map((artifact) => <button key={artifact.artifactId} className={`dna-history-item${activeDna?.artifactId === artifact.artifactId ? " on" : ""}`} onClick={() => load(artifact)}><span>{artifact.targetModality}</span><strong>{artifact.name}</strong><small>v{artifact.version} · {savedLabel(artifact.createdAt)}</small><em>{artifact.lineage.parentArtifactId ? "Evolved" : "Root"}</em></button>)}
          {!projectDna.length ? <span className="empty-copy">No saved DNA yet.</span> : null}
        </div>
      </div>
    </section>
  );
}
