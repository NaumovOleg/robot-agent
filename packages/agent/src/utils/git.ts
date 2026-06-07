import { execAsync, runGit, isGitRepo } from '@robocode-packages/shared';

const logGitError = (label: string, error: unknown) => {
  process.stderr.write(`${label}: ${String(error)}\n`);
};

export const commitSessionStart = async (
  cwd: string,
  sessionId: string
): Promise<string | null> => {
  try {
    // 1. Check if there are any changes (staged or unstaged)
    const { stdout: status } = await execAsync('git status --short', { cwd, timeout: 3_000 });
    if (!status.trim()) return null;

    const branchName = `robocode/session-${sessionId.slice(0, 8)}`;

    // 2. Check if branch already exists
    const { stdout: branchList } = await execAsync(`git branch --list "${branchName}"`, { cwd });
    const branchExists = branchList.trim().length > 0;

    // 3. If branch exists, just switch to it; otherwise create it
    if (branchExists) {
      await runGit(`checkout "${branchName}"`, cwd);
    } else {
      await runGit(`checkout -b "${branchName}"`, cwd);
    }

    // 4. Stage all changes (including untracked files)
    await runGit('add -A', cwd);

    // 5. Commit with a descriptive message
    const commitMsg = `robocode: session start ${sessionId.slice(0, 8)}`;
    await runGit(`commit -m "${commitMsg}" --allow-empty`, cwd);

    // 6. Get the commit hash
    const { stdout: hash } = await execAsync('git rev-parse HEAD', { cwd, timeout: 3_000 });
    return hash.trim();
  } catch (error) {
    logGitError('Failed to commit session start', error);
    return null;
  }
};

export const commitSessionEnd = async (
  cwd: string,
  sessionId: string,
  customMessage?: string
): Promise<string | null> => {
  try {
    // 1. Check if there are any changes to commit
    const { stdout: status } = await execAsync('git status --short', { cwd, timeout: 3_000 });
    if (!status.trim()) return null;

    // 2. Stage all changes (including untracked files)
    await runGit('add -A', cwd);

    // 3. Commit with a descriptive message
    const commitMsg = customMessage || `robocode: session end ${sessionId.slice(0, 8)}`;
    await runGit(`commit -m "${commitMsg}" --allow-empty`, cwd);

    // 4. Get the commit hash
    const { stdout: hash } = await execAsync('git rev-parse HEAD', { cwd, timeout: 3_000 });
    return hash.trim();
  } catch (error) {
    logGitError('Failed to commit session end', error);
    return null;
  }
};
export const createSessionCheckpoint = async (
  cwd: string,
  sessionId: string
): Promise<string | null> => {
  if (!(await isGitRepo(cwd))) return null;
  return commitSessionStart(cwd, sessionId);
};
