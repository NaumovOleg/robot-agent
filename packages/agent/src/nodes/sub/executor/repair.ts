import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { debug, MiniReaderOutputSchema } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildRepairPrompt } from '../../../prompts/sub/executor/repair';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { MAX_REPAIR } from '../../../subagents/executor/state';

// Targeted re-prompt: asks the model to fix ONLY the hints validate flagged, merges
// the corrections back over the good hints by index, and bumps repairCount. Bounded
// by MAX_REPAIR — on exhaustion it sets lastError so step_review takes the normal
// retry/escalate path.
export const repairNode = async (state: ExecutorStateType) => {
  const { cwd, currentHints, hintErrors, repairCount } = state;

  if (repairCount >= MAX_REPAIR) {
    const summary = hintErrors.map((e) => `- ${e.op} ${e.file}: ${e.reason}`).join('\n');
    debug('[executor/repair] exhausted', repairCount, 'attempts');
    return { lastError: `Could not resolve edit hints after ${MAX_REPAIR} repair attempts:\n${summary}`, hintErrors: [] };
  }

  const failed = hintErrors.map((e) => ({ hint: currentHints[e.index], reason: e.reason }));
  const prompt = await buildRepairPrompt({ failed, cwd });

  try {
    const model = getModel(false).withStructuredOutput(MiniReaderOutputSchema, { name: 'repair' });
    const output = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage('Return the corrected hints, one per failure, in order.'),
    ]);

    // Merge: replace each failed index with the next corrected hint in order.
    const corrected = [...currentHints];
    (output.hints ?? []).slice(0, hintErrors.length).forEach((fix, i) => {
      const targetIndex = hintErrors[i]?.index;
      if (typeof targetIndex === 'number') corrected[targetIndex] = fix;
    });

    debug('[executor/repair]', `attempt ${repairCount + 1}: re-prompted ${failed.length} hint(s)`);
    return { currentHints: corrected, repairCount: repairCount + 1, hintErrors: [] };
  } catch (err) {
    debug('[executor/repair] LLM failed', err);
    return { lastError: `repair LLM error: ${String(err).slice(0, 300)}`, hintErrors: [] };
  }
};
