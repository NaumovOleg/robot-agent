import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execAsync, TOOL_NAMES } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const bashTool = tool(
  async ({ command }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30_000, cwd });
      return stdout || stderr || '(no output)';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.bash,
    description: 'Execute a bash command in the project directory.',
    schema: z.object({ command: z.string().describe('The bash command to execute') }),
  }
);
