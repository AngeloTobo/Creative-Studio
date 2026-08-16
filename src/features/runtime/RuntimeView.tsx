import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

export function RuntimeView() {
  const { snapshot, refresh } = useStudio();
  return (
    <section className="runtime-view fade-up">
      <div className={`adapter-banner ${snapshot?.adapter.development ? "development" : "production"}`}>
        <Icon name={snapshot?.adapter.development ? "wand" : "shield"} size={20} />
        <div><strong>{snapshot?.adapter.label}</strong><span>Persistence: {snapshot?.adapter.durableScope ?? "unknown"}. Development fallbacks are never silent.</span></div>
        <button className="btn btn-ghost" onClick={() => void refresh()}><Icon name="rerun" size={16} /> Recheck</button>
      </div>
      <div className="capability-grid">
        {snapshot?.capabilities.map((capability) => <article className="capability-card glass" key={capability.key}><div><span className={`capability-state ${capability.state}`}><i />{capability.state}</span><Icon name={capability.key === "creative-dna" ? "dna" : capability.key.includes("generation") ? capability.key.startsWith("music") ? "music" : capability.key.startsWith("video") ? "video" : "image" : capability.key === "artifact-review" ? "check" : capability.key === "artifact-retention" ? "archive" : "runtime"} size={23} /></div><h3>{capability.label}</h3><p>{capability.detail}</p><footer><span>{capability.provider}</span><time>{new Date(capability.checkedAt).toLocaleTimeString()}</time></footer></article>)}
      </div>
    </section>
  );
}
