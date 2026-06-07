import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import type { RunnableConfig } from '@langchain/core/runnables';
import { TOOL_NAMES } from '@robocode-packages/shared';

export const verifyEditsTool = tool(
  async ({ command }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    try {
      const output = execSync(command, {
        cwd,
        shell: '/bin/sh',
        encoding: 'utf-8',
        timeout: 120_000,
      });
      return `Verification passed.\n${output.trim() || '(no output)'}`;
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf-8') ?? '';
      const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf-8') ?? '';
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const code = e.status ?? 1;
      return `Verification FAILED (exit ${code}).\n${output || '(no output)'}\nFix all errors before proceeding.`;
    }
  },
  {
    name: TOOL_NAMES.verify_edits,
    description: `Run a verification command after completing a group of related edits.
Use when edits form a coherent unit and correctness needs checking (type errors, failing tests, build errors).
Skip when the change clearly needs no verification (docs-only edits, comments).
Examples: 'npx tsc --noEmit', 'npm test', 'pnpm test', 'cargo check', 'python -m pytest'`,
    schema: z.object({
      command: z.string().describe('Shell command to run (e.g. npx tsc --noEmit)'),
      description: z.string().optional().describe('What you are verifying (e.g. TypeScript types, unit tests)'),
    }),
  },
);
