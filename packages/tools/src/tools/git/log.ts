import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

// ── git_log ───────────────────────────────────────────────

export const gitLogTool = tool(
  async ({ limit = 10, file, oneline = false }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const format = oneline ? '--oneline' : '--pretty=format:"%h  %an  %ar  %s"';

    const fileFlag = file ? ` -- ${file}` : '';
    const cmd = `log ${format} -${limit}${fileFlag}`;

    return runGit(cmd, cwd);
  },
  {
    name: TOOL_NAMES.git_log,
    description: 'Show commit history. Use file to see history of a specific file.',
    schema: z.object({
      limit: z.number().int().min(1).max(50).optional().describe('Number of commits. Default: 10'),
      file: z.string().optional().describe('Show history for specific file'),
      oneline: z.boolean().optional().describe('Compact one-line format. Default: false'),
    }),
  }
);
