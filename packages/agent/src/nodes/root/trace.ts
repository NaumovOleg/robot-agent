import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '@robocode-packages/shared';

// Compact snapshot of the root graph state for the debug trace.
export const summarizeRootState = (state: RootStateType): string => {
  const intent = state.router?.intent?.intent ?? '—';
  const plan = state.plan ? `${state.plan.steps.length} steps` : 'none';
  const approved =
    state.planApproved === null || state.planApproved === undefined
      ? '—'
      : String(state.planApproved);
  return [
    `intent=${intent}`,
    `plan=${plan}`,
    `approved=${approved}`,
    `clarify=${state.clarificationSource ?? '—'}`,
    `results=${state.stepResults?.length ?? 0}`,
  ].join(' | ');
};

// Wraps a root graph node so every entry logs the node name and a compact state
// snapshot — a node-by-node trace of the orchestrator flow
// (context → router → planner → plan_approval → executor → agent).
// Generic over the node's return type so addNode's overloads still resolve.
export const traceRootNode =
  <R>(name: string, fn: (state: RootStateType) => R): ((state: RootStateType) => R) =>
  (state) => {
    debug(`[graph/root] → ${name.padEnd(16)} ${summarizeRootState(state)}`);
    return fn(state);
  };
