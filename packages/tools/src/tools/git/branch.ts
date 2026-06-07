import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

// ── git_branch ────────────────────────────────────────────

export const gitBranchTool = tool(
  async ({ all = false }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const cmd = all ? 'branch -a --sort=-committerdate' : 'branch --sort=-committerdate';
    return runGit(cmd, cwd);
  },
  {
    name: TOOL_NAMES.git_branch,
    description: 'List branches. Use all=true to include remote branches.',
    schema: z.object({
      all: z.boolean().optional().describe('Include remote branches. Default: false'),
    }),
  }
);
