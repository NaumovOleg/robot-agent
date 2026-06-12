import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { EscalationDecision, StepResult, StepStatus } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export interface ParsedEscalation {
  decision: EscalationDecision;
  guidance: string | null;
}

export const parseEscalationAnswer = (answer: string): ParsedEscalation => {
  const normalized = answer.trim().toLowerCase();
  if (normalized === 'skip') return { decision: 'skip', guidance: null };
  if (normalized === 'abort' || normalized === 'stop') return { decision: 'abort', guidance: null };
  if (normalized === 'retry') return { decision: 'retry', guidance: null };
  return { decision: 'retry', guidance: answer.trim() };
};

export const collectDependents = (
  steps: { id: string; depends_on: string[] }[],
  stepId: string
): string[] => {
  const dependents = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const step of steps) {
      if (dependents.has(step.id)) continue;
      if (step.depends_on.some((dep) => dep === stepId || dependents.has(dep))) {
        dependents.add(step.id);
        grew = true;
      }
    }
  }
  return [...dependents];
};

export const escalateNode = (state: ExecutorStateType) => {
  const { plan, sessionId, currentStepId, lastError } = state;
  const stepId = currentStepId ?? 'unknown';
  const step = plan?.steps.find((s) => s.id === stepId);

  const question =
    `Executor step "${step?.title ?? stepId}" failed:\n${lastError ?? 'unknown error'}\n\n` +
    `Reply "skip" to skip this step (dependent steps will be skipped too), ` +
    `"abort" (or "stop") to stop the executor, or type guidance to retry with your hint.`;

  EventBus.emit('agent:question', { sessionId, question, source: 'executor' });
  const answer: string = interrupt(question);
  const parsed = parseEscalationAnswer(answer);
  EventBus.emit('agent:answer', { sessionId, answer, source: 'executor' });
  debug('[executor/escalate]', stepId, '→', parsed.decision);

  if (parsed.decision === 'retry' && step) {
    return {
      escalationDecision: 'retry' as const,
      userGuidance: parsed.guidance,
      retryCounts: { [stepId]: 0 },
      stepStates: { [stepId]: 'running' as StepStatus },
    };
  }

  if (parsed.decision === 'skip' && plan && step) {
    const cascade = collectDependents(plan.steps, stepId).filter(
      (id) => state.stepStates[id] === 'pending'
    );
    const stepStates: Record<string, StepStatus> = { [stepId]: 'skipped' };
    const stepResults: StepResult[] = [];
    // the failed step already has a StepResult from step_review/reader_step — only cascade gets new ones
    for (const id of cascade) {
      stepStates[id] = 'skipped';
      stepResults.push({
        stepId: id, status: 'skipped',
        output: `Skipped: dependency "${stepId}" was skipped by the user.`,
        retries: 0,
      });
      EventBus.emit('executor:step:done', { sessionId, stepId: id, status: 'skipped', retries: 0 });
    }
    return {
      escalationDecision: 'skip' as const,
      stepStates,
      stepResults,
      currentStepId: null,
      lastError: null,
      userGuidance: null,
    };
  }

  if (parsed.decision !== 'abort') {
    debug('[executor/escalate] fallthrough to abort (no valid step for decision:', parsed.decision, ', stepId:', stepId, ')');
  }

  return { escalationDecision: 'abort' as const, currentStepId: null };
};
