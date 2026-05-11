import { gatherProjectContext } from '../helpers';
import type { ProjectContext, CacheEntry } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';
import fs from 'node:fs';
import path from 'node:path';
import { CONTEXT_TTL_MS, WATCHED_FILES } from '@robocode-packages/config';

export class ContextService {
  private static readonly cache = new Map<string, CacheEntry>();

  private static getFileMtime(filePath: string): number {
    try {
      return fs.statSync(filePath).mtimeMs;
    } catch {
      return 0;
    }
  }

  private static buildWatchedFiles(cwd: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const file of WATCHED_FILES) {
      const fullPath = path.join(cwd, file);
      map.set(fullPath, this.getFileMtime(fullPath));
    }
    return map;
  }

  private static isStale(entry: CacheEntry): boolean {
    if (Date.now() - entry.timestamp > CONTEXT_TTL_MS) return true;

    for (const [filePath, mtime] of entry.watchedFiles.entries()) {
      if (this.getFileMtime(filePath) !== mtime) {
        debug(`[ContextService] file changed: ${filePath}`);
        return true;
      }
    }

    return false;
  }

  static async get(cwd: string): Promise<ProjectContext> {
    const cached = this.cache.get(cwd);

    if (cached && !this.isStale(cached)) {
      debug('[ContextService] cache hit', cwd);
      return cached.context;
    }

    debug('[ContextService] cache miss — gathering context', cwd);
    const context = await gatherProjectContext(cwd);

    this.cache.set(cwd, {
      context,
      timestamp: Date.now(),
      watchedFiles: this.buildWatchedFiles(cwd),
    });

    return context;
  }

  static invalidate(cwd: string): void {
    this.cache.delete(cwd);
    debug('[ContextService] invalidated', cwd);
  }

  static invalidateAfterWrite(filePath: string): void {
    for (const [cwd, entry] of this.cache.entries()) {
      if (filePath.startsWith(cwd) && entry.watchedFiles.has(filePath)) {
        this.cache.delete(cwd);
        debug('[ContextService] invalidated after write', filePath);
        return;
      }
    }
  }

  static invalidateAll(): void {
    this.cache.clear();
    debug('[ContextService] all cache cleared');
  }

  static has(cwd: string): boolean {
    const entry = this.cache.get(cwd);
    return !!entry && !this.isStale(entry);
  }

  static stats(): { entries: number; cwds: string[] } {
    return {
      entries: this.cache.size,
      cwds: [...this.cache.keys()],
    };
  }
}
