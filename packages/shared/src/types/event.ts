import type { PendingToolCall, Plan } from '@types';

export interface AppEvents {
  'user:message': { sessionId: string; content: string };
  'user:stop': { sessionId: string };

  'llm:token': { sessionId: string; token: string };
  'llm:thinking': { sessionId: string; text: string };
  'llm:start': { sessionId: string };
  'llm:end': { sessionId: string };
  'llm:error': { sessionId: string; error: string };

  'agent:plan': { sessionId: string; plan: { goal: string; steps: string[] } };
  'agent:plan_pending': { sessionId: string; plan: Plan | null };
  'agent:plan_decision': {
    sessionId: string;
    approved: boolean;
    plan: Plan | null;
  };
  'agent:tool_pending': { sessionId: string; toolCall: PendingToolCall };
  'agent:tool_decision': { sessionId: string; approved: boolean; toolCall: PendingToolCall };
  'agent:stopped': { sessionId: string };

  'tool:start': { sessionId: string; name: string; input: unknown; callId: string };
  'tool:end': { sessionId: string; name: string; output: unknown; callId: string };
  'tool:error': { sessionId: string; name: string; error: string; callId: string };
}
