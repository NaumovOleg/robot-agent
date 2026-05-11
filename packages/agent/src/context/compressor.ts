import { trimMessages } from '@langchain/core/messages';
import type { AgentStateType } from '../state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const compressHistoryJson = async (state: AgentStateType, model: any) => {
  // Example usage within a node or as part of a LangGraph transformation
  return trimMessages(state.messages, {
    maxTokens: 3000, // Keep messages within 5000 tokens
    strategy: 'last', // Keep the most recent messages
    tokenCounter: model, // Optional: pass your model to count tokens
    includeSystem: true, // Ensure the system message is not removed
    allowPartial: false, // Do not allow partial messages in history
  });
};
