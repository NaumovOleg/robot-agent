import { execAsync } from './async';

export const runGit = async (cmd: string, cwd: string): Promise<string> => {
  try {
    const { stdout, stderr } = await execAsync(`git ${cmd}`, { cwd, timeout: 10_000 });
    return stdout.trim() || stderr.trim() || '(no output)';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.message.includes('not a git repository')) {
      return 'Error: Not a git repository. Initialize with: git init';
    }
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
