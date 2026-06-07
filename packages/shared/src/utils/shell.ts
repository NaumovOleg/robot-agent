import { execAsync } from './async';

export const runShell = async (cmd: string, cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 8000 });
    return stdout.trim();
  } catch {
    return '';
  }
};
