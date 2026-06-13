import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isIgnoredPath } from './ignorePaths';

const MAX_REFERENCE_CHARS = 6_000;

// For a file that will be CREATED, find an existing sibling file of the same kind
// (same extension) so the editor can mirror the project's real conventions —
// import style, default vs named exports, whether a framework import is needed,
// quotes, etc. — instead of guessing them. Searches the target's own directory,
// then its parent, picking the smallest reasonable example.
export const findReferenceFile = async (
  cwd: string,
  targetRelPath: string
): Promise<{ file: string; content: string } | null> => {
  const ext = path.extname(targetRelPath);
  if (!ext) return null;
  const targetBase = path.basename(targetRelPath);
  const targetDir = path.dirname(targetRelPath);

  const searchDirs = [targetDir, path.dirname(targetDir)].filter(
    (d, i, arr) => d !== '.' && arr.indexOf(d) === i && !isIgnoredPath(d)
  );

  for (const relDir of searchDirs) {
    const absDir = path.resolve(cwd, relDir);
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => []);
    const candidates = entries
      .filter((e) => e.isFile() && e.name !== targetBase && path.extname(e.name) === ext)
      .map((e) => path.join(relDir, e.name))
      .filter((rel) => !isIgnoredPath(rel));

    let best: { file: string; content: string } | null = null;
    for (const rel of candidates) {
      const content = await fs.readFile(path.resolve(cwd, rel), 'utf-8').catch(() => null);
      if (content === null || content.length > MAX_REFERENCE_CHARS) continue;
      // Prefer the shortest example — easiest to mirror, least noise.
      if (!best || content.length < best.content.length) best = { file: rel, content };
    }
    if (best) return best;
  }

  return null;
};
