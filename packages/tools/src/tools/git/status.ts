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
