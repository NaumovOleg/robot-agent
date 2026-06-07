import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ContextService } from '@robocode-packages/core';

export const renameFileTool = tool(
  async ({ from, to }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const srcPath = path.isAbsolute(from) ? from : path.resolve(cwd, from);
    const dstPath = path.isAbsolute(to) ? to : path.resolve(cwd, to);
    try {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.renameSync(srcPath, dstPath);
      ContextService.invalidateAfterWrite(srcPath);
      ContextService.invalidateAfterWrite(dstPath);
      return `Renamed: ${srcPath} → ${dstPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file.',
    schema: z.object({
      from: z.string().describe('Source file path'),
      to: z.string().describe('Destination file path'),
    }),
  }
);
