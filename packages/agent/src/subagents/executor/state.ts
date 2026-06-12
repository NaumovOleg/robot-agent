import { Annotation } from '@langchain/langgraph';
import type {
  PlannerOutput,
  WorkspaceContext,
  ExecutorHint,
  ReaderDigest,
  StepStatus,
  StepResult,
  VerifyCommands,
  EscalationDecision,
} from '@robocode-packages/shared';

const mergeRecord = <V>() => ({
  reducer: (prev: Record<string, V>, next: Record<string, V>) => ({ ...prev, ...next }),
  default: () => ({}) as Record<string, V>,
});

export const ExecutorState = Annotation.Root({
  // ── shared with root (input) ────────────────────────────────────────────────
  plan: Annotation<PlannerOutput | null>({ reducer: (_, n) => n, default: () => null }),
  context: Annotation<WorkspaceContext | null>({ reducer: (_, n) => n, default: () => null }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => process.cwd() }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),

  // ── shared with root (output) ───────────────────────────────────────────────
  // nodes MUST return only NEW items (delta); the reducer appends them
  stepResults: Annotation<StepResult[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),

  // ── private loop state ──────────────────────────────────────────────────────
  stepStates: Annotation<Record<string, StepStatus>>(mergeRecord<StepStatus>()),
  currentStepId: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  currentHints: Annotation<ExecutorHint[]>({ reducer: (_, n) => n, default: () => [] as ExecutorHint[] }),
  readerFindings: Annotation<Record<string, ReaderDigest>>(mergeRecord<ReaderDigest>()),
  fileSnapshots: Annotation<Record<string, Record<string, string | null>>>(
    mergeRecord<Record<string, string | null>>()
  ),
  retryCounts: Annotation<Record<string, number>>(mergeRecord<number>()),
  // nodes must read state.appliedOps[stepId], append, and return the full new array
  appliedOps: Annotation<Record<string, string[]>>(mergeRecord<string[]>()),
  lastError: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  userGuidance: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  verifyCommands: Annotation<VerifyCommands>({
    reducer: (_, n) => n,
    default: () => ({ typeCheck: null, testRunner: null, lint: null }),
  }),
  verifyOutput: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  escalationDecision: Annotation<EscalationDecision | null>({ reducer: (_, n) => n, default: () => null }),
});

export type ExecutorStateType = typeof ExecutorState.State;
export const MAX_STEP_RETRIES = 2;
