import type { PlannerStateType } from '@robocode-packages/shared';
import { PlannerOutputSchema, debug } from '@robocode-packages/shared';

// ─── validatePlanNode ────────────────────────────────────────────────────────
// Runs Zod parse on rawPlan.
// On success → writes to plan (final output).
// On failure → writes validationError so classifyPlanNode retries.

export const validatePlanNode = (state: PlannerStateType) => {
  const { rawPlan } = state;

  if (!rawPlan) {
    return {
      plan: null,
      validationError: 'LLM returned no output.',
    };
  }

  const result = PlannerOutputSchema.safeParse(rawPlan);

  if (result.success) {
    debug('[validatePlanNode] valid', result.data);
    return { plan: result.data, validationError: null };
  }

  const errorMessage = result.error.issues
    .map((i) => `${i.path.join('.')}: ${i.message}`)
    .join('\n');

  debug('[validatePlanNode] invalid', errorMessage);

  return { plan: null, validationError: errorMessage };
};
