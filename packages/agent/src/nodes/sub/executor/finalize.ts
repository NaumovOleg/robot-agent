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

  const all = [...stepResults, ...missing];
  const tally = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  debug(
    '[executor/finalize]',
    `${all.length} step result(s) —`,
    Object.entries(tally)
      .map(([s, n]) => `${n} ${s}`)
      .join(', '),
    all.map((r) => `\n    [${r.status}] ${r.stepId}`).join('')
  );
  return missing.length > 0 ? { stepResults: missing } : {};
};

// A step that was escalated and later retried to success appears twice (failed, then done).
export const dedupeStepResults = (results: StepResult[]): StepResult[] => {
  const byId = new Map<string, StepResult>();
  for (const r of results) byId.set(r.stepId, r);
  return [...byId.values()];
};
