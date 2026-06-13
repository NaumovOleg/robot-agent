import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { debug, MiniReaderOutputSchema } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildMiniReaderPrompt } from '../../../prompts/sub/executor/miniReader';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { summarizeHints } from './summary';

export const miniReaderNode = async (state: ExecutorStateType) => {
  const { plan, cwd, currentStepId } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!plan || !step) return { currentHints: [], lastError: 'mini_reader: no current step' };

  const targetFiles = step.files.slice(0, 15);
  if (targetFiles.length < step.files.length) {
    debug('[executor/mini_reader] clipped file list', step.files.length, '→ 15');
  }

  const files = (
    await Promise.all(
      targetFiles.map(async (file) => {
        const content = await fs.readFile(path.resolve(cwd, file), 'utf-8').catch(() => null);
        return content === null ? null : { file, content };
      })
    )
  ).filter((f): f is { file: string; content: string } => f !== null);

  if (files.length === 0 && step.files.length > 0 && step.kind !== 'create') {
    return {
      currentHints: [],
      lastError: `mini_reader: file(s) not found for ${step.kind} step: ${step.files.join(', ')}`,
    };
  }

  const findings = step.depends_on
    .map((depId) => state.readerFindings[depId])
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const prompt = buildMiniReaderPrompt({
    step,
    goal: plan.goal,
    constraints: plan.constraints,
    files,
    findings,
    lastError: state.lastError,
    userGuidance: state.userGuidance,
    appliedOps: state.appliedOps[step.id] ?? [],
  });

  try {
    const model = getModel(false).withStructuredOutput(MiniReaderOutputSchema, {
      name: 'mini_reader',
    });
    const output = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(`Generate the edit hints for step "${step.id}".`),
    ]);
    debug(
      '[executor/mini_reader]',
      step.id,
      `proposed ${output.hints.length} hint(s):`,
      summarizeHints(output.hints)
    );
    if (output.hints.length === 0) {
      return { currentHints: [], lastError: 'mini_reader produced zero hints' };
    }
    return { currentHints: output.hints, lastError: null, userGuidance: null };
  } catch (err) {
    debug('[executor/mini_reader] LLM failed', err);
    return { currentHints: [], lastError: `mini_reader LLM error: ${String(err).slice(0, 500)}` };
  }
};
