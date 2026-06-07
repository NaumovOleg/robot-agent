import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const gitPushTool = tool(
  async (_, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    return runGit('push -u origin HEAD', cwd);
  },
  {
    name: TOOL_NAMES.git_push,
    description: 'Push the current branch to origin. Sets upstream tracking with -u so future pushes need no arguments.',
    schema: z.object({}),
  }
);
