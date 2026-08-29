import { useMemo } from "react";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import {
  isActiveOvernightSession,
  newestOvernightSessions,
  overnightStatusDetail,
  overnightStatusLabel,
} from "./overnightPresentation";
import "./OvernightStudio.css";

export type OvernightHomeTileProps = {
  onOpen: () => void;
  onManage: () => void;
  onReview: (sessionId: string) => void;
};

export function OvernightHomeTile({ onOpen, onManage, onReview }: OvernightHomeTileProps) {
  const { snapshot, activeProjectId } = useStudio();
  const sessions = useMemo(() => newestOvernightSessions(snapshot?.overnightSessions ?? [], activeProjectId), [activeProjectId, snapshot?.overnightSessions]);
  const session = sessions.find(isActiveOvernightSession)
    ?? sessions.find((item) => item.progress.readyForReview > 0)
    ?? sessions[0]
    ?? null;

  if (!session) {
    return <section className="overnight-home-tile glass" aria-label="Overnight Studio">
      <span className="overnight-home-orb"><Icon name="moon" size={21} /></span>
      <span className="overnight-home-copy"><small>OVERNIGHT STUDIO</small><strong>Wake up to new worlds</strong><p>Stories, scenes, and sound rendered locally while the browser is closed.</p></span>
      <button type="button" className="btn btn-primary" onClick={onOpen}><Icon name="moon" size={15} /> Plan tonight</button>
    </section>;
  }

  const total = Math.max(session.progress.planned, session.outputCount, 1);
  const finished = session.progress.completed + session.progress.failed + session.progress.cancelled;
  const progress = Math.max(0, Math.min(100, Math.round(finished / total * 100)));
  const reviewCount = session.progress.readyForReview;

  return <section className={`overnight-home-tile has-run ${session.status}`} aria-label={`Overnight Studio · ${overnightStatusLabel(session.status)}`}>
    <span className="overnight-home-orb"><Icon name={reviewCount ? "star" : session.status === "running" ? "wand" : "moon"} size={21} /></span>
    <span className="overnight-home-copy">
      <small>OVERNIGHT STUDIO · {overnightStatusLabel(session.status).toUpperCase()}</small>
      <strong>{session.name}</strong>
      <p>{overnightStatusDetail(session)}</p>
      <span className="overnight-home-progress" aria-label={`${progress}% complete`}><i style={{ width: `${progress}%` }} /></span>
    </span>
    {reviewCount ? <button type="button" className="btn btn-primary" onClick={() => onReview(session.id)}>{reviewCount} to review <Icon name="arrow" size={14} /></button> : <button type="button" className="btn btn-ghost" onClick={isActiveOvernightSession(session) ? onManage : onOpen}>{isActiveOvernightSession(session) ? "Manage run" : "Plan another"} <Icon name="chevron" size={14} /></button>}
  </section>;
}
