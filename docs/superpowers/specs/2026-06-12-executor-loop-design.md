# Executor Loop — Design Spec

Date: 2026-06-12
Status: approved design, pending implementation plan

## Goal

Add a production-grade edit loop to the root agent: the approved plan (`PlannerOutput`) is executed step by step — read fresh state, generate edits with an LLM, apply mechanically, verify, retry on failure, escalate to the user when stuck. Comparable in behavior to Claude Code / Cursor execution loops.

This supersedes `.superpowers/EXECUTOR_LOOP.md` (pure mechanical executor). Key change: an LLM (mini-reader) runs inside the loop per edit step and produces `newContent`; the old spec had no component that could synthesize new code. The schemas in `packages/shared/src/schemas/executor/types.ts` (`ExecutorHintSchema.newContent`, `MiniReaderOutputSchema`, `StepReviewOutputSchema`, `StepResultSchema`) already reflect this design and are the base contracts.

## Decisions (confirmed with user)

1. **LLM in the loop** — per edit step, a mini-reader LLM reads fresh files and emits hints with ready `newContent`; application is mechanical.
2. **The loop owns the whole plan** — inspect steps run the existing reader subagent; edit/create/delete steps run the mini-reader pipeline. One loop, one state.
3. **Two-tier verification** — cheap check (tree-sitter parse + anchor application) after every hint; `tsc` + related tests after each completed plan step. Verification commands derived from `WorkspaceContext.language`; tiers are skipped when the language is unsupported (the agent supports a limited language set).
4. **Forward-fix + state snapshots** — file contents snapshotted per step before the first write; retries fix forward from a clean step state (rollback step files before each retry); after max retries the step's files are rolled back and the user is asked.
5. **Approvals only for destructive ops** — `interrupt()` for `delete_file` (and bash if added later). Regular edits auto-apply; the plan was already approved upstream.
6. **Form: subgraph-as-node** — the executor is a compiled subgraph added to the root graph via `addNode('executor', executorGraph)`. LangGraph ^1.3.0 propagates `interrupt()` from subgraphs to the parent thread; the checkpointer is inherited; `Command({ resume })` on the root thread resumes the loop exactly where it stopped.

## Root graph changes

```
planner → (afterPlanner) → question_node | executor
executor (subgraph node) → agent (final answer) → END
```

- `RootState` (`packages/shared/src/state/root.ts`) gains `plan: PlannerOutput | null` and `stepResults: StepResult[]`. Today `plannerNode` returns `{ plan }` but `RootState` has no `plan` annotation — the plan is silently dropped. Fixed as part of this work.
- `afterPlanner`: clarifying questions → `question_node`; plan present → `executor`; no plan → `agent` (current fallback).
- Root `question_node` / `afterAsk` are untouched: executor interrupts happen inside the subgraph.

## Executor subgraph

Location: `packages/agent/src/subagents/executor/` (graph.ts, state.ts, index.ts), nodes in `packages/agent/src/nodes/sub/executor/`, prompts in `packages/agent/src/prompts/sub/executor/`.

### Topology

```
START → init → step_selector
step_selector ─ all done / nothing left ──→ finalize → END
             ─ deadlock from failed deps ─→ escalate
             ─ step.kind = inspect ───────→ reader_step ───────────→ step_selector
             ─ edit / create / delete ────→ mini_reader
mini_reader → approval_gate (destructive only, interrupt) → apply
apply → verify_step → step_review
step_review ─ sufficient ─────────→ step_selector
            ─ insufficient, retries < 2 → mini_reader   (with error context)
            ─ blocked / max retries ─→ rollback → escalate (interrupt) → step_selector
```

### Nodes

- **init** — no LLM. Validates the plan DAG, reads baseline file contents, derives verification commands from `WorkspaceContext.language` (`typeCheck`, `testRunner`, `lint`). Unsupported language → that tier is disabled.
- **step_selector** — no LLM. Topological pick by `depends_on`: next step whose dependencies are all `done`. No eligible step + a `failed`/`skipped` blocker → deadlock → escalate. None left → finalize.
- **reader_step** — invokes the existing reader subagent for an inspect step. Stores a compressed `ReaderDigest` (`summary`, clipped `key_findings`, `operation_hints`) in `readerFindings[stepId]`; the full `ReaderOutput` is not kept in loop state to keep mini-reader prompts small.
- **mini_reader** — LLM, single structured-output call (`MiniReaderOutputSchema`), no ReAct loop. Prompt input:
  1. The plan step (`title`, `kind`, `files`, `expected_output`) plus plan `goal` and `constraints`.
  2. Fresh contents of `step.files` read from disk with line numbers, clipped (~30KB/file).
  3. `readerFindings` of the step's `depends_on` chain.
  4. On retry: `lastError` plus the diff the previous attempt produced (files are rolled back to the step snapshot before the retry, so every attempt starts from clean step state).
  If a step needs files outside `step.files`, that is a plan defect — `step_review` catches the failed verification and escalates.
- **approval_gate** — only when hints contain destructive ops (`delete_file`). Emits the pending event, `interrupt()`; resume value approves or rejects (reject → step failed → escalate path).
- **apply** — no LLM. Mechanical dispatch of hints, in order, to existing primitives in `packages/shared/src/utils/editor/` (`applyTextReplace/Insert/Delete`, `applyAstReplace/Rename/Remove/Insert`, `applyFileInsert/Remove/Rename`). Per hint: re-read the file from disk (a previous hint may have shifted content), require the `anchor` to occur exactly once (`anchor not found` / `anchor ambiguous` → step fails into retry with the exact error), write, then tree-sitter parse — a syntax error fails the step into retry immediately without waiting for `tsc`. All paths resolve inside `cwd`; traversal is a hard failure. The step's files are snapshotted (`fileSnapshots[stepId]`, `null` = file did not exist) before the first write.
- **verify_step** — runs `typeCheck` when configured (grep for errors in output), then the related test file only (heuristic: `foo.ts → foo.test.ts | __tests__/**/foo.test.ts`), not the whole suite. Per-command timeout, 120s default. Output tail stored for review/retry context.
- **step_review** — LLM judge, `StepReviewOutputSchema`. Input: `expected_output`, applied hints list, verification output tail, step diff. `sufficient` → step `done` (a `StepResult` is recorded); `insufficient` → retry if `retryCounts[stepId] < 2`; `blocked` → escalate immediately without burning retries.
- **escalate** — `interrupt({ type: 'executor_escalation', stepId, error, options: ['skip', 'retry', 'abort'] })`.
  - `skip` → step `skipped`; transitively dependent steps are also `skipped` (cascade).
  - `retry` → retry counter reset; the user's guidance is appended to the mini-reader prompt.
  - `abort` → finalize with partial results; the failed step's files are already rolled back; completed steps' edits remain.
- **finalize** — writes `stepResults` (and a short run summary) back to root state; the root `agent` node composes the user-facing answer.

### State (`ExecutorState`)

```typescript
// shared with root (input)
plan, context, cwd, sessionId

// private
stepStates:     Record<stepId, StepStatus>        // pending|running|done|failed|skipped
currentStepId:  string | null
currentHints:   ExecutorHint[]
readerFindings: Record<stepId, ReaderDigest>
fileSnapshots:  Record<stepId, Record<file, string | null>>
retryCounts:    Record<stepId, number>
lastError:      string | null
verifyCommands: { typeCheck?: string; testRunner?: string; lint?: string }

// output (written to root at finalize)
stepResults:    StepResult[]
```

`ReaderDigest` is a new schema in `packages/shared/src/schemas/executor/` alongside escalation payload types.

## Error handling summary

| Failure | Handling |
| --- | --- |
| Anchor missing/ambiguous, syntax error after write | Step fails into retry with exact error; step files rolled back to snapshot first |
| `tsc`/test failure | Same retry path, verification tail in context |
| Review `blocked`, or retries exhausted (2) | Rollback step files, escalate interrupt |
| DAG deadlock (failed/skipped dependency) | Escalate |
| Unexpected node error | Caught in node, step `failed`, escalate |

No silent failures: every terminal failure surfaces to the user with the exact error and step id.

## Events

Added to `AppEvents` (`packages/shared/src/types/event.ts`):

```typescript
'executor:step:start':   { sessionId, stepId, title, index, total }
'executor:step:done':    { sessionId, stepId, status, retries }
'executor:edit:applied': { sessionId, stepId, file, op, diff }
'executor:verify':       { sessionId, stepId, command, ok }
```

Escalation and approval reuse the existing `agent:question` flow (source `'executor'`); the CLI only adds rendering for the new progress events.

## Testing

`__tests__/agent/executor/`:

- `stepSelector.test.ts` — DAG ordering, deadlock detection, cascade skip.
- `apply.test.ts` — every op against a temp directory; ambiguous/missing anchor; path traversal rejection; snapshot/rollback round-trip.
- `init.test.ts` — verify-command derivation per language; unsupported-language fallback.
- `graph.test.ts` — integration with mocked LLM (fixed hints/review) on a temp project: happy path, retry path, escalation interrupt/resume.
- `miniReader`/`stepReview` — prompt assembly and output parsing tests, no live LLM calls.

## File map

```
packages/agent/src/subagents/executor/{graph,state,index}.ts
packages/agent/src/nodes/sub/executor/{init,stepSelector,readerStep,miniReader,apply,verifyStep,stepReview,escalate,finalize,index}.ts
packages/agent/src/prompts/sub/executor/{miniReader,stepReview}.ts
packages/shared/src/schemas/executor/        // extend: ReaderDigest, escalation types
packages/shared/src/state/root.ts            // + plan, stepResults
packages/shared/src/types/event.ts           // + executor:* events
packages/agent/src/graphs/root.ts            // wire executor node
```
