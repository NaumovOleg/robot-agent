import type { RootStateType } from '../types';

export const resolveQuestion = (state: RootStateType): string => {
  const source = state.clarificationSource;

  if (source === 'router') {
    return state.router?.intent?.question ?? 'Could you clarify your request?';
  }

  //   if (source === 'planner') {
  //     return (
  //       state.plan?.clarification_question ?? 'Could you clarify the task before I start planning?'
  //     );
  //   }

  //   if (source === 'executor') {
  //     const failedStep = Object.entries(state.steps_state ?? {}).find(
  //       ([, status]) => status === 'failed'
  //     )?.[0];
  //     const lastError = failedStep
  //       ? (state.steps_results?.[failedStep] ?? 'unknown error')
  //       : 'unknown error';
  //     return `Step "${failedStep}" failed with: ${lastError}\nHow should I proceed?`;
  //   }

  return 'Could you provide more details?';
};
