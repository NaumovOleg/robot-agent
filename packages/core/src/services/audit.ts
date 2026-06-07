import { FileSystem, sessionAuditPath } from '@robocode-packages/shared';
import type { AppEvent } from '../utils/event';

export interface AuditEntry {
  timestamp: string;
  event: AppEvent | string;
  payload: unknown;
}

export class AuditService {
  static path(sessionId: string): string {
    return sessionAuditPath(sessionId);
  }

  static append(sessionId: string, event: AppEvent | string, payload: unknown): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      event,
      payload,
    };
    FileSystem.appendFile(this.path(sessionId), `${JSON.stringify(entry)}\n`);
  }

  static read(sessionId: string): AuditEntry[] {
    try {
      const raw = FileSystem.readFile(this.path(sessionId));
      if (!raw.trim()) return [];
      return raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  static tail(sessionId: string, count = 10): AuditEntry[] {
    const entries = this.read(sessionId);
    return entries.slice(-count);
  }

  static clear(sessionId: string): void {
    FileSystem.deleteFile(this.path(sessionId));
  }
}
