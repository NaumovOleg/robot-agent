import type { RootStateType } from '@robocode-packages/shared';

// Pure routing predicates for the root graph. Kept in their own module (no graph
// construction, no heavy imports) so they can be unit-tested without eagerly
// building the compiled root graph and its subgraph chain.

export const afterPlanner = (state: RootStateType): string => {
  if (state.clarificationSource === 'planner') return 'question_node';
  if (state.plan && state.plan.steps.length > 0) return 'plan_approval';
  return 'agent';
};

export const afterPlanApproval = (state: RootStateType): string =>
  state.planApproved ? 'executor' : 'agent';
