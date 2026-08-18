import { useState } from "react";
import type { EnrollLocalRunnerResponse } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

function heartbeat(value: string | null) {
  if (!value) return "Never connected";
  return `Last heartbeat ${new Date(value).toLocaleString()}`;
}

export function SettingsView() {
  const { snapshot, busy, error, enrollLocalRunner, revokeLocalRunner } = useStudio();
  const [name, setName] = useState("Angelo 3090 workstation");
  const [enrollment, setEnrollment] = useState<EnrollLocalRunnerResponse | null>(null);
  const [copied, setCopied] = useState<"token" | "command" | null>(null);
  const runners = snapshot?.runners ?? [];
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

  return <section className="settings-view fade-up">
    <section className="runner-settings glass">
      <header><div><span className="eyebrow">Local execution</span><h2>Creative Studio Local Runner</h2><p>Pair this private Windows machine once. The agent then claims durable API-format ComfyUI jobs even when the browser is closed.</p></div><span className="runner-security"><Icon name="shield" size={17} /> Hashed credential · revocable</span></header>
      <div className="runner-enroll">
        <label className="field"><span>Machine name</span><input className="input" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy || !name.trim() || uiOnlyDevelopment} onClick={() => void enroll()}><Icon name="plus" size={16} /> Create one-time token</button>
      </div>
      {uiOnlyDevelopment ? <p className="runner-boundary">Runner enrollment is available through the Creative Studio Worker or local BFF.</p> : null}
      {enrollment ? <section className="runner-token" role="status">
        <header><span><Icon name="check" size={18} /><strong>Token created for {enrollment.runner.name}</strong></span><em>Shown once</em></header>
        <p>Install from this repository on the ComfyUI machine. The installer prompts securely for the token, restricts its config file to your Windows account, creates an at-logon task, and starts it now.</p>
        <label><span>One-time runner token</span><code>{enrollment.token}</code><button className="btn btn-ghost" onClick={() => void copy("token", enrollment.token)}>{copied === "token" ? "Copied" : "Copy token"}</button></label>
        <label><span>PowerShell install command</span><code>{installCommand}</code><button className="btn btn-ghost" onClick={() => void copy("command", installCommand)}>{copied === "command" ? "Copied" : "Copy command"}</button></label>
        <small>Runner API: {enrollment.apiBase} · ComfyUI remains localhost-only at 127.0.0.1:8188.</small>
      </section> : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
    </section>

    <section className="runner-list glass">
      <header><div><span className="eyebrow">Paired machines</span><h2>{runners.length} registered</h2></div></header>
      {runners.map((runner) => <article key={runner.id}>
        <span className={`runner-state ${runner.state}`}><i />{runner.state}</span>
        <div><strong>{runner.name}</strong><small>{runner.device || "Device details arrive with the first heartbeat"}</small><small>{heartbeat(runner.lastHeartbeatAt)}{runner.comfyVersion ? ` · ComfyUI ${runner.comfyVersion}` : ""}</small>{runner.lastError ? <em>{runner.lastError.replaceAll("_", " ")}</em> : null}</div>
        <code>{runner.version ? `runner v${runner.version}` : runner.id}</code>
        {!runner.revokedAt ? <button className="btn btn-ghost" disabled={busy} onClick={() => void revokeLocalRunner(runner.id)}>Revoke</button> : null}
      </article>)}
      {!runners.length ? <div className="runner-empty"><Icon name="runtime" size={28} /><span><strong>No machines paired.</strong><small>Create a token above, then run the installer on this ComfyUI workstation.</small></span></div> : null}
    </section>
  </section>;
}
