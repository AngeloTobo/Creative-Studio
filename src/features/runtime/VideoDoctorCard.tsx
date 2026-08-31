import type { VideoDoctorReport } from "../../../shared/contracts";
import { primaryVideoDoctorFinding, videoDoctorGuidance } from "../../../shared/contracts";
import { Icon } from "../../components/Icon";

function checkedLabel(value: string) {
  const milliseconds = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "checked now";
  if (milliseconds < 60_000) return "checked now";
  const minutes = Math.round(milliseconds / 60_000);
  return `checked ${minutes}m ago`;
}

export function VideoDoctorCard({ report, compact = false }: { report: VideoDoctorReport; compact?: boolean }) {
  const primary = primaryVideoDoctorFinding(report);
  const guidance = primary ? videoDoctorGuidance(primary.code) : null;
  const title = guidance?.title ?? (report.status === "working" ? "Video is moving through Comfy" : report.canClaimVideo ? "Video is ready" : "Video state is still being verified");
  const summary = guidance?.summary ?? (report.status === "working"
    ? "The exact Creative Studio prompt is present in Comfy and still belongs to its active job."
    : report.canClaimVideo ? "The queue is clear and Comfy reports ready for the next video." : "No unsafe conclusion has been made from incomplete evidence.");
  const action = guidance?.action ?? (report.status === "working" ? "Nothing needs intervention while the prompt remains observable." : report.canClaimVideo ? "Nothing to fix." : "Recheck after Comfy finishes starting.");

  return <article className={`video-doctor glass ${report.status}${compact ? " compact" : ""}`} aria-live={report.status === "blocked" ? "polite" : undefined}>
    <span className="video-doctor-icon"><Icon name={report.status === "blocked" ? "bell" : report.status === "working" ? "queue" : "runtime"} size={19} /></span>
    <div className="video-doctor-copy">
      <span className="eyebrow">Video Doctor · {checkedLabel(report.checkedAt)}</span>
      <strong>{title}</strong>
      <p>{summary}</p>
      <span className="video-doctor-action"><b>What to do</b>{action}</span>
      {report.queue.blockedVideoJobs ? <small>{report.queue.blockedVideoJobs} queued video{report.queue.blockedVideoJobs === 1 ? "" : "s"} waiting behind this.</small> : null}
    </div>
    <details className="video-doctor-evidence">
      <summary>Evidence</summary>
      <div>
        <span><b>Queue</b>{report.queue.state} · {report.queue.running} running · {report.queue.pending} pending</span>
        <span><b>Comfy status</b>{report.systemStats}</span>
        <span><b>Log</b>{report.log.state}{report.log.updatedAt ? ` · ${new Date(report.log.updatedAt).toLocaleString()}` : ""}</span>
        {report.queue.creativeStudioJobId ? <span><b>Job</b><code>{report.queue.creativeStudioJobId}</code></span> : null}
        {report.queue.promptId ? <span><b>Prompt</b><code>{report.queue.promptId}</code></span> : null}
        {report.findings.filter((item) => item.code !== primary?.code).map((item) => {
          const copy = videoDoctorGuidance(item.code);
          return <span key={item.code}><b>{copy.title}</b>{copy.summary}</span>;
        })}
      </div>
    </details>
  </article>;
}
