import { AIMessage, type BaseMessage } from '@langchain/core/messages';

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}\n... truncated` : value;

const extractContent = (message: BaseMessage | undefined): string => {
  if (!message) return '';

  if (typeof message.content === 'string') return message.content.trim();

  if (Array.isArray(message.content)) {
    return message.content
      .map((chunk: unknown) => (typeof chunk === 'string' ? chunk : JSON.stringify(chunk)))
      .join('\n')
      .trim();
  }

  try {
    return JSON.stringify(message.content, null, 2).trim();
  } catch {
    return String(message.content).trim();
  }
};

const getLastAIMessage = (messages: BaseMessage[]): BaseMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof AIMessage) return message;
  }

  return messages.at(-1);
};

export const buildFinalResult = (messages: BaseMessage[], limit: number) => ({
  finalResult: truncate(extractContent(getLastAIMessage(messages)), limit),
});
