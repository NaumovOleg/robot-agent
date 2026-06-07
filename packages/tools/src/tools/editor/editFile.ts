import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import { buildDiff } from '../../utils';
import { TOOL_NAMES } from '@robocode-packages/shared';

export const editFileTool = tool(
  async ({ path: filePath, old_str, new_str }) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const matchIndex = content.indexOf(old_str);

      if (matchIndex === -1) {
        const lines = content.split('\n');
        const firstLineOfOld = old_str.split('\n')[0].trim();
        const closestLine = lines.findIndex((l) => l.trim().includes(firstLineOfOld.slice(0, 20)));

        const hint =
          closestLine >= 0
            ? `Closest match found at line ${closestLine + 1}: "${lines[closestLine]}"`
            : 'No similar content found. Use read_file to check the current file content.';

        return `Error: old_str not found in ${filePath}\n${hint}`;
      }

      const secondMatch = content.indexOf(old_str, matchIndex + 1);
      if (secondMatch !== -1) {
        return `Error: old_str appears multiple times in ${filePath}. Make old_str more specific by including more surrounding context.`;
      }

      const diff = buildDiff(filePath, old_str, new_str, content, matchIndex);
      const updated =
        content.slice(0, matchIndex) + new_str + content.slice(matchIndex + old_str.length);

      fs.writeFileSync(filePath, updated, 'utf-8');

      const linesChanged = Math.abs(new_str.split('\n').length - old_str.split('\n').length);
      const changed =
        linesChanged > 0
          ? `Added ${linesChanged} lines`
          : `Removed ${Math.abs(linesChanged)} lines`;
      const summary = linesChanged === 0 ? 'Modified existing lines' : changed;

      return `Edited: ${filePath} (${summary})\n\n${diff}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.edit_file,
    description: `Replace an exact string in a file. Safer than write_file for targeted edits.
Rules:
- old_str must be an EXACT match including whitespace and indentation
- old_str must be unique in the file — include enough context lines to make it unique
- prefer small focused edits over large replacements
- use patch_file when you need multiple replacements in the same file`,
    schema: z.object({
      path: z.string().describe('Path to the file'),
      old_str: z.string().describe('Exact string to find and replace. Must be unique in the file.'),
      new_str: z.string().describe('Replacement string'),
    }),
  }
);
