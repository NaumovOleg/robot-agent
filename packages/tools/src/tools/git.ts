import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

// ── git_status ────────────────────────────────────────────

export const gitStatusTool = tool(
  async (_, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const [status, branch, stash] = await Promise.all([
      runGit('status --short', cwd),
      runGit('branch --show-current', cwd),
      runGit('stash list', cwd),
    ]);

    const lines: string[] = [`Branch: ${branch}`, '', 'Working tree:', status || '  (clean)'];

    if (stash && !stash.startsWith('Error')) {
      lines.push('', 'Stashes:', stash);
    }

    return lines.join('\n');
  },
  {
    name: TOOL_NAMES.git_status,
    description: 'Show current git status — branch, modified files, staged changes.',
    schema: z.object({}),
  }
);

// ── git_diff ──────────────────────────────────────────────

export const gitDiffTool = tool(
  async ({ file, staged = false, commit }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    let cmd: string;

    if (commit) {
      cmd = `diff ${commit}${file ? ` -- ${file}` : ''}`;
    } else if (staged) {
      cmd = `diff --cached${file ? ` -- ${file}` : ''}`;
    } else {
      cmd = `diff${file ? ` -- ${file}` : ''}`;
    }

    const diff = await runGit(cmd, cwd);

    if (!diff || diff === '(no output)') {
      return staged ? 'No staged changes' : 'No unstaged changes';
    }

    const lines = diff.split('\n');
    if (lines.length > 300) {
      return [
        `Diff truncated (${lines.length} lines → showing first 300)`,
        'Use file parameter to narrow down to specific file.',
        '',
        lines.slice(0, 300).join('\n'),
        `\n... ${lines.length - 300} more lines`,
      ].join('\n');
    }

    return diff;
  },
  {
    name: TOOL_NAMES.git_diff,
    description: `Show git diff.
- No args: unstaged changes
- staged=true: staged changes  
- file: diff for specific file
- commit: diff against a commit/branch e.g. "HEAD~1" or "main"`,
    schema: z.object({
      file: z.string().optional().describe('Specific file to diff'),
      staged: z.boolean().optional().describe('Show staged changes. Default: false'),
      commit: z.string().optional().describe('Compare against commit/branch e.g. "HEAD~1", "main"'),
    }),
  }
);

// ── git_log ───────────────────────────────────────────────

export const gitLogTool = tool(
  async ({ limit = 10, file, oneline = false }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const format = oneline ? '--oneline' : '--pretty=format:"%h  %an  %ar  %s"';

    const fileFlag = file ? ` -- ${file}` : '';
    const cmd = `log ${format} -${limit}${fileFlag}`;

    return runGit(cmd, cwd);
  },
  {
    name: TOOL_NAMES.git_log,
    description: 'Show commit history. Use file to see history of a specific file.',
    schema: z.object({
      limit: z.number().int().min(1).max(50).optional().describe('Number of commits. Default: 10'),
      file: z.string().optional().describe('Show history for specific file'),
      oneline: z.boolean().optional().describe('Compact one-line format. Default: false'),
    }),
  }
);

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

// ── git_show ──────────────────────────────────────────────

export const gitShowTool = tool(
  async ({ ref, file }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const fileFlag = file ? `:${file}` : '';
    const cmd = `show ${ref}${fileFlag}`;

    const output = await runGit(cmd, cwd);

    const lines = output.split('\n');
    if (lines.length > 200) {
      return lines.slice(0, 200).join('\n') + `\n... truncated (${lines.length} lines total)`;
    }

    return output;
  },
  {
    name: TOOL_NAMES.git_show,
    description: 'Show contents of a commit or a file at a specific commit.',
    schema: z.object({
      ref: z.string().describe('Commit hash, branch, or tag e.g. "HEAD~1", "abc1234"'),
      file: z.string().optional().describe('Show specific file at that commit'),
    }),
  }
);

// ── git_branch ────────────────────────────────────────────

export const gitBranchTool = tool(
  async ({ all = false }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const cmd = all ? 'branch -a --sort=-committerdate' : 'branch --sort=-committerdate';
    return runGit(cmd, cwd);
  },
  {
    name: TOOL_NAMES.git_branch,
    description: 'List branches. Use all=true to include remote branches.',
    schema: z.object({
      all: z.boolean().optional().describe('Include remote branches. Default: false'),
    }),
  }
);
