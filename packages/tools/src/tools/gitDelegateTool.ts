import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { IAgent } from '@robocode-packages/shared';
import { TOOL_NAMES, debug } from '@robocode-packages/shared';
import type { CompiledGraphType } from '@langchain/langgraph';

export const gitToolFactory = (agent: IAgent<CompiledGraphType>) => {
  return tool(
    async ({ task, focus }, config) => {
      const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
      const response = await agent.run({ task, focus: focus ?? [], cwd, config });
      debug('RESPONSE_FROM GIT', response);
      return response;
    },
    {
      name: TOOL_NAMES.delegate_to_git,
      description:
        'Delegate git/status/history inspection to a git subagent. Use for branch, status, diff, log, show, and blame tasks when you want a dedicated git pass.',
      schema: z.object({
        task: z.string().min(1).describe('Git investigation goal for the subagent'),
        focus: z.array(z.string()).optional().describe('Specific files, refs, or history targets'),
      }),
    }
  );
};
