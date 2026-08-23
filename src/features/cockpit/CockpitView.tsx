import { useEffect, useMemo, useState } from "react";
import type {
  ProductionCockpitAction,
  ProductionCockpitDecision,
  ProductionCockpitRun,
} from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

type CockpitViewProps = {
  focusRunId?: string;
  onOpen: (action: ProductionCockpitAction) => void;
};

type RunScope = "all" | "active" | "review" | "failed";

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function duration(value: number) {
  const seconds = Math.max(0, Math.round(value / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function relative(value: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function iconFor(run: ProductionCockpitRun) {
  if (run.kind === "training") return "dna" as const;
  if (run.modality === "music") return "music" as const;
  if (run.modality === "video") return "video" as const;
  return "image" as const;
}

function isActive(run: ProductionCockpitRun) {
  return run.status === "queued" || run.status === "running" || run.status === "waiting-for-runner";
}

export function CockpitView({ focusRunId, onOpen }: CockpitViewProps) {
  const { snapshot, refresh, retryJob, cancelJob, cancelDnaTraining, busy } = useStudio();
  const cockpit = snapshot?.productionCockpit;
  const [scope, setScope] = useState<RunScope>("all");
  const [project, setProject] = useState("all");
  const [modality, setModality] = useState("all");
  const [workflow, setWorkflow] = useState("all");
  const [dna, setDna] = useState("all");
  const [decision, setDecision] = useState("all");
  const [showAllActions, setShowAllActions] = useState(false);

  useEffect(() => {
    if (!focusRunId) return;
    window.requestAnimationFrame(() => document.getElementById(`cockpit-run-${focusRunId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [focusRunId]);

  const workflowOptions = useMemo(
    () => [...new Set(cockpit?.runs.map((run) => run.workflowName).filter((name): name is string => Boolean(name)) ?? [])].sort(),
    [cockpit?.runs],
  );
  const dnaOptions = useMemo(() => {
    const found = new Map<string, string>();
    for (const run of cockpit?.runs ?? []) {
      if (!run.dnaArtifactId) continue;
      found.set(run.dnaArtifactId, run.dnaName ? `${run.dnaName}${run.dnaVersion ? ` · v${run.dnaVersion}` : ""}` : run.dnaArtifactId);
    }
    return [...found.entries()];
  }, [cockpit?.runs]);

  const runs = useMemo(() => [...(cockpit?.runs ?? [])]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((run) => {
      if (run.id === focusRunId) return true;
      if (scope === "active" && !isActive(run)) return false;
      if (scope === "review" && run.decision !== "unreviewed") return false;
      if (scope === "failed" && run.status !== "failed" && run.status !== "cancelled") return false;
      if (project !== "all" && run.projectId !== project) return false;
      if (modality !== "all" && run.modality !== modality) return false;
      if (workflow !== "all" && (workflow === "direct" ? run.workflowName !== null : run.workflowName !== workflow)) return false;
      if (dna !== "all" && run.dnaArtifactId !== dna) return false;
      if (decision !== "all" && run.decision !== decision) return false;
      return true;
    }), [cockpit?.runs, decision, dna, focusRunId, modality, project, scope, workflow]);

  const actions = (cockpit?.actions ?? []).filter((action) => {
    if (project !== "all" && action.projectId !== project) return false;
    if (modality !== "all" && action.modality !== modality) return false;
    return true;
  });

  const act = async (action: ProductionCockpitAction) => {
    if (action.kind === "retry-generation") {
      const retry = await retryJob(action.entityId);
      onOpen({ ...action, entityId: retry.id });
      return;
    }
    onOpen(action);
  };

  const openRun = (run: ProductionCockpitRun) => {
    if (run.artifactId) {
      onOpen({
        id: `open-artifact:${run.artifactId}`,
        kind: "review-artifact",
        severity: "info",
        projectId: run.projectId,
        projectName: run.projectName,
        entityId: run.artifactId,
        modality: run.modality,
        title: run.title,
        detail: run.detail,
        actionLabel: "Open artifact",
        surface: "gallery",
        createdAt: run.createdAt,
      });
      return;
    }
    if (run.kind === "training") {
      onOpen({
        id: `open-training:${run.id}`,
        kind: run.status === "failed" ? "restart-training" : "review-training",
        severity: "info",
        projectId: run.projectId,
        projectName: run.projectName,
        entityId: run.id,
        modality: "training",
        title: run.title,
        detail: run.detail,
        actionLabel: "Open training",
        surface: "dna",
        createdAt: run.createdAt,
      });
    }
  };

  if (!cockpit) return <section className="cockpit-view fade-up"><div className="empty-state glass"><Icon name="analytics" size={34} /><h2>Production state unavailable</h2><p>Refresh the Worker-backed snapshot to load the dashboard.</p></div></section>;

  const awaitingReview = cockpit.summary.outputsAwaitingReview + cockpit.summary.trainingAwaitingReview;
  const reviewRunCount = cockpit.runs.filter((run) => run.decision === "unreviewed").length;
  const summary = [
    { label: "Needs attention", value: cockpit.summary.actionRequired, detail: cockpit.summary.actionRequired ? `${cockpit.summary.failedRuns} failed` : "All caught up", accent: "var(--pink)", icon: "bell" as const },
    { label: "In progress", value: cockpit.summary.activeRuns, detail: `${cockpit.summary.runningRuns} running · ${cockpit.summary.queuedRuns} waiting`, accent: "var(--cyan)", icon: "queue" as const },
    { label: "Ready to review", value: awaitingReview, detail: `${cockpit.summary.outputsAwaitingReview} output · ${cockpit.summary.trainingAwaitingReview} DNA`, accent: "var(--amber)", icon: "check" as const },
    { label: "Retained", value: cockpit.summary.retainedOutputs, detail: `${bytes(cockpit.summary.storedBytes)} · ${cockpit.summary.retainedFiles} files`, accent: "var(--teal)", icon: "archive" as const },
  ];
  const runnerAvailable = cockpit.runners.filter((runner) => runner.state === "online" || runner.state === "busy").length;
  const shownActions = showAllActions ? actions : actions.slice(0, 3);

  return <section className="cockpit-view fade-up" aria-labelledby="cockpit-title">
    <header className="cockpit-head">
      <div><h2 id="cockpit-title">Production Dashboard</h2><p>Live work, decisions, retained outputs, and local execution in one place.</p></div>
      <button className="btn btn-ghost cockpit-refresh" aria-label="Refresh production" disabled={busy} onClick={() => void refresh()}><Icon name="rerun" size={16} /><span>Refresh</span></button>
    </header>

    <div className="cockpit-summary">
      {summary.map((item) => <article className="glass" key={item.label} style={{ "--cockpit-accent": item.accent } as React.CSSProperties}><span><Icon name={item.icon} size={17} /> {item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></article>)}
    </div>

    <div className="cockpit-fact-strip glass" aria-label="Production totals">
      <span><small>All runs</small><strong>{cockpit.runs.length}</strong></span>
      <span><small>Generated</small><strong>{cockpit.summary.generationRuns}</strong></span>
      <span><small>Training</small><strong>{cockpit.summary.trainingRuns}</strong></span>
      <span><small>Completed</small><strong>{cockpit.summary.completedRuns}</strong></span>
      <span><small>Projects</small><strong>{cockpit.summary.activeProjects}</strong></span>
      <span><small>Local Runner</small><strong>{cockpit.runners.length ? `${runnerAvailable}/${cockpit.runners.length}` : "Not paired"}</strong></span>
    </div>

    <section className={`cockpit-inbox glass${actions.length ? " has-actions" : ""}`} aria-labelledby="cockpit-inbox-title">
      <header><div><span className="eyebrow">Next actions</span><h3 id="cockpit-inbox-title">{actions.length ? `${actions.length} ${actions.length === 1 ? "item needs" : "items need"} attention` : "Nothing needs attention"}</h3></div>{actions.length ? <span className="cockpit-count">{actions.length}</span> : <Icon name="check" size={20} />}</header>
      {actions.length ? <div className="cockpit-actions">
        {shownActions.map((action) => <article className={`cockpit-action ${action.severity}`} key={action.id}>
          <span className="cockpit-action-icon"><Icon name={action.kind.includes("review") ? "check" : action.kind.includes("runner") ? "runtime" : action.kind === "long-running-generation" ? "analytics" : "rerun"} size={17} /></span>
          <span><small>{action.projectName ?? "Production system"} · {relative(action.createdAt)}</small><strong>{action.title}</strong><p>{action.detail}</p></span>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void act(action)}>{action.actionLabel} <Icon name="arrow" size={14} /></button>
        </article>)}
        {actions.length > 3 ? <button className="cockpit-more" onClick={() => setShowAllActions((value) => !value)}>{showAllActions ? "Show less" : `Show all ${actions.length}`}</button> : null}
      </div> : <div className="cockpit-clear"><Icon name="check" size={20} /><span><strong>All caught up.</strong><small>No review or recovery actions are waiting.</small></span></div>}
    </section>

    <section className="cockpit-history glass" aria-labelledby="cockpit-history-title">
      <header><div><span className="eyebrow">Newest to oldest</span><h3 id="cockpit-history-title">Activity</h3></div><span>{runs.length} of {cockpit.runs.length}</span></header>
      <div className="cockpit-scope" aria-label="Filter production activity">
        {([
          ["all", `All ${cockpit.runs.length}`],
          ["active", `Active ${cockpit.summary.activeRuns}`],
          ["review", `Review ${reviewRunCount}`],
          ["failed", `Failed ${cockpit.summary.failedRuns}`],
        ] as Array<[RunScope, string]>).map(([value, label]) => <button className={scope === value ? "on" : ""} key={value} onClick={() => setScope(value)}>{label}</button>)}
      </div>
      <details className="cockpit-filter-drawer">
        <summary><Icon name="grid" size={14} /> More filters</summary>
        <div className="cockpit-filters">
          <label><span>Project</span><select value={project} onChange={(event) => setProject(event.target.value)}><option value="all">All projects</option>{snapshot?.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Type</span><select value={modality} onChange={(event) => setModality(event.target.value)}><option value="all">All types</option><option value="image">Image</option><option value="music">Music</option><option value="video">Video</option><option value="training">Training</option></select></label>
          <label><span>Workflow</span><select value={workflow} onChange={(event) => setWorkflow(event.target.value)}><option value="all">All workflows</option><option value="direct">Direct / training</option>{workflowOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label><span>CreativeDNA</span><select value={dna} onChange={(event) => setDna(event.target.value)}><option value="all">All versions</option>{dnaOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label><span>Decision</span><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="all">All decisions</option>{(["unreviewed", "accepted", "rejected", "archived", "approved", "not-applicable"] as ProductionCockpitDecision[]).map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>
        </div>
      </details>
      <div className="cockpit-run-list">
        {runs.map((run) => <article className={`cockpit-run${focusRunId === run.id ? " cockpit-focus" : ""}`} id={`cockpit-run-${run.id}`} key={run.id}>
          <span className="cockpit-run-kind"><Icon name={iconFor(run)} size={18} /><i className={run.status} /></span>
          <span className="cockpit-run-primary"><small>{run.projectName} · {timestamp(run.createdAt)}</small><strong>{run.title}</strong><p>{run.detail}</p></span>
          <strong className={`state-pill ${run.status}`}>{run.status.replaceAll("-", " ")}</strong>
          <div className="cockpit-run-facts">
            <span><small>Stage</small><b>{run.stageLabel}{run.queuePosition ? ` · #${run.queuePosition}` : ""}</b></span>
            <span><small>Time</small><b>{duration(run.durationMs)}</b></span>
            <span><small>Output</small><b>{run.retainedBytes ? bytes(run.retainedBytes) : run.decision.replaceAll("-", " ")}</b></span>
            {run.workloadFacts.slice(0, 3).map((fact) => <em key={fact}>{fact}</em>)}
          </div>
          <details className="cockpit-run-details">
            <summary>Details</summary>
            <div>
              <span><small>Started</small><b>{new Date(run.createdAt).toLocaleString()}</b></span>
              <span><small>Provider</small><b>{run.provider}</b></span>
              <span><small>Runner</small><b>{run.runnerName ?? "Not assigned"}{run.runnerDevice ? ` · ${run.runnerDevice}` : ""}</b></span>
              <span><small>Workflow</small><b>{run.workflowName ? `${run.workflowName}${run.workflowRevision ? ` v${run.workflowRevision}` : ""}` : "Direct"}</b></span>
              <span><small>CreativeDNA</small><b>{run.dnaName ? `${run.dnaName}${run.dnaVersion ? ` v${run.dnaVersion}` : ""}` : "Not resolved"}</b></span>
              <span><small>Timing</small><b>{run.queueMs === null ? "No queue timing" : `${duration(run.queueMs)} queued`}{run.executionMs === null ? "" : ` · ${duration(run.executionMs)} execution`}</b></span>
              <span className="cockpit-run-detail-wide"><small>Models</small><b>{run.models.length ? run.models.join(" · ") : "No model inventory stamped"}</b></span>
              <span className="cockpit-run-detail-wide"><small>Run ID</small><code>{run.id}</code></span>
              {run.error ? <span className="cockpit-run-error cockpit-run-detail-wide"><small>Failure</small><b>{run.error.replaceAll("_", " ")}</b></span> : null}
            </div>
            <footer>
              {(run.status === "failed" || run.status === "cancelled") && run.kind === "generation" ? <button className="btn btn-ghost" disabled={busy} onClick={() => void act({ id: `retry-generation:${run.id}`, kind: "retry-generation", severity: "warning", projectId: run.projectId, projectName: run.projectName, entityId: run.id, modality: run.modality, title: run.title, detail: run.error ?? run.detail, actionLabel: "Retry", surface: "queue", createdAt: run.updatedAt })}><Icon name="rerun" size={14} /> Retry</button> : null}
              {isActive(run) ? <button className="btn btn-ghost" disabled={busy} onClick={() => void (run.kind === "training" ? cancelDnaTraining(run.id) : cancelJob(run.id))}>Cancel</button> : null}
              {run.artifactId || run.kind === "training" ? <button className="btn btn-primary" onClick={() => openRun(run)}>{run.artifactId ? "Open artifact" : "Open training"} <Icon name="arrow" size={14} /></button> : null}
            </footer>
          </details>
        </article>)}
        {!runs.length ? <p className="empty-copy">No durable activity matches these filters.</p> : null}
      </div>
    </section>

    <details className="cockpit-runners glass">
      <summary><span><span className="eyebrow">Local execution</span><strong>Runner health</strong></span><span>{cockpit.runners.length ? `${runnerAvailable}/${cockpit.runners.length} available` : "Not paired"} <Icon name="chevronDown" size={14} /></span></summary>
      <div>
        {cockpit.runners.map((runner) => <article key={runner.id}><i className={runner.state} /><span><strong>{runner.name}</strong><small>{runner.device ?? "Device not reported"}</small></span><span><b>{runner.state}</b><small>{runner.lastHeartbeatAt ? relative(runner.lastHeartbeatAt) : "Never connected"}</small></span><span><b>{runner.version ? `v${runner.version}` : "No version"}</b><small>{runner.activeJobId ? `Active ${runner.activeJobId}` : "Idle"}</small></span></article>)}
        {!cockpit.runners.length ? <p className="empty-copy">No Local Runner has been paired.</p> : null}
      </div>
    </details>
  </section>;
}
