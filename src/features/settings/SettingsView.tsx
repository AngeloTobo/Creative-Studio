import { useState } from "react";
import type { EnrollLocalRunnerResponse, LocalRunner } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

function heartbeat(value: string | null) {
  if (!value) return "Never connected";
  return `Last heartbeat ${new Date(value).toLocaleString()}`;
}

function RunnerRow({ runner, busy, onRevoke }: { runner: LocalRunner; busy: boolean; onRevoke: (id: string) => void }) {
  return <article>
    <span className={`runner-state ${runner.state}`}><i />{runner.state}</span>
    <div><strong>{runner.name}</strong><small>{runner.device || "Device details arrive with the first heartbeat"}</small><small>{heartbeat(runner.lastHeartbeatAt)}{runner.comfyVersion ? ` · ComfyUI ${runner.comfyVersion}` : ""}</small>{runner.lastError ? <em>{runner.lastError.replaceAll("_", " ")}</em> : null}</div>
    <code>{runner.version ? `runner v${runner.version}` : runner.id}</code>
    {!runner.revokedAt ? <button className="btn btn-ghost" disabled={busy} onClick={() => onRevoke(runner.id)}>Revoke</button> : null}
  </article>;
}

export function SettingsView({ embedded = false }: { embedded?: boolean } = {}) {
  const { snapshot, busy, error, enrollLocalRunner, revokeLocalRunner } = useStudio();
  const [name, setName] = useState("Angelo 3090 workstation");
  const [enrollment, setEnrollment] = useState<EnrollLocalRunnerResponse | null>(null);
  const [copied, setCopied] = useState<"token" | "command" | null>(null);
  const runners = snapshot?.runners ?? [];
  const activeRunners = runners.filter((runner) => !runner.revokedAt);
  const revokedRunners = runners.filter((runner) => Boolean(runner.revokedAt));
  const uiOnlyDevelopment = snapshot?.adapter.id === "development-local-storage";
  const installCommand = "powershell -ExecutionPolicy Bypass -File .\\scripts\\install-local-runner.ps1";

  const enroll = async () => {
    const result = await enrollLocalRunner(name.trim());
    setEnrollment(result);
  };

  const copy = async (kind: "token" | "command", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_500);
  };

  return <section className={`settings-view settings-view-compact fade-up${embedded ? " embedded" : ""}`}>
    <section className="runner-list glass">
      <header><div>{!embedded ? <span className="eyebrow">Local execution</span> : null}<h2>Paired machines</h2><p>{activeRunners.length} active · {activeRunners.filter((runner) => runner.state === "online" || runner.state === "busy").length} online</p></div><span className="runner-security"><Icon name="shield" size={17} /> Private · revocable</span></header>
      {activeRunners.map((runner) => <RunnerRow key={runner.id} runner={runner} busy={busy} onRevoke={(id) => void revokeLocalRunner(id)} />)}
      {!activeRunners.length ? <div className="runner-empty"><Icon name="runtime" size={28} /><span><strong>No machine paired.</strong><small>Pair the ComfyUI workstation below to run durable local jobs.</small></span></div> : null}
      {revokedRunners.length ? <details className="revoked-runners"><summary>Revoked machines · {revokedRunners.length}</summary><div>{revokedRunners.map((runner) => <RunnerRow key={runner.id} runner={runner} busy={busy} onRevoke={() => undefined} />)}</div></details> : null}
    </section>

    <details className="runner-pair glass" open={!activeRunners.length || Boolean(enrollment)}>
      <summary><span><span className="media-drop-icon"><Icon name="plus" size={18} /></span><span><strong>Pair another machine</strong><small>One-time token · Windows Local Runner</small></span></span><Icon name="chevronDown" size={16} /></summary>
      <section className="runner-settings">
        <header><div><span className="eyebrow">Local Runner</span><h2>Pair this workstation</h2><p>The authenticated agent claims durable API-format ComfyUI jobs even when this browser is closed.</p></div></header>
        <div className="runner-enroll">
          <label className="field"><span>Machine name</span><input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy || !name.trim() || uiOnlyDevelopment} onClick={() => void enroll()}><Icon name="plus" size={16} /> Create one-time token</button>
        </div>
        {uiOnlyDevelopment ? <p className="runner-boundary">Runner enrollment requires the Creative Studio Worker or local BFF. The browser development adapter cannot fabricate a runner.</p> : null}
        {enrollment ? <section className="runner-token" role="status">
          <header><span><Icon name="check" size={18} /><strong>Token created for {enrollment.runner.name}</strong></span><em>Shown once</em></header>
          <p>Install from this repository on the ComfyUI machine. The installer prompts securely for the token, restricts its config file to your Windows account, creates an at-logon task, and starts it now.</p>
          <label><span>One-time runner token</span><code>{enrollment.token}</code><button className="btn btn-ghost" onClick={() => void copy("token", enrollment.token)}>{copied === "token" ? "Copied" : "Copy token"}</button></label>
          <label><span>PowerShell install command</span><code>{installCommand}</code><button className="btn btn-ghost" onClick={() => void copy("command", installCommand)}>{copied === "command" ? "Copied" : "Copy command"}</button></label>
          <small>Runner API: {enrollment.apiBase} · ComfyUI remains localhost-only at 127.0.0.1:8188.</small>
        </section> : null}
        {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>
    </details>
  </section>;
}
