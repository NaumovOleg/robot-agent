import type { BaseMessage } from '@langchain/core/messages';
import { FileSystem, sessionMdPath, messageType } from '@robocode-packages/shared';
import type { Session, SessionMeta } from '@robocode-packages/shared';
import { SESSION_INDEX_PATH } from '@robocode-packages/config';
import { writeMessagesToFile, readMessagesFromFile } from '../helpers';

export class SessionService {
  static active: Session | null = null;
  messages: BaseMessage[] = [];
  static list(): SessionMeta[] {
    return FileSystem.loadJson<SessionMeta[]>(SESSION_INDEX_PATH) ?? [];
  }

  static load(id: string): Session | null {
    const index = this.list();
    const meta = index.find((m) => m.id === id);
    if (!meta) return null;
    const messages = readMessagesFromFile(id);
    return { meta, messages };
  }

  static set(id: string | null) {
    if (id === null) {
      this.active = null;
      return;
    }
    const list = this.list();
    const meta = list.find((el) => el.id === id);
    if (!meta) return;
    meta.active = true;
    this.active = {
      meta,
      messages: this.getMessages(meta.id),
    };
    this.updateIndex(meta);
  }

  static create(): Session {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id,
      name: `Session ${new Date().toLocaleDateString()}`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      active: true,
    };

    writeMessagesToFile(id, []);
    this.updateIndex(meta);
    return { meta, messages: [] };
  }

  static addMessage(id: string, message: BaseMessage): Session {
    const session = this.load(id);
    if (!session) throw new Error(`Session ${id} not found`);

    session.messages.push(message);
    session.meta.messageCount = session.messages.length;
    session.meta.updatedAt = new Date().toISOString();

    if (session.messages.length === 1 && messageType(message) === 'human') {
      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      session.meta.name = content.slice(0, 40) + (content.length > 40 ? '...' : '');
    }

    writeMessagesToFile(id, session.messages);

    this.updateIndex(session.meta);
    this.active?.messages?.push(message);

    return session;
  }

  static getMessages(id: string) {
    return [];
  }

  static rename(id: string, name: string): void {
    const index = this.list();
    const meta = index.find((m) => m.id === id);
    if (!meta) throw new Error(`Session ${id} not found`);
    meta.name = name;
    meta.updatedAt = new Date().toISOString();
    this.updateIndex(meta);
  }

  static delete(id: string): void {
    FileSystem.deleteFile(sessionMdPath(id));
    const newIndex = this.list().filter((m) => m.id !== id);
    FileSystem.writeJson(SESSION_INDEX_PATH, newIndex);
  }

  static clear(id: string): Session {
    const index = this.list();
    const meta = index.find((m) => m.id === id);
    if (!meta) throw new Error(`Session ${id} not found`);
    writeMessagesToFile(id, []);
    meta.messageCount = 0;
    meta.updatedAt = new Date().toISOString();
    this.updateIndex(meta);
    if (id === this.active?.id) {
      this.active = null;
    }
    return { meta, messages: [] };
  }

  private static updateIndex(updatedMeta: SessionMeta): void {
    let index = this.list();
    const existingIdx = index.findIndex((m) => m.id === updatedMeta.id);
    if (existingIdx >= 0) {
      index[existingIdx] = updatedMeta;
    } else {
      index.unshift(updatedMeta);
    }
    if (updatedMeta.active) {
      index = index.map((el) => ({ ...el, active: el.id === updatedMeta.id }));
    }
    FileSystem.writeJson(SESSION_INDEX_PATH, index);
  }
}
