import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  formatSize,
  type DirEntry,
  readDir,
  renderTree,
  renderFlat,
  TOOL_NAMES,
} from '@robocode-packages/shared';

export const listDirTool = tool(
  async ({ path: dirPath, depth = 2, format = 'tree' }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(dirPath ?? '')
      ? (dirPath ?? cwd)
      : path.resolve(cwd, dirPath ?? '.');

    try {
      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        return `Error: ${targetPath} is not a directory`;
      }
    } catch {
      return `Error: Directory not found: ${targetPath}`;
    }

    const entries = readDir(targetPath, 0, depth);

    if (entries.length === 0) {
      return `Empty directory: ${targetPath}`;
    }
    let fileCount = 0;
    let dirCount = 0;
    let totalSize = 0;

    const countEntries = (items: DirEntry[]) => {
      for (const item of items) {
        if (item.type === 'file') {
          fileCount++;
          totalSize += item.size;
        }
        if (item.type === 'dir') {
          dirCount++;
        }
        if (item.children) countEntries(item.children);
      }
    };
    countEntries(entries);

    const header = `${targetPath}\n${fileCount} files, ${dirCount} dirs, ${formatSize(totalSize)} total\n`;
    const divider = '─'.repeat(50);

    const tree =
      format === 'flat' ? renderFlat(entries, targetPath) : renderTree(entries, '', true);

    return `${header}${divider}\n${tree}`;
  },
  {
    name: TOOL_NAMES.list_dir,
    description: `List directory contents with file sizes and dates.
Use to explore project structure before reading files.
Automatically ignores node_modules, .git, dist, and other build artifacts.`,
    schema: z.object({
      path: z.string().optional().describe('Directory path. Defaults to project root.'),
      depth: z
        .number()
        .min(1)
        .max(5)
        .optional()
        .describe('How deep to recurse. Default: 2, max: 5.'),
      format: z
        .enum(['tree', 'flat'])
        .optional()
        .describe('Output format. tree = visual hierarchy, flat = file paths. Default: tree.'),
    }),
  }
);
