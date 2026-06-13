import { Annotation } from '@langchain/langgraph';
import type { WorkspaceContext, RouterIntentOutput } from '../types';
import type { PlannerOutput } from '../schemas';

export const PlannerState = Annotation.Root({
  // ── input ─────────────────────────────────────────────────────────────────
  requests: Annotation<string[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  context: Annotation<WorkspaceContext | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  intent: Annotation<RouterIntentOutput | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  selectedFiles: Annotation<string[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  sessionId: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),

  // ── intermediate ──────────────────────────────────────────────────────────
  rawPlan: Annotation<PlannerOutput | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  validationError: Annotation<string | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  retryCount: Annotation<number>({
    reducer: (_, n) => n,
    default: () => 0,
  }),

  // ── output ────────────────────────────────────────────────────────────────
  plan: Annotation<PlannerOutput | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
});
