import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { CONTEXT_LINES } from '@robocode-packages/config';
import { TOOL_NAMES } from '@robocode-packages/shared';

const formatDiff = (
  filePath: string,
  originalLines: string[],
  newLines: string[],
  startLine: number,
  endLine: number
): string => {
  const contextStart = Math.max(0, startLine - 1 - CONTEXT_LINES);
  const contextEnd = Math.min(originalLines.length, endLine + CONTEXT_LINES);

  const lines: string[] = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -${startLine},${endLine - startLine + 1} +${startLine},${newLines.length} @@`,
    '',
  ];

  for (let i = contextStart; i < startLine - 1; i++) {
    lines.push(`  ${String(i + 1).padStart(4)} │   ${originalLines[i]}`);
  }

  for (let i = startLine - 1; i < endLine; i++) {
    lines.push(`  ${String(i + 1).padStart(4)} │ - ${originalLines[i]}`);
  }

  for (let i = 0; i < newLines.length; i++) {
    lines.push(`  ${String(startLine + i).padStart(4)} │ + ${newLines[i]}`);
  }

  for (let i = endLine; i < contextEnd; i++) {
    lines.push(`  ${String(i + 1).padStart(4)} │   ${originalLines[i]}`);
  }

  return lines.join('\n');
};

export const replaceLinesTool = tool(
  async ({ path: filePath, start_line, end_line, new_content }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

    try {
      const raw = fs.readFileSync(targetPath, 'utf-8');
      const originalLines = raw.split('\n');
      const totalLines = originalLines.length;

      if (start_line < 1 || start_line > totalLines) {
        return `Error: start_line ${start_line} is out of range (file has ${totalLines} lines)`;
      }
      if (end_line < start_line) {
        return `Error: end_line ${end_line} must be >= start_line ${start_line}`;
      }
      if (end_line > totalLines) {
        return `Error: end_line ${end_line} is out of range (file has ${totalLines} lines)`;
      }

      const newLines = new_content.split('\n');

      const diff = formatDiff(targetPath, originalLines, newLines, start_line, end_line);

      const result = [
        ...originalLines.slice(0, start_line - 1),
        ...newLines,
        ...originalLines.slice(end_line),
      ];

      fs.writeFileSync(targetPath, result.join('\n'), 'utf-8');

      const removedCount = end_line - start_line + 1;
      const addedCount = newLines.length;
      const delta = addedCount - removedCount;
      const deltaStr =
        delta === 0 ? 'no line count change' : delta > 0 ? `+${delta} lines` : `${delta} lines`;

      return [
        `Replaced lines ${start_line}-${end_line} in ${targetPath} (${deltaStr})`,
        '',
        diff,
      ].join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code === 'ENOENT') return `Error: File not found: ${targetPath}`;
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.replace_lines,
    description: `Replace specific lines in a file by line number range.
Use when:
- edit_file fails because old_str is not unique or too large
- You need to replace a large block (function, class, section)
- You know exact line numbers from read_file output

Always read_file first to get current line numbers.
new_content replaces lines start_line through end_line (inclusive).`,
    schema: z.object({
      path: z.string().describe('Path to the file'),
      start_line: z.number().int().min(1).describe('First line to replace (1-indexed, inclusive)'),
      end_line: z.number().int().min(1).describe('Last line to replace (1-indexed, inclusive)'),
      new_content: z.string().describe('New content to insert. Replaces the entire line range.'),
    }),
  }
);
