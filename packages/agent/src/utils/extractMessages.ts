import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { debug } from '@robocode-packages/shared';

export const extractNewMessages = (before: BaseMessage[], after: BaseMessage[]): BaseMessage[] => {
  if (after.length <= before.length) return [];

  const newMessages = after.slice(before.length);
  if (newMessages[0] instanceof ToolMessage) {
    const toolCallId = newMessages[0].tool_call_id;

    const parentAI = [...before]
      .reverse()
      .find((m) => m instanceof AIMessage && m.tool_calls?.some((tc) => tc.id === toolCallId));

    if (!parentAI) {
      debug('WARNING: ToolMessage has no parent AIMessage in history — chain is broken');
    }
  }

  return newMessages;
};
