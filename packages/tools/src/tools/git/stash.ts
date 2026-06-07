import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const gitStashTool = tool(
  async ({ action, message }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    if (action === 'list') return runGit('stash list', cwd);
    if (action === 'pop') return runGit('stash pop', cwd);
    const msgFlag = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
    return runGit(`stash push${msgFlag}`, cwd);
  },
  {
    name: TOOL_NAMES.git_stash,
    description: 'Stash, pop, or list stashes. Use push to save uncommitted changes, pop to restore them.',
    schema: z.object({
      action: z.enum(['push', 'pop', 'list']).describe('Stash operation'),
      message: z.string().optional().describe('Description for stash push'),
    }),
  }
);
