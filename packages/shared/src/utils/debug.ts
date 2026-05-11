import fs from 'node:fs';
import path from 'node:path';
import { ensureFile } from './fs';

const LOG_PATH = path.join('.robocode', './debug.log');

export const debug = (...args: unknown[]) => {
  ensureFile(LOG_PATH);
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)))
    .join(' ')}\n`;

  fs.appendFileSync(LOG_PATH, line);
};
