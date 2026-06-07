import type { BaseMessage } from '@langchain/core/messages';
import { messageType } from './message';

const toPreview = (content: unknown): string => {
  const text =
    typeof content === 'string' ? content : JSON.stringify(content, null, 0).replace(/\s+/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
};

export const summarizeMessages = (messages: BaseMessage[]): string | undefined => {
  if (messages.length === 0) return undefined;

  const lastMeaningful = [...messages]
    .reverse()
    .find((msg) => {
      const role = messageType(msg);
      if (role === 'system') return false;
      const content = toPreview(msg.content);
      return content.length > 0;
    });

  if (!lastMeaningful) return undefined;

  const role = messageType(lastMeaningful);
  const preview = toPreview(lastMeaningful.content);
  const clipped = preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;

  return `${role.toUpperCase()}: ${clipped}`;
};
