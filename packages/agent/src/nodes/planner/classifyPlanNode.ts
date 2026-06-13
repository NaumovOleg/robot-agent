import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { PlannerStateType } from '@robocode-packages/shared';
import { PlannerOutputSchema, debug } from '@robocode-packages/shared';
import { getModel } from '../../utils';
import { buildPlannerPrompt } from '../../prompts/planner';

// ─── classifyPlanNode ─────────────────────────────────────────────────────────
// Core LLM call. Produces PlannerOutput.
// On validation failure — retries with error appended to prompt.

export const classifyPlanNode = async (state: PlannerStateType) => {
  const { requests, context, intent, selectedFiles, validationError, retryCount } = state;

  if (!context || !intent) {
    return {
      rawPlan: null,
      validationError: 'Missing context or intent — cannot plan.',
      retryCount: retryCount + 1,
    };
  }

  const systemPrompt = buildPlannerPrompt(context, intent, selectedFiles, validationError);

  // combine all user requests into one message
  const userContent = requests.join('\n---\n');

  const model = getModel(false).withStructuredOutput(PlannerOutputSchema, {
    name: 'planner',
  });

  try {
    const rawPlan = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userContent),
    ]);

    debug('[classifyPlanNode] raw output', rawPlan);

    return {
      rawPlan,
      validationError: null,
      retryCount: retryCount + 1,
    };
  } catch (err) {
    debug('[classifyPlanNode] LLM call failed', err);
    return {
      rawPlan: null,
      validationError: String(err).slice(0, 600),
      retryCount: retryCount + 1,
    };
  }
};
