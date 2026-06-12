import type { Session } from './session';
import type { ClarificationSource } from './agent';
import type { ExecutorHint } from '../schemas/executor/types';

export interface AppEvents {
  'user:message': { sessionId: string; content: string };
  'user:stop': { sessionId: string };

  'llm:token': { sessionId: string; token: string };
  'llm:thinking': { sessionId: string; text: string };
  'llm:start': { sessionId: string };
  'llm:end': { sessionId: string };
  'llm:error': { sessionId: string; error: string };
  'llm:usage': {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cost: number;
  };

  'agent:plan_pending': { sessionId: string; plan: string };
  'agent:plan_decision': { sessionId: string; approved: boolean; plan: string };
  'agent:tool_pending': {
    sessionId: string;
    toolCall: { name: string; input: unknown };
    source?: 'root';
  };
  'agent:tool_decision': {
    sessionId: string;
    approved: boolean;
    toolCall: { name: string; input: unknown };
  };
  'agent:stopped': { sessionId: string };
  'agent:resume': { sessionId: string; decision: 'approve' | 'reject' | 'y' | 'n' };
  'agent:stop': { sessionId: string };
  'agent:allow_tool': { toolName: string };
  'agent:delete-checkpoint': string;
  'agent:set-session': Session | null;
  'agent:run': string;
  'agent:git_diff': {
    sessionId: string;
    gitDiffStat: string | null;
    gitDiffPreview: string | null;
  };

  'tool:start': { sessionId: string; name: string; input: unknown; callId?: string };
  'tool:stream': {
    sessionId: string;
    name: string;
    chunk: string;
    stream: 'stdout' | 'stderr';
    callId?: string;
  };
  'tool:end': { sessionId: string; name: string; output: unknown; callId: string };
  'tool:error': { sessionId: string; name: string; error: string; callId: string };

  'session:set': { sessionId: string };
  'agent:compact_request': { sessionId: string };
  'agent:compact_complete': { sessionId: string; originalCount: number };
  'agent:question': { sessionId: string; question: string; source: ClarificationSource | null };
  'agent:answer': { sessionId: string; answer: string; source: ClarificationSource | null };

  'executor:step:start': {
    sessionId: string;
    stepId: string;
    title: string;
    index: number;
    total: number;
  };
  'executor:step:done': {
    sessionId: string;
    stepId: string;
    status: 'done' | 'failed' | 'skipped';
    retries: number;
  };
  'executor:edit:applied': {
    sessionId: string;
    stepId: string;
    file: string;
    op: ExecutorHint['op'];
    diff: string;
  };
  'executor:step:verify': {
    sessionId: string;
    stepId: string;
    command: string;
    ok: boolean;
    output?: string;
  };
}
