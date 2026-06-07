import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import type { RunnableConfig } from '@langchain/core/runnables';

export const requestApprovalTool = tool(
  async ({ plan }: { plan: string }, config?: RunnableConfig) => {
    const sessionId = (config?.configurable?.sessionId as string) ?? '';
    EventBus.emit('agent:plan_pending', { sessionId, plan });
    const decision = interrupt({ type: 'plan_approval', plan });
    const approved = decision === 'approve' || decision === 'y';
    if (!approved) return 'User rejected the plan. Reconsider the approach or stop.';
    return 'Plan approved. Proceed with execution.';
  },
  {
    name: 'request_approval',
    description: `Show the user a plan and wait for approval before executing.
Use for: multiple file modifications, deletions, renames, destructive bash commands.
Skip for: single-file edits, read-only tasks, simple fixes.
plan: plain text description of what you intend to do, typically a numbered list.`,
    schema: z.object({
      plan: z.string().describe('Description of the changes you plan to make'),
    }),
  }
);
