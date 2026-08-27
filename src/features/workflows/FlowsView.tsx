import { useRef, useState } from "react";
import type { WorkflowScalar } from "../../../shared/contracts";
import { useStudio } from "../../app/StudioProvider";
import { Icon } from "../../components/Icon";
import { WorkflowParameterField } from "./WorkflowParameterField";
import { sameWorkflowValue } from "./workflowValues";

export function FlowsView({ embedded = false }: { embedded?: boolean } = {}) {
  const { snapshot, activeProjectId, busy, error, uploadWorkflow, saveWorkflowRevision } = useStudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const workflows = snapshot?.workflows ?? [];
  const [selectedId, setSelectedId] = useState("");
  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0] ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [values, setValues] = useState<Record<string, WorkflowScalar>>({});
  const [valuesRevisionId, setValuesRevisionId] = useState("");
  const uiOnlyDevelopment = snapshot?.adapter.id === "development-local-storage";
  const projectRequired = !activeProjectId;
  const importDisabled = busy || uiOnlyDevelopment || projectRequired;

  const effectiveValues = selected && valuesRevisionId === selected.currentRevision.id ? values : {};
  const changed = selected?.currentRevision.parameters.some((parameter) => !sameWorkflowValue(parameter.value, effectiveValues[parameter.id] ?? parameter.value)) ?? false;

  const importFile = async () => {
    if (!file || projectRequired) return;
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
      .filter((parameter) => !sameWorkflowValue(parameter.value, effectiveValues[parameter.id] ?? parameter.value))
      .map((parameter) => [parameter.id, effectiveValues[parameter.id]]));
    await saveWorkflowRevision(selected.id, selected.currentRevision.id, modified);
  };

  return <section className={`flows-view flows-view-compact fade-up${embedded ? " embedded" : ""}`}>
    <details className="workflow-import-shell glass" open={!workflows.length || undefined}>
      <summary><span><span className="media-drop-icon"><Icon name="flows" size={18} /></span><span><strong>Import a ComfyUI model</strong><small>{projectRequired ? "Select a project to import · browsing stays available" : "JSON graph · immutable revisions"}</small></span></span><span>{workflows.length} saved</span><Icon name="chevronDown" size={16} /></summary>
      <section className="workflow-import workflow-import-compact">
      <div className="workflow-import-copy"><span className="eyebrow">Model library</span><h2>Add a workflow</h2><p>Import into the active project, then use the model from Create. The graph and every settings revision remain immutable and content-hashed.</p></div>
      {projectRequired ? <div className="workflow-project-required workflow-notice" role="note"><Icon name="projects" size={18} /><span><strong>Create or select a project to import.</strong><small>Models are project-owned. You can still browse and inspect every saved model below.</small></span></div> : null}
      <label className="workflow-drop">
        <input ref={inputRef} type="file" accept="application/json,.json" disabled={importDisabled} onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          setFile(next);
          if (next && !name) setName(next.name.replace(/\.json$/i, "").replaceAll("_", " "));
        }} />
        <span className="media-drop-icon"><Icon name="flows" size={23} /></span>
        <strong>{file?.name ?? "Choose workflow JSON"}</strong>
        <small>{projectRequired ? "Project required before a workflow can be stored." : uiOnlyDevelopment ? "Connect through the Creative Studio Worker to import real workflows." : "ComfyUI API and UI graph exports · maximum 1 MB"}</small>
      </label>
      <div className="workflow-import-fields">
        <label className="field"><span>Workflow name</span><input value={name} disabled={importDisabled} onChange={(event) => setName(event.target.value)} placeholder="Defaults to the JSON filename" /></label>
        <label className="field"><span>Description</span><input value={description} disabled={importDisabled} onChange={(event) => setDescription(event.target.value)} placeholder="What this workflow is for" /></label>
        <button className="btn btn-primary" disabled={!file || importDisabled} onClick={() => void importFile()}><Icon name="plus" size={16} /> Import workflow</button>
      </div>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      </section>
    </details>

    <div className="workflow-layout">
      <aside className="workflow-list glass">
        <div className="workflow-list-head"><span><span className="eyebrow">Your models</span><strong>{workflows.length} saved</strong></span></div>
        {workflows.map((workflow) => <button key={workflow.id} className={selected?.id === workflow.id ? "on" : ""} onClick={() => {
          setSelectedId(workflow.id);
          setValuesRevisionId(workflow.currentRevision.id);
          setValues(Object.fromEntries(workflow.currentRevision.parameters.map((parameter) => [parameter.id, parameter.value])));
        }}>
          <Icon name={workflow.modality === "music" || workflow.modality === "audio" ? "music" : workflow.modality === "video" ? "video" : workflow.modality === "3d" ? "cube" : "image"} size={18} />
          <span><strong>{workflow.name}</strong><small>v{workflow.currentRevision.version} · {workflow.modality} · {workflow.currentRevision.format}</small></span>
        </button>)}
        {!workflows.length ? <p>No workflow JSONs have been imported yet.</p> : null}
      </aside>

      <section className="workflow-editor glass">
        {selected ? <>
          <header className="workflow-editor-head"><div><span className="eyebrow">Build from workflow</span><h2>{selected.name}</h2><p>{selected.description || selected.sourceFileName}</p></div><span className={`workflow-state ${selected.executionState}`}>{selected.executionState === "ready" ? "API ready" : "UI graph"}</span></header>
          <div className="workflow-facts"><span><small>Revision</small><strong>v{selected.currentRevision.version}</strong></span><span><small>Nodes</small><strong>{selected.currentRevision.nodeCount}</strong></span><span><small>Editable</small><strong>{selected.currentRevision.parameters.length}</strong></span><span className="workflow-hash"><small>SHA-256</small><code>{selected.currentRevision.contentHash}</code></span></div>
          {selected.executionState === "api-export-required" ? <div className="workflow-notice"><Icon name="external" size={18} /><span><strong>This is a ComfyUI UI graph.</strong><small>You can version, edit, and download it here. Local automated execution will require its API-format export.</small></span></div> : null}
          <div className="workflow-parameters">
            {selected.currentRevision.parameters.map((parameter) => <WorkflowParameterField key={parameter.id} parameter={parameter} value={effectiveValues[parameter.id] ?? parameter.value} onChange={(value) => {
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
        </> : <div className="empty-state"><Icon name="flows" size={34} /><h2>Add your first model</h2><p>Import one working ComfyUI graph here, then reuse it from Create across projects.</p></div>}
      </section>
    </div>
  </section>;
}
