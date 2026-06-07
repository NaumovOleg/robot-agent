import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

// ── git_blame ─────────────────────────────────────────────

export const gitBlameTool = tool(
  async ({ file, start_line, end_line }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const lineFlag = start_line && end_line ? ` -L ${start_line},${end_line}` : '';

    const cmd = `blame --date=short -p${lineFlag} ${file}`;
    const raw = await runGit(cmd, cwd);

    if (raw.startsWith('Error')) return raw;

    const lines = raw.split('\n');
    const result: string[] = [];
    let currentHash = '';
    let currentAuthor = '';
    let currentDate = '';

    for (const line of lines) {
      if (line.match(/^[0-9a-f]{40}/)) {
        currentHash = line.slice(0, 8);
      } else if (line.startsWith('author ')) {
        currentAuthor = line.slice(7);
      } else if (line.startsWith('author-time ')) {
        const ts = Number.parseInt(line.slice(12));
        currentDate = new Date(ts * 1000).toISOString().slice(0, 10);
      } else if (line.startsWith('\t')) {
        result.push(
          `${currentHash}  ${currentDate}  ${currentAuthor.padEnd(20)}  ${line.slice(1)}`
        );
      }
    }

    if (result.length === 0) return raw;

    const header = `${'commit'.padEnd(8)}  ${'date'.padEnd(10)}  ${'author'.padEnd(20)}  code`;
    const divider = '─'.repeat(80);
    return `${header}\n${divider}\n${result.join('\n')}`;
  },
  {
    name: TOOL_NAMES.git_blame,
    description: 'Show who last modified each line of a file and when.',
    schema: z.object({
      file: z.string().describe('File to blame'),
      start_line: z.number().int().positive().optional().describe('Start line'),
      end_line: z.number().int().positive().optional().describe('End line'),
    }),
  }
);
