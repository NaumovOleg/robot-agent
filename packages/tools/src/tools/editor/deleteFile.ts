import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ContextService } from '@robocode-packages/core';

export const deleteFileTool = tool(
  async ({ path: filePath }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    try {
      fs.unlinkSync(targetPath);
      ContextService.invalidateAfterWrite(targetPath);
      return `Deleted: ${targetPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the filesystem.',
    schema: z.object({
      path: z.string().describe('Path to the file to delete'),
    }),
  }
);
