import type { WorkflowScalar } from "../../../shared/contracts";

export function sameWorkflowValue(left: WorkflowScalar, right: WorkflowScalar) {
  return typeof left === typeof right && left === right;
}
