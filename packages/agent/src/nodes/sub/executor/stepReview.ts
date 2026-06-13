import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { StepResult, StepReviewStatus } from '@robocode-packages/shared';
import { restoreSnapshot } from './snapshots';
import { MAX_STEP_RETRIES } from '../../../subagents/executor/state';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export type StepOutcome = 'done' | 'retry' | 'failed';

export const decideStepOutcome = (
  status: StepReviewStatus,
  retries: number
): StepOutcome => {
  if (status === 'sufficient') return 'done';
  if (status === 'blocked') return 'failed';
  return retries < MAX_STEP_RETRIES ? 'retry' : 'failed';
};

export const stepReviewNode = async (state: ExecutorStateType) => {
  const { plan, cwd, sessionId, currentStepId } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!currentStepId || !step) return { currentStepId: null };

  const retries = state.retryCounts[currentStepId] ?? 0;

  // The gate is programmatic, not an LLM judge: a step is "done" once its edits
  // applied cleanly (apply already ran a tree-sitter syntax check). The
  // authoritative whole-project type check runs once at the final mutation
  // (verify_step) and routes its failures back here as lastError — including
  // errors in OTHER files, which the retry is allowed to fix. An earlier LLM
  // judge was removed: it was unreliable (kept demanding already-passed checks).
  let status: StepReviewStatus;
  let reason: string;
  if (state.lastError) {
    status = 'insufficient';
    reason = state.lastError;
  } else {
    status = 'sufficient';
    reason =
      state.verifyPassed === true
        ? 'Edit applied and the final type check passed.'
        : 'Edit applied (syntax ok); type check deferred to the final mutation.';
  }

  const outcome = decideStepOutcome(status, retries);
  debug(
    '[executor/step_review]',
    currentStepId,
    `verdict=${status} → ${outcome} (retries=${retries})`,
    '\n  reason:',
    reason.replace(/\s+/g, ' ').trim().slice(0, 300)
  );

  if (outcome === 'done') {
    const result: StepResult = {
      stepId: currentStepId,
      status: 'done',
      output: reason.slice(0, 800),
      retries,
    };
    EventBus.emit('executor:step:done', { sessionId, stepId: currentStepId, status: 'done', retries });
    return {
      stepStates: { [currentStepId]: 'done' as const },
      stepResults: [result],
      currentStepId: null,
      currentHints: [],
      lastError: null,
      verifyOutput: null,
      verifyPassed: null,
      errorFiles: [],
    };
  }

  // retry and failed both roll the step's files back to pristine state
  const snapshot = state.fileSnapshots[currentStepId];
  if (snapshot) await restoreSnapshot(cwd, snapshot);

  if (outcome === 'retry') {
    return {
      retryCounts: { [currentStepId]: retries + 1 },
      lastError: reason,
      currentHints: [],
      verifyOutput: null,
      verifyPassed: null,
    };
  }

  const result: StepResult = {
    stepId: currentStepId,
    status: 'failed',
    output: reason.slice(0, 800),
    retries,
  };
  EventBus.emit('executor:step:done', { sessionId, stepId: currentStepId, status: 'failed', retries });
  return {
    stepStates: { [currentStepId]: 'failed' as const },
    stepResults: [result],
    lastError: reason,
    currentHints: [],
    verifyOutput: null,
    verifyPassed: null,
    errorFiles: [],
  };
};
