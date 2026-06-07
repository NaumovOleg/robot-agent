import { trimMessages, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { sanitizeToolChain } from '../utils/messages';
import { createBaseModel } from '../utils';
import { messageType } from '@robocode-packages/shared';

export const compressHistoryJson = async (
  state: { messages: BaseMessage[] },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  maxTokens = 5_000
) => {
  const safeMessages = sanitizeToolChain(state.messages);
  const trimmed = await trimMessages(safeMessages, {
    maxTokens,
    strategy: 'last',
    tokenCounter: model,
    includeSystem: true,
    allowPartial: false,
  });

  return sanitizeToolChain(trimmed);
};

export const compactConversation = async (messages: BaseMessage[]): Promise<SystemMessage> => {
  const relevant = messages.filter((msg) => {
    const role = messageType(msg);
    return role === 'human' || role === 'ai';
  });

  if (relevant.length === 0) {
    return new SystemMessage('[Conversation compacted — no prior history]');
  }

  const transcript = relevant
    .map((msg) => {
      const role = messageType(msg);
      const content =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${role.toUpperCase()}: ${content}`;
    })
    .join('\n\n');

  const model = createBaseModel(false);
  const response = await model.invoke([
    new HumanMessage(
      `Summarize the following conversation into a concise context block. Preserve: goals, key decisions, findings, current state, and any unresolved questions.\n\n${transcript}`
    ),
  ]);

  const summary =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  return new SystemMessage(`[Conversation compacted]\n\n${summary}`);
};
