import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { debug, MiniReaderOutputSchema } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildMiniReaderPrompt } from '../../../prompts/sub/executor/miniReader';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { summarizeHints } from './summary';
import { findReferenceFile } from './referenceFile';

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

  // Files created/changed by EARLIER steps in this plan, excluding the ones this
  // step already reads — so the LLM references new files by their exact path.
  const ownFiles = new Set(step.files);
  const producedFiles = (state.producedFiles ?? []).filter((f) => !ownFiles.has(f));

  // For files this step will CREATE (in step.files but not on disk), pull an
  // existing sibling of the same kind so the editor mirrors real project
  // conventions instead of inventing them.
  const loaded = new Set(files.map((f) => f.file));
  const toCreate = step.files.filter((f) => !loaded.has(f));
  const references = (
    await Promise.all(toCreate.map((f) => findReferenceFile(cwd, f)))
  ).filter((r): r is { file: string; content: string } => r !== null);
  // Dedupe references by path.
  const seenRef = new Set<string>();
  const uniqueReferences = references.filter((r) =>
    seenRef.has(r.file) ? false : (seenRef.add(r.file), true)
  );

  // Files the final verification errors point to that this step doesn't already
  // read — load them so the retry can fix cross-file errors it introduced.
  const errorOnly = (state.errorFiles ?? []).filter((f) => !ownFiles.has(f));
  const errorFiles = (
    await Promise.all(
      errorOnly.map(async (file) => {
        const content = await fs.readFile(path.resolve(cwd, file), 'utf-8').catch(() => null);
        return content === null ? null : { file, content };
      })
    )
  ).filter((f): f is { file: string; content: string } => f !== null);

  // Project import path aliases so the editor uses valid module specifiers.
  const aliases = (state.context?.language?.aliases ?? []).map((a) => ({
    alias: a.name,
    path: a.path,
  }));

  const prompt = buildMiniReaderPrompt({
    step,
    goal: plan.goal,
    constraints: plan.constraints,
    files,
    findings,
    producedFiles,
    references: uniqueReferences,
    errorFiles,
    aliases,
    outstandingErrors: state.verifyOutput,
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
