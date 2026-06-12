import * as path from 'node:path';
import { fileExists } from '@robocode-packages/shared';

// Cheap heuristic: sibling foo.test.ts / foo.spec.ts, or __tests__/ next to the file.
export const findRelatedTestFile = async (
  relativeFile: string,
  cwd: string
): Promise<string | null> => {
  const dir = path.dirname(relativeFile);
  const ext = path.extname(relativeFile);
  const base = path.basename(relativeFile, ext);

  const candidates = [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, '__tests__', `${base}.test${ext}`),
  ];

  for (const candidate of candidates) {
    if (await fileExists(path.resolve(cwd, candidate))) return candidate;
  }
  return null;
};
