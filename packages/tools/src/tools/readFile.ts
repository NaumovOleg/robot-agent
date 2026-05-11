import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';

export const readFileTool = tool(
  async ({ path: filePath }) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    schema: z.object({
      path: z.string().describe('Absolute or relative path to the file'),
    }),
  }
);
