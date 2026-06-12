import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export const hasDestructiveHints = (state: ExecutorStateType): boolean =>
  state.currentHints.some((hint) => hint.op === 'delete_file');

// interrupt() propagates through the subgraph to the root thread; the CLI's
// existing tool-approval UI resumes it via agent:resume → Command({ resume }).
export const approvalGateNode = (state: ExecutorStateType) => {
  const { sessionId, currentHints } = state;
  const targets = currentHints.filter((h) => h.op === 'delete_file').map((h) => h.file);

  EventBus.emit('agent:tool_pending', {
    sessionId,
    toolCall: { name: 'delete_file', input: { files: targets } },
  });

  const decision: string = interrupt(
    `Executor wants to delete: ${targets.join(', ')}. Approve?`
  );
  const approved = decision === 'approve' || decision === 'y';

  EventBus.emit('agent:tool_decision', {
    sessionId,
    approved,
    toolCall: { name: 'delete_file', input: { files: targets } },
  });
  debug('[executor/approval_gate]', approved ? 'approved' : 'rejected');

  if (!approved) {
    return { lastError: `User rejected deletion of: ${targets.join(', ')}` };
  }
  return { lastError: null };
};
