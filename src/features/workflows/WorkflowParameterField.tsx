import { canonicalWorkflowParameterValue, workflowParameterChoices, type WorkflowParameter, type WorkflowScalar } from "../../../shared/contracts";

export function WorkflowParameterField({ parameter, value, onChange, showBinding = true }: {
  parameter: WorkflowParameter;
  value: WorkflowScalar;
  onChange: (value: WorkflowScalar) => void;
  showBinding?: boolean;
}) {
  if (parameter.kind === "boolean") {
    return <label className="workflow-toggle"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><span><strong>{parameter.label}</strong>{showBinding ? <small>{parameter.id}</small> : null}</span></label>;
  }
  if (parameter.kind === "number") {
    return <label className="field workflow-field"><span>{parameter.label}</span><input type="number" value={Number(value)} onChange={(event) => onChange(Number(event.target.value))} />{showBinding ? <small>{parameter.id}</small> : null}</label>;
  }
  const choices = workflowParameterChoices(parameter);
  if (choices.length) {
    const selected = canonicalWorkflowParameterValue(parameter, value);
    return <label className="field workflow-field"><span>{parameter.label}</span><select value={String(selected)} onChange={(event) => onChange(event.target.value)}>{choices.map((choice) => <option key={String(choice)} value={String(choice)}>{String(choice)}</option>)}</select>{showBinding ? <small>{parameter.id}</small> : null}</label>;
  }
  const text = String(value);
  const multiline = text.length > 100 || /prompt|lyrics|caption/i.test(parameter.label);
  return <label className="field workflow-field"><span>{parameter.label}</span>{multiline
    ? <textarea value={text} onChange={(event) => onChange(event.target.value)} />
    : <input value={text} onChange={(event) => onChange(event.target.value)} />}
    {showBinding ? <small>{parameter.kind === "media" ? "ComfyUI input filename" : parameter.id}</small> : null}
  </label>;
}
