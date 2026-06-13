import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { debug, StepReviewOutputSchema } from '@robocode-packages/shared';
import type { StepResult, StepReviewStatus } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildStepReviewPrompt } from '../../../prompts/sub/executor/stepReview';
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
  const applied = state.appliedOps[currentStepId] ?? [];

  let status: StepReviewStatus;
  let reason: string;

  if (state.lastError) {
    // Mechanical/verification failure — the LLM judge adds nothing here.
    status = 'insufficient';
    reason = state.lastError;
  } else if (state.verifyPassed === true) {
    // Programmatic verification (type-check / related tests) ran and passed —
    // authoritative. Don't ask the LLM judge to re-confirm an already-passing
    // check; it tends to demand verification that already succeeded and loops a
    // correct edit to failure.
    status = 'sufficient';
    reason = 'Edit applied and verification (type-check/tests) passed.';
  } else {
    const prompt = buildStepReviewPrompt({
      stepTitle: step.title,
      expectedOutput: step.expected_output,
      appliedOps: applied,
      verifyOutput: state.verifyOutput,
    });
    try {
      const model = getModel(false).withStructuredOutput(StepReviewOutputSchema, {
        name: 'step_review',
      });
      const review = await model.invoke([
        new SystemMessage(prompt),
        new HumanMessage('Review the step result.'),
      ]);
      status = review.status;
      reason = review.reason;
    } catch (err) {
      const verificationRan = !!(state.verifyCommands.typeCheck || state.verifyCommands.testRunner);
      if (verificationRan) {
        // cheap tiers passed (no lastError) — accept rather than loop on infra errors
        debug('[executor/step_review] judge LLM failed, accepting on verification', err);
        status = 'sufficient';
        reason = 'Verification passed; review LLM unavailable.';
      } else {
        debug('[executor/step_review] judge LLM failed, no verification configured', err);
        status = 'insufficient';
        reason = `Review LLM unavailable and no verification was configured: ${String(err).slice(0, 200)}`;
      }
    }
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
  };
};
