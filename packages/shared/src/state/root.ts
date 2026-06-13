import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  WorkspaceContext,
  RouterIntentOutput,
  ClarificationSource,
  PlannerOutput,
} from '../types';
import type { StepResult } from '../schemas/executor/types';

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
  selectedFiles: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),

  // plan produced by plannerNode (was silently dropped before — no annotation existed)
  plan: Annotation<PlannerOutput | null>({ reducer: (_, n) => n, default: () => null }),
  planApproved: Annotation<boolean | null>({ reducer: (_, n) => n, default: () => null }),
  // Written back by the executor subgraph at finalize. Last-writer-wins (NOT
  // concat): the executor accumulates internally with its own concat reducer and
  // returns its full list, so the root takes it wholesale. Concat here would
  // re-append the inherited list and double every result on a second run.
  stepResults: Annotation<StepResult[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
});
