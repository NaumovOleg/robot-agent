import type { AIMessage } from '@langchain/core/messages';
import type { AgentStateType } from '../state';

export const shouldContinue = (state: AgentStateType): 'tool_approval' | '__end__' => {
  const last = state.messages.at(-1) as AIMessage;
  if (last?.tool_calls?.length) return 'tool_approval';
  return '__end__';
};

export const afterApproval = (state: AgentStateType): 'tools' | 'agent' => {
  return state.toolApproved ? 'tools' : 'agent';
};
