import { useMemo, useState } from "react";
import { generationTiming, type OvernightSession, type OvernightTask } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import {
  bytesLabel,
  overnightStatusDetail,
  overnightStatusLabel,
} from "./overnightPresentation";
import "./OvernightStudio.css";

export type OvernightRunGroupProps = {
  session: OvernightSession;
  onReview: (sessionId: string) => void;
};

const TASK_LABELS: Record<OvernightTask["role"], string> = {
  "scene-image": "Scene",
  "scene-video": "Motion",
  soundtrack: "Soundtrack",
  soundscape: "Soundscape",
};

function taskIcon(task: OvernightTask) {
  if (task.modality === "music") return "music" as const;
  return task.modality;
}

function taskTitle(task: OvernightTask) {
  return task.sceneTitle?.trim() || task.storyTitle.trim();
}

export function OvernightRunGroup({ session, onReview }: OvernightRunGroupProps) {
  const {
    snapshot,
    busy,
    pauseOvernightSession,
    resumeOvernightSession,
    cancelOvernightSession,
  } = useStudio();
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const tasks = useMemo(() => [...session.tasks].sort((left, right) => left.ordinal - right.ordinal), [session.tasks]);
  const jobs = useMemo(() => new Map((snapshot?.jobs ?? []).map((job) => [job.id, job])), [snapshot?.jobs]);
  const activeTask = tasks.find((task) => task.status === "running")
    ?? tasks.find((task) => task.status === "queued")
    ?? tasks.find((task) => task.status === "planned")
    ?? null;
  const activeJob = activeTask?.jobId ? jobs.get(activeTask.jobId) ?? null : null;
  const activeJobTiming = activeJob
    ? generationTiming(activeJob, snapshot?.productionCockpit.computedAt ?? new Date().toISOString())
    : null;
  const total = Math.max(session.progress.planned, session.outputCount, 1);
  const finished = session.progress.completed + session.progress.failed + session.progress.cancelled;
  const progress = Math.max(0, Math.min(100, Math.round(finished / total * 100)));
  const reviewCount = session.progress.readyForReview;
  const canPause = session.status === "armed" || session.status === "planning" || session.status === "running";
  const canResume = session.status === "paused";
  const canCancel = canPause || canResume || session.status === "needs-attention";

  const runAction = async (action: () => Promise<unknown>) => {
    setActing(true);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Creative Studio could not update this run.");
    } finally {
      setActing(false);
    }
  };

  return <article className={`overnight-run-group glass status-${session.status}`}>
    <header>
      <span className="overnight-run-mark"><Icon name={session.status === "completed" ? "star" : "moon"} size={18} /></span>
      <span className="overnight-run-title"><small>{overnightStatusLabel(session.status)}</small><strong>{session.name}</strong><p>{overnightStatusDetail(session)}</p></span>
      <em>{progress}%</em>
    </header>

    <div className="overnight-run-progress" role="progressbar" aria-label="Overnight run progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>

    <div className="overnight-run-stats" aria-label="Overnight run totals">
      <span><strong>{session.progress.completed}</strong><small>Finished</small></span>
      <span><strong>{reviewCount}</strong><small>To review</small></span>
      <span><strong>{session.progress.failed}</strong><small>Failed</small></span>
      <span><strong>{bytesLabel(session.progress.retainedBytes)}</strong><small>Retained</small></span>
    </div>

    {activeTask ? <div className="overnight-current-task">
      <Icon name={taskIcon(activeTask)} size={17} />
      <span><small>{activeTask.status} · {TASK_LABELS[activeTask.role]}</small><strong>{taskTitle(activeTask)}</strong></span>
      {activeJobTiming ? <em title={activeJobTiming.stageLabel}>{activeJobTiming.comfyApiUnresponsive ? "Comfy API unavailable" : activeJobTiming.stageLabel}</em> : null}
    </div> : null}

    {(actionError || session.error) ? <p className="overnight-run-error" role="alert"><Icon name="shield" size={15} /> {actionError || session.error}</p> : null}

    <details className="overnight-task-list">
      <summary><span>{tasks.length} planned creations</span><Icon name="chevronDown" size={14} /></summary>
      <div>
        {session.plan ? <div className="overnight-story-plan">
          <strong>{session.plan.logline}</strong>
          {session.plan.stories.map((story) => <p key={story.index}><b>{story.title}</b><span>{story.premise}</span></p>)}
        </div> : null}
        {tasks.map((task) => <div key={task.id} className={`overnight-task-row status-${task.status}`}>
          <span className="overnight-task-icon"><Icon name={taskIcon(task)} size={15} /></span>
          <span><strong>{taskTitle(task)}</strong><small>{task.storyTitle} · {TASK_LABELS[task.role]}</small></span>
          <em>{task.status}</em>
        </div>)}
      </div>
    </details>

    <footer>
      {reviewCount ? <button type="button" className="btn btn-primary" disabled={busy || acting} onClick={() => onReview(session.id)}><Icon name="star" size={15} /> Review {reviewCount}</button> : null}
      {canPause ? <button type="button" className="btn btn-ghost" disabled={busy || acting} onClick={() => void runAction(() => pauseOvernightSession(session.id))}><Icon name="pause" size={14} /> Pause</button> : null}
      {canResume ? <button type="button" className="btn btn-primary" disabled={busy || acting} onClick={() => void runAction(() => resumeOvernightSession(session.id))}><Icon name="play" size={14} /> Resume</button> : null}
      {canCancel ? <button type="button" className="overnight-cancel" disabled={busy || acting} onClick={() => void runAction(() => cancelOvernightSession(session.id))}>Stop run</button> : null}
    </footer>
  </article>;
}
