import {
  FileSystem,
  sessionAuditPath,
  sessionJsonPath,
  sessionMdPath,
} from '@robocode-packages/shared';
import type { Session } from '@robocode-packages/shared';
import { SESSION_INDEX_PATH } from '@robocode-packages/config';
import { AuditService } from './audit';

export class SessionService {
  public static active: Session | null = null;
  static list(): Session[] {
    const sessions = FileSystem.loadJson<Session[]>(SESSION_INDEX_PATH) ?? [];
    this.active = this.active ?? sessions.find((s) => s.active) ?? null;

    return sessions;
  }

  static findActive() {
    return this.list().find((s) => s.active);
  }

  static load(id: string): Session | null {
    const index = this.list();
    const session = index.find((m) => m.id === id);
    if (!session) return null;
    return session;
  }

  static set(id: string | null): Session | null | undefined {
    if (id === null) {
      const cleared = this.list().map((m) => ({ ...m, active: false }));
      FileSystem.writeJson(SESSION_INDEX_PATH, cleared);
      this.active = null;
      return null;
    }
    const list = this.list();
    const found = list.find((el) => el.id === id);
    if (!found) return undefined;
    found.active = true;
    this.active = found;
    this.updateIndex(found);
    return found;
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
      transcriptPath: sessionMdPath(id),
      auditPath: sessionAuditPath(id),
    };
    this.active = session;

    this.updateIndex(session);
    return session;
  }

  static fork(id: string, cwd?: string): Session {
    const source = this.load(id);
    if (!source) throw new Error(`Session ${id} not found`);

    const forked = this.create(cwd ?? source.cwd);
    const now = new Date().toISOString();
    forked.name = `${source.name} (fork)`;
    forked.createdAt = now;
    forked.updatedAt = now;
    forked.messageCount = source.messageCount;
    forked.summary = source.summary;
    forked.transcriptPath = sessionMdPath(forked.id);
    forked.auditPath = sessionAuditPath(forked.id);
    forked.forkedFromId = source.id;
    forked.forkedFromName = source.name;
    this.updateIndex(forked);

    FileSystem.copyFile(sessionJsonPath(id), sessionJsonPath(forked.id));
    FileSystem.copyFile(sessionMdPath(id), sessionMdPath(forked.id));
    FileSystem.copyFile(sessionAuditPath(id), sessionAuditPath(forked.id));
    AuditService.append(forked.id, 'session:fork', {
      sourceSessionId: id,
      sourceName: source.name,
    });

    this.active = forked;
    return forked;
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
    FileSystem.deleteFile(sessionJsonPath(id));
    FileSystem.deleteFile(sessionMdPath(id));
    FileSystem.deleteFile(sessionAuditPath(id));
    let newIndex = this.list().filter((m) => m.id !== id);

    if (newIndex.length > 0 && !newIndex.some((m) => m.active)) {
      newIndex = newIndex.map((m, i) => ({ ...m, active: i === 0 }));
      this.active = newIndex[0] ?? null;
    } else {
      this.active = newIndex.find((m) => m.active) ?? null;
    }

    FileSystem.writeJson(SESSION_INDEX_PATH, newIndex);
  }

  static get(id: string) {
    return this.list().find((m) => m.id === id);
  }

  static clear(id: string): Session {
    const index = this.list();
    const session = index.find((m) => m.id === id);
    if (!session) throw new Error(`Session ${id} not found`);
    session.messageCount = 0;
    session.updatedAt = new Date().toISOString();
    session.summary = undefined;
    this.updateIndex(session);
    FileSystem.deleteFile(sessionAuditPath(id));
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

  static updateMessageCount(sessionId: string, count: number, summary?: string): void {
    const index = this.list();
    const meta = index.find((s) => s.id === sessionId);
    if (!meta) return;
    meta.messageCount = count;
    meta.updatedAt = new Date().toISOString();
    meta.summary = summary;
    this.updateIndex(meta);
  }
}
