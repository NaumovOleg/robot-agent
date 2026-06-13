import type { RootStateType } from '../types';

export const resolveQuestion = (state: RootStateType): string => {
  const source = state.clarificationSource;

  if (source === 'router') {
    return state.router?.intent?.question?.trim() || 'Could you clarify your request?';
  }

  if (source === 'planner') {
    // plannerNode sets state.question to the first clarifying question; fall back
    // to the plan's list, then a generic prompt.
    return (
      state.question?.trim() ||
      state.plan?.clarifying_questions?.[0] ||
      'Could you clarify the task before I start planning?'
    );
  }

  // Executor escalation emits its own agent:question from inside the subgraph and
  // does not route through askUserNode, so it is not resolved here.
  return state.question?.trim() || 'Could you provide more details?';
};
