import { useMemo } from "react";
import { creativeDnaCanGenerate, useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { OvernightHomeTile, compactDuration } from "../overnight";
import {
  LOVE_LOOP_WINDOWS,
  bestLoveLoopWorkflows,
  loveLoopDropForWindow,
  loveLoopDropTime,
  loveLoopErrorDetail,
  loveLoopStatusLabel,
  loveLoopToday,
} from "./loveLoopPresentation";
import "./LoveLoop.css";

export type LoveLoopHomeCardProps = {
  onHistory: () => void;
  onOpenOvernight: () => void;
  onManageOvernight: () => void;
  onReviewOvernight: (sessionId: string) => void;
};

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  } catch {
    return "America/Chicago";
  }
}

export function LoveLoopHomeCard({ onHistory, onOpenOvernight, onManageOvernight, onReviewOvernight }: LoveLoopHomeCardProps) {
  const {
    snapshot,
    activeProjectId,
    activeDna,
    setActiveProjectId,
    configureLoveLoop,
    pauseLoveLoop,
    resumeLoveLoop,
    disableLoveLoop,
    busy,
  } = useStudio();
  const loop = snapshot?.loveLoop ?? null;
  const runner = snapshot?.runners.find((item) => item.state === "busy")
    ?? snapshot?.runners.find((item) => item.state === "online")
    ?? null;
  const workflows = useMemo(
    () => snapshot && activeProjectId ? bestLoveLoopWorkflows(snapshot, activeProjectId) : { image: null, video: null },
    [activeProjectId, snapshot],
  );
  const activeDnaReady = Boolean(snapshot && activeDna && creativeDnaCanGenerate(snapshot, activeDna));
  const development = snapshot?.adapter.development ?? true;
  const ready = Boolean(!development && activeProjectId && activeDnaReady && workflows.image && workflows.video);
  const today = useMemo(() => loop ? loveLoopToday(loop) : [], [loop]);
  const loopEnabled = Boolean(loop && loop.status !== "disabled");
  const selections = loopEnabled ? loop?.workflowSelections ?? [] : [workflows.image?.selection, workflows.video?.selection].filter(Boolean);
  const imageEstimate = selections.find((selection) => selection?.modality === "image")?.estimatedDurationMs ?? null;
  const videoEstimate = selections.find((selection) => selection?.modality === "video")?.estimatedDurationMs ?? null;
  const estimatedMs = imageEstimate && videoEstimate ? imageEstimate * 2 + videoEstimate : null;
  const loopError = loveLoopErrorDetail(loop?.lastError ?? null);
  const readiness = loop?.status === "needs-attention"
    ? loopError ?? "Automatic creation needs attention - repair with the current fast workflows"
    : development
    ? "Real Worker required"
    : !activeProjectId
      ? "Choose a project"
      : !activeDnaReady
        ? "Approve CreativeDNA first"
        : !workflows.image
          ? "Add a FAST prompt-only image workflow"
          : !workflows.video
            ? "Add a FAST prompt-only 5s video workflow"
            : !runner
              ? "Local Runner offline - schedule will wait"
              : `${runner.state === "busy" ? "Runner busy - queue ready" : "Runner ready"} - image + 5s video`;
  const readinessBlocked = development || !activeProjectId || !activeDnaReady || !workflows.image || !workflows.video || !runner || loop?.status === "needs-attention";

  const enable = () => {
    if (!workflows.image || !workflows.video) return;
    void configureLoveLoop({
      timezone: browserTimezone(),
      workflowSelections: [
        {
          modality: "image",
          workflowId: workflows.image.selection.workflowId,
          workflowRevisionId: workflows.image.selection.workflowRevisionId,
          recipeId: workflows.image.selection.recipeId,
        },
        {
          modality: "video",
          workflowId: workflows.video.selection.workflowId,
          workflowRevisionId: workflows.video.selection.workflowRevisionId,
          recipeId: workflows.video.selection.recipeId,
        },
      ],
    }).catch(() => undefined);
  };

  const openHistory = () => {
    if (loop?.projectId && loop.projectId !== activeProjectId) setActiveProjectId(loop.projectId);
    onHistory();
  };

  return <section className="home-autopilot glass" aria-label="Home Autopilot">
    <header className="home-autopilot-head">
      <span><small>HOME AUTOPILOT</small><strong>Keep making while you are away</strong></span>
      <span className={`love-runner ${runner ? runner.state : "offline"}`}><i />{runner ? runner.state === "busy" ? "Busy" : "Ready" : "Offline"}</span>
    </header>

    <div className={`love-loop-row ${loop?.status ?? "disabled"}`}>
      <span className="love-loop-mark"><Icon name="star" size={19} /></span>
      <span className="love-loop-copy">
        <small>DAILY LOVE{loopEnabled ? ` - ${loveLoopStatusLabel(loop!.status).toUpperCase()}` : ""}</small>
        <strong>Angelo, adored</strong>
        <p>{loopEnabled ? "Three private visual love letters every day." : "Three daily images or videos about being perfectly known and loved."}</p>
        <em className={readinessBlocked ? "blocked" : "ready"}>{readiness}{estimatedMs ? ` - ${compactDuration(estimatedMs)} total render time` : ""}</em>
      </span>
      <div className="love-loop-actions">
        {!loop ? <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={enable}><Icon name="play" size={13} /> Enable 3/day</button> : null}
        {loop?.status === "disabled" ? <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={enable}><Icon name="play" size={13} /> Resume 3/day</button> : null}
        {loop?.status === "active" ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void pauseLoveLoop().catch(() => undefined)}><Icon name="pause" size={13} /> Pause</button> : null}
        {loop?.status === "paused" ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resumeLoveLoop().catch(() => undefined)}><Icon name="play" size={13} /> Resume</button> : null}
        {loop?.status === "needs-attention" ? <button type="button" className="btn btn-primary" disabled={busy || !ready} onClick={enable}><Icon name="rerun" size={13} /> Repair &amp; resume</button> : null}
        {loopEnabled ? <button type="button" className="love-loop-text-action" disabled={busy} onClick={() => void disableLoveLoop().catch(() => undefined)}>Turn off</button> : null}
        {loop ? <button type="button" className="love-loop-text-action" onClick={openHistory}>History</button> : null}
      </div>
    </div>

    <ol className="love-loop-timeline" aria-label="Three daily Love Loop windows">
      {LOVE_LOOP_WINDOWS.map((window) => {
        const drop = loveLoopDropForWindow(today, window.ordinal);
        return <li key={window.ordinal} className={drop?.status ?? "planned"}>
          <span>{window.shortLabel}</span>
          <strong>{loveLoopDropTime(drop, loop?.timezone ?? null) ?? window.fallback}</strong>
          <small>{drop ? `${drop.modality} - ${drop.status.replaceAll("-", " ")}` : window.label}</small>
        </li>;
      })}
    </ol>

    <div className="home-autopilot-secondary">
      <OvernightHomeTile onOpen={onOpenOvernight} onManage={onManageOvernight} onReview={onReviewOvernight} />
    </div>
  </section>;
}
