import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { TOOL_NAMES, runGit } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';

export const gitAmendTool = tool(
  async ({ files, message }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    // Warn if branch has a remote tracking ref (amending a pushed commit needs force push)
    const upstreamCheck = await runGit('rev-parse --abbrev-ref --symbolic-full-name @{u}', cwd);
    const hasRemote = !upstreamCheck.startsWith('Error:') && !upstreamCheck.includes('fatal:') && upstreamCheck !== '(no output)';
    const warning = hasRemote
      ? 'Warning: branch appears to have remote commits — amending will diverge from remote.\n'
      : '';

    const fileArgs = files.map((f) => `"${f}"`).join(' ');
    const addResult = await runGit(`add ${fileArgs}`, cwd);
    if (addResult.startsWith('Error:') || addResult.startsWith('fatal:')) return `${warning}${addResult}`;

    const messageFlag = message
      ? `-m "${message.replace(/"/g, '\\"')}"`
      : '--no-edit';
    const amendResult = await runGit(`commit --amend ${messageFlag}`, cwd);
    return `${warning}${amendResult}`;
  },
  {
    name: TOOL_NAMES.git_amend,
    description: 'Stage files and amend the last commit. Optionally provide a new message; omit to keep existing message.',
    schema: z.object({
      files: z.array(z.string()).min(1).describe('Files to stage before amending'),
      message: z.string().optional().describe('New commit message. Omit to keep existing message (--no-edit).'),
    }),
  }
);
