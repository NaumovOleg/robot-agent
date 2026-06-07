import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

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
