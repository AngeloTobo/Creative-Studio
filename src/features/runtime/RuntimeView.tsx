import type { Capability } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { capabilitiesNeedingAttention, isCapabilityOffByDesign } from "./capabilityStatus";
import { VideoDoctorCard } from "./VideoDoctorCard";

function capabilityIcon(capability: Capability) {
  if (capability.key === "creative-dna") return "dna" as const;
  if (capability.key.includes("generation")) return capability.key.startsWith("music") ? "music" as const : capability.key.startsWith("video") ? "video" as const : "image" as const;
  if (capability.key === "artifact-review") return "check" as const;
  if (capability.key === "artifact-retention") return "archive" as const;
  return "runtime" as const;
}

function CapabilityCard({ capability }: { capability: Capability }) {
  const offByDesign = isCapabilityOffByDesign(capability);
  return <article className="capability-card glass"><div><span className={`capability-state ${offByDesign ? "off-by-design" : capability.state}`}><i />{offByDesign ? "off by design" : capability.state}</span><Icon name={capabilityIcon(capability)} size={23} /></div><h3>{capability.label}</h3><p>{capability.detail}</p><footer><span>{capability.provider}</span><time>{new Date(capability.checkedAt).toLocaleTimeString()}</time></footer></article>;
}

export function RuntimeView({ embedded = false }: { embedded?: boolean } = {}) {
  const { snapshot, refresh } = useStudio();
  const capabilities = snapshot?.capabilities ?? [];
  const issues = capabilitiesNeedingAttention(capabilities);
  const offByDesign = capabilities.filter(isCapabilityOffByDesign);
  const available = capabilities.filter((capability) => capability.state === "available");
  const diagnosticRunner = [...(snapshot?.runners ?? [])].filter((runner) => runner.state === "online" || runner.state === "busy").sort((left, right) => {
    const priority = { blocked: 0, attention: 1, working: 2, unknown: 3, ready: 4 } as const;
    return (priority[left.videoDoctor?.status ?? "unknown"] ?? 3) - (priority[right.videoDoctor?.status ?? "unknown"] ?? 3);
  }).find((runner) => runner.videoDoctor);
  return (
    <section className={`runtime-view runtime-view-compact fade-up${embedded ? " embedded" : ""}`}>
      <div className={`adapter-banner ${snapshot?.adapter.development ? "development" : "production"}`}>
        <Icon name={snapshot?.adapter.development ? "wand" : "shield"} size={20} />
        <div><strong>{snapshot?.adapter.label ?? "Runtime unavailable"}</strong><span>Persistence: {snapshot?.adapter.durableScope ?? "unknown"}. Development fallbacks are never silent.</span></div>
        <button className="btn btn-ghost" onClick={() => void refresh()}><Icon name="rerun" size={16} /> Recheck</button>
      </div>
      <div className="runtime-summary glass" aria-label="Capability summary">
        <span><b>{available.length}</b><small>available</small></span>
        <span className={issues.length ? "warning" : ""}><b>{issues.length}</b><small>need attention</small></span>
        <span><b>{offByDesign.length}</b><small>off by design</small></span>
        <span><b>{snapshot?.runners.filter((runner) => runner.state === "online" || runner.state === "busy").length ?? 0}</b><small>runners online</small></span>
      </div>
      {diagnosticRunner?.videoDoctor ? <VideoDoctorCard report={diagnosticRunner.videoDoctor} /> : <div className="video-doctor-awaiting glass"><Icon name="runtime" size={17} /><span><strong>Video Doctor is waiting for its first runner report.</strong><small>Local Runner 1.19 adds read-only Comfy diagnosis without loading an AI model.</small></span></div>}
      {issues.length ? <section className="runtime-issues"><header><span className="eyebrow">Needs attention</span><strong>{issues.length} capabilities</strong></header><div className="capability-grid">{issues.map((capability) => <CapabilityCard capability={capability} key={capability.key} />)}</div></section> : <div className="runtime-all-clear"><Icon name="check" size={17} /><strong>Local capabilities report no failures.</strong>{offByDesign.length ? <span>{offByDesign.length} optional remote {offByDesign.length === 1 ? "route is" : "routes are"} off by design.</span> : null}</div>}
      {offByDesign.length ? <details className="runtime-optional glass">
        <summary><span><Icon name="shield" size={16} /><strong>Remote routes off by design</strong></span><b>{offByDesign.length}</b><Icon name="chevronDown" size={15} /></summary>
        <div className="capability-grid">{offByDesign.map((capability) => <CapabilityCard capability={capability} key={capability.key} />)}</div>
      </details> : null}
      <details className="runtime-healthy glass">
        <summary><span><Icon name="check" size={16} /><strong>Available capabilities</strong></span><b>{available.length}</b><Icon name="chevronDown" size={15} /></summary>
        <div className="capability-grid">{available.map((capability) => <CapabilityCard capability={capability} key={capability.key} />)}</div>
      </details>
    </section>
  );
}
