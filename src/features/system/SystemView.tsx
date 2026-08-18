import { useState } from "react";
import { Icon } from "../../components/Icon";
import { RuntimeView } from "../runtime/RuntimeView";
import { SettingsView } from "../settings/SettingsView";

type SystemTab = "status" | "runners";

export function SystemView() {
  const [tab, setTab] = useState<SystemTab>("status");

  return <section className="system-view fade-up" aria-label="System">
    <nav className="system-tabs glass" role="tablist" aria-label="System workspace">
      <button role="tab" aria-selected={tab === "status"} className={tab === "status" ? "on" : ""} onClick={() => setTab("status")}><Icon name="runtime" size={17} /><span><strong>Status</strong><small>Capabilities and providers</small></span></button>
      <button role="tab" aria-selected={tab === "runners"} className={tab === "runners" ? "on" : ""} onClick={() => setTab("runners")}><Icon name="settings" size={17} /><span><strong>Runners</strong><small>Pair and revoke machines</small></span></button>
    </nav>
    {tab === "status" ? <RuntimeView /> : <SettingsView />}
  </section>;
}
