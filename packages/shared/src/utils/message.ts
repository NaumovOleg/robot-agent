import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from '@langchain/core/messages';

// ── type guards ───────────────────────────────────────────

export const isHumanMessage = (msg: BaseMessage): msg is HumanMessage =>
  HumanMessage.isInstance(msg);

export const isAIMessage = (msg: BaseMessage): msg is AIMessage => AIMessage.isInstance(msg);

export const isSystemMessage = (msg: BaseMessage): msg is SystemMessage =>
  SystemMessage.isInstance(msg);

export const isToolMessage = (msg: BaseMessage): msg is ToolMessage => ToolMessage.isInstance(msg);

export const messageType = (msg: BaseMessage): 'human' | 'ai' | 'system' | 'tool' => {
  if (isToolMessage(msg)) return 'tool';
  if (isSystemMessage(msg)) return 'system';
  if (isAIMessage(msg)) return 'ai';
  return 'human';
};

export const toBaseMessage = (msg: unknown): BaseMessage => {
  if (msg instanceof BaseMessage) return msg;

  if (typeof msg === 'string') return new HumanMessage(msg);

  if (typeof msg === 'object' && msg !== null && 'role' in msg && 'content' in msg) {
    const { role, content, tool_call_id, tool_calls, name } = msg as Record<string, unknown>;

    switch (role) {
      case 'user':
      case 'human':
        return new HumanMessage(String(content));

      case 'assistant':
      case 'ai':
        if (Array.isArray(tool_calls) && tool_calls.length) {
          return new AIMessage({ content: String(content ?? ''), tool_calls });
        }
        return new AIMessage(String(content));

      case 'system':
        return new SystemMessage(String(content));

      case 'tool':
        return new ToolMessage({
          content: String(content ?? ''),
          tool_call_id: String(tool_call_id ?? 'unknown'),
          name: name ? String(name) : undefined,
        });
    }
  }

  throw new Error(`Cannot convert to BaseMessage: ${JSON.stringify(msg)}`);
};

export const serializeMessages = (messages: BaseMessage[]): string => {
  return JSON.stringify(mapChatMessagesToStoredMessages(messages));
};

export const deserializeMessages = (raw: string) => {
  return mapStoredMessagesToChatMessages(JSON.parse(raw));
};
