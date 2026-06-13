import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { PlannerOutput, StepStatus, StepResult } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { summarizeState } from './summary';

type PlanStep = PlannerOutput['steps'][number];

export const pickNextStep = (
  steps: PlanStep[],
  stepStates: Record<string, StepStatus>
): PlanStep | null =>
  steps.find(
    (step) =>
      stepStates[step.id] === 'pending' &&
      step.depends_on.every((dep) => stepStates[dep] === 'done')
  ) ?? null;

export const stepSelectorNode = async (state: ExecutorStateType) => {
  const { plan, sessionId, stepStates } = state;
  if (!plan) return { currentStepId: null };

  const next = pickNextStep(plan.steps, stepStates);

  if (next) {
    const total = plan.steps.length;
    const index = plan.steps.findIndex((s) => s.id === next.id) + 1;
    EventBus.emit('executor:step:start', {
      sessionId, stepId: next.id, title: next.title, index, total,
    });
    debug(
      '[executor/select]',
      `(${index}/${total}) [${next.kind}]`,
      next.id,
      '—',
      next.title,
      '\n  state:',
      summarizeState({ ...state, currentStepId: next.id })
    );
    return {
      currentStepId: next.id,
      stepStates: { [next.id]: 'running' as StepStatus },
      lastError: null,
      verifyOutput: null,
      verifyPassed: null,
      currentHints: [],
    };
  }

  // No eligible step. Any still-pending steps are unreachable (failed/skipped deps).
  const unreachable = plan.steps.filter((s) => stepStates[s.id] === 'pending');
  if (unreachable.length === 0) return { currentStepId: null };

  const skippedStates: Record<string, StepStatus> = {};
  const skippedResults: StepResult[] = [];
  for (const step of unreachable) {
    skippedStates[step.id] = 'skipped';
    skippedResults.push({
      stepId: step.id,
      status: 'skipped',
      output: 'Unreachable: a dependency failed or was skipped.',
      retries: state.retryCounts[step.id] ?? 0,
    });
    EventBus.emit('executor:step:done', {
      sessionId, stepId: step.id, status: 'skipped',
      retries: state.retryCounts[step.id] ?? 0,
    });
  }
  return { currentStepId: null, stepStates: skippedStates, stepResults: skippedResults };
};
