import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

// ── git_show ──────────────────────────────────────────────

export const gitShowTool = tool(
  async ({ ref, file }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const fileFlag = file ? `:${file}` : '';
    const cmd = `show ${ref}${fileFlag}`;

    const output = await runGit(cmd, cwd);

    const lines = output.split('\n');
    if (lines.length > 200) {
      return lines.slice(0, 200).join('\n') + `\n... truncated (${lines.length} lines total)`;
    }

    return output;
  },
  {
    name: TOOL_NAMES.git_show,
    description: 'Show contents of a commit or a file at a specific commit.',
    schema: z.object({
      ref: z.string().describe('Commit hash, branch, or tag e.g. "HEAD~1", "abc1234"'),
      file: z.string().optional().describe('Show specific file at that commit'),
    }),
  }
);
