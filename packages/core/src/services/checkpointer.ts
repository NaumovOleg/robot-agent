import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { debug } from '@robocode-packages/shared';
import { DB_PATH } from '@robocode-packages/config';

export class Checkpointer {
  private static instance: SqliteSaver;

  static getInstance(): SqliteSaver {
    if (!Checkpointer.instance) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      debug('[checkpointer] opening db:', DB_PATH);
      Checkpointer.instance = SqliteSaver.fromConnString(DB_PATH);
    }
    return Checkpointer.instance;
  }

  static close(): void {
    try {
      if (Checkpointer.instance) {
        (Checkpointer.instance as unknown as { db?: { close(): void } }).db?.close();
        debug('[checkpointer] closed');
      }
    } catch (err) {
      debug('[checkpointer] error on close:', err);
    }
  }

  // Bounds the SQLite file: LangGraph writes a checkpoint per super-step and never
  // prunes, so a single thread accumulates hundreds of rows (plus dead subgraph
  // checkpoints). Call ONLY after a run has fully COMPLETED (no pending interrupt):
  // the next turn only needs the latest root checkpoint, so keep the last few
  // root-namespace checkpoints and drop everything older — including all subgraph
  // checkpoints from the finished run.
  static pruneThread(threadId: string, keepLast = 4): void {
    try {
      const db = (
        Checkpointer.instance as unknown as { db?: PrunableDb }
      ).db;
      if (!db || !threadId) return;

      const kept = db
        .prepare(
          `SELECT checkpoint_id FROM checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ''
             ORDER BY checkpoint_id DESC LIMIT ?`
        )
        .all(threadId, keepLast) as { checkpoint_id: string }[];
      if (kept.length === 0) return;

      const keepIds = kept.map((r) => r.checkpoint_id);
      const placeholders = keepIds.map(() => '?').join(',');
      // Delete every row except the kept root checkpoints (drops old root rows AND
      // all subgraph-namespace rows from the completed run).
      const where = `thread_id = ? AND NOT (checkpoint_ns = '' AND checkpoint_id IN (${placeholders}))`;
      const cp = db.prepare(`DELETE FROM checkpoints WHERE ${where}`).run(threadId, ...keepIds);
      db.prepare(`DELETE FROM writes WHERE ${where}`).run(threadId, ...keepIds);
      if (cp.changes > 0) {
        debug('[checkpointer] pruned', cp.changes, 'checkpoints for', threadId);
      }
    } catch (err) {
      debug('[checkpointer] prune error:', err);
    }
  }
}

interface PrunableStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
}
interface PrunableDb {
  prepare(sql: string): PrunableStatement;
}
