import { debug } from '@robocode-packages/shared';
import type { StepStatus } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

const hasCycle = (steps: { id: string; depends_on: string[] }[]): boolean => {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(steps.map((s) => [s.id, s]));

  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (visit(dep)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };

  return steps.some((s) => visit(s.id));
};

export const initNode = async (state: ExecutorStateType) => {
  const { plan, context } = state;

  if (!plan || plan.steps.length === 0) {
    return { lastError: 'Executor started with no plan.' };
  }

  if (hasCycle(plan.steps)) {
    return { lastError: 'Plan dependency cycle detected — cannot execute.' };
  }

  const stepStates: Record<string, StepStatus> = {};
  for (const step of plan.steps) stepStates[step.id] = 'pending';

  const verifyCommands = {
    typeCheck: context?.language?.typeCheck ?? null,
    testRunner: context?.language?.testRunner ?? null,
    lint: context?.language?.linter ?? null,
  };

  debug('[executor/init]', plan.steps.length, 'steps; verify:', verifyCommands);
  return { stepStates, verifyCommands, lastError: null };
};
