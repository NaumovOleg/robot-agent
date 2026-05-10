import type { BaseMessage } from '@langchain/core/messages';
import { FileSystem, markdownToMessage, sessionMdPath } from '@robocode-packages/shared';

export function readMessagesFromFile(id: string): BaseMessage[] {
  const raw = FileSystem.readFile(sessionMdPath(id));
  if (!raw) return [];
  const blocks = raw.split(/\n---\n/).filter((b) => b.trim().length > 0);
  const messages: BaseMessage[] = [];

  for (const block of blocks) {
    const msg = markdownToMessage(block);
    if (msg) messages.push(msg);
  }
  return messages;
}
