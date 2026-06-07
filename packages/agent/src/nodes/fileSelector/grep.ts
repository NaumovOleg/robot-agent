import { execSync } from 'node:child_process';
import type { FileSelectorStateType } from '@robocode-packages/shared';

const EXCLUDES = [
  '--glob=!node_modules/**',
  '--glob=!dist/**',
  '--glob=!.git/**',
  '--glob=!**/*.snap',
  '--glob=!**/*.lock',
  '--glob=!pnpm-lock.yaml',
].join(' ');

export const grepNode = async (state: FileSelectorStateType) => {
  const cwd = state.cwd || process.cwd();
  const fileSet = new Map<string, Set<string>>();

  for (const keyword of state.keywords) {
    if (!keyword.trim()) continue;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const raw = execSync(`rg -l "${escaped}" ${EXCLUDES} .`, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).toString();

      for (const file of raw.split('\n').filter(Boolean)) {
        if (!fileSet.has(file)) fileSet.set(file, new Set());
        fileSet.get(file)!.add(keyword);
      }
    } catch {
      /* no matches for this keyword */
    }
  }

  return {
    grepResults: Array.from(fileSet.entries()).map(([file, kws]) => ({
      file,
      matches: Array.from(kws),
    })),
  };
};
