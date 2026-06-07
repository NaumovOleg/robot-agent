import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { glob } from 'glob';
import { TOOL_NAMES } from '@robocode-packages/shared';
export const globTool = tool(
  async ({ pattern, cwd }) => {
    try {
      const files = await glob(pattern, {
        cwd: cwd ?? process.cwd(),
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/.next/**'],
        absolute: false,
      });
      if (files.length === 0) return 'No files found';
      return files.join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.glob,
    description: 'Find files matching a glob pattern. Use to explore project structure.',
    schema: z.object({
      pattern: z.string().describe('Glob pattern e.g. "src/**/*.ts" or "**/*.test.ts"'),
      cwd: z.string().optional().describe('Directory to search from. Defaults to project root.'),
    }),
  }
);
