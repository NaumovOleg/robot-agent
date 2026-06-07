# Executor Loop Design

**Date:** 2026-05-29
**Status:** Approved

---

## Goal

Replace the current single-pass `reader → edit_intent → delegate_writer` pipeline with a step-by-step executor that processes each `plan.steps[]` entry individually, in DAG dependency order, with per-step verification against `expected_output` and retry/escalation on failure. The executor also supports parallel execution of conflict-free steps, dynamic step insertion mid-run, and cross-step file conflict detection.

---

## Approach

**Approach A — executor_loop replaces reader + edit_intent + delegate_writer.**

- `plan_approval` routes directly to `executor_loop` (always).
- For `inspect` steps: `tool_executor` reads files with `read_file`, accumulates content in `codeContext`. No LLM call needed.
- For `edit` steps: `tool_executor` runs a focused mini-reader LLM call (with accumulated `codeContext` + step details) to produce `operation_hints[]`, then applies them using existing editor tools (`edit_file`, `patch_file`, `resolveAstEdit`).
- For `create` steps: LLM generates file content from `codeContext` patterns → `write_file`.
- For `delete` steps: `delete_file` after risk confirmation.
- For `bash` steps: `bash_tool` runs the command; output stored in `stepsResults`.
- `editIntentNode`, `reader`, `collect_reader_answers`, and `delegate_writer` are all removed.

### AST preference

The mini-reader prompt for `edit` steps explicitly requires: **prefer AST operations** (`replace_node`, `insert_node`, `remove_node`, `rename_symbol`) over text operations wherever the target is a named symbol, type, function, class, or enum declaration. Fall back to `replace_text` / `insert_text` only for structural patterns with no named AST anchor (config objects, JSX attribute values, inline template strings). The step_reviewer failure report suggests AST alternatives when text ops fail on retry.

---

## Root Graph Changes

### Removed nodes

- `reader`
- `collect_reader_answers`
- `edit_intent`
- `delegate_writer`

### Added nodes

- `executor_loop` — delegates to `ExecutorAgent.run()`, handles `GraphInterrupt` for `ask_user` and `delete` confirmations
- `summarizer` — in root graph, after `executor_loop`

### New edge chain

```
plan_approval → executor_loop → summarizer → build_git_intent → delegate_git → END
```

`plan_approval` routing simplifies: approved always → `'executor_loop'` (no more "has non-inspect steps?" branch).

### RootState additions

```typescript
executionSummary:      string | null       // produced by summarizer
executionChangedFiles: string[]            // files touched — replaces editorAppliedFiles for build_git_intent
executionStepsResult:  StepResult[]        // per-step result table
```

`buildGitIntentNode` reads `executionChangedFiles ?? editorAppliedFiles` — backward-compatible.

---

## Executor Subgraph

Thread ID: `{sessionId}_executor`. Compiled with shared SQLite checkpointer.

### Internal graph

```
START → initialize → step_selector

step_selector:
  no pending steps       → summarizer → END
  step(s) found          → tool_executor (Send[] for parallel, single for serial)

tool_executor → step_reviewer

step_reviewer:
  sufficient             → step_selector
  insufficient           → tool_executor (retry)
  blocked                → ask_user (interrupt)

ask_user:
  action='retry'         → tool_executor (with userHint appended)
  action='skip'          → step_selector (mark step 'skipped')
  action='add_steps'     → step_selector (append to dynamicSteps)
```

### ExecutorState fields

```typescript
// From root (passed on invoke)
plan:                  Plan
cwd:                   string
sessionId:             string

// Step tracking
stepsState:            Record<string, StepStatus>     // merge reducer
stepsResults:          Record<string, string>          // merge reducer
retryCounts:           Record<string, number>          // merge reducer
dynamicSteps:          PlanStep[]                      // steps added mid-run

// Current step context
currentStepId:         string | null
currentStepOutput:     string | null
userHint:              string | null                   // set by ask_user on retry

// Accumulated file context (grows as inspect steps run)
codeContext:           Record<string, string>          // filename → content

// LangGraph messages (tool_executor LLM calls)
messages:              BaseMessage[]

// Summarizer output (returned to root state)
executionSummary:      string | null
executionChangedFiles: string[]
executionStepsResult:  StepResult[]
```

---

## Node Contracts

### initialize

Sets all `plan.steps` to `'pending'` in `stepsState`. Emits `agent:executor_start`.

### step_selector

1. Merges `plan.steps` + `dynamicSteps` into a single step list.
2. Computes the ready set: steps with `status === 'pending'` where all `depends_on` entries are `'done'` or `'skipped'`.
3. Auto-marks inspect steps `'done'` if all their `files` are already in `codeContext` (no tool_executor call needed).
4. Runs `partitionReadySteps()` on the ready set:
   - Steps with no file overlap with any other ready step → **parallel group** → return `Send[]`
   - Steps with file overlap → serialize; pick first by original DAG order
   - Inspect steps sharing files with edit steps → inspect always serialized first
5. If ready set is empty → route to `'summarizer'`.

Router: `'tool_executor'` (or `Send[]`) | `'summarizer'`

### partitionReadySteps (pure function)

```
Input:  PlanStep[] (all ready)
Output: { parallel: PlanStep[], serial: PlanStep[] }

Algorithm:
  Build map: file → stepIds[]
  Steps where no file appears in any other step's files → parallel
  Steps sharing a file with another → serial (pick first by index)
```

### tool_executor

Dispatches by `step.kind`. On re-entry (retry), appends prior error output + `userHint` to context before re-running the LLM phase.

**inspect:**
```
for file in step.files:
  content = read_file(file)
  codeContext[file] = content
currentStepOutput = "Read N files: [filenames]"
```
No LLM call. Always routes to `step_reviewer` which returns `sufficient`.

**edit:**
- Phase 1 (mini-reader): if files not in `codeContext`, `read_file` them. LLM call: `step.title + step.expected_output + codeContext[step.files]` → `operation_hints[]` (AST-first prompt).
- Phase 2 (apply): for each hint — AST ops → `resolveAstEdit()` → `edit_file`; text ops → `edit_file`; rename → `rename_file`.
- On retry: re-run Phase 1 with prior error appended to context.

**create:**
LLM generates file content from `step.title + step.expected_output + codeContext` (adjacent files for pattern-matching). → `write_file(step.files[0], content)`. If file exists, falls back to `edit` flow.

**delete:**
`TOOL_RISK: 'destructive'`. If `autoApprove=false` → emit `agent:tool_pending` + `interrupt()` for user confirmation (same pattern as `pushApprovalNode`). On approve → `delete_file(step.files[0])`. This is a separate interrupt from `ask_user` — it fires inside `tool_executor`, not via `step_reviewer`.

**bash:**
Extracts command from `step.title` (format: `"Run: <command>"`). Runs via `bash_tool`. Output → `stepsResults[stepId]`. No LLM call.

> The planner prompt is updated to require bash steps use `"Run: <command>"` prefix.

### step_reviewer

Determines `StepReviewStatus` per kind:

| Kind | Check |
|---|---|
| `inspect` | Always `sufficient` |
| `edit` / `create` | LLM judge (expected_output met?) + `tsc --noEmit` on changed files. Both must pass. |
| `delete` | File no longer exists? |
| `bash` | Exit 0 + LLM judge on expected_output |

**LLM judge call** (cheap model, structured output):
- System: "Assess whether a code change satisfies its success criteria."
- Human: `step.title` + `step.expected_output` + `currentStepOutput` + tsc output
- Output: `{ status: 'sufficient' | 'insufficient' | 'blocked', reason: string }`
- When reporting failures: suggest AST alternatives if text ops failed.

**Status routing:**
- `sufficient` → mark step `'done'`, route to `step_selector`
- `insufficient` → `retryCounts[stepId]++`, append error to messages, route to `tool_executor`
- `blocked` (retries ≥ `EXECUTOR_MAX_RETRIES`) → mark step `'failed'`, route to `ask_user`

### ask_user

Emits `agent:step_blocked` with failure context (step title, expected_output, error). Calls `interrupt()`. Resume payload:

```typescript
| { action: 'retry',     hint: string    }  // → set userHint → tool_executor
| { action: 'skip'                        }  // → mark 'skipped' → step_selector
| { action: 'add_steps', steps: PlanStep[] } // → append to dynamicSteps → step_selector
```

### summarizer

Collects: `git diff --stat` (changed files), `stepsResults` (per-step output), `stepsState` (done/failed/skipped count). Produces a brief LLM prose summary (2–3 sentences) + step result table. Returns `executionSummary`, `executionChangedFiles`, `executionStepsResult` to root state. Emits `agent:execution_complete`.

---

## Parallel Execution

`step_selector` returns `Send('tool_executor', { currentStepId })` for each step in the parallel group. LangGraph dispatches them concurrently. After each completes, it routes to `step_reviewer` independently.

**State reducers that must switch to merge:**

```typescript
stepsState:   Annotation<Record<string, StepStatus>>({ reducer: (old, n) => ({ ...old, ...n }) })
stepsResults: Annotation<Record<string, string>>({ reducer: (old, n) => ({ ...old, ...n }) })
retryCounts:  Annotation<Record<string, number>>({ reducer: (old, n) => ({ ...old, ...n }) })
```

---

## Dynamic Step Insertion

New `dynamicSteps: PlanStep[]` field in ExecutorState (default `[]`). Steps added via `ask_user`'s `'add_steps'` resume action or by the step_reviewer when it detects a missing prerequisite.

Rules for dynamic steps:
- IDs must be prefixed `'dyn-'` and globally unique.
- `depends_on` defaults to `[currentStepId]` if not specified.
- `step_selector` merges `plan.steps + dynamicSteps` before computing the ready set.

---

## New Shared Types

**`packages/shared/src/schemas/executor/types.ts`**

```typescript
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type StepReviewStatus = 'sufficient' | 'insufficient' | 'blocked';

export const StepResultSchema = z.object({
  stepId:  z.string(),
  status:  z.enum(['done', 'failed', 'skipped']),
  output:  z.string(),
  retries: z.number().int().min(0),
});
export type StepResult = z.infer<typeof StepResultSchema>;
```

**`packages/config/src/executor.ts`**

```typescript
export const EXECUTOR_MAX_RETRIES = 2;
```

---

## New AppEvents

```typescript
// packages/shared/src/types/event.ts
'agent:executor_start':    { sessionId: string; stepCount: number }
'agent:step_blocked':      { sessionId: string; stepId: string; stepTitle: string; error: string; expectedOutput: string }
'agent:execution_complete':{ sessionId: string; summary: string; changedFiles: string[]; stepsResult: StepResult[] }
```

---

## File Map

### New files

| File | Purpose |
|---|---|
| `packages/shared/src/schemas/executor/types.ts` | `StepStatus`, `StepReviewStatus`, `StepResult` |
| `packages/shared/src/schemas/executor/index.ts` | barrel export |
| `packages/config/src/executor.ts` | `EXECUTOR_MAX_RETRIES = 2` |
| `packages/agent/src/main/subagents/executor/state.ts` | `ExecutorState` |
| `packages/agent/src/main/subagents/executor/graph.ts` | compiled executor subgraph |
| `packages/agent/src/main/subagents/executor/index.ts` | `ExecutorAgent` singleton |
| `packages/agent/src/nodes/sub/executor/initialize.ts` | init stepsState |
| `packages/agent/src/nodes/sub/executor/stepSelector.ts` | DAG + parallel partition + Send[] |
| `packages/agent/src/nodes/sub/executor/toolExecutor.ts` | per-kind execution |
| `packages/agent/src/nodes/sub/executor/stepReviewer.ts` | LLM judge + tsc check |
| `packages/agent/src/nodes/sub/executor/askUser.ts` | interrupt + resume routing |
| `packages/agent/src/nodes/sub/executor/summarizer.ts` | diff + step table + prose summary |
| `packages/agent/src/nodes/sub/executor/index.ts` | barrel export |
| `packages/agent/src/nodes/root/delegateExecutor.ts` | calls executorAgent.run(), handles interrupt |
| `packages/agent/src/prompts/sub/executor.ts` | mini-reader (AST-first), reviewer judge, create-file prompts |
| `__tests__/agent/executorLoop.test.ts` | unit + integration tests |

### Modified files

| File | Change |
|---|---|
| `packages/shared/src/schemas/index.ts` | `+ export * from './executor'` |
| `packages/shared/src/types/event.ts` | + 3 new executor events |
| `packages/config/src/index.ts` | re-export executor constants |
| `packages/agent/src/main/root/graph.ts` | remove reader/edit_intent/delegate_writer; add executor_loop + summarizer |
| `packages/agent/src/main/root/state.ts` | + `executionSummary`, `executionChangedFiles`, `executionStepsResult` |
| `packages/agent/src/nodes/planApproval.ts` | approved → `'executor_loop'` always |
| `packages/agent/src/nodes/root/buildGitIntent.ts` | read `executionChangedFiles ?? editorAppliedFiles` |
| `packages/agent/src/prompts/planner.ts` | bash step format: `"Run: <command>"`; executor context |

### Deleted files

| File | Reason |
|---|---|
| `packages/agent/src/nodes/root/reader.ts` | replaced by inspect steps in executor |
| `packages/agent/src/nodes/root/collectReaderAnswers.ts` | removed |
| `packages/agent/src/nodes/root/editIntent.ts` | replaced by mini-reader in tool_executor |
| `packages/agent/src/nodes/root/editIntent/` (directory) | removed |
| `packages/agent/src/nodes/root/delegateWriter.ts` | replaced by delegateExecutor |

---

## Test Coverage

**`__tests__/agent/executorLoop.test.ts`**

### stepSelector
- Respects `depends_on` — no step runs before deps are done
- Topological order with multiple dependency levels
- Auto-skips inspect step when all files already in `codeContext`
- Returns null / routes to summarizer when all steps done
- Counts `'skipped'` steps as resolved for `depends_on`
- Merges `plan.steps` + `dynamicSteps` correctly

### partitionReadySteps
- No file overlap → all steps in parallel group
- Shared file → conflicting steps serialized, others parallel
- Inspect step sharing file with edit step → inspect serialized first

### toolExecutor — inspect
- Reads files into `codeContext`
- Does not call LLM

### toolExecutor — bash
- Runs command, stores output in `stepsResults[stepId]`

### stepReviewer routers
- Routes to `'step_selector'` on `sufficient`
- Routes to `'tool_executor'` when `insufficient` + `retryCounts < EXECUTOR_MAX_RETRIES`
- Routes to `'ask_user'` when `retryCounts >= EXECUTOR_MAX_RETRIES`
- `inspect` always returns `sufficient`

### askUser
- Routes to `'tool_executor'` on `action='retry'`, sets `userHint`
- Routes to `'step_selector'` on `action='skip'`, marks step `'skipped'`
- Routes to `'step_selector'` on `action='add_steps'`, appends to `dynamicSteps`

### dynamicSteps
- Steps with `dyn-` prefix appear in stepSelector's ready set
- `depends_on: [currentStepId]` resolves correctly after parent completes

---

## What This Does Not Cover

- UI diff preview per step (only final summarizer diff shown to user)
- Executor checkpointing between parallel branches (parallel state merged after all complete)
