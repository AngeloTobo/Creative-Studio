import { useRef, useState } from "react";
import type { WorkflowParameter, WorkflowScalar } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";

function sameValue(left: WorkflowScalar, right: WorkflowScalar) {
  return typeof left === typeof right && left === right;
}

function ParameterField({ parameter, value, onChange }: {
  parameter: WorkflowParameter;
  value: WorkflowScalar;
  onChange: (value: WorkflowScalar) => void;
}) {
  if (parameter.kind === "boolean") {
    return <label className="workflow-toggle"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span><strong>{parameter.label}</strong><small>{parameter.id}</small></span></label>;
  }
  if (parameter.kind === "number") {
    return <label className="field workflow-field"><span>{parameter.label}</span><input type="number" value={Number(value)} onChange={(event) => onChange(Number(event.target.value))} /><small>{parameter.id}</small></label>;
  }
  const text = String(value);
  const multiline = text.length > 100 || /prompt|lyrics|caption/i.test(parameter.label);
  return <label className="field workflow-field"><span>{parameter.label}</span>{multiline
    ? <textarea value={text} onChange={(event) => onChange(event.target.value)} />
    : <input value={text} onChange={(event) => onChange(event.target.value)} />}
    <small>{parameter.kind === "media" ? "ComfyUI input filename" : parameter.id}</small>
  </label>;
}

export function FlowsView() {
  const { snapshot, activeProjectId, busy, error, uploadWorkflow, saveWorkflowRevision } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const workflows = snapshot?.workflows.filter((workflow) => workflow.projectId === activeProjectId) ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0] ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");

  const effectiveValues = selected && valuesRevisionId === selected.currentRevision.id ? values : {};
  const changed = selected?.currentRevision.parameters.some((parameter) => !sameValue(parameter.value, effectiveValues[parameter.id] ?? parameter.value)) ?? false;

  const importFile = async () => {
    if (!file) return;
    const imported = await uploadWorkflow(file, name, description);
    setSelectedId(imported.id);
    setValuesRevisionId(imported.currentRevision.id);
    setValues(Object.fromEntries(imported.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
    setFile(null);
    setName("");
    setDescription("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const saveVersion = async () => {
    if (!selected || !changed) return;
    const modified = Object.fromEntries(selected.currentRevision.parameters
      .filter((parameter) => !sameValue(parameter.value, effectiveValues[parameter.id] ?? parameter.value))
      .map((parameter) => [parameter.id, effectiveValues[parameter.id]]));
    await saveWorkflowRevision(selected.id, selected.currentRevision.id, modified);
  };

  return <section className="flows-view fade-up">
    <section className="workflow-import glass">
      <div className="workflow-import-copy"><span className="eyebrow">Workflow library</span><h2>Upload a ComfyUI JSON</h2><p>The original graph is preserved and content-hashed. Creative Studio detects editable prompts and safe generation controls, then saves every modification as a new immutable version.</p></div>
      <label className="workflow-drop">
        <input ref={inputRef} type="file" accept="application/json,.json" disabled={busy || snapshot?.adapter.development} onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          setFile(next);
          if (next && !name) setName(next.name.replace(/\.json$/i, "").replaceAll("_", " "));
        }} />
        <span className="media-drop-icon"><Icon name="flows" size={23} /></span>
        <strong>{file?.name ?? "Choose workflow JSON"}</strong>
        <small>{snapshot?.adapter.development ? "Connect through the Creative Studio Worker to import real workflows." : "ComfyUI API and UI graph exports · maximum 1 MB"}</small>
      </label>
      <div className="workflow-import-fields">
        <label className="field"><span>Workflow name</span><input value={name} disabled={busy || snapshot?.adapter.development} onChange={(event) => setName(event.target.value)} placeholder="Defaults to the JSON filename" /></label>
        <label className="field"><span>Description</span><input value={description} disabled={busy || snapshot?.adapter.development} onChange={(event) => setDescription(event.target.value)} placeholder="What this workflow is for" /></label>
        <button className="btn btn-primary" disabled={!file || busy || snapshot?.adapter.development} onClick={() => void importFile()}><Icon name="plus" size={16} /> Import workflow</button>
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
    </section>

    <div className="workflow-layout">
      <aside className="workflow-list glass">
        <div className="workflow-list-head"><span><span className="eyebrow">Project workflows</span><strong>{workflows.length} saved</strong></span></div>
        {workflows.map((workflow) => <button key={workflow.id} className={selected?.id === workflow.id ? "on" : ""} onClick={() => {
          setSelectedId(workflow.id);
          setValuesRevisionId(workflow.currentRevision.id);
          setValues(Object.fromEntries(workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
        }}>
          <Icon name={workflow.modality === "music" || workflow.modality === "audio" ? "music" : workflow.modality === "video" ? "video" : workflow.modality === "3d" ? "cube" : "image"} size={18} />
          <span><strong>{workflow.name}</strong><small>v{workflow.currentRevision.version} · {workflow.modality} · {workflow.currentRevision.format}</small></span>
        </button>)}
        {!workflows.length ? <p>No workflow JSONs have been imported for this project.</p> : null}
      </aside>

      <section className="workflow-editor glass">
        {selected ? <>
          <header className="workflow-editor-head"><div><span className="eyebrow">Build from workflow</span><h2>{selected.name}</h2><p>{selected.description || selected.sourceFileName}</p></div><span className={`workflow-state ${selected.executionState}`}>{selected.executionState === "ready" ? "API ready" : "UI graph"}</span></header>
          <div className="workflow-facts"><span><small>Revision</small><strong>v{selected.currentRevision.version}</strong></span><span><small>Nodes</small><strong>{selected.currentRevision.nodeCount}</strong></span><span><small>Editable</small><strong>{selected.currentRevision.parameters.length}</strong></span><span className="workflow-hash"><small>SHA-256</small><code>{selected.currentRevision.contentHash}</code></span></div>
          {selected.executionState === "api-export-required" ? <div className="workflow-notice"><Icon name="external" size={18} /><span><strong>This is a ComfyUI UI graph.</strong><small>You can version, edit, and download it here. Local automated execution will require its API-format export.</small></span></div> : null}
          <div className="workflow-parameters">
            {selected.currentRevision.parameters.map((parameter) => <ParameterField key={parameter.id} parameter={parameter} value={effectiveValues[parameter.id] ?? parameter.value} onChange={(value) => {
              if (valuesRevisionId !== selected.currentRevision.id) {
                setValuesRevisionId(selected.currentRevision.id);
                setValues({ ...Object.fromEntries(selected.currentRevision.parameters.map((item) => [item.id, item.value])), [parameter.id]: value });
              } else {
                setValues((current) => ({ ...current, [parameter.id]: value }));
              }
            }} />)}
            {!selected.currentRevision.parameters.length ? <p className="empty-copy">The graph is preserved, but no safe editable controls were detected automatically.</p> : null}
          </div>
          <div className="workflow-models"><span className="eyebrow">Detected models</span>{selected.currentRevision.models.length ? <div>{selected.currentRevision.models.map((model) => <code key={model}>{model}</code>)}</div> : <p>No model filenames were embedded in this graph.</p>}</div>
          <footer className="workflow-actions">
            <a className="btn btn-ghost" href={`${selected.id ? `/api/creative-studio/workflows/${encodeURIComponent(selected.id)}/content?revision=${encodeURIComponent(selected.currentRevision.id)}` : "#"}`}><Icon name="external" size={15} /> Download JSON</a>
            <button className="btn btn-ghost" disabled={!changed || busy} onClick={() => { setValuesRevisionId(selected.currentRevision.id); setValues(Object.fromEntries(selected.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value]))); }}><Icon name="rerun" size={15} /> Reset</button>
            <button className="btn btn-primary" disabled={!changed || busy} onClick={() => void saveVersion()}><Icon name="history" size={15} /> Save as v{selected.currentRevision.version + 1}</button>
          </footer>
        </> : <div className="empty-state"><Icon name="flows" size={34} /><h2>Upload or build a workflow</h2><p>Imported ComfyUI graphs will become reusable, versioned project tools.</p></div>}
      </section>
    </div>
  </section>;
}
