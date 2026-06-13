import { debug, runCommand } from '@robocode-packages/shared';
import type { StepStatus } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { parseVerifyErrors } from './verifyErrors';

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

  // Capture the project's pre-existing type-check errors ONCE, before any edit.
  // verify_step diffs against this so a step is only blamed for errors it newly
  // introduces — a project that already has tsc noise (e.g. test files without
  // jest types) would otherwise fail every single edit step forever.
  let baselineErrors: string[] = [];
  if (verifyCommands.typeCheck) {
    const baseline = await runCommand(verifyCommands.typeCheck, state.cwd);
    baselineErrors = parseVerifyErrors(baseline.output);
  }

  debug(
    '[executor/init]',
    `goal: ${plan.goal.replace(/\s+/g, ' ').trim().slice(0, 200)}`,
    `\n  ${plan.steps.length} step(s):`,
    plan.steps.map((s) => `\n    [${s.kind}] ${s.id} (${s.files.join(', ') || 'no files'})`).join(''),
    `\n  verify: typeCheck=${verifyCommands.typeCheck ?? 'none'}, testRunner=${verifyCommands.testRunner ?? 'none'}`,
    `| ${baselineErrors.length} baseline tsc error(s)`
  );
  return { stepStates, verifyCommands, baselineErrors, lastError: null };
};
