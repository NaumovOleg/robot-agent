import type { PlannerStateType } from '@robocode-packages/shared';
import { PlannerOutputSchema, debug } from '@robocode-packages/shared';

// ─── fallbackPlanNode ────────────────────────────────────────────────────────
// Called when retryCount >= MAX_RETRIES and plan is still null.
// Produces a safe fallback that asks for clarification.

export const fallbackPlanNode = (state: PlannerStateType) => {
  debug('[fallbackPlanNode] producing fallback after', state.retryCount, 'retries');

  const fallback = PlannerOutputSchema.parse({
    goal: 'Clarify the task before making code changes.',
    clarifying_questions: [
      'The planner encountered an error. Could you rephrase or simplify the task?',
    ],
    assumptions: [],
    risk: 'low',
    files_affected: [],
    constraints: [],
    steps: [
      {
        id: 'fallback-inspect',
        kind: 'inspect',
        title: 'Inspect codebase to understand task scope',
        files: [],
        depends_on: [],
        expected_output: 'Sufficient context gathered to replan.',
      },
    ],
    gitStep: null,
  });

  return { plan: fallback, validationError: null };
};
