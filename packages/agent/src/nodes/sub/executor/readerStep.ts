import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ReaderDigest, ReaderOutput, StepResult } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { readerGraph } from '../../../graphs/reader';
import { READER_PROMPT } from '../../../prompts';

const MAX_FINDINGS = 15;
const MAX_FINDING_CHARS = 800;

export const digestReaderOutput = (stepId: string, output: ReaderOutput): ReaderDigest => ({
  stepId,
  summary: output.summary,
  keyFindings: (output.key_findings ?? []).slice(0, MAX_FINDINGS).map((f) => ({
    file: f.file,
    lines: f.lines,
    content: f.content.slice(0, MAX_FINDING_CHARS),
    comment: f.comment,
  })),
  operationHints: output.potential_edit_strategy?.operation_hints ?? [],
});

export const readerStepNode = async (state: ExecutorStateType) => {
  const { plan, cwd, sessionId, currentStepId } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!plan || !step || !currentStepId) return { currentStepId: null };

  const task = `${step.title}\nExpected output: ${step.expected_output}\nOverall goal: ${plan.goal}`;

  const systemMessage = READER_PROMPT({
    task,
    focus: step.files ?? [],
    context: {
      user_goal: state.plan?.goal ?? '',
      current_plan_step: step.id,
      cwd: state.cwd,
      sessionId: state.sessionId,
    },
  });

  let output: ReaderOutput | null = null;
  try {
    const result = await readerGraph.invoke(
      {
        messages: [new SystemMessage(systemMessage), new HumanMessage(task)],
        sessionId,
        cwd,
        task,
        focus: step.files,
        turnCount: 0,
        editIntentInputPayload: null,
      },
      { configurable: { sessionId, cwd }, recursionLimit: 150 }
    );
    output = result.editIntentInputPayload ?? null;
  } catch (err) {
    debug('[executor/reader_step] reader failed', err);
  }
  debug('[executor/reader_step] output', output);

  const retries = state.retryCounts[currentStepId] ?? 0;

  if (!output || output.status === 'blocked') {
    const reason = output
      ? `Reader blocked: ${output.unresolved_questions.join('; ') || output.summary}`
      : 'Reader subagent returned no output.';
    EventBus.emit('executor:step:done', {
      sessionId,
      stepId: currentStepId,
      status: 'failed',
      retries,
    });
    const result: StepResult = {
      stepId: currentStepId,
      status: 'failed',
      output: reason.slice(0, 800),
      retries,
    };
    return {
      stepStates: { [currentStepId]: 'failed' as const },
      stepResults: [result],
      lastError: reason,
    };
  }

  // 'sufficient' and 'insufficient' both produce usable findings; unresolved
  // questions surface to the mini-reader through the digest summary.
  const digest = digestReaderOutput(currentStepId, output);

  EventBus.emit('executor:step:done', {
    sessionId,
    stepId: currentStepId,
    status: 'done',
    retries,
  });
  const result: StepResult = {
    stepId: currentStepId,
    status: 'done',
    output: output.summary.slice(0, 800),
    retries,
  };

  debug('[executor/reader_step]', {
    key_findings: { [currentStepId]: digest },
    stepStates: { [currentStepId]: 'done' },
    stepResults: [result],
    currentStepId: null,
    lastError: null,
  });
  return {
    key_findings: { [currentStepId]: digest },
    stepStates: { [currentStepId]: 'done' as const },
    stepResults: [result],
    currentStepId: null,
    lastError: null,
  };
};
