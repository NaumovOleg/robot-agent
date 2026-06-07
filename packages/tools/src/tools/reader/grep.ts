import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execAsync, TOOL_NAMES } from '@robocode-packages/shared';

export const grepTool = tool(
  async ({ pattern, path: searchPath, file_pattern }) => {
    try {
      const fileFlag = file_pattern ? `--include="${file_pattern}"` : '';
      const cmd = `grep -rn ${fileFlag} "${pattern}" ${searchPath ?? '.'}`;
      const { stdout } = await execAsync(cmd, { timeout: 10_000 });
      return stdout.trim() || 'No matches found';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code === 1) return 'No matches found';
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.grep,
    description:
      'Search for a pattern in files. Use to find usages, imports, function definitions.',
    schema: z.object({
      pattern: z.string().describe('Search pattern (regex supported)'),
      path: z.string().optional().describe('Directory or file to search. Defaults to cwd.'),
      file_pattern: z.string().optional().describe('File pattern e.g. "*.ts" or "*.tsx"'),
    }),
  }
);
