import type { BaseMessage } from '@langchain/core/messages';
import { FileSystem, messageToMarkdown, sessionMdPath } from '@robocode-packages/shared';

export function writeMessagesToFile(id: string, messages: BaseMessage[]): void {
  if (messages.length === 0) {
    FileSystem.writeFile(sessionMdPath(id), '');
    return;
  }
  const content = messages.map((msg) => messageToMarkdown(msg)).join('\n---\n');
  FileSystem.writeFile(sessionMdPath(id), content);
}
