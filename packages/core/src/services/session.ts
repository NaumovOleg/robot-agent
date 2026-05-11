import { FileSystem, sessionMdPath } from '@robocode-packages/shared';
import type { Session } from '@robocode-packages/shared';
import { SESSION_INDEX_PATH } from '@robocode-packages/config';
import { writeMessagesToFile } from '../helpers';

export class SessionService {
  static active: Session | null = null;
  static list(): Session[] {
    const sessions = FileSystem.loadJson<Session[]>(SESSION_INDEX_PATH) ?? [];
    this.active = this.active ?? sessions.find((s) => s.active) ?? null;

    return sessions;
  }

  static load(id: string): Session | null {
    const index = this.list();
    const session = index.find((m) => m.id === id);
    if (!session) return null;
    return session;
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
    this.active = meta;
    this.updateIndex(meta);
  }

  static create(cwd?: string): Session {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const session: Session = {
      id,
      name: `Session ${new Date().toLocaleDateString()}`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      active: true,
      cwd: cwd ?? process.cwd(),
    };

    writeMessagesToFile(id, []);
    this.updateIndex(session);
    return session;
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
    const session = index.find((m) => m.id === id);
    if (!session) throw new Error(`Session ${id} not found`);
    writeMessagesToFile(id, []);
    session.messageCount = 0;
    session.updatedAt = new Date().toISOString();
    this.updateIndex(session);
    if (id === this.active?.id) {
      this.active = null;
    }
    return session;
  }

  private static updateIndex(updatedMeta: Session): void {
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

  static updateMessageCount(sessionId: string, count: number): void {
    const index = this.list();
    const meta = index.find((s) => s.id === sessionId);
    if (!meta) return;
    meta.messageCount = count;
    meta.updatedAt = new Date().toISOString();
    this.updateIndex(meta);
  }
}
