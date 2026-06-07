import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const gitAddTool = tool(
  async ({ files }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    return runGit(`add ${fileArgs}`, cwd);
  },
  {
    name: TOOL_NAMES.git_add,
    description: 'Stage specific files for commit. Never stages all files — always takes an explicit list.',
    schema: z.object({
      files: z.array(z.string()).min(1).describe('File paths to stage, relative to repo root'),
    }),
  }
);
