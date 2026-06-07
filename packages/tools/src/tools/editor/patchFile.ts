import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ContextService } from '@robocode-packages/core';
import { TOOL_NAMES } from '@robocode-packages/shared';
import { buildDiff } from '../../utils';
import { applyPatchOperations } from '../../utils/patch';

const patchSchema = z.object({
  old_str: z.string().describe('Exact string to find and replace. Must be unique in the file.'),
  new_str: z.string().describe('Replacement string'),
});

export const patchFileTool = tool(
  async ({ path: filePath, patches }, config?: RunnableConfig) => {
    try {
      const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
      const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
      const content = fs.readFileSync(targetPath, 'utf-8');

      const result = applyPatchOperations(content, patches);
      if (result.error) {
        return `Error: ${result.error} in ${targetPath}`;
      }

      const diff = patches
        .map((patch, index) => {
          const applied = result.applied[index];
          if (!applied) return '';
          return buildDiff(
            targetPath,
            patch.old_str,
            patch.new_str,
            applied.contentBefore,
            applied.matchIndex
          );
        })
        .filter(Boolean)
        .join('\n\n');

      fs.writeFileSync(targetPath, result.content, 'utf-8');
      ContextService.invalidateAfterWrite(targetPath);

      return `Patched: ${targetPath} (${patches.length} hunks)\n\n${diff}`;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return `Error: ${error}`;
    }
  },
  {
    name: TOOL_NAMES.patch_file,
    description: `Apply multiple exact string replacements in one file.
Rules:
- each old_str must be an EXACT match including whitespace and indentation
- each old_str must be unique in the current file
- use this when one file needs multiple coordinated edits`,
    schema: z.object({
      path: z.string().describe('Path to the file'),
      patches: z.array(patchSchema).min(1).describe('Ordered list of exact replacements'),
    }),
  }
);
