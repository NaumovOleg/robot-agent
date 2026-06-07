import { execAsync } from './async';
import type { GitContext } from '../types';

export const runGit = async (cmd: string, cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await execAsync(`git ${cmd}`, { cwd, timeout: 10_000 });
    return stdout.trim() || stderr.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.message.includes('not a git repository')) {
      return 'Error: Not a git repository. Initialize with: git init';
    }
    // Prefer stdout/stderr from the process when available (e.g. "nothing to commit")
    const output = (err.stdout ?? '').trim() || (err.stderr ?? '').trim();
    if (output) return output;
    return `Error: ${err.message}`;
  }
};

export const getFileTree = async (cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(
      `find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" -not -path "*/.next/*" | head -80 | sort`,
      { cwd, timeout: 5_000 }
    );
    return stdout.trim();
  } catch {
    return '';
  }
};

export const getGitBranch = async (cwd: string): Promise<string | null> => {
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd, timeout: 3_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export const getGitStatus = async (cwd: string): Promise<string | null> => {
  try {
    const { stdout } = await execAsync('git status --short --branch', { cwd, timeout: 3_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export const getGitDiffStat = async (cwd: string): Promise<string | null> => {
  try {
    const { stdout } = await execAsync('git diff --stat --summary --no-color', {
      cwd,
      timeout: 5_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

export const getGitDiffPreview = async (cwd: string, maxChars = 4000): Promise<string | null> => {
  try {
    const { stdout } = await execAsync('git diff --no-color --unified=1', { cwd, timeout: 8_000 });
    const diff = stdout.trim();
    if (!diff) return null;
    return diff.length > maxChars ? `${diff.slice(0, maxChars - 3)}...` : diff;
  } catch {
    return null;
  }
};

export const isGitRepo = async (cwd: string): Promise<boolean> => {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd, timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
};

export const isFileTracked = async (filePath: string, cwd: string): Promise<boolean> => {
  try {
    await execAsync(`git ls-files --error-unmatch "${filePath}"`, { cwd, timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
};

export const parseGitStatus = (raw: string): GitContext['status'] => {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    const x = line[0];
    const y = line[1];
    const file = line.slice(3).trim();
    if (x === '?' && y === '?') {
      untracked.push(file);
    } else if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      conflicted.push(file);
    } else {
      if (x !== ' ' && x !== '?') staged.push(file);
      if (y !== ' ' && y !== '?') unstaged.push(file);
    }
  }

  return { staged, unstaged, untracked, conflicted };
};
