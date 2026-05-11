import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import {
  FileSystem,
  deserializeMessages,
  sessionJsonPath,
  serializeMessages,
} from '@robocode-packages/shared';

export class MessageService {
  static load(sessionId: string): BaseMessage[] {
    try {
      const raw = FileSystem.readFile(sessionJsonPath(sessionId));
      if (!raw) return [];
      return deserializeMessages(raw);
    } catch {
      return [];
    }
  }

  static save(sessionId: string, messages: BaseMessage[]): void {
    const content = serializeMessages(messages);
    FileSystem.writeFile(sessionJsonPath(sessionId), content);
  }

  static add(sessionId: string, message: BaseMessage | string): BaseMessage[] {
    const msg = typeof message === 'string' ? new HumanMessage(message) : message;
    const messages = this.load(sessionId);

    messages.push(msg);
    this.save(sessionId, messages);
    return messages;
  }

  static addMany(sessionId: string, newMessages: BaseMessage[]): BaseMessage[] {
    const messages = this.load(sessionId);
    messages.push(...newMessages);
    this.save(sessionId, messages);
    return messages;
  }

  static clear(sessionId: string): void {
    this.save(sessionId, []);
  }

  static count(sessionId: string): number {
    return this.load(sessionId).length;
  }

  static last(sessionId: string, n = 1): BaseMessage[] {
    const messages = this.load(sessionId);
    return messages.slice(-n);
  }

  static slice(sessionId: string, from: number, to?: number): BaseMessage[] {
    const messages = this.load(sessionId);
    return messages.slice(from, to);
  }
}
