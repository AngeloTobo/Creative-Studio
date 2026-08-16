import { useState, type FormEvent } from "react";
import {
  PROJECT_HUES,
  type CreateProjectRequest,
  type Project,
  type ProjectHue,
  type UpdateProjectRequest,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ProjectAvatar } from "../../components/Visuals";

type ProjectFormValue = CreateProjectRequest & { status: "active" | "paused" };

function ProjectForm({ project, busy, onSave, onCancel }: {
  project?: Project;
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
        <div><span className="eyebrow">{project ? "Project details" : "Start with real work"}</span><h2>{project ? `Edit ${project.name}` : "Create your first project"}</h2></div>
        {onCancel ? <button type="button" className="btn-icon" aria-label="Close project form" onClick={onCancel}><Icon name="close" size={18} /></button> : null}
      </div>
      {!project ? <p className="project-form-copy">Projects hold their own CreativeDNA, jobs, artifacts, and review history. Nothing is created until you name it.</p> : null}
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

export function ProjectsView() {
  const { snapshot, activeProjectId, setActiveProjectId, createProject, updateProject, archiveProject, busy, error } = useStudio();
  const projects = snapshot?.projects ?? [];
  const availableProjects = projects.filter((project) => project.status !== "archived");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  const showCreateForm = creating || availableProjects.length === 0;

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
      {availableProjects.length ? <div className="projects-toolbar"><div><span className="eyebrow">Product-owned workspaces</span><h2>Projects</h2></div><button className="btn btn-primary" onClick={() => { setEditingId(null); setCreating(true); }}><Icon name="plus" size={16} /> New project</button></div> : null}
      {showCreateForm ? <ProjectForm busy={busy} onSave={create} onCancel={availableProjects.length ? () => setCreating(false) : undefined} /> : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      <div className="projects-grid">
        {projects.map((project) => {
          const jobs = snapshot?.jobs.filter((job) => job.projectId === project.id).length ?? 0;
          const artifacts = snapshot?.artifacts.filter((artifact) => artifact.projectId === project.id).length ?? 0;
          const archived = project.status === "archived";
          return <article key={project.id} className={`project-card glass${activeProjectId === project.id ? " on" : ""}${archived ? " archived" : ""}`}>
            <button className="project-select" disabled={archived} onClick={() => setActiveProjectId(project.id)}>
              <ProjectAvatar project={project} size={58} />
              <span className="project-card-main"><span><strong>{project.name}</strong><i className={`badge ${project.status === "active" ? "active" : "draft"}`}>{project.status}</i></span><small>{project.type}</small>{project.description ? <p>{project.description}</p> : null}{project.note ? <em>{project.note}</em> : null}</span>
              <span className="project-counts"><b>{jobs}<small>jobs</small></b><b>{artifacts}<small>artifacts</small></b>{!archived ? <Icon name="chevron" size={18} /> : null}</span>
            </button>
            {!archived ? <div className="project-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => { setCreating(false); setEditingId(project.id); setConfirmArchiveId(null); }}><Icon name="settings" size={15} /> Edit</button><button className="btn project-archive" disabled={busy} onClick={() => void archive(project.id)}><Icon name="archive" size={15} /> {confirmArchiveId === project.id ? "Confirm archive" : "Archive"}</button></div> : null}
            {editingId === project.id ? <ProjectForm key={project.updatedAt} project={project} busy={busy} onSave={(input) => update(project.id, input)} onCancel={() => setEditingId(null)} /> : null}
          </article>;
        })}
      </div>
    </section>
  );
}
