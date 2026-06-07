import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ContextService } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';

export const writeFileTool = tool(
  async ({ path: filePath, content }, config?: RunnableConfig) => {
    debug('WRITE FILE TOOL ');
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    debug('WRITE FILE TOOL 2 ', targetPath);
    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, 'utf-8');

      ContextService.invalidateAfterWrite(targetPath);
      debug('WRITE FILE TOOL 3', targetPath);
      return `Written: ${targetPath}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with new content',
    schema: z.object({
      path: z.string().describe('Path to the file'),
      content: z.string().describe('Full file content to write'),
    }),
  }
);
