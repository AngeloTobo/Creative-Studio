import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CONTINUITY_FACETS,
  PROMOTE_TO_CANON_SCHEMA_VERSION,
  type Artifact,
  type ArtifactHistoryCursor,
  type CanonReference,
  type CanonReferenceSource,
  type ContinuityAttribute,
  type ContinuityFacet,
  type ContinuityModality,
  type ContinuityRule,
  type ContinuityRuleStrength,
  type MediaAsset,
  type MediaKind,
  type Project,
  type World,
  type WorldEntity,
  type WorldEntityKind,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon, type IconName } from "../../components/Icon";
import "./WorldBoard.css";

type WorldSheetState =
  | { kind: "create-world" }
  | { kind: "edit-world"; worldId: string }
  | { kind: "create-entity"; worldId: string }
  | { kind: "create-rule"; worldId: string; entityId: string | null }
  | { kind: "create-candidate"; worldId: string; entityId: string }
  | { kind: "promote-candidate"; worldId: string; referenceId: string }
  | null;

type CandidateSourceOption = {
  key: string;
  origin: "upload" | "artifact";
  source: CanonReferenceSource;
  label: string;
  kind: MediaKind;
  imageUrl: string | null;
  createdAt: string;
};

type FacetDraft = ContinuityAttribute & { key: number };

type CandidateArtifactHistoryState = {
  projectId: string;
  loaded: boolean;
  loading: boolean;
  error: string;
  nextCursor: ArtifactHistoryCursor | null;
  hasMore: boolean;
  total: number | null;
};

function emptyCandidateArtifactHistory(projectId: string): CandidateArtifactHistoryState {
  return {
    projectId,
    loaded: false,
    loading: false,
    error: "",
    nextCursor: null,
    hasMore: true,
    total: null,
  };
}

const ENTITY_LABELS: Record<WorldEntityKind, string> = {
  character: "Character",
  place: "Place",
  object: "Object",
};

const STRENGTH_LABELS: Record<ContinuityRuleStrength, string> = {
  must: "Must keep",
  prefer: "Prefer",
  avoid: "Avoid",
};

function titleCase(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actionMessage(error: unknown) {
  if (!(error instanceof Error)) return "Creative Studio could not complete that change.";
  const known: Record<string, string> = {
    world_version_conflict: "This world changed on another screen. Close this panel, then try again.",
    world_entity_version_conflict: "This character or element changed on another screen. Try again from its latest version.",
    continuity_rule_version_conflict: "This continuity rule changed on another screen. Try again from its latest version.",
    canon_reference_version_conflict: "This reference changed on another screen. Review its latest state before promoting it.",
    canon_reference_notes_required: "Add at least one continuity detail to this reference.",
    canon_promotion_note_required: "Write a short reason for making this canon.",
    canon_promotion_facets_required: "Choose at least one facet to make canon.",
  };
  return known[error.message] ?? error.message.replace(/_/g, " ");
}

function useSheetAction() {
  const [actionError, setActionError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setActionError("");
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(actionMessage(error));
      return false;
    }
  };
  return { actionError, run };
}

function WorldSheet({ eyebrow, title, onClose, children }: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("[autofocus], button, input, textarea, select")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="world-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} className="world-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <span><small>{eyebrow}</small><strong id={titleId}>{title}</strong></span>
          <button type="button" className="world-icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
        </header>
        <div className="world-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function FormError({ message }: { message: string }) {
  return message ? <div className="world-form-error" role="alert">{message}</div> : null;
}

function SheetActions({ busy, submitLabel, disabled = false, onCancel }: {
  busy: boolean;
  submitLabel: string;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return <footer className="world-sheet-actions">
    <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
    <button type="submit" className="btn btn-primary" disabled={busy || disabled}>{busy ? "Saving..." : submitLabel}</button>
  </footer>;
}

function FacetEditor({ rows, onChange, label = "Continuity details" }: {
  rows: FacetDraft[];
  onChange: (rows: FacetDraft[]) => void;
  label?: string;
}) {
  const update = (key: number, patch: Partial<FacetDraft>) => onChange(rows.map((row) => row.key === key ? { ...row, ...patch } : row));
  const remove = (key: number) => onChange(rows.filter((row) => row.key !== key));
  const add = () => onChange([...rows, { key: Math.max(0, ...rows.map((row) => row.key)) + 1, facet: "identity", value: "" }]);
  return <fieldset className="world-facet-editor">
    <legend>{label}</legend>
    <div className="world-facet-rows">
      {rows.map((row) => <div className="world-facet-row" key={row.key}>
        <select aria-label="Continuity facet" value={row.facet} onChange={(event) => update(row.key, { facet: event.target.value as ContinuityFacet })}>
          {CONTINUITY_FACETS.map((facet) => <option key={facet} value={facet}>{titleCase(facet)}</option>)}
        </select>
        <input aria-label={`${titleCase(row.facet)} detail`} value={row.value} maxLength={360} onChange={(event) => update(row.key, { value: event.target.value })} />
        <button type="button" aria-label={`Remove ${row.facet} detail`} onClick={() => remove(row.key)} disabled={rows.length === 1}><Icon name="close" size={14} /></button>
      </div>)}
    </div>
    {rows.length < 8 ? <button type="button" className="world-inline-add" onClick={add}><Icon name="plus" size={13} /> Add detail</button> : null}
  </fieldset>;
}

function WorldForm({ project, world, busy, onClose, onSave, onArchive }: {
  project: Project;
  world?: World;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, premise: string) => Promise<unknown>;
  onArchive?: () => Promise<unknown>;
}) {
  const [name, setName] = useState(world?.name ?? "");
  const [premise, setPremise] = useState(world?.premise ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const { actionError, run } = useSheetAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => onSave(name.trim(), premise.trim()));
    if (saved) onClose();
  };
  return <form className="world-form" onSubmit={(event) => void submit(event)}>
    <p className="world-form-intro">Worlds hold the characters, places, visual references, and rules that should remain consistent inside {project.name}.</p>
    <label><span>World name</span><input autoFocus value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} /></label>
    <label><span>Premise</span><textarea value={premise} maxLength={1200} rows={4} onChange={(event) => setPremise(event.target.value)} /></label>
    <FormError message={actionError} />
    {world && onArchive ? <div className="world-danger-zone">
      <span><strong>Archive this world</strong><small>Its canon remains in history and stops appearing in active creation.</small></span>
      <button type="button" disabled={busy} onClick={() => {
        if (!confirmArchive) { setConfirmArchive(true); return; }
        void run(onArchive).then((archived) => { if (archived) onClose(); });
      }}>{confirmArchive ? "Confirm archive" : "Archive"}</button>
    </div> : null}
    <SheetActions busy={busy} submitLabel={world ? "Save world" : "Create world"} disabled={!name.trim()} onCancel={onClose} />
  </form>;
}

function EntityForm({ projectId, busy, onClose, onSave }: {
  projectId: string;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { projectId: string; kind: WorldEntityKind; name: string; summary: string; aliases: string[]; attributes: ContinuityAttribute[] }) => Promise<unknown>;
}) {
  const [kind, setKind] = useState<WorldEntityKind>("character");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [aliases, setAliases] = useState("");
  const [rows, setRows] = useState<FacetDraft[]>([{ key: 1, facet: "identity", value: "" }]);
  const { actionError, run } = useSheetAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => onSave({
      projectId,
      kind,
      name: name.trim(),
      summary: summary.trim(),
      aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
      attributes: rows.map(({ facet, value }) => ({ facet, value: value.trim() })).filter((row) => row.value),
    }));
    if (saved) onClose();
  };
  return <form className="world-form" onSubmit={(event) => void submit(event)}>
    <fieldset className="world-segmented"><legend>Type</legend>{(Object.keys(ENTITY_LABELS) as WorldEntityKind[]).map((value) => <button type="button" key={value} className={kind === value ? "on" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}><Icon name={value === "character" ? "dna" : value === "place" ? "projects" : "cube"} size={16} />{ENTITY_LABELS[value]}</button>)}</fieldset>
    <label><span>Name</span><input autoFocus value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} /></label>
    <label><span>Identity summary</span><textarea value={summary} maxLength={800} rows={3} onChange={(event) => setSummary(event.target.value)} /></label>
    <label><span>Aliases <small>optional, comma separated</small></span><input value={aliases} maxLength={500} onChange={(event) => setAliases(event.target.value)} /></label>
    <FacetEditor rows={rows} onChange={setRows} />
    <FormError message={actionError} />
    <SheetActions busy={busy} submitLabel={`Add ${ENTITY_LABELS[kind].toLowerCase()}`} disabled={!name.trim()} onCancel={onClose} />
  </form>;
}

function RuleForm({ projectId, entities, initialEntityId, busy, onClose, onSave }: {
  projectId: string;
  entities: WorldEntity[];
  initialEntityId: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { projectId: string; entityIds: string[]; facet: ContinuityFacet; strength: ContinuityRuleStrength; instruction: string; modalities: ContinuityModality[] }) => Promise<unknown>;
}) {
  const [scope, setScope] = useState(initialEntityId ?? "world");
  const [facet, setFacet] = useState<ContinuityFacet>("identity");
  const [strength, setStrength] = useState<ContinuityRuleStrength>("must");
  const [instruction, setInstruction] = useState("");
  const [modalities, setModalities] = useState<ContinuityModality[]>(["image", "video"]);
  const { actionError, run } = useSheetAction();
  const toggleModality = (modality: ContinuityModality) => setModalities((current) => current.includes(modality) ? current.filter((value) => value !== modality) : [...current, modality]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await run(() => onSave({ projectId, entityIds: scope === "world" ? [] : [scope], facet, strength, instruction: instruction.trim(), modalities }));
    if (saved) onClose();
  };
  return <form className="world-form" onSubmit={(event) => void submit(event)}>
    <label><span>Applies to</span><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="world">Whole world</option>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
    <div className="world-form-grid">
      <label><span>Facet</span><select value={facet} onChange={(event) => setFacet(event.target.value as ContinuityFacet)}>{CONTINUITY_FACETS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
      <label><span>Strength</span><select value={strength} onChange={(event) => setStrength(event.target.value as ContinuityRuleStrength)}>{(Object.keys(STRENGTH_LABELS) as ContinuityRuleStrength[]).map((value) => <option key={value} value={value}>{STRENGTH_LABELS[value]}</option>)}</select></label>
    </div>
    <label><span>Instruction</span><textarea autoFocus value={instruction} maxLength={500} rows={4} required onChange={(event) => setInstruction(event.target.value)} /></label>
    <fieldset className="world-check-row"><legend>Use for</legend>{(["image", "video", "music"] as ContinuityModality[]).map((modality) => <label key={modality} className={modalities.includes(modality) ? "on" : ""}><input type="checkbox" checked={modalities.includes(modality)} onChange={() => toggleModality(modality)} /><Icon name={modality} size={14} />{titleCase(modality)}</label>)}</fieldset>
    <FormError message={actionError} />
    <SheetActions busy={busy} submitLabel="Add rule" disabled={!instruction.trim() || !modalities.length} onCancel={onClose} />
  </form>;
}

function sourceIcon(kind: MediaKind): IconName {
  return kind === "audio" ? "music" : kind;
}

function SourceVisual({ imageUrl, kind, label }: { imageUrl: string | null; kind: MediaKind; label: string }) {
  return <span className={`world-source-visual ${imageUrl ? "has-image" : ""}`}>
    {imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" /> : <Icon name={sourceIcon(kind)} size={22} />}
    <i><Icon name={sourceIcon(kind)} size={11} /></i>
    <span className="sr-only">{label}</span>
  </span>;
}

function CandidateForm({ projectId, entityId, sources, artifactHistory, busy, onClose, onLoadArtifacts, onSave }: {
  projectId: string;
  entityId: string;
  sources: CandidateSourceOption[];
  artifactHistory: CandidateArtifactHistoryState;
  busy: boolean;
  onClose: () => void;
  onLoadArtifacts: () => Promise<void>;
  onSave: (input: { projectId: string; entityId: string; source: CanonReferenceSource; continuityNotes: ContinuityAttribute[] }) => Promise<unknown>;
}) {
  const firstOrigin = sources.some((source) => source.origin === "upload") ? "upload" : "artifact";
  const [origin, setOrigin] = useState<"upload" | "artifact">(firstOrigin);
  const visibleSources = sources.filter((source) => source.origin === origin);
  const [selectedKey, setSelectedKey] = useState(sources.find((source) => source.origin === firstOrigin)?.key ?? "");
  const [rows, setRows] = useState<FacetDraft[]>([{ key: 1, facet: "identity", value: "" }]);
  const selected = sources.find((source) => source.key === selectedKey && source.origin === origin) ?? visibleSources[0] ?? null;
  const notes = rows.map(({ facet, value }) => ({ facet, value: value.trim() })).filter((row) => row.value);
  const { actionError, run } = useSheetAction();

  const switchOrigin = (next: "upload" | "artifact") => {
    setOrigin(next);
    setSelectedKey(sources.find((source) => source.origin === next)?.key ?? "");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const saved = await run(() => onSave({ projectId, entityId, source: selected.source, continuityNotes: notes }));
    if (saved) onClose();
  };
  return <form className="world-form world-candidate-form" onSubmit={(event) => void submit(event)}>
    <p className="world-form-intro"><strong>This adds a candidate only.</strong> Accepting an artifact never changes canon. You will review and promote the facets separately.</p>
    <div className="world-source-tabs" role="tablist" aria-label="Reference source">
      <button type="button" role="tab" aria-selected={origin === "upload"} className={origin === "upload" ? "on" : ""} onClick={() => switchOrigin("upload")}>Uploads <b>{sources.filter((source) => source.origin === "upload").length}</b></button>
      <button type="button" role="tab" aria-selected={origin === "artifact"} className={origin === "artifact" ? "on" : ""} onClick={() => switchOrigin("artifact")}>Accepted work <b>{sources.filter((source) => source.origin === "artifact").length}</b></button>
    </div>
    {visibleSources.length ? <div className="world-source-gallery" role="listbox" aria-label={origin === "upload" ? "Owner uploads" : "Accepted retained artifacts"}>
      {visibleSources.map((source) => <button type="button" role="option" aria-selected={selected?.key === source.key} className={selected?.key === source.key ? "on" : ""} key={source.key} onClick={() => setSelectedKey(source.key)}>
        <SourceVisual imageUrl={source.imageUrl} kind={source.kind} label={source.label} />
        <span><strong>{source.label}</strong><small>{source.origin === "upload" ? "Owner upload" : "Accepted + retained"}</small></span>
        {selected?.key === source.key ? <i className="world-source-check"><Icon name="check" size={12} /></i> : null}
      </button>)}
    </div> : <div className="world-source-empty"><Icon name={origin === "upload" ? "gallery" : "star"} size={22} /><span><strong>{origin === "artifact" && artifactHistory.loading ? "Loading accepted work" : `No eligible ${origin === "upload" ? "uploads" : "artifacts"}`}</strong><small>{origin === "upload" ? "Upload retained media in Studio > Media." : artifactHistory.loading ? "Checking retained results from newest to oldest." : "Accept and retain a result in Work, then it will appear here."}</small></span></div>}
    {origin === "artifact" ? <div className="world-source-history" aria-live="polite">
      <span>{artifactHistory.loading ? "Loading..." : artifactHistory.error ? "Accepted work could not load." : artifactHistory.total === null ? "Accepted work loads directly here." : `${sources.filter((source) => source.origin === "artifact").length} eligible loaded · ${artifactHistory.total} accepted total`}</span>
      {artifactHistory.error || artifactHistory.hasMore ? <button type="button" disabled={artifactHistory.loading} onClick={() => void onLoadArtifacts()}>{artifactHistory.error ? "Retry" : artifactHistory.loaded ? "Load older" : "Load accepted work"}</button> : artifactHistory.loaded ? <small>All accepted work checked</small> : null}
    </div> : null}
    <FacetEditor rows={rows} onChange={setRows} label="What must stay consistent" />
    <FormError message={actionError} />
    <SheetActions busy={busy} submitLabel="Add candidate" disabled={!selected || !notes.length} onCancel={onClose} />
  </form>;
}

function PromotionForm({ reference, busy, onClose, onPromote }: {
  reference: CanonReference;
  busy: boolean;
  onClose: () => void;
  onPromote: (facets: ContinuityFacet[], note: string) => Promise<unknown>;
}) {
  const availableFacets = [...new Set(reference.continuityNotes.map((entry) => entry.facet))];
  const [facets, setFacets] = useState<ContinuityFacet[]>(availableFacets);
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const { actionError, run } = useSheetAction();
  const toggleFacet = (facet: ContinuityFacet) => setFacets((current) => current.includes(facet) ? current.filter((value) => value !== facet) : [...current, facet]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const promoted = await run(() => onPromote(facets, note.trim()));
    if (promoted) onClose();
  };
  return <form className="world-form" onSubmit={(event) => void submit(event)}>
    <p className="world-form-intro">Only the selected, reviewed facets become generation continuity. The source file remains provenance and is not copied into provider prompt text.</p>
    <fieldset className="world-promotion-facets"><legend>Facets to make canon</legend>{availableFacets.map((facet) => <label key={facet} className={facets.includes(facet) ? "on" : ""}><input type="checkbox" checked={facets.includes(facet)} onChange={() => toggleFacet(facet)} /><span>{titleCase(facet)}</span><small>{reference.continuityNotes.find((entry) => entry.facet === facet)?.value}</small></label>)}</fieldset>
    <label><span>Promotion note <small>required</small></span><textarea autoFocus value={note} minLength={4} maxLength={500} rows={3} required onChange={(event) => setNote(event.target.value)} /></label>
    <label className="world-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><strong>Make these facets canon</strong><small>I reviewed this reference and want it used for continuity.</small></span></label>
    <FormError message={actionError} />
    <SheetActions busy={busy} submitLabel="Promote to canon" disabled={!facets.length || note.trim().length < 4 || !confirmed} onCancel={onClose} />
  </form>;
}

function referenceMedia(reference: CanonReference, media: MediaAsset[], artifacts: Artifact[]) {
  const source = reference.source;
  if (source.kind === "owner-upload") {
    const asset = media.find((item) => item.id === source.mediaId);
    return asset ? { imageUrl: asset.kind === "image" ? asset.contentUrl : null, kind: asset.kind } : null;
  }
  if (source.kind === "retained-artifact") {
    const artifact = artifacts.find((item) => item.id === source.artifactId);
    if (!artifact || artifact.kind === "3d") return null;
    const imageUrl = artifact.kind === "image" && artifact.preview.kind === "remote-media"
      ? artifact.preview.url
      : artifact.kind === "video" && artifact.preview.kind === "remote-media"
        ? artifact.preview.posterUrl ?? null
        : null;
    return { imageUrl, kind: artifact.kind === "music" ? "audio" as const : artifact.kind };
  }
  return null;
}

function ReferenceVisual({ reference, media, artifacts, label }: {
  reference: CanonReference;
  media: MediaAsset[];
  artifacts: Artifact[];
  label: string;
}) {
  const visual = referenceMedia(reference, media, artifacts);
  return visual ? <SourceVisual imageUrl={visual.imageUrl} kind={visual.kind} label={label} /> : <span className="world-source-visual"><Icon name="shield" size={22} /></span>;
}

function WorldCover({ references, media, artifacts, hue }: {
  references: CanonReference[];
  media: MediaAsset[];
  artifacts: Artifact[];
  hue: string;
}) {
  const visualReferences = [...references]
    .sort((left, right) => Number(right.status === "canonical") - Number(left.status === "canonical") || right.updatedAt.localeCompare(left.updatedAt))
    .filter((reference) => referenceMedia(reference, media, artifacts)?.imageUrl)
    .slice(0, 3);
  return <span className={`world-cover${visualReferences.length ? " has-images" : ""}`} style={{ "--world-hue": hue } as CSSProperties} aria-hidden="true">
    {visualReferences.length ? visualReferences.map((reference) => {
      const visual = referenceMedia(reference, media, artifacts);
      return visual?.imageUrl ? <img key={reference.id} src={visual.imageUrl} alt="" loading="lazy" decoding="async" /> : null;
    }) : <Icon name="projects" size={25} />}
  </span>;
}

function RuleCard({ rule, entities, busy, confirming, onRetire }: {
  rule: ContinuityRule;
  entities: WorldEntity[];
  busy: boolean;
  confirming: boolean;
  onRetire: () => void;
}) {
  const scopes = rule.entityIds.map((id) => entities.find((entity) => entity.id === id)?.name).filter(Boolean);
  return <article className={`world-rule-card strength-${rule.strength}`}>
    <span className="world-rule-mark"><Icon name={rule.strength === "avoid" ? "close" : rule.strength === "must" ? "shield" : "star"} size={14} /></span>
    <span><small>{STRENGTH_LABELS[rule.strength]} {titleCase(rule.facet)} · {scopes.length ? scopes.join(", ") : "Whole world"}</small><strong>{rule.instruction}</strong><em>{rule.modalities.join(" · ")}</em></span>
    <button type="button" disabled={busy} onClick={onRetire}>{confirming ? "Confirm" : "Retire"}</button>
  </article>;
}

export function WorldBoard({ project }: { project: Project }) {
  const {
    snapshot,
    busy,
    createWorld,
    updateWorld,
    archiveWorld,
    createWorldEntity,
    updateWorldEntity,
    createContinuityRule,
    updateContinuityRule,
    createCanonReference,
    updateCanonReference,
    promoteCanonReference,
    loadArtifactHistory,
  } = useStudio();
  const [selectedWorldId, setSelectedWorldId] = useState("");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [sheet, setSheet] = useState<WorldSheetState>(null);
  const [confirmRetire, setConfirmRetire] = useState("");
  const [candidateArtifactHistory, setCandidateArtifactHistory] = useState<CandidateArtifactHistoryState>(() => emptyCandidateArtifactHistory(project.id));
  const pendingHistoryRequests = useRef(new Set<string>());

  const worlds = useMemo(() => (snapshot?.worlds ?? []).filter((world) => world.projectId === project.id).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [project.id, snapshot?.worlds]);
  const activeWorlds = worlds.filter((world) => world.status === "active");
  const archivedWorlds = worlds.filter((world) => world.status === "archived");
  const selectedWorld = activeWorlds.find((world) => world.id === selectedWorldId) ?? activeWorlds[0] ?? null;
  const allEntities = (snapshot?.worldEntities ?? []).filter((entity) => entity.projectId === project.id);
  const worldEntities = selectedWorld ? allEntities.filter((entity) => entity.worldId === selectedWorld.id) : [];
  const activeEntities = worldEntities.filter((entity) => entity.status === "active");
  const retiredEntities = worldEntities.filter((entity) => entity.status === "retired");
  const selectedEntity = activeEntities.find((entity) => entity.id === selectedEntityId) ?? activeEntities[0] ?? null;
  const allRules = (snapshot?.continuityRules ?? []).filter((rule) => rule.projectId === project.id);
  const worldRules = selectedWorld ? allRules.filter((rule) => rule.worldId === selectedWorld.id) : [];
  const activeRules = worldRules.filter((rule) => rule.status === "active" && (!selectedEntity || !rule.entityIds.length || rule.entityIds.includes(selectedEntity.id)));
  const retiredRules = worldRules.filter((rule) => rule.status === "retired");
  const activeEntityIds = new Set(activeEntities.map((entity) => entity.id));
  const pausedRules = worldRules.filter((rule) => rule.status === "active" && rule.entityIds.length > 0 && !rule.entityIds.some((entityId) => activeEntityIds.has(entityId)));
  const projectReferences = (snapshot?.canonReferences ?? []).filter((reference) => reference.projectId === project.id && reference.status !== "retired");
  const worldReferences = selectedWorld ? projectReferences.filter((reference) => reference.worldId === selectedWorld.id) : [];
  const entityReferences = selectedEntity ? worldReferences.filter((reference) => reference.entityId === selectedEntity.id) : [];
  const media = useMemo(() => snapshot?.mediaAssets.filter((asset) => asset.projectId === project.id && asset.status === "retained") ?? [], [project.id, snapshot?.mediaAssets]);
  const artifacts = useMemo(() => snapshot?.artifacts.filter((artifact) => artifact.projectId === project.id) ?? [], [project.id, snapshot?.artifacts]);
  const promotions = snapshot?.canonPromotions ?? [];

  const candidateSources = useMemo<CandidateSourceOption[]>(() => [
    ...media.map((asset) => ({
      key: `upload:${asset.id}`,
      origin: "upload" as const,
      source: { kind: "owner-upload" as const, mediaId: asset.id, label: asset.name },
      label: asset.name,
      kind: asset.kind,
      imageUrl: asset.kind === "image" ? asset.contentUrl : null,
      createdAt: asset.createdAt,
    })),
    ...artifacts.filter((artifact): artifact is Artifact & { kind: Exclude<Artifact["kind"], "3d"> } => artifact.kind !== "3d").filter((artifact) => artifact.status === "accepted" && artifact.retention.state === "retained").map((artifact) => ({
      key: `artifact:${artifact.id}`,
      origin: "artifact" as const,
      source: { kind: "retained-artifact" as const, artifactId: artifact.id, label: artifact.name },
      label: artifact.name,
      kind: artifact.kind === "music" ? "audio" as const : artifact.kind,
      imageUrl: artifact.kind === "image" && artifact.preview.kind === "remote-media"
        ? artifact.preview.url
        : artifact.kind === "video" && artifact.preview.kind === "remote-media"
          ? artifact.preview.posterUrl ?? null
          : null,
      createdAt: artifact.createdAt,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.key.localeCompare(left.key)), [artifacts, media]);

  const activeCandidateArtifactHistory = candidateArtifactHistory.projectId === project.id
    ? candidateArtifactHistory
    : emptyCandidateArtifactHistory(project.id);
  const loadAcceptedCandidateArtifacts = async () => {
    const current = candidateArtifactHistory.projectId === project.id
      ? candidateArtifactHistory
      : emptyCandidateArtifactHistory(project.id);
    if (current.loading || (current.loaded && !current.hasMore)) return;
    const cursor = current.loaded ? current.nextCursor : null;
    const requestKey = `${project.id}:${cursor?.createdAt ?? "first"}:${cursor?.artifactId ?? "first"}`;
    if (pendingHistoryRequests.current.has(requestKey)) return;
    pendingHistoryRequests.current.add(requestKey);
    setCandidateArtifactHistory((existing) => ({
      ...(existing.projectId === project.id ? existing : emptyCandidateArtifactHistory(project.id)),
      loading: true,
      error: "",
    }));
    try {
      const page = await loadArtifactHistory({
        projectId: project.id,
        statuses: ["accepted"],
        includeArchived: false,
        limit: 50,
        cursor,
      });
      setCandidateArtifactHistory((existing) => existing.projectId !== project.id ? existing : {
        ...existing,
        loaded: true,
        loading: false,
        error: "",
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        total: page.total,
      });
    } catch (error) {
      setCandidateArtifactHistory((existing) => existing.projectId !== project.id ? existing : {
        ...existing,
        loading: false,
        error: actionMessage(error),
      });
    } finally {
      pendingHistoryRequests.current.delete(requestKey);
    }
  };

  const openCandidate = (worldId: string, entityId: string) => {
    setSheet({ kind: "create-candidate", worldId, entityId });
    void loadAcceptedCandidateArtifacts();
  };

  const chooseWorld = (worldId: string) => {
    setSelectedWorldId(worldId);
    setSelectedEntityId("");
    setConfirmRetire("");
  };

  const quietly = (action: Promise<unknown>) => void action.catch(() => undefined);

  if (!selectedWorld) {
    return <section className="world-board glass" aria-label={`Creative worlds for ${project.name}`} style={{ "--world-hue": project.hue } as CSSProperties}>
      <header className="world-board-title">
        <span className="world-board-icon"><Icon name="projects" size={19} /></span>
        <span><small>Continuity</small><strong>World & characters</strong><em>Build reusable canon without changing accepted work automatically.</em></span>
        <button type="button" className="btn btn-primary" onClick={() => setSheet({ kind: "create-world" })}><Icon name="plus" size={15} /> New world</button>
      </header>
      <div className="world-empty">
        <span className="world-empty-graphic"><Icon name="dna" size={28} /></span>
        <span><strong>No world in this project yet</strong><small>Create one, then add characters, places, references, and rules that generation can reuse.</small></span>
        <button type="button" onClick={() => setSheet({ kind: "create-world" })}>Create world <Icon name="arrow" size={14} /></button>
      </div>
      {archivedWorlds.length ? <details className="world-archived"><summary>{archivedWorlds.length} archived {archivedWorlds.length === 1 ? "world" : "worlds"}</summary><div>{archivedWorlds.map((world) => <span key={world.id}><strong>{world.name}</strong><button type="button" disabled={busy} onClick={() => quietly(updateWorld(world.id, { expectedVersion: world.version, status: "active" }))}>Restore</button></span>)}</div></details> : null}
      {sheet?.kind === "create-world" ? <WorldSheet eyebrow="Continuity" title="Create a world" onClose={() => setSheet(null)}><WorldForm project={project} busy={busy} onClose={() => setSheet(null)} onSave={(name, premise) => createWorld({ projectId: project.id, name, premise })} /></WorldSheet> : null}
    </section>;
  }

  const worldReferenceCounts = {
    canonical: worldReferences.filter((reference) => reference.status === "canonical").length,
    candidate: worldReferences.filter((reference) => reference.status === "candidate").length,
  };

  const editWorld = sheet?.kind === "edit-world" ? activeWorlds.find((world) => world.id === sheet.worldId) ?? null : null;
  const promotionReference = sheet?.kind === "promote-candidate" ? worldReferences.find((reference) => reference.id === sheet.referenceId && reference.status === "candidate") ?? null : null;

  return <section className="world-board glass" aria-label={`Creative worlds for ${project.name}`} style={{ "--world-hue": project.hue } as CSSProperties}>
    <header className="world-board-title">
      <span className="world-board-icon"><Icon name="projects" size={19} /></span>
      <span><small>Continuity · {project.name}</small><strong>World & characters</strong><em>{activeWorlds.length} active · {worldReferenceCounts.canonical} canon · {worldReferenceCounts.candidate} candidates</em></span>
      <button type="button" className="world-icon-button world-new-button" aria-label="Create another world" onClick={() => setSheet({ kind: "create-world" })}><Icon name="plus" size={18} /></button>
    </header>

    <div className="world-switcher" role="tablist" aria-label="Active worlds">
      {activeWorlds.map((world) => {
        const references = projectReferences.filter((reference) => reference.worldId === world.id);
        return <button type="button" key={world.id} role="tab" aria-selected={selectedWorld.id === world.id} className={selectedWorld.id === world.id ? "on" : ""} onClick={() => chooseWorld(world.id)}>
          <WorldCover references={references} media={media} artifacts={artifacts} hue={project.hue} />
          <span><strong>{world.name}</strong><small>{allEntities.filter((entity) => entity.worldId === world.id && entity.status === "active").length} elements</small></span>
        </button>;
      })}
      <button type="button" className="world-switcher-add" onClick={() => setSheet({ kind: "create-world" })}><Icon name="plus" size={16} /><span>New</span></button>
    </div>

    <article className="world-stage">
      <div className="world-stage-hero">
        <WorldCover references={worldReferences} media={media} artifacts={artifacts} hue={project.hue} />
        <span><small>Creative world · v{selectedWorld.version}</small><strong>{selectedWorld.name}</strong>{selectedWorld.premise ? <p>{selectedWorld.premise}</p> : <p className="world-muted">No premise written yet.</p>}</span>
        <button type="button" className="world-icon-button" aria-label={`Edit ${selectedWorld.name}`} onClick={() => setSheet({ kind: "edit-world", worldId: selectedWorld.id })}><Icon name="settings" size={16} /></button>
      </div>

      <div className="world-quick-actions" role="toolbar" aria-label="World actions">
        <button type="button" onClick={() => setSheet({ kind: "create-entity", worldId: selectedWorld.id })}><Icon name="plus" size={14} /> Add element</button>
        <button type="button" onClick={() => setSheet({ kind: "create-rule", worldId: selectedWorld.id, entityId: selectedEntity?.id ?? null })}><Icon name="shield" size={14} /> Add rule</button>
        <button type="button" disabled={!selectedEntity} onClick={() => selectedEntity && openCandidate(selectedWorld.id, selectedEntity.id)}><Icon name="star" size={14} /> Add reference</button>
      </div>

      {activeEntities.length ? <div className="world-entity-rail" role="tablist" aria-label="Characters, places, and objects">
        {activeEntities.map((entity) => {
          const references = worldReferences.filter((reference) => reference.entityId === entity.id);
          const preferred = references.find((reference) => reference.status === "canonical") ?? references[0];
          const visual = preferred ? referenceMedia(preferred, media, artifacts) : null;
          return <button type="button" key={entity.id} role="tab" aria-selected={selectedEntity?.id === entity.id} className={selectedEntity?.id === entity.id ? "on" : ""} onClick={() => { setSelectedEntityId(entity.id); setConfirmRetire(""); }}>
            {visual ? <SourceVisual imageUrl={visual.imageUrl} kind={visual.kind} label={entity.name} /> : <span className="world-entity-icon"><Icon name={entity.kind === "character" ? "dna" : entity.kind === "place" ? "projects" : "cube"} size={20} /></span>}
            <span><strong>{entity.name}</strong><small>{ENTITY_LABELS[entity.kind]} · {references.filter((reference) => reference.status === "canonical").length} canon</small></span>
          </button>;
        })}
        <button type="button" className="world-entity-add" onClick={() => setSheet({ kind: "create-entity", worldId: selectedWorld.id })}><Icon name="plus" size={17} /><span>Add</span></button>
      </div> : <button type="button" className="world-first-entity" onClick={() => setSheet({ kind: "create-entity", worldId: selectedWorld.id })}><span><Icon name="dna" size={23} /></span><strong>Add the first character, place, or object</strong><Icon name="arrow" size={15} /></button>}

      {selectedEntity ? <div className="world-entity-panel" role="tabpanel">
        <header>
          <span><small>{ENTITY_LABELS[selectedEntity.kind]} · v{selectedEntity.version}</small><strong>{selectedEntity.name}</strong>{selectedEntity.summary ? <p>{selectedEntity.summary}</p> : null}</span>
          <button type="button" className={confirmRetire === `entity:${selectedEntity.id}` ? "confirm" : ""} disabled={busy} onClick={() => {
            const key = `entity:${selectedEntity.id}`;
            if (confirmRetire !== key) { setConfirmRetire(key); return; }
            quietly(updateWorldEntity(selectedWorld.id, selectedEntity.id, { expectedVersion: selectedEntity.version, status: "retired" }));
            setConfirmRetire("");
          }}>{confirmRetire === `entity:${selectedEntity.id}` ? "Confirm retire" : "Retire"}</button>
        </header>
        {selectedEntity.aliases.length || selectedEntity.attributes.length ? <div className="world-attribute-chips">
          {selectedEntity.aliases.map((alias) => <span className="alias" key={alias}>AKA {alias}</span>)}
          {selectedEntity.attributes.map((attribute, index) => <span key={`${attribute.facet}:${index}`}><small>{titleCase(attribute.facet)}</small>{attribute.value}</span>)}
        </div> : null}

        <div className="world-panel-section">
          <header><span><strong>Canon references</strong><small>{entityReferences.filter((reference) => reference.status === "canonical").length} canon · {entityReferences.filter((reference) => reference.status === "candidate").length} waiting</small></span><button type="button" onClick={() => openCandidate(selectedWorld.id, selectedEntity.id)}><Icon name="plus" size={13} /> Candidate</button></header>
          {entityReferences.length ? <div className="world-reference-rail">
            {entityReferences.map((reference) => {
              const promotion = promotions.find((item) => item.referenceId === reference.id);
              const sourceLabel = reference.source.kind === "commercial-reference" ? "Abstracted reference" : reference.source.label;
              const referenceConfirmKey = `reference:${reference.id}`;
              return <article key={reference.id} className={`world-reference-card ${reference.status}`}>
                <ReferenceVisual reference={reference} media={media} artifacts={artifacts} label={sourceLabel} />
                <span><small className="world-reference-status"><Icon name={reference.status === "canonical" ? "shield" : "history"} size={11} />{reference.status}</small><strong>{sourceLabel}</strong><em>{reference.continuityNotes.map((entry) => titleCase(entry.facet)).join(" · ")}</em>{promotion ? <p title={promotion.note}>Promoted by {promotion.actor} · {promotion.note}</p> : null}</span>
                {reference.status === "candidate" ? <div>
                  <button type="button" className="world-promote" onClick={() => setSheet({ kind: "promote-candidate", worldId: selectedWorld.id, referenceId: reference.id })}>Promote</button>
                  <button type="button" className={confirmRetire === referenceConfirmKey ? "confirm" : ""} disabled={busy} onClick={() => {
                    if (confirmRetire !== referenceConfirmKey) { setConfirmRetire(referenceConfirmKey); return; }
                    quietly(updateCanonReference(selectedWorld.id, reference.id, { expectedVersion: reference.version, status: "retired" }));
                    setConfirmRetire("");
                  }}>{confirmRetire === referenceConfirmKey ? "Confirm" : "Remove"}</button>
                </div> : null}
              </article>;
            })}
          </div> : <button type="button" className="world-empty-row" onClick={() => openCandidate(selectedWorld.id, selectedEntity.id)}><Icon name="gallery" size={18} /><span><strong>No references yet</strong><small>Add an owner upload or accepted artifact as a candidate.</small></span><Icon name="arrow" size={14} /></button>}
        </div>

        <div className="world-panel-section">
          <header><span><strong>Continuity rules</strong><small>{activeRules.length} active for this view</small></span><button type="button" onClick={() => setSheet({ kind: "create-rule", worldId: selectedWorld.id, entityId: selectedEntity.id })}><Icon name="plus" size={13} /> Rule</button></header>
          {activeRules.length ? <div className="world-rules-list">{activeRules.map((rule) => <RuleCard key={rule.id} rule={rule} entities={activeEntities} busy={busy} confirming={confirmRetire === `rule:${rule.id}`} onRetire={() => {
            const key = `rule:${rule.id}`;
            if (confirmRetire !== key) { setConfirmRetire(key); return; }
            quietly(updateContinuityRule(selectedWorld.id, rule.id, { expectedVersion: rule.version, status: "retired" }));
            setConfirmRetire("");
          }} />)}</div> : <button type="button" className="world-empty-row" onClick={() => setSheet({ kind: "create-rule", worldId: selectedWorld.id, entityId: selectedEntity.id })}><Icon name="shield" size={18} /><span><strong>No active rules here</strong><small>Add only the constraints generation truly needs.</small></span><Icon name="arrow" size={14} /></button>}
        </div>
      </div> : null}
    </article>

    {retiredEntities.length || retiredRules.length || pausedRules.length || archivedWorlds.length ? <details className="world-archived"><summary>Retired & archived · {retiredEntities.length + retiredRules.length + pausedRules.length + archivedWorlds.length}</summary><div>
      {retiredEntities.map((entity) => <span key={entity.id}><strong>{entity.name}</strong><small>Retired {ENTITY_LABELS[entity.kind].toLowerCase()}</small><button type="button" disabled={busy} onClick={() => quietly(updateWorldEntity(entity.worldId, entity.id, { expectedVersion: entity.version, status: "active" }))}>Restore</button></span>)}
      {pausedRules.map((rule) => { const key = `rule:${rule.id}`; return <span key={rule.id}><strong>{titleCase(rule.facet)} rule</strong><small>Paused because its element is retired</small><button type="button" className={confirmRetire === key ? "confirm" : ""} disabled={busy} onClick={() => { if (confirmRetire !== key) { setConfirmRetire(key); return; } quietly(updateContinuityRule(rule.worldId, rule.id, { expectedVersion: rule.version, status: "retired" })); setConfirmRetire(""); }}>{confirmRetire === key ? "Confirm retire" : "Retire rule"}</button></span>; })}
      {retiredRules.map((rule) => { const canRestore = rule.entityIds.every((entityId) => activeEntityIds.has(entityId)); return <span key={rule.id}><strong>{titleCase(rule.facet)} rule</strong><small>{canRestore ? rule.instruction : "Restore its element before this rule"}</small><button type="button" disabled={busy || !canRestore} onClick={() => quietly(updateContinuityRule(rule.worldId, rule.id, { expectedVersion: rule.version, status: "active" }))}>Restore</button></span>; })}
      {archivedWorlds.map((world) => <span key={world.id}><strong>{world.name}</strong><small>Archived world</small><button type="button" disabled={busy} onClick={() => quietly(updateWorld(world.id, { expectedVersion: world.version, status: "active" }))}>Restore</button></span>)}
    </div></details> : null}

    {sheet?.kind === "create-world" ? <WorldSheet eyebrow="Continuity" title="Create a world" onClose={() => setSheet(null)}><WorldForm project={project} busy={busy} onClose={() => setSheet(null)} onSave={(name, premise) => createWorld({ projectId: project.id, name, premise })} /></WorldSheet> : null}
    {editWorld ? <WorldSheet eyebrow="World settings" title={`Edit ${editWorld.name}`} onClose={() => setSheet(null)}><WorldForm project={project} world={editWorld} busy={busy} onClose={() => setSheet(null)} onSave={(name, premise) => updateWorld(editWorld.id, { name, premise, expectedVersion: editWorld.version })} onArchive={() => archiveWorld(editWorld.id, editWorld.version)} /></WorldSheet> : null}
    {sheet?.kind === "create-entity" ? <WorldSheet eyebrow={selectedWorld.name} title="Add a world element" onClose={() => setSheet(null)}><EntityForm projectId={project.id} busy={busy} onClose={() => setSheet(null)} onSave={(input) => createWorldEntity(selectedWorld.id, input)} /></WorldSheet> : null}
    {sheet?.kind === "create-rule" ? <WorldSheet eyebrow={selectedWorld.name} title="Add continuity rule" onClose={() => setSheet(null)}><RuleForm projectId={project.id} entities={activeEntities} initialEntityId={sheet.entityId} busy={busy} onClose={() => setSheet(null)} onSave={(input) => createContinuityRule(selectedWorld.id, input)} /></WorldSheet> : null}
    {sheet?.kind === "create-candidate" ? <WorldSheet eyebrow={selectedEntity?.name ?? selectedWorld.name} title="Add canon candidate" onClose={() => setSheet(null)}><CandidateForm projectId={project.id} entityId={sheet.entityId} sources={candidateSources} artifactHistory={activeCandidateArtifactHistory} busy={busy} onClose={() => setSheet(null)} onLoadArtifacts={loadAcceptedCandidateArtifacts} onSave={(input) => createCanonReference(selectedWorld.id, input)} /></WorldSheet> : null}
    {promotionReference ? <WorldSheet eyebrow="Explicit canon review" title="Promote candidate" onClose={() => setSheet(null)}><PromotionForm reference={promotionReference} busy={busy} onClose={() => setSheet(null)} onPromote={(facets, note) => promoteCanonReference(selectedWorld.id, promotionReference.id, {
      schemaVersion: PROMOTE_TO_CANON_SCHEMA_VERSION,
      confirmation: "promote-to-canon",
      worldId: selectedWorld.id,
      entityId: promotionReference.entityId,
      referenceId: promotionReference.id,
      facets,
      note,
      expectedReferenceVersion: promotionReference.version,
    })} /></WorldSheet> : null}
  </section>;
}
