import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const gitCommitTool = tool(
  async ({ message }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    return runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, cwd);
  },
  {
    name: TOOL_NAMES.git_commit,
    description: 'Create a commit with the given message. Files must already be staged via git_add.',
    schema: z.object({
      message: z.string().min(1).describe('Commit message, e.g. "feat(router): add FAQ route"'),
    }),
  }
);
