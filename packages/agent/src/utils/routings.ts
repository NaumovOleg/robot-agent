import { AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../state';
import { debug } from '@robocode-packages/shared';

export const shouldContinue = (state: AgentStateType): 'tool_approval' | '__end__' => {
  const last = state.messages.at(-1);
  debug('SHOULD CONTINUE STEP - LAST MESSAGE', last);
  if (AIMessage.isInstance(last) && last.tool_calls?.length) {
    return 'tool_approval';
  }
  return '__end__';
};

export const afterToolApproval = (state: AgentStateType): 'tools' | 'agent' => {
  return state.toolApproved === true ? 'tools' : 'agent';
};

export const afterPlanApproval = (state: AgentStateType) => {
  if (!state.plan || state.planApproved) return 'agent';
  return 'plan_approval';
};
