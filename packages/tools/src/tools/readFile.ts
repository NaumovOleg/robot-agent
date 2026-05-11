import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { detectLanguage, formatLines, getFileStats, TOOL_NAMES } from '@robocode-packages/shared';
import { MAX_LINES_DEFAULT, LARGE_FILE_THRESHOLD } from '@robocode-packages/config';

export const readFileTool = tool(
  async (
    { path: filePath, start_line, end_line, show_line_numbers = true },
    config?: RunnableConfig
  ) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

    try {
      const stat = fs.statSync(targetPath);

      if (stat.isDirectory()) {
        return `Error: ${targetPath} is a directory. Use list_dir instead.`;
      }

      const ext = path.extname(targetPath).toLowerCase();
      const binaryExts = new Set([
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.ico',
        '.svg',
        '.pdf',
        '.zip',
        '.tar',
        '.gz',
        '.exe',
        '.bin',
        '.wasm',
        '.ttf',
        '.woff',
        '.woff2',
        '.eot',
      ]);
      if (binaryExts.has(ext)) {
        return `Binary file: ${targetPath} (${(stat.size / 1024).toFixed(1)}KB) — cannot display contents`;
      }

      const raw = fs.readFileSync(targetPath, 'utf-8');
      const allLines = raw.split('\n');
      const totalLines = allLines.length;
      const lang = detectLanguage(targetPath);

      if (start_line !== undefined || end_line !== undefined) {
        const from = Math.max(1, start_line ?? 1);
        const to = Math.min(totalLines, end_line ?? totalLines);

        if (from > totalLines) {
          return `Error: start_line ${from} exceeds file length (${totalLines} lines)`;
        }

        const slice = allLines.slice(from - 1, to);
        const content = show_line_numbers ? formatLines(slice, from) : slice.join('\n');

        const header = `${targetPath} (lines ${from}-${to} of ${totalLines})`;
        const hints: string[] = [];
        if (from > 1) hints.push(`use start_line=1 to see from beginning`);
        if (to < totalLines)
          hints.push(`use end_line=${totalLines} or start_line=${to + 1} to see more`);

        return [
          header,
          hints.length ? `Hint: ${hints.join(', ')}` : '',
          '```' + lang,
          content,
          '```',
        ]
          .filter(Boolean)
          .join('\n');
      }

      if (totalLines > LARGE_FILE_THRESHOLD) {
        const preview = allLines.slice(0, MAX_LINES_DEFAULT);
        const content = show_line_numbers ? formatLines(preview, 1) : preview.join('\n');

        return [
          `${targetPath} — LARGE FILE (${getFileStats(allLines)})`,
          `Showing lines 1-${MAX_LINES_DEFAULT} of ${totalLines}. Use start_line and end_line to read specific sections.`,
          '',
          `Quick navigation:`,
          `  - First ${MAX_LINES_DEFAULT} lines: shown below`,
          `  - Middle section: start_line=${Math.floor(totalLines / 2) - 50}, end_line=${Math.floor(totalLines / 2) + 50}`,
          `  - Last section: start_line=${totalLines - MAX_LINES_DEFAULT}, end_line=${totalLines}`,
          '',
          '```' + lang,
          content,
          '```',
          `\n... ${totalLines - MAX_LINES_DEFAULT} more lines. Use start_line/end_line to read more.`,
        ].join('\n');
      }

      const content = show_line_numbers ? formatLines(allLines, 1) : allLines.join('\n');

      return [`${targetPath} (${getFileStats(allLines)})`, '```' + lang, content, '```'].join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        const dir = path.dirname(targetPath);
        const base = path.basename(targetPath);
        try {
          const siblings = fs
            .readdirSync(dir)
            .filter((f) => f.toLowerCase().includes(base.toLowerCase().slice(0, 5)))
            .slice(0, 5);
          const hint = siblings.length
            ? `Similar files in ${dir}:\n${siblings.map((f) => `  - ${f}`).join('\n')}`
            : `Directory ${dir} exists but no similar files found.`;
          return `Error: File not found: ${targetPath}\n${hint}`;
        } catch {
          return `Error: File not found: ${targetPath}`;
        }
      }
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.read_file,
    description: `Read file contents with line numbers.
- For large files (>500 lines) use start_line and end_line to read sections
- Line numbers are shown by default to help with edit_file references
- Binary files are detected and skipped automatically`,
    schema: z.object({
      path: z.string().describe('Path to the file'),
      start_line: z.number().int().positive().optional().describe('First line to read (1-indexed)'),
      end_line: z.number().int().positive().optional().describe('Last line to read (inclusive)'),
      show_line_numbers: z.boolean().optional().describe('Show line numbers. Default: true'),
    }),
  }
);
