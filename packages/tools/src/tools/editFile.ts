import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';

export const editFileTool = tool(
  async ({ path: filePath, old_str, new_str }) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(old_str)) {
        return `Error: old_str not found in ${filePath}`;
      }
      const updated = content.replace(old_str, new_str);
      fs.writeFileSync(filePath, updated, 'utf-8');
      return `Edited: ${filePath}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: 'edit_file',
    description: 'Replace a specific string in a file. Safer than write_file for small edits.',
    schema: z.object({
      path: z.string(),
      old_str: z.string().describe('Exact string to replace'),
      new_str: z.string().describe('Replacement string'),
    }),
  }
);
