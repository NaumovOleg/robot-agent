import { Annotation } from '@langchain/langgraph';
import type { RouterIntentOutput, WorkspaceContext } from '../types';

export const RouterIntentState = Annotation.Root({
  // ── input (injected from root state) ──────────────────────────────────────

  context: Annotation<WorkspaceContext>(),
  sessionId: Annotation<string>(),
  requests: Annotation<string[]>(),

  // ── intermediate ──────────────────────────────────────────────────────────

  // raw LLM output before validation retry
  rawIntent: Annotation<RouterIntentOutput | null>({
    default: () => null,
    reducer: (_, n) => n,
  }),

  // validation error from previous attempt — fed back into prompt on retry
  validationError: Annotation<string | null>({
    default: () => null,
    reducer: (_, n) => n,
  }),

  // how many times classify_intent has run
  retryCount: Annotation<number>({
    default: () => 0,
    reducer: (_, n) => n,
  }),

  // ── output ────────────────────────────────────────────────────────────────
  intent: Annotation<RouterIntentOutput | null>({
    default: () => null,
    reducer: (_, n) => n,
  }),
});
