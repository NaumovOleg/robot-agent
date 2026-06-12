import { debug } from '@robocode-packages/shared';
import type { StepResult } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

// Safety net: every plan step must end with a StepResult, even on abort.
export const finalizeNode = (state: ExecutorStateType) => {
  const { plan, stepResults } = state;
  if (!plan) return {};

  const covered = new Set(stepResults.map((r) => r.stepId));
  const missing: StepResult[] = plan.steps
    .filter((s) => !covered.has(s.id))
    .map((s) => ({
      stepId: s.id,
      status: 'skipped' as const,
      output:
        state.escalationDecision === 'abort'
          ? 'Skipped: executor aborted by the user.'
          : `Skipped: executor ended before this step.${state.lastError ? ` (last error: ${state.lastError.slice(0, 200)})` : ''}`,
      retries: state.retryCounts[s.id] ?? 0,
    }));

  debug('[executor/finalize]', stepResults.length + missing.length, 'step results');
  return missing.length > 0 ? { stepResults: missing } : {};
};

// stepResults accumulate; a retried step appears multiple times (failed, then done).
// Consumers must use the LAST entry per stepId.
export const dedupeStepResults = (results: StepResult[]): StepResult[] => {
  const byId = new Map<string, StepResult>();
  for (const r of results) byId.set(r.stepId, r);
  return [...byId.values()];
};
