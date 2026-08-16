import { useMemo, useState } from "react";
import type { ProductionCockpitAction, ProductionCockpitDecision } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

type CockpitViewProps = { onOpen: (action: ProductionCockpitAction) => void };

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

export function CockpitView({ onOpen }: CockpitViewProps) {
  const { snapshot, refresh, retryJob, busy } = useStudio();
  const cockpit = snapshot?.productionCockpit;
  const [project, setProject] = useState("all");
  const [modality, setModality] = useState("all");
  const [workflow, setWorkflow] = useState("all");
  const [dna, setDna] = useState("all");
  const [decision, setDecision] = useState("all");
  const workflowOptions = useMemo(() => [...new Set(cockpit?.runs.map((run) => run.workflowName).filter((name): name is string => Boolean(name)) ?? [])].sort(), [cockpit?.runs]);
  const dnaOptions = useMemo(() => {
    const found = new Map<string, string>();
    for (const run of cockpit?.runs ?? []) if (run.dnaArtifactId) found.set(run.dnaArtifactId, run.dnaName ? `${run.dnaName}${run.dnaVersion ? ` · v${run.dnaVersion}` : ""}` : run.dnaArtifactId);
    return [...found.entries()];
  }, [cockpit?.runs]);
  const runs = useMemo(() => (cockpit?.runs ?? []).filter((run) => {
    if (project !== "all" && run.projectId !== project) return false;
    if (modality !== "all" && run.modality !== modality) return false;
    if (workflow !== "all" && (workflow === "direct" ? run.workflowName !== null : run.workflowName !== workflow)) return false;
    if (dna !== "all" && run.dnaArtifactId !== dna) return false;
    if (decision !== "all" && run.decision !== decision) return false;
    return true;
  }), [cockpit?.runs, decision, dna, modality, project, workflow]);
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

  if (!cockpit) return <section className="cockpit-view fade-up"><div className="empty-state glass"><Icon name="analytics" size={34} /><h2>Production state unavailable</h2><p>Refresh the Worker-backed snapshot to load the cockpit.</p></div></section>;

  const summary = [
    { label: "Action required", value: cockpit.summary.actionRequired, detail: "Review or recovery", accent: "var(--pink)", icon: "bell" as const },
    { label: "Active runs", value: cockpit.summary.activeRuns, detail: "Generation + training", accent: "var(--cyan)", icon: "queue" as const },
    { label: "Awaiting review", value: cockpit.summary.outputsAwaitingReview, detail: `${cockpit.summary.retainedOutputs} outputs retained`, accent: "var(--amber)", icon: "check" as const },
    { label: "Failed runs", value: cockpit.summary.failedRuns, detail: "History retained", accent: "var(--rose)", icon: "close" as const },
    { label: "Verified storage", value: bytes(cockpit.summary.storedBytes), detail: `${cockpit.summary.retainedFiles} retained files`, accent: "var(--teal)", icon: "archive" as const },
  ];

  return <section className="cockpit-view fade-up" aria-labelledby="cockpit-title">
    <header className="cockpit-head">
      <div><span className="eyebrow">Phase 4 · Production operations</span><h2 id="cockpit-title">Production cockpit</h2><p>One cross-project view of required decisions, durable runs, Local Runner health, and verified retained storage.</p></div>
      <button className="btn btn-ghost" disabled={busy} onClick={() => void refresh()}><Icon name="rerun" size={16} /> Refresh state</button>
    </header>

    <div className="cockpit-summary">
      {summary.map((item) => <article className="glass" key={item.label} style={{ "--cockpit-accent": item.accent } as React.CSSProperties}><span><Icon name={item.icon} size={17} /> {item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></article>)}
    </div>

    <section className="cockpit-inbox glass" aria-labelledby="cockpit-inbox-title">
      <header><div><span className="eyebrow">Owner inbox</span><h3 id="cockpit-inbox-title">Required attention</h3></div><span className="cockpit-count">{actions.length}</span></header>
      <div className="cockpit-actions">
        {actions.map((action) => <article className={`cockpit-action ${action.severity}`} key={action.id}>
          <span className="cockpit-action-icon"><Icon name={action.kind.includes("review") ? "check" : action.kind.includes("runner") ? "runtime" : "rerun"} size={18} /></span>
          <span><small>{action.projectName ?? "Production system"} · {relative(action.createdAt)}</small><strong>{action.title}</strong><p>{action.detail}</p></span>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void act(action)}>{action.actionLabel} <Icon name="arrow" size={14} /></button>
        </article>)}
        {!actions.length ? <div className="cockpit-clear"><Icon name="check" size={22} /><span><strong>All caught up.</strong><small>No review or recovery action matches these filters.</small></span></div> : null}
      </div>
    </section>

    <section className="cockpit-runners glass" aria-labelledby="cockpit-runner-title">
      <header><div><span className="eyebrow">Local execution</span><h3 id="cockpit-runner-title">Runner health</h3></div><span>{cockpit.runners.length} paired</span></header>
      <div>
        {cockpit.runners.map((runner) => <article key={runner.id}><i className={runner.state} /><span><strong>{runner.name}</strong><small>{runner.device ?? "Device not reported"}</small></span><span><b>{runner.state}</b><small>{runner.lastHeartbeatAt ? relative(runner.lastHeartbeatAt) : "Never connected"}</small></span><span><b>{runner.version ? `v${runner.version}` : "No version"}</b><small>{runner.activeJobId ? `Active ${runner.activeJobId}` : "Idle"}</small></span></article>)}
        {!cockpit.runners.length ? <p className="empty-copy">No Local Runner has been paired.</p> : null}
      </div>
    </section>

    <section className="cockpit-history glass" aria-labelledby="cockpit-history-title">
      <header><div><span className="eyebrow">Durable production history</span><h3 id="cockpit-history-title">Runs and outcomes</h3></div><span>{runs.length} shown · {cockpit.runs.length} total</span></header>
      <div className="cockpit-filters">
        <label><span>Project</span><select value={project} onChange={(event) => setProject(event.target.value)}><option value="all">All projects</option>{snapshot?.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>Modality</span><select value={modality} onChange={(event) => setModality(event.target.value)}><option value="all">All modalities</option><option value="image">Image</option><option value="music">Music</option><option value="video">Video</option><option value="training">Training</option></select></label>
        <label><span>Workflow</span><select value={workflow} onChange={(event) => setWorkflow(event.target.value)}><option value="all">All workflows</option><option value="direct">Direct / training</option>{workflowOptions.map((name) => <option key={name} value={name!}>{name}</option>)}</select></label>
        <label><span>CreativeDNA</span><select value={dna} onChange={(event) => setDna(event.target.value)}><option value="all">All versions</option>{dnaOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label><span>Decision</span><select value={decision} onChange={(event) => setDecision(event.target.value)}><option value="all">All decisions</option>{(["unreviewed", "accepted", "rejected", "archived", "approved", "not-applicable"] as ProductionCockpitDecision[]).map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</select></label>
      </div>
      <div className="cockpit-run-list">
        {runs.map((run) => <article className="cockpit-run" id={`cockpit-run-${run.id}`} key={run.id}>
          <span className="cockpit-run-kind"><Icon name={run.kind === "training" ? "dna" : run.modality === "music" ? "music" : run.modality === "video" ? "video" : "image"} size={19} /><i className={run.status} /></span>
          <span className="cockpit-run-primary"><small>{run.projectName} · {run.kind}</small><strong>{run.workflowName ?? (run.kind === "training" ? "CreativeDNA evidence synthesis" : "Direct CreativeDNA generation")}</strong><em>{run.id}</em></span>
          <span><small>Status</small><strong className={`state-pill ${run.status}`}>{run.status.replaceAll("-", " ")}</strong><em>{run.progress}%{run.queuePosition ? ` · queue ${run.queuePosition}` : ""}</em></span>
          <span><small>DNA / decision</small><strong>{run.dnaName ? `${run.dnaName}${run.dnaVersion ? ` v${run.dnaVersion}` : ""}` : "No resolved DNA"}</strong><em>{run.decision.replaceAll("-", " ")}</em></span>
          <span><small>Runner / duration</small><strong>{run.runnerName ?? run.provider}</strong><em>{duration(run.durationMs)}{run.runnerDevice ? ` · ${run.runnerDevice}` : ""}</em></span>
          <span><small>Retained</small><strong>{run.retainedBytes ? bytes(run.retainedBytes) : "—"}</strong><em>{run.workflowRevision ? `workflow v${run.workflowRevision}` : run.modality}</em></span>
        </article>)}
        {!runs.length ? <p className="empty-copy">No durable runs match these filters.</p> : null}
      </div>
    </section>
  </section>;
}
