import { useMemo } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { loveLoopDropTime, loveLoopErrorDetail, loveLoopStatusLabel, loveLoopToday, nextLoveLoopDrop } from "./loveLoopPresentation";
import "./LoveLoop.css";

export function LoveLoopWorkStatus({ onResults, onNeedsAction, onRepair }: { onResults: () => void; onNeedsAction: () => void; onRepair: () => void }) {
  const { snapshot, activeProjectId } = useStudio();
  const loop = snapshot?.loveLoop ?? null;
  const runner = snapshot?.runners.find((item) => item.state === "busy")
    ?? snapshot?.runners.find((item) => item.state === "online")
    ?? null;
  const today = useMemo(() => loop ? loveLoopToday(loop) : [], [loop]);
  if (!loop || loop.status === "disabled" || loop.projectId !== activeProjectId) return null;
  const next = nextLoveLoopDrop(today);
  const complete = today.filter((drop) => drop.status === "completed").length;
  const failed = today.filter((drop) => drop.status === "failed").length;
  const joblessFailure = today.some((drop) => drop.status === "failed" && !drop.jobId);
  const repairRequired = loop.status === "needs-attention" && (joblessFailure || loop.lastError !== "love_loop_failure_limit_reached");
  const detail = repairRequired
    ? loveLoopErrorDetail(loop.lastError) ?? "Automatic creation setup needs repair"
    : next
    ? `${next.status === "running" || next.status === "queued" ? next.status.replaceAll("-", " ") : `next ${loveLoopDropTime(next, loop.timezone)}`} - ${next.modality}`
    : failed ? `${failed} needs review` : `${complete} of 3 complete today`;

  return <aside className={`love-loop-work-status ${loop.status}`} aria-label="Daily love status">
    <span className="love-loop-work-mark"><Icon name="star" size={14} /></span>
    <span><strong>Daily love - {loveLoopStatusLabel(loop.status)}</strong><small>{detail}</small></span>
    <em className={runner ? runner.state : "offline"}><i />{runner ? runner.state === "busy" ? "Runner busy" : "Runner ready" : "Runner offline"}</em>
    <button type="button" onClick={repairRequired ? onRepair : failed ? onNeedsAction : onResults}>{repairRequired ? "Repair" : failed ? "Failures" : "Results"} <Icon name="arrow" size={12} /></button>
  </aside>;
}
