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
  // applyNode replaces this per attempt; the previous attempt's ops are discarded with the rollback
  appliedOps: Annotation<Record<string, string[]>>(mergeRecord<string[]>()),
  // Repo-relative paths created/modified by completed steps in this run. Fed to
  // the mini-reader so a later edit step references newly-created files by their
  // EXACT path instead of guessing (e.g. `./faq` vs `./faq/FAQ`).
  producedFiles: Annotation<string[]>({
    reducer: (prev, next) => [...new Set([...prev, ...next])],
    default: () => [],
  }),
  lastError: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  userGuidance: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  verifyCommands: Annotation<VerifyCommands>({
    reducer: (_, n) => n,
    default: () => ({ typeCheck: null, testRunner: null, lint: null }),
  }),
  verifyOutput: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  // true when a programmatic check (type-check / related tests) ran for the step
  // and passed; null when no check ran. step_review treats `true` as authoritative
  // (done) instead of asking the LLM judge to re-confirm already-passed checks.
  verifyPassed: Annotation<boolean | null>({ reducer: (_, n) => n, default: () => null }),
  // Normalized type-check error signatures captured at init, before any edit.
  // verify_step subtracts these so a step is only blamed for NEW errors it
  // introduced — not pre-existing project tsc noise (test files, etc.).
  baselineErrors: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),
  escalationDecision: Annotation<EscalationDecision | null>({ reducer: (_, n) => n, default: () => null }),
});

export type ExecutorStateType = typeof ExecutorState.State;
export const MAX_STEP_RETRIES = 2;
