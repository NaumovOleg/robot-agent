import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

export const writeFileTool = tool(
  async ({ path: filePath, content }) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return `Written: ${filePath}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with new content',
    schema: z.object({
      path: z.string().describe('Path to the file'),
      content: z.string().describe('Full file content to write'),
    }),
  }
);
