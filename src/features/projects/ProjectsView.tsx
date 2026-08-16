import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ProjectAvatar } from "../../components/Visuals";

export function ProjectsView() {
  const { snapshot, activeProjectId, setActiveProjectId } = useStudio();
  return (
    <section className="projects-view fade-up">
      <div className="projects-grid">
        {snapshot?.projects.map((project) => {
          const jobs = snapshot.jobs.filter((job) => job.projectId === project.id).length;
          const artifacts = snapshot.artifacts.filter((artifact) => artifact.projectId === project.id).length;
          return <button key={project.id} className={`project-card glass${activeProjectId === project.id ? " on" : ""}`} onClick={() => setActiveProjectId(project.id)}><ProjectAvatar project={project} size={58} /><span className="project-card-main"><span><strong>{project.name}</strong><i className={`badge ${project.status === "active" ? "active" : "draft"}`}>{project.status}</i></span><small>{project.type}</small><p>{project.description}</p><em>{project.note}</em></span><span className="project-counts"><b>{jobs}<small>jobs</small></b><b>{artifacts}<small>artifacts</small></b><Icon name="chevron" size={18} /></span></button>;
        })}
      </div>
    </section>
  );
}
