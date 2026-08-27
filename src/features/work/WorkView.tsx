import { useEffect, useMemo, useState } from "react";
import type { ProductionCockpitAction, ProductionCockpitRun } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { ArtifactsView, type ArtifactsViewProps } from "../artifacts/ArtifactsView";
import { CockpitView } from "../cockpit/CockpitView";
import "./work.css";

export type WorkSegment = "needs-action" | "running" | "results";

export type WorkViewProps = Pick<ArtifactsViewProps, "onQueued" | "onContinueLoop" | "onExtendVideo" | "onEvolve" | "onAnimate"> & {
  onOpen: (action: ProductionCockpitAction) => void;
  focusRunId?: string;
  focusArtifactId?: string;
  initialSegment?: WorkSegment;
};

function isRunning(run: ProductionCockpitRun) {
  return run.status === "queued" || run.status === "running" || run.status === "waiting-for-runner";
}

function initialWorkSegment({ initialSegment, focusRunId, focusArtifactId }: Pick<WorkViewProps, "initialSegment" | "focusRunId" | "focusArtifactId">): WorkSegment {
  if (focusArtifactId) return "results";
  if (focusRunId) return "running";
  return initialSegment ?? "needs-action";
}

export function WorkView({
  onOpen,
  onQueued,
  onContinueLoop,
  onExtendVideo,
  onEvolve,
  onAnimate,
  focusRunId,
  focusArtifactId,
  initialSegment,
}: WorkViewProps) {
  const { snapshot, activeProjectId, refresh, busy } = useStudio();
  const project = snapshot?.projects.find((item) => item.id === activeProjectId);
  const cockpit = snapshot?.productionCockpit;

  const projectRuns = useMemo(
    () => cockpit?.runs.filter((run) => run.projectId === activeProjectId) ?? [],
    [activeProjectId, cockpit?.runs],
  );
  const projectActions = useMemo(
    () => cockpit?.actions.filter((action) => action.projectId === null || action.projectId === activeProjectId) ?? [],
    [activeProjectId, cockpit?.actions],
  );
  const resultCount = useMemo(
    () => snapshot?.artifacts.filter((artifact) => artifact.projectId === activeProjectId && artifact.status !== "archived").length ?? 0,
    [activeProjectId, snapshot?.artifacts],
  );
  const runningCount = projectRuns.filter(isRunning).length;
  const completedCount = projectRuns.filter((run) => run.status === "completed").length;
  const failedCount = projectRuns.filter((run) => run.status === "failed" || run.status === "cancelled").length;
  const retainedBytes = projectRuns.reduce((total, run) => total + (run.retainedBytes ?? 0), 0);
  const [segment, setSegment] = useState<WorkSegment>(() => {
    const requested = initialWorkSegment({ initialSegment, focusRunId, focusArtifactId });
    if (initialSegment || focusRunId || focusArtifactId) return requested;
    if (projectActions.length) return "needs-action";
    return runningCount ? "running" : "results";
  });
  const runnerAvailable = cockpit?.runners.some((runner) => runner.state === "online" || runner.state === "busy") ?? false;
  const runnerBusy = cockpit?.runners.some((runner) => runner.state === "busy") ?? false;

  useEffect(() => {
    if (!focusArtifactId && !focusRunId) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusArtifactId) {
        setSegment("results");
        return;
      }
      const focusedRun = projectRuns.find((run) => run.id === focusRunId);
      setSegment(focusedRun && !isRunning(focusedRun) ? "needs-action" : "running");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusArtifactId, focusRunId, projectRuns]);

  const openAction = (action: ProductionCockpitAction) => {
    if (action.kind === "review-artifact") setSegment("results");
    if (action.kind === "retry-generation") setSegment("running");
    onOpen(action);
  };

  const queued = () => {
    setSegment("running");
    onQueued();
  };

  const tabs: Array<{ id: WorkSegment; label: string; count: number; icon: "bell" | "queue" | "gallery" }> = [
    { id: "needs-action", label: "Needs action", count: projectActions.length, icon: "bell" },
    { id: "running", label: "Running", count: runningCount, icon: "queue" },
    { id: "results", label: "Results", count: resultCount, icon: "gallery" },
  ];

  return (
    <section className="work-view fade-up" aria-labelledby="work-title">
      <header className="work-header">
        <div>
          <span className="eyebrow">{project?.name ?? "Active project"}</span>
          <h2 id="work-title">Work</h2>
          <p>Make progress, recover runs, and decide what stays.</p>
        </div>
        <div className="work-header-actions">
          <span className={`work-runner-chip ${runnerBusy ? "busy" : runnerAvailable ? "online" : "offline"}`} title="Local Runner state">
            <i /> {runnerBusy ? "Runner busy" : runnerAvailable ? "Runner ready" : "Runner offline"}
          </span>
          <button type="button" className="icon-button" aria-label="Refresh work" disabled={busy} onClick={() => void refresh()}><Icon name="rerun" size={17} /></button>
          <button type="button" className="btn btn-primary work-create" onClick={onContinueLoop}><Icon name="star" size={15} /><span>Create</span></button>
        </div>
      </header>

      <nav className="work-segments glass" aria-label="Work lifecycle">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={segment === tab.id ? "active" : ""}
            aria-pressed={segment === tab.id}
            onClick={() => setSegment(tab.id)}
          >
            <Icon name={tab.icon} size={16} />
            <span>{tab.label}</span>
            <strong>{tab.count}</strong>
          </button>
        ))}
      </nav>

      <div className="work-panel">
        {segment === "needs-action" ? <CockpitView embedded mode="needs-action" projectId={activeProjectId} focusRunId={focusRunId} onOpen={openAction} /> : null}
        {segment === "running" ? <CockpitView embedded mode="running" projectId={activeProjectId} focusRunId={focusRunId} onOpen={openAction} onRunStatusChange={() => setSegment("needs-action")} /> : null}
        {segment === "results" ? <>
          <details className="work-history glass">
            <summary><span><Icon name="history" size={15} /><strong>Run history &amp; performance</strong></span><small>{projectRuns.length} durable {projectRuns.length === 1 ? "run" : "runs"}</small><Icon name="chevronDown" size={14} /></summary>
            <div className="work-history-stats"><span><small>All runs</small><strong>{projectRuns.length}</strong></span><span><small>Completed</small><strong>{completedCount}</strong></span><span><small>Failed / cancelled</small><strong>{failedCount}</strong></span><span><small>Retained</small><strong>{retainedBytes >= 1024 * 1024 ? `${(retainedBytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(retainedBytes / 1024)} KB`}</strong></span></div>
            <CockpitView embedded mode="history" projectId={activeProjectId} onOpen={openAction} />
          </details>
          <ArtifactsView embedded compact focusArtifactId={focusArtifactId} onQueued={queued} onContinueLoop={onContinueLoop} onExtendVideo={onExtendVideo} onEvolve={onEvolve} onAnimate={onAnimate} />
        </> : null}
      </div>
    </section>
  );
}
