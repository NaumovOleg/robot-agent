import fs from 'node:fs';
import path from 'node:path';
import { ensureFile } from './fs';

const LOG_PATH = path.join('.robocode', './debug.log');

function serializeError(error: unknown) {
  return JSON.stringify(
    error,
    (_key, value) => {
      // If it's an Error, extract standard properties
      if (value instanceof Error) {
        return { stack: value.stack, ...value, name: value.name, message: value.message };
      }
      return value;
    },
    2 // Pretty print
  );
}

export const debug = (...args: unknown[]) => {
  ensureFile(LOG_PATH);
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => {
      if (a instanceof Error) {
        return serializeError(a);
      }
      return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a);
    })
    .join(' ')}\n`;

  fs.appendFileSync(LOG_PATH, line);
};
