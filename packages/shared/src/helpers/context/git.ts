import type { GitContext } from '../../types';
import { runShell, parseGitStatus } from '../../utils';

export const buildGitContext = async (cwd: string): Promise<GitContext | null> => {
  const [statusRaw, logRaw, branchRaw] = await Promise.all([
    runShell('git status --short', cwd),
    runShell('git log --oneline -10', cwd),
    runShell('git branch --show-current', cwd),
  ]);

  if (!branchRaw && !statusRaw) return null;

  return {
    branch: branchRaw || 'unknown',
    status: parseGitStatus(statusRaw),
    recentCommits: logRaw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf(' ');
        return { hash: line.slice(0, i), message: line.slice(i + 1) };
      }),
  };
};
