import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';

export function isHumanMessage(msg: BaseMessage): msg is HumanMessage {
  return HumanMessage.isInstance(msg);
}

export function isAIMessage(msg: BaseMessage): msg is AIMessage {
  return AIMessage.isInstance(msg);
}

export function isSystemMessage(msg: BaseMessage): msg is SystemMessage {
  return SystemMessage.isInstance(msg);
}

export function isToolMessage(msg: BaseMessage): msg is ToolMessage {
  return ToolMessage.isInstance(msg);
}

export const messageType = (msg: BaseMessage) => {
  if (isToolMessage(msg)) {
    return 'tool';
  }
  if (isSystemMessage(msg)) {
    return 'system';
  }
  if (isAIMessage(msg)) {
    return 'ai';
  }
  return 'human';
};

export function messageToMarkdown(message: BaseMessage): string {
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return `## ${messageType(message)}\n${content}`;
}

export function markdownToMessage(block: string): BaseMessage | null {
  const match = block.match(/^##\s+(human|ai|system|tool)\n(.*)/s);
  if (!match) return null;

  const role = match[1] as 'human' | 'ai' | 'system' | 'tool';
  const content = match[2].trim();

  switch (role) {
    case 'human':
      return new HumanMessage(content);
    case 'ai':
      return new AIMessage(content);
    case 'system':
      return new SystemMessage(content);
    case 'tool':
      try {
        const parsed = JSON.parse(content);
        return new ToolMessage({
          content: parsed.content ?? '',
          tool_call_id: parsed.tool_call_id ?? 'unknown',
        });
      } catch {
        return new ToolMessage({ content: content, tool_call_id: 'unknown' });
      }
    default:
      return null;
  }
}

export function toBaseMessage(msg: unknown): BaseMessage {
  if (msg instanceof BaseMessage) return msg;
  if (typeof msg === 'string') return new HumanMessage(msg);
  if (typeof msg === 'object' && msg !== null && 'role' in msg && 'content' in msg) {
    const { role, content } = msg as any;
    if (role === 'user') return new HumanMessage(content);
    if (role === 'assistant') return new AIMessage(content);
    if (role === 'system') return new SystemMessage(content);
    if (role === 'tool')
      return new ToolMessage({
        content: content.tool_call_id ? content : content,
        tool_call_id: content.tool_call_id || 'unknown',
      });
  }
  throw new Error(`Cannot convert to BaseMessage: ${JSON.stringify(msg)}`);
}

export const parseMessages = (raw: string): BaseMessage[] => {
  const blocks = raw.split(/\n---\n/).filter(Boolean);

  return blocks.map(markdownToMessage).filter((el) => !!el);
};

export const serializeMessages = (messages: BaseMessage[]): string => {
  return messages
    .map((msg) => {
      const role = messageType(msg);

      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

      if (msg instanceof ToolMessage) {
        return `## tool\n<!-- tool_call_id: ${msg.tool_call_id} -->\n${content}`;
      }

      return `## ${role}\n${content}`;
    })
    .join('\n---\n');
};
