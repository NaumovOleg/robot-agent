import { verifyEditsTool } from '../verify';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';

describe('verifyEditsTool', () => {
  it('returns "Verification passed" when command exits 0', async () => {
    const result = await verifyEditsTool.invoke(
      { command: 'echo hello' },
      { configurable: { cwd: process.cwd() } },
    );
    expect(result).toMatch(/^Verification passed\./);
    expect(result).toContain('hello');
  });

  it('returns "Verification FAILED" when command exits non-zero', async () => {
    const result = await verifyEditsTool.invoke(
      { command: 'false' },
      { configurable: { cwd: process.cwd() } },
    );
    expect(result).toMatch(/^Verification FAILED \(exit \d+\)\./);
    expect(result).toContain('Fix all errors before proceeding.');
  });

  it('includes exit code in failure message', async () => {
    const result = await verifyEditsTool.invoke(
      { command: 'exit 42' },
      { configurable: { cwd: process.cwd() } },
    );
    expect(result).toContain('exit 42');
  });

  it('runs command from provided cwd', async () => {
    const cwd = tmpdir();
    const result = await verifyEditsTool.invoke(
      { command: 'pwd' },
      { configurable: { cwd } },
    );
    expect(result).toMatch(/^Verification passed\./);
    // resolve symlinks for macOS (/tmp -> /private/tmp)
    const resolvedCwd = realpathSync(cwd);
    expect(result).toContain(resolvedCwd);
  });

  it('falls back to process.cwd() when no cwd in config', async () => {
    const result = await verifyEditsTool.invoke({ command: 'echo ok' });
    expect(result).toMatch(/^Verification passed\./);
  });

  it('tool name is verify_edits', () => {
    expect(verifyEditsTool.name).toBe('verify_edits');
  });
});
