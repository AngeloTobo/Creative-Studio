import { useState, type FormEvent } from "react";
import {
  PROJECT_HUES,
  type CreateProjectRequest,
  type Project,
  type ProjectHue,
  type ProductionLoopStage,
  type ProductionLoopSurface,
  type UpdateProjectRequest,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ProjectAvatar } from "../../components/Visuals";

type ProjectFormValue = CreateProjectRequest & { status: "active" | "paused" };
type ProjectDestination = "dna" | "gallery" | "cockpit" | "queue";

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
    if (!name.trim() || !type.trim()) return;
    await onSave({ name, type, description, note, hue, status });
  };

  return (
    <form className="project-form glass" onSubmit={(event) => void submit(event)}>
      <div className="project-form-head">
        <div><span className="eyebrow">{project ? "Project details" : firstProject ? "Start with real work" : "New workspace"}</span><h2>{project ? `Edit ${project.name}` : firstProject ? "Create your first project" : "New project"}</h2></div>
        {onCancel ? <button type="button" className="btn-icon" aria-label="Close project form" onClick={onCancel}><Icon name="close" size={18} /></button> : null}
      </div>
      {!project ? <p className="project-form-copy">A project keeps its direction, source media, workflows, jobs, results, and review history together.</p> : null}
      <div className="project-fields">
        <label className="field"><span>Name</span><input className="input" aria-label="Project name" value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} /></label>
        <label className="field"><span>Type</span><input className="input" aria-label="Project type" value={type} maxLength={80} required onChange={(event) => setType(event.target.value)} /></label>
        <label className="field project-field-wide"><span>Description</span><textarea className="textarea project-description" aria-label="Project description" value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="field"><span>Current note</span><input className="input" aria-label="Project note" value={note} maxLength={250} onChange={(event) => setNote(event.target.value)} /></label>
        <label className="field"><span>Status</span><select className="input" aria-label="Project status" value={status} onChange={(event) => setStatus(event.target.value as "active" | "paused")}><option value="active">Active</option><option value="paused">Paused</option></select></label>
      </div>
      <fieldset className="project-hues"><legend>Project color</legend>{PROJECT_HUES.map((color) => <button type="button" key={color} aria-label={`Use project color ${color}`} aria-pressed={hue === color} className={hue === color ? "on" : ""} style={{ "--project-hue": color } as React.CSSProperties} onClick={() => setHue(color)} />)}</fieldset>
      <div className="project-form-actions">
        {onCancel ? <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button> : null}
        <button className="btn btn-primary" disabled={busy || !name.trim() || !type.trim()}><Icon name={project ? "check" : "plus"} size={16} /> {busy ? "Saving…" : project ? "Save changes" : "Create project"}</button>
      </div>
    </form>
  );
}

export function ProjectsView({ onOpen }: { onOpen: (destination: ProjectDestination) => void }) {
  const { snapshot, activeProjectId, setActiveProjectId, createProject, updateProject, archiveProject, busy, error } = useStudio();
  const projects = snapshot?.projects ?? [];
  const availableProjects = projects.filter((project) => project.status !== "archived");
  const archivedProjects = projects.filter((project) => project.status === "archived");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const showCreateForm = creating || availableProjects.length === 0;
  const editingProject = projects.find((project) => project.id === editingId) ?? null;

  const open = (projectId: string, destination: ProjectDestination) => {
    setActiveProjectId(projectId);
    onOpen(destination);
  };

  const create = async (input: ProjectFormValue) => {
    const request: CreateProjectRequest = {
      name: input.name,
      type: input.type,
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
    <section className={`projects-view fade-up${availableProjects.length === 0 ? " project-onboarding" : ""}`}>
      {availableProjects.length ? <div className="projects-toolbar"><div><span className="eyebrow">Workspace manager</span><h2>Choose your workspace</h2><p>{availableProjects.length} available · switch context or go directly to the work.</p></div><button className="btn btn-primary" onClick={() => { setEditingId(null); setCreating(true); }}><Icon name="plus" size={16} /> New project</button></div> : null}
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
          const current = activeProjectId === project.id;
          return <article key={project.id} className={`project-card project-workspace-card glass${current ? " on" : ""}`}>
            <header className="project-card-head">
              <ProjectAvatar project={project} size={52} />
              <span className="project-card-main"><span><strong>{project.name}</strong><i className={`badge ${project.status === "active" ? "active" : "draft"}`}>{project.status}</i>{current ? <i className="project-current">current</i> : null}</span><small>{project.type} · updated {new Date(project.updatedAt).toLocaleDateString()}</small>{project.description ? <p>{project.description}</p> : null}</span>
            </header>
            {project.note ? <p className="project-note"><Icon name="star" size={14} /> {project.note}</p> : null}
            <div className="project-progress">
              <span className={`production-loop-stage ${loop?.stage ?? "needs-dna"}`}>{loop ? STAGE_LABELS[loop.stage] : "Direction needed"}</span>
              <span><small>Next</small><strong>{loop?.nextAction.label ?? "Build CreativeDNA"}</strong><p>{loop?.nextAction.detail ?? "Create the first reusable direction for this workspace."}</p></span>
              <button className="btn btn-primary" onClick={() => open(project.id, loop ? destinationFor(loop.nextAction.surface) : "dna")}>{loop?.nextAction.label ?? "Open Create"} <Icon name="arrow" size={14} /></button>
            </div>
            <div className="project-metrics"><span><b>{dna}</b><small>DNA</small></span><span><b>{sources}</b><small>sources</small></span><span><b>{jobs}</b><small>jobs</small></span><span><b>{artifacts}</b><small>results</small></span></div>
            <footer className="project-actions">
              <div className="project-open-actions"><button className="btn btn-ghost" onClick={() => open(project.id, "dna")}><Icon name="wand" size={15} /> Create</button><button className="btn btn-ghost" onClick={() => open(project.id, "gallery")}><Icon name="gallery" size={15} /> Artifacts</button><button className="btn btn-ghost" onClick={() => open(project.id, "cockpit")}><Icon name="analytics" size={15} /> Production</button></div>
              <div className="project-admin-actions"><button className="btn btn-ghost" aria-label={`Edit ${project.name}`} disabled={busy} onClick={() => { setCreating(false); setEditingId(project.id); setConfirmArchiveId(null); }}><Icon name="settings" size={14} /> Edit</button><button className="btn project-archive" aria-label={confirmArchiveId === project.id ? `Confirm archive ${project.name}` : `Archive ${project.name}`} disabled={busy} onClick={() => void archive(project.id)}><Icon name={confirmArchiveId === project.id ? "check" : "archive"} size={14} /> {confirmArchiveId === project.id ? "Confirm" : "Archive"}</button></div>
            </footer>
          </article>;
        })}
      </div>
      {archivedProjects.length ? <details className="archived-projects" open={!availableProjects.length}><summary>Archived projects · {archivedProjects.length}</summary><div>{archivedProjects.map((project) => <article className="project-archived-row glass" key={project.id}><ProjectAvatar project={project} size={38} /><span><strong>{project.name}</strong><small>{project.type} · archived</small></span></article>)}</div></details> : null}
    </section>
  );
}
