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

// Overwrite-last reducer: discards previous value, keeps the incoming one.
// Explicit `_prev: T` annotation ensures the reducer satisfies BinaryOperator<T,T>.
const ow =
  <T>() =>
  (prev: T, next: T): T =>
    next;

const mergeRecord = <V>() => ({
  reducer: (prev: Record<string, V>, next: Record<string, V>) => ({ ...prev, ...next }),
  default: () => ({}) as Record<string, V>,
});

export const ExecutorState = Annotation.Root({
  // ── shared with root (input) ────────────────────────────────────────────────
  plan: Annotation<PlannerOutput | null>({
    reducer: ow<PlannerOutput | null>(),
    default: () => null,
  }),
  context: Annotation<WorkspaceContext | null>({
    reducer: ow<WorkspaceContext | null>(),
    default: () => null,
  }),
  cwd: Annotation<string>({ reducer: ow<string>(), default: () => process.cwd() }),
  sessionId: Annotation<string>({ reducer: ow<string>(), default: () => '' }),

  // ── shared with root (output) ───────────────────────────────────────────────
  // nodes MUST return only NEW items (delta); the reducer appends them
  stepResults: Annotation<StepResult[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),

  // ── private loop state ──────────────────────────────────────────────────────
  stepStates: Annotation<Record<string, StepStatus>>(mergeRecord<StepStatus>()),
  currentStepId: Annotation<string | null>({
    reducer: ow<string | null>(),
    default: () => null,
  }),
  currentHints: Annotation<ExecutorHint[]>({
    reducer: ow<ExecutorHint[]>(),
    default: () => [] as ExecutorHint[],
  }),
  readerFindings: Annotation<Record<string, ReaderDigest>>(mergeRecord<ReaderDigest>()),
  fileSnapshots: Annotation<Record<string, Record<string, string | null>>>(
    mergeRecord<Record<string, string | null>>()
  ),
  retryCounts: Annotation<Record<string, number>>(mergeRecord<number>()),
  appliedOps: Annotation<Record<string, string[]>>(mergeRecord<string[]>()),
  lastError: Annotation<string | null>({
    reducer: ow<string | null>(),
    default: () => null,
  }),
  userGuidance: Annotation<string | null>({
    reducer: ow<string | null>(),
    default: () => null,
  }),
  verifyCommands: Annotation<VerifyCommands>({
    reducer: ow<VerifyCommands>(),
    default: () => ({ typeCheck: null, testRunner: null, lint: null }),
  }),
  verifyOutput: Annotation<string | null>({
    reducer: ow<string | null>(),
    default: () => null,
  }),
  escalationDecision: Annotation<EscalationDecision | null>({
    reducer: ow<EscalationDecision | null>(),
    default: () => null,
  }),
});

export type ExecutorStateType = typeof ExecutorState.State;
export const MAX_STEP_RETRIES = 2;
