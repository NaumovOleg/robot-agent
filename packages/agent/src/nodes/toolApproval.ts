import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { TOOL_RISK } from '@robocode-packages/config';
import type { AgentStateType } from '../state';
import { formatToolDescription } from '@robocode-packages/tools';

import type { PendingToolCall } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';

export const toolApprovalNode = async (state: AgentStateType) => {
  const { sessionId } = state;
  const last = state.messages.at(-1) as AIMessage;

  if (!AIMessage.isInstance(last) || !last.tool_calls?.length) {
    debug('TOOL NOT TOOL', last);
    return { toolApproved: false, pendingToolCall: null };
  }

  const toolCall = last.tool_calls[0];
  const risk = TOOL_RISK[toolCall.name] ?? 'safe';
  if (risk === 'safe') {
    debug('TOOL SAFE', last.tool_calls[0]);
    return { toolApproved: true, pendingToolCall: null };
  }

  const pending: PendingToolCall = {
    id: toolCall.id ?? crypto.randomUUID(),
    name: toolCall.name,
    args: toolCall.args as Record<string, unknown>,
    risk,
    description: formatToolDescription(toolCall.name, toolCall.args as Record<string, unknown>),
  };

  EventBus.emit('agent:tool_pending', { sessionId, toolCall: pending });
  const decision = interrupt({ type: 'tool_approval', toolCall: pending });
  const approved = decision === 'approve' || decision === 'y';
  EventBus.emit('agent:tool_decision', { sessionId, approved, toolCall: pending });

  if (!approved) {
    const toolMessage = new ToolMessage({
      content: `User rejected the tool call "${pending.name}". Do not retry this operation. Explain what you were trying to do and ask for guidance or find an alternative approach.`,
      tool_call_id: pending.id,
    });

    debug('TOOL REJECTED', pending);

    return { toolApproved: false, pendingToolCall: null, messages: [toolMessage] };
  }

  return { toolApproved: true, pendingToolCall: null };
};
