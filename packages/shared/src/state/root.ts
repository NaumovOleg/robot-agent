import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { WorkspaceContext, RouterIntentOutput, ClarificationSource } from '../types';

export const RootState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => process.cwd() }),
  context: Annotation<WorkspaceContext | null>({ reducer: (_, n) => n, default: () => null }),
  router: Annotation<{
    intent?: RouterIntentOutput;
    userRequests: string[];
  }>({
    reducer: (_, n) => n,
    default: () => ({ userRequests: [] }),
  }),
  clarificationSource: Annotation<ClarificationSource | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  answer: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  question: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  userRequest: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
});
