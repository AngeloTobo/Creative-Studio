import { useState, type FormEvent } from "react";
import {
  PROJECT_HUES,
  type CreateProjectRequest,
  type Project,
  type ProjectHue,
  type ProductionLoopStage,
  type ProductionLoopSurface,
  type ProductionCockpitAction,
  type UpdateProjectRequest,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ProjectAvatar } from "../../components/Visuals";

type ProjectFormValue = CreateProjectRequest & { status: "active" | "paused" };
export type ProjectDestination = "dna" | "gallery" | "cockpit" | "queue";

export type ProjectsViewProps = {
  onOpen: (destination: ProjectDestination, action?: ProductionCockpitAction) => void;
  embedded?: boolean;
};

const STAGE_LABELS: Record<ProductionLoopStage, string> = {
  "needs-dna": "Direction needed",
  "ready-to-generate": "Ready to create",
  "generation-running": "Generation running",
  "review-output": "Review needed",
  "generation-failed": "Run needs attention",
  "evidence-ready": "Training evidence ready",
  "training-running": "Training running",
  "review-training": "Training review needed",
};

function destinationFor(surface: ProductionLoopSurface): ProjectDestination {
  if (surface === "artifacts") return "gallery";
  if (surface === "queue") return "queue";
  return "dna";
}

function ProjectForm({ project, firstProject = false, busy, onSave, onCancel }: {
  project?: Project;
  firstProject?: boolean;
  busy: boolean;
  onSave: (input: ProjectFormValue) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [type, setType] = useState(project?.type ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [note, setNote] = useState(project?.note ?? "");
  const [hue, setHue] = useState<ProjectHue>((PROJECT_HUES as readonly string[]).includes(project?.hue ?? "") ? project?.hue as ProjectHue : PROJECT_HUES[0]);
  const [status, setStatus] = useState<"active" | "paused">(project?.status === "paused" ? "paused" : "active");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onSave({ name: name.trim(), type: type.trim() || "Creative project", description, note, hue, status });
  };

  return (
    <form className="project-form project-form-progressive glass" onSubmit={(event) => void submit(event)}>
      <div className="project-form-head">
        <div>
          <span className="eyebrow">{project ? "Project details" : firstProject ? "First workspace" : "New workspace"}</span>
          <h2>{project ? `Edit ${project.name}` : firstProject ? "Name your first project" : "Create a project"}</h2>
        </div>
        {onCancel ? <button type="button" className="btn-icon" aria-label="Close project form" onClick={onCancel}><Icon name="close" size={18} /></button> : null}
      </div>
      {!project ? <p className="project-form-copy">Start with a name. Canon, direction, type, and color can be added when they become useful.</p> : null}
      <label className="field project-name-first"><span>Project name</span><input className="input" autoFocus={firstProject} aria-label="Project name" value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} placeholder="New world, character, album…" /></label>
      <details className="project-options" open={Boolean(project)}>
        <summary><Icon name="settings" size={15} /><span>{project ? "Project details" : "Add details"}</span><small>Optional</small><Icon name="chevronDown" size={14} /></summary>
        <div className="project-fields">
          <label className="field"><span>Type</span><input className="input" aria-label="Project type" value={type} maxLength={80} onChange={(event) => setType(event.target.value)} placeholder="Creative project" /></label>
          {project ? <label className="field"><span>Status</span><select className="input" aria-label="Project status" value={status} onChange={(event) => setStatus(event.target.value as "active" | "paused")}><option value="active">Active</option><option value="paused">Paused</option></select></label> : null}
          <label className="field project-field-wide"><span>Project / character canon</span><textarea className="textarea project-description" aria-label="Project or character canon" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="Identity, world rules, appearance, and continuity that must remain true." /></label>
          <label className="field project-field-wide"><span>Current piece direction</span><input className="input" aria-label="Current piece direction" value={note} maxLength={250} onChange={(event) => setNote(event.target.value)} placeholder="What this piece is doing now" /></label>
        </div>
        <fieldset className="project-hues"><legend>Project color</legend>{PROJECT_HUES.map((color) => <button type="button" key={color} aria-label={`Use project color ${color}`} aria-pressed={hue === color} className={hue === color ? "on" : ""} style={{ "--project-hue": color } as React.CSSProperties} onClick={() => setHue(color)} />)}</fieldset>
      </details>
      <div className="project-form-actions">
        {onCancel ? <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button> : null}
        <button className="btn btn-primary" disabled={busy || !name.trim()}><Icon name={project ? "check" : "plus"} size={16} /> {busy ? "Saving…" : project ? "Save changes" : "Create project"}</button>
      </div>
    </form>
  );
}

export function ProjectsView({ onOpen, embedded = false }: ProjectsViewProps) {
  const { snapshot, activeProjectId, setActiveProjectId, createProject, updateProject, archiveProject, busy, error } = useStudio();
  const projects = snapshot?.projects ?? [];
  const availableProjects = projects.filter((project) => project.status !== "archived");
  const archivedProjects = projects.filter((project) => project.status === "archived");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const showCreateForm = creating || availableProjects.length === 0;
  const editingProject = projects.find((project) => project.id === editingId) ?? null;

  const open = (projectId: string, destination: ProjectDestination, action?: ProductionCockpitAction) => {
    setActiveProjectId(projectId);
    onOpen(destination, action);
  };

  const create = async (input: ProjectFormValue) => {
    const request: CreateProjectRequest = {
      name: input.name,
      type: input.type || "Creative project",
      description: input.description,
      note: input.note,
      hue: input.hue,
    };
    await createProject(request);
    setCreating(false);
  };

  const update = async (projectId: string, input: ProjectFormValue) => {
    await updateProject(projectId, input satisfies UpdateProjectRequest);
    setEditingId(null);
  };

  const archive = async (projectId: string) => {
    if (confirmArchiveId !== projectId) {
      setConfirmArchiveId(projectId);
      return;
    }
    await archiveProject(projectId);
    setConfirmArchiveId(null);
    setEditingId(null);
  };

  return (
    <section className={`projects-view projects-view-compact fade-up${availableProjects.length === 0 ? " project-onboarding" : ""}${embedded ? " embedded" : ""}`}>
      {availableProjects.length ? <div className="projects-toolbar"><div>{!embedded ? <span className="eyebrow">Projects</span> : null}<h2>{embedded ? "Your projects" : "Choose your workspace"}</h2><p>{availableProjects.length} available · newest activity stays with its project.</p></div><button className="btn btn-primary" onClick={() => { setEditingId(null); setCreating(true); }}><Icon name="plus" size={16} /> New</button></div> : null}
      {showCreateForm ? <ProjectForm firstProject={!availableProjects.length} busy={busy} onSave={create} onCancel={availableProjects.length ? () => setCreating(false) : undefined} /> : null}
      {editingProject ? <ProjectForm key={editingProject.updatedAt} project={editingProject} busy={busy} onSave={(input) => update(editingProject.id, input)} onCancel={() => setEditingId(null)} /> : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="projects-grid">
        {availableProjects.map((project) => {
          const jobs = snapshot?.jobs.filter((job) => job.projectId === project.id).length ?? 0;
          const artifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === project.id).length ?? 0;
          const dna = snapshot?.dnaArtifacts.filter((artifact) => artifact.projectId === project.id).length ?? 0;
          const sources = snapshot?.mediaAssets.filter((asset) => asset.projectId === project.id).length ?? 0;
          const loop = snapshot?.productionLoops.find((item) => item.projectId === project.id) ?? null;
          const pendingTrainingJob = loop?.pendingTrainingReviewJobId
            ? snapshot?.trainingJobs.find((job) => job.id === loop.pendingTrainingReviewJobId)
            : undefined;
          const contextualAction = loop?.pendingTrainingReviewJobId
            ? snapshot?.productionCockpit.actions.find((action) => action.kind === "review-training" && action.entityId === loop.pendingTrainingReviewJobId) ?? (pendingTrainingJob ? {
              id: `review-training:${pendingTrainingJob.id}`,
              kind: "review-training",
              severity: "critical",
              projectId: project.id,
              projectName: project.name,
              entityId: pendingTrainingJob.id,
              modality: "training",
              title: "Review trained CreativeDNA",
              detail: `${pendingTrainingJob.name} completed and is waiting for your decision.`,
              actionLabel: "Review trained version",
              surface: "dna",
              createdAt: pendingTrainingJob.completedAt ?? pendingTrainingJob.updatedAt,
            } satisfies ProductionCockpitAction : undefined)
            : undefined;
          const current = activeProjectId === project.id;
          return <article key={project.id} className={`project-card project-compact-card glass${current ? " on" : ""}`}>
            <button type="button" className="project-compact-select" aria-pressed={current} onClick={() => setActiveProjectId(project.id)}>
              <ProjectAvatar project={project} size={44} />
              <span className="project-card-main">
                <span><strong>{project.name}</strong><i className={`badge ${project.status === "active" ? "active" : "draft"}`}>{project.status}</i>{current ? <i className="project-current">current</i> : null}</span>
                <small>{project.type || "Creative project"} · updated {new Date(project.updatedAt).toLocaleDateString()}</small>
                {project.note ? <em>{project.note}</em> : null}
              </span>
              <span className="project-compact-counts" aria-label={`${dna} DNA versions, ${sources} sources, ${jobs} jobs, ${artifacts} results`}>
                <b>{dna}<small>DNA</small></b><b>{sources}<small>media</small></b><b>{jobs}<small>jobs</small></b><b>{artifacts}<small>results</small></b>
              </span>
            </button>
            <div className="project-compact-next">
              <span className={`production-loop-stage ${loop?.stage ?? "needs-dna"}`}>{loop ? STAGE_LABELS[loop.stage] : "Direction needed"}</span>
              <button className="project-next-action" onClick={() => open(project.id, loop ? destinationFor(loop.nextAction.surface) : "dna", contextualAction)}><span><small>Next</small><strong>{loop?.nextAction.label ?? "Build CreativeDNA"}</strong></span><Icon name="arrow" size={15} /></button>
              <details className="project-menu">
                <summary aria-label={`Project actions for ${project.name}`}><Icon name="more" size={18} /></summary>
                <div>
                  <button type="button" disabled={busy} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setCreating(false); setEditingId(project.id); setConfirmArchiveId(null); }}><Icon name="settings" size={14} /> Edit details</button>
                  <button type="button" className="project-archive" disabled={busy} onClick={() => void archive(project.id)}><Icon name={confirmArchiveId === project.id ? "check" : "archive"} size={14} /> {confirmArchiveId === project.id ? "Confirm archive" : "Archive"}</button>
                </div>
              </details>
            </div>
          </article>;
        })}
      </div>
      {archivedProjects.length ? <details className="archived-projects"><summary>Archived · {archivedProjects.length}</summary><div>{archivedProjects.map((project) => <article className="project-archived-row glass" key={project.id}><ProjectAvatar project={project} size={38} /><span><strong>{project.name}</strong><small>{project.type} · archived</small></span></article>)}</div></details> : null}
    </section>
  );
}
