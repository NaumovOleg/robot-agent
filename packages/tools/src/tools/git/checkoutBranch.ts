import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const gitCheckoutBranchTool = tool(
  async ({ branch }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const result = await runGit(`checkout -b "${branch}"`, cwd);
    if (result.includes('already exists')) {
      // Branch exists — switch to it
      const switchResult = await runGit(`checkout "${branch}"`, cwd);
      return `Branch "${branch}" already exists. Switching to it.\n${switchResult}`;
    }
    return result;
  },
  {
    name: TOOL_NAMES.git_checkout_branch,
    description: 'Create and switch to a new branch. If the branch already exists, switches to it without error.',
    schema: z.object({
      branch: z.string().min(1).describe('Branch name to create, e.g. "feature/add-faq-route"'),
    }),
  }
);
