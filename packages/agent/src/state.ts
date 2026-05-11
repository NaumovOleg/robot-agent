import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { Plan, PendingToolCall } from '@robocode-packages/shared';

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  plan: Annotation<Plan | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  pendingToolCall: Annotation<PendingToolCall | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  toolApproved: Annotation<boolean | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  iterationCount: Annotation<number>({
    reducer: (_, n) => n,
    default: () => 0,
  }),
  planApproved: Annotation<boolean>({
    reducer: (_, n) => n ?? false,
    default: () => false,
  }),
  cwd: Annotation<string>({
    reducer: (_, n) => n,
    default: () => process.cwd(),
  }),
});

export type AgentStateType = typeof AgentState.State;
