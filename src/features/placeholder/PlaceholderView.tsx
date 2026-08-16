import { Icon, type IconName } from "../../components/Icon";
import type { StudioView } from "../../app/views";

const COPY: Partial<Record<StudioView, [IconName, string, string]>> = {
  flows: ["flows", "Graph Mode follows the same execution model", "Simple Mode is working first. This surface will reveal DNA translation, generation, review, and promotion as an inspectable graph without creating a second system."],
  settings: ["settings", "Settings stay product-owned", "Adapter selection, project defaults, accessibility, and future provider controls belong here. Secrets never do."],
};

export function PlaceholderView({ view, goBack }: { view: StudioView; goBack: () => void }) {
  const [icon, title, copy] = COPY[view] ?? ["portal", "Coming next", "This product-owned surface is ready for its next bounded capability."];
  return <div className="empty fade-up"><div className="empty-orb"><Icon name={icon} size={40} /></div><h2>{title}</h2><p>{copy}</p><button className="btn btn-ghost" onClick={goBack}><Icon name="arrow" size={17} style={{ transform: "rotate(180deg)" }} /> Back to Portal</button></div>;
}
