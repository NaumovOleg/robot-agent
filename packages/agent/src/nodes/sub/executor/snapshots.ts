import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type StepSnapshot = Record<string, string | null>;

// Captures current content of repo-relative files. null = file did not exist.
export const takeSnapshot = async (
  cwd: string,
  files: string[]
): Promise<StepSnapshot> => {
  const snapshot: StepSnapshot = {};
  for (const file of [...new Set(files)]) {
    snapshot[file] = await fs
      .readFile(path.resolve(cwd, file), 'utf-8')
      .catch(() => null);
  }
  return snapshot;
};

// Restores files to snapshot state: null → delete, string → rewrite.
export const restoreSnapshot = async (
  cwd: string,
  snapshot: StepSnapshot
): Promise<void> => {
  for (const [file, content] of Object.entries(snapshot)) {
    const abs = path.resolve(cwd, file);
    if (content === null) {
      await fs.unlink(abs).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
    }
  }
};
