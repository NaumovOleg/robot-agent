import { execAsync } from './async';

export const runShell = async (cmd: string, cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 8000 });
    return stdout.trim();
  } catch {
    return '';
  }
};

export interface CommandResult {
  ok: boolean;
  output: string;
}

// Unlike runShell: long timeout, captures stderr and failure output.
// Used by the executor verification tier.
export const runCommand = async (
  cmd: string,
  cwd: string,
  timeout = 120_000
): Promise<CommandResult> => {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output =
      `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim() || String(e.message ?? err);
    return { ok: false, output };
  }
};
