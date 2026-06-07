import { execSync } from 'node:child_process';
import type { FileSelectorStateType } from '@robocode-packages/shared';
import { tfidfScore } from '@robocode-packages/shared';

function getRecentFiles(cwd: string): string[] {
  try {
    const raw = execSync('git log --oneline -10 --name-only --pretty=format:', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export const scoringNode = async (state: FileSelectorStateType) => {
  const recentFiles = getRecentFiles(state.cwd || process.cwd());
  const allFiles = state.grepResults.map((r) => r.file);

  const scored = state.grepResults.map((r) => ({
    file: r.file,
    score: tfidfScore(
      { file: r.file, matchedKeywords: r.matches },
      state.grepResults.map((gr) => ({ file: gr.file, matchedKeywords: gr.matches })),
      allFiles,
      recentFiles
    ),
  }));

  return { scoredFiles: scored };
};
