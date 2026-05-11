import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execAsync } from '@robocode-packages/shared';

export const bashTool = tool(
  async ({ command }) => {
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30_000 });
      return stdout || stderr || '(no output)';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: 'bash',
    description:
      'Execute a bash command. Use for running tests, git, npm, reading directory structure, etc...',
    schema: z.object({
      command: z.string().describe('The bash command to execute'),
    }),
  }
);
