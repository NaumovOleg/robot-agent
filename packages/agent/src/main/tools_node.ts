import fs from 'node:fs';
import path from 'node:path';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { interrupt } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { TOOL_RISK, ALLOWED_TOOLS_PATH } from '@robocode-packages/config';
import { debug, isAIMessage } from '@robocode-packages/shared';
import type { RootStateType } from './state';
import { AGENT_TOOLS } from './agent_node';

function loadAllowedTools(): Set<string> {
  try {
    const raw = fs.readFileSync(ALLOWED_TOOLS_PATH, 'utf8');
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveAllowedTool(toolName: string): void {
  try {
    const existing = loadAllowedTools();
    existing.add(toolName);
    fs.mkdirSync(path.dirname(ALLOWED_TOOLS_PATH), { recursive: true });
    fs.writeFileSync(ALLOWED_TOOLS_PATH, JSON.stringify([...existing], null, 2));
  } catch (err) {
    debug('[allowedTools] write failed:', String(err));
  }
}

// Module-level cache — loaded once at startup
const allowedToolsCache: Set<string> = loadAllowedTools();

// Update cache AND persist when user clicks Always
EventBus.on('agent:allow_tool', ({ toolName }) => {
  allowedToolsCache.add(toolName);
  saveAllowedTool(toolName);
});

const innerToolNode = new ToolNode(AGENT_TOOLS);

export async function toolsNode(state: RootStateType) {
  const { sessionId } = state;
  const lastMsg = state.messages.at(-1);

  if (!lastMsg || !isAIMessage(lastMsg) || !lastMsg.tool_calls?.length) {
    return {};
  }

  // Find all destructive tool calls in this batch
  const destructiveCalls = lastMsg.tool_calls.filter(
    (tc) => (TOOL_RISK[tc.name] ?? 'safe') === 'destructive' && !allowedToolsCache.has(tc.name)
  );

  if (destructiveCalls.length > 0) {
    // Build simplified tool call objects for each destructive call
    const pendingCalls = destructiveCalls.map((tc) => ({
      name: tc.name,
      input: tc.args as unknown,
    }));

    // Emit pending for each destructive call
    for (const pending of pendingCalls) {
      EventBus.emit('agent:tool_pending', {
        sessionId,
        toolCall: pending,
        source: 'root' as const,
      });
    }

    // Single interrupt for the entire batch — avoids LangGraph replay state reset
    const decision = interrupt({ type: 'tool_approval', toolCalls: pendingCalls }) as
      | 'approve'
      | 'reject'
      | 'y'
      | 'n';
    const approved = decision === 'approve' || decision === 'y';

    // Emit decision for each
    for (const pending of pendingCalls) {
      EventBus.emit('agent:tool_decision', {
        sessionId,
        approved,
        toolCall: pending,
      });
    }

    if (!approved) {
      // Reject ALL tool calls in this batch with synthetic ToolMessages
      const rejectionMessages = lastMsg.tool_calls.map(
        (tc) =>
          new ToolMessage({
            content: `Tool call rejected by user.`,
            tool_call_id: tc.id ?? tc.name,
            name: tc.name,
          })
      );
      return { messages: rejectionMessages };
    }
  }

  // All approved (or no destructive tools) — execute all
  return innerToolNode.invoke(state);
}
