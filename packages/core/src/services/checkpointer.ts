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
}
