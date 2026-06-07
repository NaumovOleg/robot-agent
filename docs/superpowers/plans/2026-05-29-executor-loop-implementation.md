# Executor Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-pass reader→edit_intent→delegate_writer pipeline with a step-by-step executor that processes each plan step individually in DAG order, with per-step verification, retry, parallel execution, and dynamic step insertion.

**Architecture:** Approach A — executor_loop sits directly after plan_approval. inspect steps read files via read_file into codeContext. edit steps run a focused mini-reader LLM call (AST-first) to produce operation hints, then apply them using existing editor tools. step_reviewer uses a cheap LLM judge + tsc to determine sufficient/insufficient/blocked. Parallel execution via LangGraph's Send API for conflict-free steps.

**Tech Stack:** LangGraph (`StateGraph`, `Send`, `interrupt`, `Command`), Zod, LangChain tools (`editFileTool`, `writeFileTool`, `bashTool`, `readFileTool`), `resolveAstEdit` from `@robocode-packages/tools`, `getModel` from `packages/agent/src/utils/model.ts`.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `packages/shared/src/schemas/executor/types.ts` | `StepStatus`, `StepReviewStatus`, `StepResultSchema`, `ExecutorHintSchema` |
| `packages/shared/src/schemas/executor/index.ts` | barrel export |
| `packages/config/src/executor.ts` | `EXECUTOR_MAX_RETRIES = 2` |
| `packages/agent/src/main/subagents/executor/state.ts` | `ExecutorState` with merge reducers |
| `packages/agent/src/main/subagents/executor/graph.ts` | compiled executor subgraph |
| `packages/agent/src/main/subagents/executor/index.ts` | `ExecutorAgent` singleton |
| `packages/agent/src/nodes/sub/executor/initialize.ts` | set all steps to pending |
| `packages/agent/src/nodes/sub/executor/stepSelector.ts` | DAG logic, partition, Send dispatch |
| `packages/agent/src/nodes/sub/executor/toolExecutor.ts` | per-kind execution |
| `packages/agent/src/nodes/sub/executor/stepReviewer.ts` | LLM judge + tsc check |
| `packages/agent/src/nodes/sub/executor/askUser.ts` | interrupt + resume routing |
| `packages/agent/src/nodes/sub/executor/summarizer.ts` | diff + step table |
| `packages/agent/src/nodes/sub/executor/index.ts` | barrel export |
| `packages/agent/src/nodes/root/delegateExecutor.ts` | call executorAgent.run() |
| `packages/agent/src/prompts/sub/executor.ts` | mini-reader, reviewer judge, create-file prompts |
| `__tests__/agent/executorLoop.test.ts` | all executor tests |

### Modified files
| File | Change |
|---|---|
| `packages/shared/src/schemas/index.ts` | `+ export * from './executor'` |
| `packages/shared/src/types/event.ts` | + 3 executor events |
| `packages/agent/src/main/root/graph.ts` | remove 5 nodes, add executor_loop |
| `packages/agent/src/main/root/state.ts` | + 3 execution output fields |
| `packages/agent/src/nodes/planApproval.ts` | route to `'executor_loop'` |
| `packages/agent/src/nodes/root/buildGitIntent.ts` | read `executionChangedFiles` |
| `packages/agent/src/prompts/planner.ts` | bash step format instruction |

### Deleted files
`nodes/root/reader.ts` · `nodes/root/collectReaderAnswers.ts` · `nodes/root/editIntent.ts` · `nodes/root/editIntent/` · `nodes/root/delegateWriter.ts`

---

## Task 1: Shared types + config + AppEvents

**Files:**
- Create: `packages/shared/src/schemas/executor/types.ts`
- Create: `packages/shared/src/schemas/executor/index.ts`
- Create: `packages/config/src/executor.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Modify: `packages/shared/src/types/event.ts`

- [ ] **Step 1: Create executor types schema**

Create `packages/shared/src/schemas/executor/types.ts`:

```typescript
import { z } from 'zod';

export const StepStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepReviewStatusSchema = z.enum(['sufficient', 'insufficient', 'blocked']);
export type StepReviewStatus = z.infer<typeof StepReviewStatusSchema>;

export const StepResultSchema = z.object({
  stepId: z.string(),
  status: z.enum(['done', 'failed', 'skipped']),
  output: z.string(),
  retries: z.number().int().min(0),
});
export type StepResult = z.infer<typeof StepResultSchema>;

// Hint schema for mini-reader LLM output (edit steps).
// For AST ops: newContent is the actual replacement code.
// For text ops: newContent is the new text; anchor is the old text to find.
export const ExecutorHintSchema = z.object({
  op: z.enum([
    'replace_node', 'insert_node', 'remove_node', 'rename_symbol',
    'replace_text', 'insert_text', 'remove_text',
    'create_file', 'delete_file', 'rename_file',
  ]),
  file: z.string(),
  nodeType: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  newSymbol: z.string().nullable().optional(),
  anchor: z.string().nullable().optional(),
  newContent: z.string().nullable().optional(),
});
export type ExecutorHint = z.infer<typeof ExecutorHintSchema>;

export const MiniReaderOutputSchema = z.object({
  hints: z.array(ExecutorHintSchema).max(30),
});

export const StepReviewOutputSchema = z.object({
  status: StepReviewStatusSchema,
  reason: z.string(),
});
```

- [ ] **Step 2: Create barrel export**

Create `packages/shared/src/schemas/executor/index.ts`:

```typescript
export * from './types';
```

- [ ] **Step 3: Wire into shared schemas barrel**

In `packages/shared/src/schemas/index.ts`, add after the last `export *` line:

```typescript
export * from './executor';
```

- [ ] **Step 4: Create config constant**

Create `packages/config/src/executor.ts`:

```typescript
export const EXECUTOR_MAX_RETRIES = 2;
```

Check `packages/config/src/index.ts` — if it barrel-exports via `export * from './agent'` etc., add `export * from './executor'` there too. Inspect the file first:
```bash
cat packages/config/src/index.ts
```

- [ ] **Step 5: Add AppEvents**

In `packages/shared/src/types/event.ts`, add inside the `AppEvents` interface (next to other `agent:*` events):

```typescript
'agent:executor_start':     { sessionId: string; stepCount: number };
'agent:step_blocked':       { sessionId: string; stepId: string; stepTitle: string; error: string; expectedOutput: string };
'agent:execution_complete': { sessionId: string; summary: string; changedFiles: string[]; stepsResult: StepResult[] };
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/config/tsconfig.json
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/executor/ packages/shared/src/schemas/index.ts packages/shared/src/types/event.ts packages/config/src/executor.ts
git commit -m "feat: executor loop — shared types, config, AppEvents"
```

---

## Task 2: ExecutorState

**Files:**
- Create: `packages/agent/src/main/subagents/executor/state.ts`

- [ ] **Step 1: Create ExecutorState**

Create `packages/agent/src/main/subagents/executor/state.ts`:

```typescript
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { Plan, PlanStep, StepStatus, StepResult } from '@robocode-packages/shared';

export const ExecutorState = Annotation.Root({
  // Passed in from root on invoke
  plan: Annotation<Plan | null>({ reducer: (_, n) => n, default: () => null }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => process.cwd() }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  autoApprove: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),

  // Step tracking — merge reducers required for parallel execution
  stepsState: Annotation<Record<string, StepStatus>>({
    reducer: (old, n) => ({ ...old, ...n }),
    default: () => ({}),
  }),
  stepsResults: Annotation<Record<string, string>>({
    reducer: (old, n) => ({ ...old, ...n }),
    default: () => ({}),
  }),
  retryCounts: Annotation<Record<string, number>>({
    reducer: (old, n) => ({ ...old, ...n }),
    default: () => ({}),
  }),
  dynamicSteps: Annotation<PlanStep[]>({
    reducer: (old, n) => [...old, ...n],
    default: () => [],
  }),

  // Current step context (set per parallel Send invocation)
  currentStepId: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  currentStepOutput: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  userHint: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),

  // File context — grows as inspect steps run; merge so parallel steps accumulate
  codeContext: Annotation<Record<string, string>>({
    reducer: (old, n) => ({ ...old, ...n }),
    default: () => ({}),
  }),

  // LangGraph messages for tool_executor LLM calls
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),

  // Output returned to root state by summarizer
  executionSummary: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  executionChangedFiles: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),
  executionStepsResult: Annotation<StepResult[]>({ reducer: (_, n) => n, default: () => [] }),
});

export type ExecutorStateType = typeof ExecutorState.State;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -10
```

Expected: no errors in source files.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/subagents/executor/state.ts
git commit -m "feat: ExecutorState with merge reducers for parallel execution"
```

---

## Task 3: Pure step selection logic (TDD)

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/stepSelector.ts` (pure functions only in this task)
- Create: `__tests__/agent/executorLoop.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/agent/executorLoop.test.ts`:

```typescript
import type { PlanStep } from '@robocode-packages/shared';

const makeStep = (id: string, kind: PlanStep['kind'] = 'edit', files: string[] = [], depends_on: string[] = []): PlanStep => ({
  id, kind, title: id, files, depends_on, expected_output: `${id} done`,
});

describe('getReadySteps', () => {
  it('returns pending steps whose deps are all done', async () => {
    const { getReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [
      makeStep('a', 'inspect', ['f1.ts']),
      makeStep('b', 'edit', ['f2.ts'], ['a']),
    ];
    const state = { a: 'done', b: 'pending' } as any;
    expect(getReadySteps(steps, state).map(s => s.id)).toEqual(['b']);
  });

  it('excludes steps whose deps are pending', async () => {
    const { getReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [makeStep('a'), makeStep('b', 'edit', [], ['a'])];
    expect(getReadySteps(steps, { a: 'pending', b: 'pending' } as any)).toEqual([]);
  });

  it('treats skipped deps as resolved', async () => {
    const { getReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [makeStep('a'), makeStep('b', 'edit', [], ['a'])];
    expect(getReadySteps(steps, { a: 'skipped', b: 'pending' } as any).map(s => s.id)).toEqual(['b']);
  });
});

describe('partitionReadySteps', () => {
  it('no file overlap → all parallel', async () => {
    const { partitionReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [makeStep('a', 'edit', ['f1.ts']), makeStep('b', 'edit', ['f2.ts'])];
    const { parallel, serial } = partitionReadySteps(steps, {});
    expect(parallel.map(s => s.id)).toEqual(['a', 'b']);
    expect(serial).toEqual([]);
  });

  it('shared file → conflicting steps serialized', async () => {
    const { partitionReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [
      makeStep('a', 'edit', ['shared.ts']),
      makeStep('b', 'edit', ['shared.ts']),
      makeStep('c', 'edit', ['other.ts']),
    ];
    const { parallel, serial } = partitionReadySteps(steps, {});
    expect(serial.map(s => s.id).sort()).toEqual(['a', 'b']);
    expect(parallel.map(s => s.id)).toEqual(['c']);
  });

  it('inspect step sharing file with edit step → serialized (inspect first)', async () => {
    const { partitionReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [makeStep('inspect-a', 'inspect', ['f.ts']), makeStep('edit-a', 'edit', ['f.ts'])];
    const { serial } = partitionReadySteps(steps, {});
    expect(serial.map(s => s.id).sort()).toEqual(['edit-a', 'inspect-a']);
  });

  it('inspect step not sharing files → parallel', async () => {
    const { partitionReadySteps } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const steps = [makeStep('inspect-a', 'inspect', ['f1.ts']), makeStep('edit-a', 'edit', ['f2.ts'])];
    const { parallel } = partitionReadySteps(steps, {});
    expect(parallel).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="getReadySteps|partitionReadySteps" 2>&1 | tail -10
```

Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement pure functions**

Create `packages/agent/src/nodes/sub/executor/stepSelector.ts` (pure functions only for now):

```typescript
import type { PlanStep, StepStatus } from '@robocode-packages/shared';

export const getReadySteps = (
  allSteps: PlanStep[],
  stepsState: Record<string, StepStatus>
): PlanStep[] =>
  allSteps.filter(step => {
    if (stepsState[step.id] !== 'pending') return false;
    return step.depends_on.every(dep => stepsState[dep] === 'done' || stepsState[dep] === 'skipped');
  });

export const partitionReadySteps = (
  readySteps: PlanStep[],
  codeContext: Record<string, string>
): { parallel: PlanStep[]; serial: PlanStep[] } => {
  // Build file → stepIds[] map
  const fileToSteps = new Map<string, string[]>();
  for (const step of readySteps) {
    for (const file of step.files) {
      if (!fileToSteps.has(file)) fileToSteps.set(file, []);
      fileToSteps.get(file)!.push(step.id);
    }
  }

  const conflicting = new Set<string>();

  // Steps sharing a file with another step are conflicting
  for (const [, stepIds] of fileToSteps) {
    if (stepIds.length > 1) stepIds.forEach(id => conflicting.add(id));
  }

  // Inspect steps sharing any file with a non-inspect step must be serialized (inspect first)
  for (const step of readySteps) {
    if (step.kind === 'inspect') {
      const hasEditConflict = step.files.some(f => {
        const others = fileToSteps.get(f) ?? [];
        return others.some(id => {
          const other = readySteps.find(s => s.id === id);
          return other && other.kind !== 'inspect';
        });
      });
      if (hasEditConflict) conflicting.add(step.id);
    }
  }

  return {
    parallel: readySteps.filter(s => !conflicting.has(s.id)),
    serial: readySteps.filter(s => conflicting.has(s.id)),
  };
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="getReadySteps|partitionReadySteps" 2>&1 | tail -10
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/stepSelector.ts __tests__/agent/executorLoop.test.ts
git commit -m "feat: getReadySteps and partitionReadySteps pure functions"
```

---

## Task 4: initializeNode + stepSelectorNode + routers (TDD)

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/stepSelector.ts`
- Create: `packages/agent/src/nodes/sub/executor/initialize.ts`

- [ ] **Step 1: Add failing tests for stepSelector node and routers**

Append to `__tests__/agent/executorLoop.test.ts`:

```typescript
describe('initializeNode', () => {
  it('sets all plan steps to pending', async () => {
    const { initializeNode } = await import('../../packages/agent/src/nodes/sub/executor/initialize');
    const plan = { steps: [makeStep('a'), makeStep('b')] } as any;
    const result = await initializeNode({ plan, sessionId: 'test', cwd: process.cwd() } as any);
    expect(result.stepsState).toEqual({ a: 'pending', b: 'pending' });
  });
});

describe('stepSelectorNode', () => {
  it('auto-marks inspect step done when all files in codeContext', async () => {
    const { stepSelectorNode } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const plan = { steps: [makeStep('ins', 'inspect', ['f.ts'])], gitStep: null } as any;
    const state = {
      plan, dynamicSteps: [],
      stepsState: { ins: 'pending' },
      codeContext: { 'f.ts': 'content' },
    } as any;
    const result = stepSelectorNode(state);
    expect((result as any).stepsState).toEqual({ ins: 'done' });
  });

  it('sets currentStepId for next serial step', async () => {
    const { stepSelectorNode } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const plan = { steps: [makeStep('a', 'edit', ['f.ts'])], gitStep: null } as any;
    const state = { plan, dynamicSteps: [], stepsState: { a: 'pending' }, codeContext: {} } as any;
    const result = stepSelectorNode(state);
    expect((result as any).currentStepId).toBe('a');
  });
});

describe('afterStepSelector', () => {
  it('routes to summarizer when no pending steps remain', async () => {
    const { afterStepSelector } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const plan = { steps: [makeStep('a')], gitStep: null } as any;
    expect(afterStepSelector({ plan, dynamicSteps: [], stepsState: { a: 'done' }, codeContext: {} } as any)).toBe('summarizer');
  });

  it('routes to tool_executor for single serial step', async () => {
    const { afterStepSelector } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const plan = { steps: [makeStep('a', 'edit', ['f.ts']), makeStep('b', 'edit', ['f.ts'])], gitStep: null } as any;
    const state = { plan, dynamicSteps: [], stepsState: { a: 'pending', b: 'pending' }, codeContext: {} } as any;
    const result = afterStepSelector(state);
    expect(result).toBe('tool_executor');
  });

  it('returns Send[] for parallel steps', async () => {
    const { afterStepSelector } = await import('../../packages/agent/src/nodes/sub/executor/stepSelector');
    const { Send } = await import('@langchain/langgraph');
    const plan = {
      steps: [makeStep('a', 'edit', ['f1.ts']), makeStep('b', 'edit', ['f2.ts'])],
      gitStep: null,
    } as any;
    const state = { plan, dynamicSteps: [], stepsState: { a: 'pending', b: 'pending' }, codeContext: {} } as any;
    const result = afterStepSelector(state);
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
    expect((result as any[])[0]).toBeInstanceOf(Send);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="initializeNode|stepSelectorNode|afterStepSelector" 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Create initializeNode**

Create `packages/agent/src/nodes/sub/executor/initialize.ts`:

```typescript
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../main/subagents/executor/state';
import type { StepStatus } from '@robocode-packages/shared';

export const initializeNode = async (state: ExecutorStateType) => {
  const { plan, sessionId } = state;
  const steps = plan?.steps ?? [];
  const stepsState: Record<string, StepStatus> = {};
  for (const step of steps) stepsState[step.id] = 'pending';

  debug('[executor:initialize] steps:', steps.length);
  EventBus.emit('agent:executor_start', { sessionId, stepCount: steps.length });
  return { stepsState };
};
```

- [ ] **Step 4: Add stepSelectorNode and afterStepSelector to stepSelector.ts**

Append to `packages/agent/src/nodes/sub/executor/stepSelector.ts`:

```typescript
import { Send } from '@langchain/langgraph';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../main/subagents/executor/state';

export const stepSelectorNode = (state: ExecutorStateType) => {
  const allSteps = [...(state.plan?.steps ?? []), ...state.dynamicSteps];
  const { stepsState, codeContext } = state;

  // Auto-mark inspect steps whose files are all already in codeContext
  const autoMarked: Record<string, 'done'> = {};
  for (const step of allSteps) {
    if (step.kind === 'inspect' && stepsState[step.id] === 'pending') {
      if (step.files.length > 0 && step.files.every(f => f in codeContext)) {
        autoMarked[step.id] = 'done';
        debug('[executor:stepSelector] auto-marking inspect step done:', step.id);
      }
    }
  }
  if (Object.keys(autoMarked).length > 0) return { stepsState: autoMarked };

  const mergedState = { ...stepsState, ...autoMarked };
  const ready = getReadySteps(allSteps, mergedState);
  if (ready.length === 0) return {}; // router routes to summarizer

  const { parallel, serial } = partitionReadySteps(ready, codeContext);

  if (parallel.length >= 1 && serial.length === 0) {
    // All ready steps are conflict-free — let router handle parallel dispatch
    return {};
  }

  // Serial: take first conflicting step
  const next = serial[0];
  debug('[executor:stepSelector] picking serial step:', next.id);
  return { stepsState: { [next.id]: 'running' }, currentStepId: next.id };
};

export const afterStepSelector = (state: ExecutorStateType): string | Send[] => {
  const allSteps = [...(state.plan?.steps ?? []), ...state.dynamicSteps];
  const ready = getReadySteps(allSteps, state.stepsState);
  if (ready.length === 0) return 'summarizer';

  const { parallel, serial } = partitionReadySteps(ready, state.codeContext);

  if (parallel.length > 1 && serial.length === 0) {
    debug('[executor:stepSelector] dispatching', parallel.length, 'parallel steps');
    return parallel.map(step => new Send('tool_executor', { currentStepId: step.id, stepsState: { [step.id]: 'running' } }));
  }

  if (parallel.length === 1 && serial.length === 0) {
    return Object.assign({}, { currentStepId: parallel[0].id });
  }

  return 'tool_executor'; // serial step, currentStepId set by node
};
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="initializeNode|stepSelectorNode|afterStepSelector" 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/stepSelector.ts packages/agent/src/nodes/sub/executor/initialize.ts __tests__/agent/executorLoop.test.ts
git commit -m "feat: initializeNode, stepSelectorNode, afterStepSelector with parallel Send dispatch"
```

---

## Task 5: stepReviewer + afterStepReviewer router (TDD)

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/stepReviewer.ts`

- [ ] **Step 1: Add failing tests for afterStepReviewer**

Append to `__tests__/agent/executorLoop.test.ts`:

```typescript
describe('afterStepReviewer', () => {
  it('routes to step_selector on sufficient', async () => {
    const { afterStepReviewer } = await import('../../packages/agent/src/nodes/sub/executor/stepReviewer');
    const state = { currentStepId: 'a', stepsState: { a: 'done' }, retryCounts: {} } as any;
    expect(afterStepReviewer(state)).toBe('step_selector');
  });

  it('routes to tool_executor on insufficient when retries remain', async () => {
    const { afterStepReviewer } = await import('../../packages/agent/src/nodes/sub/executor/stepReviewer');
    const state = { currentStepId: 'a', stepsState: { a: 'running' }, retryCounts: { a: 1 } } as any;
    expect(afterStepReviewer(state)).toBe('tool_executor');
  });

  it('routes to ask_user when retryCounts reaches EXECUTOR_MAX_RETRIES', async () => {
    const { afterStepReviewer } = await import('../../packages/agent/src/nodes/sub/executor/stepReviewer');
    const state = { currentStepId: 'a', stepsState: { a: 'failed' }, retryCounts: { a: 2 } } as any;
    expect(afterStepReviewer(state)).toBe('ask_user');
  });

  it('inspect step — always routes to step_selector (no LLM check)', async () => {
    const { afterStepReviewer } = await import('../../packages/agent/src/nodes/sub/executor/stepReviewer');
    const state = { currentStepId: 'a', stepsState: { a: 'done' }, retryCounts: {} } as any;
    expect(afterStepReviewer(state)).toBe('step_selector');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="afterStepReviewer" 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Create stepReviewer**

Create `packages/agent/src/nodes/sub/executor/stepReviewer.ts`:

```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { runGit, debug } from '@robocode-packages/shared';
import { EXECUTOR_MAX_RETRIES } from '@robocode-packages/config';
import { getModel } from '../../../utils/model';
import type { ExecutorStateType } from '../../../main/subagents/executor/state';
import type { StepReviewStatus, StepStatus } from '@robocode-packages/shared';
import { StepReviewOutputSchema } from '@robocode-packages/shared';

const REVIEWER_SYSTEM = `You assess whether a code change satisfies its success criteria.
Be strict: only return "sufficient" if the expected output is clearly met.
If a text operation failed, suggest an AST alternative (replace_node, insert_node) in your reason.
Return "blocked" only if the problem is fundamentally unsolvable without new information.`;

export const stepReviewerNode = async (state: ExecutorStateType) => {
  const { plan, dynamicSteps, currentStepId, currentStepOutput, cwd } = state;
  if (!currentStepId) return {};

  const allSteps = [...(plan?.steps ?? []), ...dynamicSteps];
  const step = allSteps.find(s => s.id === currentStepId);
  if (!step) return {};

  // inspect steps always pass
  if (step.kind === 'inspect') {
    debug('[executor:reviewer] inspect step — auto-sufficient:', currentStepId);
    return {
      stepsState: { [currentStepId]: 'done' as StepStatus },
    };
  }

  // bash: check output for errors
  let tscOutput = 'not run';
  if (step.kind === 'edit' || step.kind === 'create') {
    tscOutput = await runGit('', cwd).catch(() => 'tsc check skipped').then(async () => {
      try {
        const { execSync } = await import('node:child_process');
        return execSync('npx tsc --noEmit 2>&1', { cwd, encoding: 'utf-8', timeout: 30_000 });
      } catch (e: any) {
        return e.stdout ?? e.message ?? 'tsc failed';
      }
    });
  }

  const model = getModel(false).withStructuredOutput(StepReviewOutputSchema, { name: 'review' });
  const result = await model.invoke([
    new SystemMessage(REVIEWER_SYSTEM),
    new HumanMessage(
      `Step: ${step.title}\nExpected: ${step.expected_output}\nOutput: ${currentStepOutput ?? '(none)'}\nTypeScript check: ${tscOutput}`
    ),
  ]);

  const { status, reason } = result;
  debug('[executor:reviewer]', currentStepId, '→', status, reason.slice(0, 80));

  const retries = state.retryCounts[currentStepId] ?? 0;

  if (status === 'sufficient') {
    return { stepsState: { [currentStepId]: 'done' as StepStatus } };
  }

  if (status === 'insufficient' && retries < EXECUTOR_MAX_RETRIES) {
    return {
      retryCounts: { [currentStepId]: retries + 1 },
      currentStepOutput: `${currentStepOutput ?? ''}\n\n[Reviewer feedback: ${reason}]\n[TypeScript: ${tscOutput}]`,
    };
  }

  // blocked
  const { sessionId } = state;
  EventBus.emit('agent:step_blocked', {
    sessionId, stepId: currentStepId, stepTitle: step.title,
    error: reason, expectedOutput: step.expected_output,
  });
  return { stepsState: { [currentStepId]: 'failed' as StepStatus } };
};

export const afterStepReviewer = (state: ExecutorStateType): string => {
  const { currentStepId, stepsState, retryCounts } = state;
  if (!currentStepId) return 'step_selector';
  const status = stepsState[currentStepId];
  if (status === 'done' || status === 'skipped') return 'step_selector';
  if (status === 'failed') return 'ask_user';
  // running = insufficient + retry available
  const retries = retryCounts[currentStepId] ?? 0;
  return retries >= EXECUTOR_MAX_RETRIES ? 'ask_user' : 'tool_executor';
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="afterStepReviewer" 2>&1 | tail -10
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/stepReviewer.ts __tests__/agent/executorLoop.test.ts
git commit -m "feat: stepReviewerNode and afterStepReviewer router"
```

---

## Task 6: askUser node + afterAskUser router (TDD)

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/askUser.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/agent/executorLoop.test.ts`:

```typescript
describe('afterAskUser', () => {
  it('routes to tool_executor on retry', async () => {
    const { afterAskUser } = await import('../../packages/agent/src/nodes/sub/executor/askUser');
    expect(afterAskUser({ userHint: 'fix it', currentStepId: 'a', stepsState: { a: 'failed' } } as any)).toBe('tool_executor');
  });

  it('routes to step_selector on skip', async () => {
    const { afterAskUser } = await import('../../packages/agent/src/nodes/sub/executor/askUser');
    expect(afterAskUser({ userHint: null, currentStepId: 'a', stepsState: { a: 'skipped' } } as any)).toBe('step_selector');
  });

  it('routes to step_selector on add_steps', async () => {
    const { afterAskUser } = await import('../../packages/agent/src/nodes/sub/executor/askUser');
    expect(afterAskUser({ userHint: null, currentStepId: 'a', stepsState: { a: 'running' }, dynamicSteps: [makeStep('dyn-1')] } as any)).toBe('step_selector');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="afterAskUser" 2>&1 | tail -10
```

- [ ] **Step 3: Create askUser node**

Create `packages/agent/src/nodes/sub/executor/askUser.ts`:

```typescript
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../main/subagents/executor/state';
import type { PlanStep, StepStatus } from '@robocode-packages/shared';

type AskUserResume =
  | { action: 'retry'; hint: string }
  | { action: 'skip' }
  | { action: 'add_steps'; steps: PlanStep[] };

export const askUserNode = async (state: ExecutorStateType) => {
  const { plan, dynamicSteps, currentStepId, sessionId } = state;
  const allSteps = [...(plan?.steps ?? []), ...dynamicSteps];
  const step = allSteps.find(s => s.id === currentStepId);
  if (!step || !currentStepId) return {};

  const error = state.currentStepOutput ?? 'Unknown error';
  EventBus.emit('agent:step_blocked', {
    sessionId, stepId: currentStepId, stepTitle: step.title,
    error, expectedOutput: step.expected_output,
  });

  const decision = interrupt({ type: 'step_blocked', stepId: currentStepId, error }) as AskUserResume;
  debug('[executor:askUser] decision:', decision.action);

  if (decision.action === 'retry') {
    return {
      userHint: decision.hint,
      stepsState: { [currentStepId]: 'running' as StepStatus },
      currentStepOutput: `${error}\n[User guidance: ${decision.hint}]`,
    };
  }

  if (decision.action === 'skip') {
    return {
      userHint: null,
      stepsState: { [currentStepId]: 'skipped' as StepStatus },
    };
  }

  // add_steps
  const newSteps: PlanStep[] = (decision.steps ?? []).map((s, i) => ({
    ...s,
    id: s.id.startsWith('dyn-') ? s.id : `dyn-${currentStepId}-${i}`,
    depends_on: s.depends_on.length > 0 ? s.depends_on : [currentStepId],
  }));
  return {
    userHint: null,
    dynamicSteps: newSteps,
    stepsState: { [currentStepId]: 'failed' as StepStatus },
  };
};

export const afterAskUser = (state: ExecutorStateType): string => {
  const { userHint, currentStepId, stepsState, dynamicSteps } = state;
  if (!currentStepId) return 'step_selector';
  const status = stepsState[currentStepId];
  if (status === 'running' && userHint) return 'tool_executor';  // retry
  if (dynamicSteps.some(s => s.depends_on.includes(currentStepId))) return 'step_selector'; // add_steps
  return 'step_selector'; // skip
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="afterAskUser" 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/askUser.ts __tests__/agent/executorLoop.test.ts
git commit -m "feat: askUserNode with retry/skip/add_steps resume actions"
```

---

## Task 7: Executor prompts

**Files:**
- Create: `packages/agent/src/prompts/sub/executor.ts`

- [ ] **Step 1: Create executor prompts**

Create `packages/agent/src/prompts/sub/executor.ts`:

```typescript
export const MINI_READER_SYSTEM = `You are a precise code editor. Analyze the provided file content and produce an ordered list of atomic edit operations to accomplish the step goal.

CRITICAL: Prefer AST operations over text operations:
- Use replace_node, insert_node, remove_node, rename_symbol whenever the target is a named symbol, type, function, class, or enum declaration.
- Use replace_text, insert_text, remove_text ONLY for patterns with no named AST anchor (config object values, JSX attributes, template string internals).

For AST operations:
- nodeType: the tree-sitter node type (e.g. function_declaration, interface_declaration, enum_declaration, variable_declarator)
- symbol: the exact name as declared in source
- newContent: the COMPLETE replacement code (for replace_node/insert_node)

For text operations:
- anchor: a unique verbatim single-line substring from the file to locate the insertion/replacement point
- newContent: the exact text to insert or use as replacement

Return { hints: OperationHint[] } in JSON.`;

export const buildMiniReaderHuman = (
  stepTitle: string,
  expectedOutput: string,
  fileContents: Record<string, string>,
  retryContext?: string
): string => {
  const files = Object.entries(fileContents)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``)
    .join('\n\n');

  return [
    `Step: ${stepTitle}`,
    `Success criteria: ${expectedOutput}`,
    retryContext ? `Previous attempt failed: ${retryContext}` : '',
    '',
    '## File content',
    files,
  ].filter(Boolean).join('\n');
};

export const REVIEWER_SYSTEM = `You assess whether a code change satisfies its success criteria.
Return "sufficient" only when the expected output is clearly met.
Return "insufficient" when the change is on the right track but incomplete or has errors.
Return "blocked" only when the problem cannot be solved without new information or a fundamentally different approach.
When text operations fail, suggest AST alternatives in your reason field.`;

export const CREATE_FILE_SYSTEM = `You generate new source files following existing codebase patterns.
- Match the coding style, imports, and patterns from the adjacent files provided.
- Generate only the file content — no markdown, no explanation, no code fences.
- The output must be valid, compilable source code.`;

export const buildCreateFileHuman = (
  stepTitle: string,
  targetPath: string,
  adjacentFiles: Record<string, string>
): string => {
  const adjacent = Object.entries(adjacentFiles)
    .map(([p, c]) => `### ${p}\n${c.slice(0, 3000)}`)
    .join('\n\n');

  return `Create file: ${targetPath}\nGoal: ${stepTitle}\n\n## Adjacent files for pattern reference\n${adjacent}`;
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -5
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/prompts/sub/executor.ts
git commit -m "feat: executor prompts — mini-reader (AST-first), reviewer, create-file"
```

---

## Task 8: toolExecutor — inspect + bash (TDD)

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/toolExecutor.ts` (inspect + bash only)

- [ ] **Step 1: Add failing tests for inspect and bash**

Append to `__tests__/agent/executorLoop.test.ts`:

```typescript
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-test-')); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

describe('toolExecutor — inspect', () => {
  it('reads files into codeContext', async () => {
    const { toolExecutorNode } = await import('../../packages/agent/src/nodes/sub/executor/toolExecutor');
    fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const x = 1;');
    const plan = { steps: [makeStep('ins', 'inspect', ['a.ts'])], gitStep: null } as any;
    const state = { plan, dynamicSteps: [], currentStepId: 'ins', cwd: tmpDir, codeContext: {}, stepsResults: {}, retryCounts: {}, userHint: null, currentStepOutput: null } as any;
    const result = await toolExecutorNode(state);
    expect((result as any).codeContext?.['a.ts']).toContain('const x = 1');
  });
});

describe('toolExecutor — bash', () => {
  it('runs command and stores output', async () => {
    const { toolExecutorNode } = await import('../../packages/agent/src/nodes/sub/executor/toolExecutor');
    const plan = { steps: [{ ...makeStep('b', 'bash'), title: 'Run: echo hello_world' }], gitStep: null } as any;
    const state = { plan, dynamicSteps: [], currentStepId: 'b', cwd: tmpDir, codeContext: {}, stepsResults: {}, retryCounts: {}, userHint: null, currentStepOutput: null } as any;
    const result = await toolExecutorNode(state);
    expect((result as any).stepsResults?.b).toContain('hello_world');
    expect((result as any).currentStepOutput).toContain('hello_world');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="toolExecutor — inspect|toolExecutor — bash" 2>&1 | tail -10
```

- [ ] **Step 3: Create toolExecutor with inspect + bash**

Create `packages/agent/src/nodes/sub/executor/toolExecutor.ts`:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug } from '@robocode-packages/shared';
import { bashTool, readFileTool } from '@robocode-packages/tools';
import type { ExecutorStateType } from '../../../main/subagents/executor/state';

// Forward declaration — edit/create/delete implemented in next task
async function executeEditStep(state: ExecutorStateType, step: { id: string; title: string; files: string[]; expected_output: string }): Promise<{ currentStepOutput: string; codeContext: Record<string, string> }> {
  return { currentStepOutput: '[edit not yet implemented]', codeContext: {} };
}
async function executeCreateStep(state: ExecutorStateType, step: { id: string; title: string; files: string[] }): Promise<{ currentStepOutput: string }> {
  return { currentStepOutput: '[create not yet implemented]' };
}
async function executeDeleteStep(state: ExecutorStateType, step: { id: string; files: string[] }): Promise<{ currentStepOutput: string }> {
  return { currentStepOutput: '[delete not yet implemented]' };
}

export const toolExecutorNode = async (state: ExecutorStateType) => {
  const { plan, dynamicSteps, currentStepId, cwd } = state;
  if (!currentStepId) return {};

  const allSteps = [...(plan?.steps ?? []), ...dynamicSteps];
  const step = allSteps.find(s => s.id === currentStepId);
  if (!step) return {};

  debug('[executor:toolExecutor] running step:', currentStepId, step.kind);

  // ── inspect ──────────────────────────────────────────────
  if (step.kind === 'inspect') {
    const updates: Record<string, string> = {};
    for (const file of step.files) {
      const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
      if (!fs.existsSync(abs)) continue;
      const content = await readFileTool.invoke(
        { path: abs, show_line_numbers: false },
        { configurable: { cwd } }
      );
      updates[file] = typeof content === 'string' ? content : JSON.stringify(content);
    }
    const summary = `Read ${Object.keys(updates).length} file(s): ${Object.keys(updates).join(', ')}`;
    return { codeContext: updates, currentStepOutput: summary, stepsResults: { [currentStepId]: summary } };
  }

  // ── bash ─────────────────────────────────────────────────
  if (step.kind === 'bash') {
    const match = step.title.match(/^Run:\s*(.+)$/i);
    const command = match?.[1] ?? step.title;
    debug('[executor:toolExecutor] bash command:', command);
    const output = await bashTool.invoke({ command }, { configurable: { cwd } });
    const out = typeof output === 'string' ? output : JSON.stringify(output);
    return { currentStepOutput: out, stepsResults: { [currentStepId]: out } };
  }

  // ── edit / create / delete ───────────────────────────────
  if (step.kind === 'edit') {
    const result = await executeEditStep(state, step);
    return { ...result, stepsResults: { [currentStepId]: result.currentStepOutput } };
  }
  if (step.kind === 'create') {
    const result = await executeCreateStep(state, step);
    return { ...result, stepsResults: { [currentStepId]: result.currentStepOutput } };
  }
  if (step.kind === 'delete') {
    const result = await executeDeleteStep(state, step);
    return { ...result, stepsResults: { [currentStepId]: result.currentStepOutput } };
  }

  return { currentStepOutput: `Unknown step kind: ${step.kind}` };
};
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executorLoop.test.ts --testNamePattern="toolExecutor — inspect|toolExecutor — bash" 2>&1 | tail -10
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/toolExecutor.ts __tests__/agent/executorLoop.test.ts
git commit -m "feat: toolExecutor — inspect and bash step kinds"
```

---

## Task 9: toolExecutor — edit kind (mini-reader + apply hints)

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/toolExecutor.ts`

- [ ] **Step 1: Implement executeEditStep**

Replace the forward declaration `executeEditStep` in `toolExecutor.ts` with the real implementation. Add these imports at the top of the file:

```typescript
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import { resolveAstEdit, editFileTool } from '@robocode-packages/tools';
import { getModel } from '../../../utils/model';
import { MINI_READER_SYSTEM, buildMiniReaderHuman } from '../../../prompts/sub/executor';
import type { ExecutorHint } from '@robocode-packages/shared';
import { MiniReaderOutputSchema } from '@robocode-packages/shared';
```

Replace the `executeEditStep` stub with:

```typescript
async function executeEditStep(
  state: ExecutorStateType,
  step: { id: string; title: string; files: string[]; expected_output: string }
): Promise<{ currentStepOutput: string; codeContext: Record<string, string> }> {
  const { cwd, codeContext, retryCounts, currentStepOutput, userHint } = state;
  const retryContext = retryCounts[step.id] > 0 ? (currentStepOutput ?? undefined) : undefined;
  const hint = userHint ?? undefined;

  // Phase 1: ensure all step files are in codeContext
  const fileUpdates: Record<string, string> = {};
  for (const file of step.files) {
    if (!(file in codeContext)) {
      const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
      if (fs.existsSync(abs)) {
        const content = fs.readFileSync(abs, 'utf-8');
        fileUpdates[file] = content;
      }
    }
  }
  const fullContext = { ...codeContext, ...fileUpdates };
  const relevantContext: Record<string, string> = {};
  for (const file of step.files) {
    if (fullContext[file]) relevantContext[file] = fullContext[file];
  }

  // Phase 2: mini-reader LLM call → operation hints (AST-first)
  const model = getModel(false).withStructuredOutput(MiniReaderOutputSchema, { name: 'hints' });
  const retryMsg = retryContext ? `${retryContext}${hint ? `\nUser guidance: ${hint}` : ''}` : undefined;
  const { hints } = await model.invoke([
    new SystemMessage(MINI_READER_SYSTEM),
    new HumanMessage(buildMiniReaderHuman(step.title, step.expected_output, relevantContext, retryMsg)),
  ]);

  // Phase 3: apply hints
  const applied: string[] = [];
  for (const hint of hints as ExecutorHint[]) {
    const abs = path.isAbsolute(hint.file) ? hint.file : path.resolve(cwd, hint.file);
    const fileContent = fullContext[hint.file] ?? (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : '');

    try {
      if (['replace_node', 'insert_node', 'remove_node', 'rename_symbol'].includes(hint.op)) {
        const astEdit = {
          mode: 'ast' as const,
          action: hint.op === 'replace_node' ? 'replace' : hint.op === 'insert_node' ? 'insert' : hint.op === 'remove_node' ? 'remove' : 'rename',
          nodeType: hint.nodeType ?? '',
          symbol: hint.symbol ?? '',
          newSymbol: hint.newSymbol ?? undefined,
          afterSnippet: hint.newContent ?? '',
          lines: null,
        } as Parameters<typeof resolveAstEdit>[0];
        const { oldStr, newStr } = await resolveAstEdit(astEdit, abs, fileContent);
        await editFileTool.invoke({ path: abs, old_str: oldStr, new_str: newStr });
        applied.push(`${hint.op} ${hint.symbol ?? ''} in ${hint.file}`);
      } else if (['replace_text', 'remove_text'].includes(hint.op)) {
        const oldStr = hint.anchor ?? '';
        const newStr = hint.op === 'remove_text' ? '' : (hint.newContent ?? '');
        await editFileTool.invoke({ path: abs, old_str: oldStr, new_str: newStr });
        applied.push(`${hint.op} in ${hint.file}`);
      } else if (hint.op === 'insert_text') {
        const anchor = hint.anchor ?? '';
        await editFileTool.invoke({ path: abs, old_str: anchor, new_str: anchor + '\n' + (hint.newContent ?? '') });
        applied.push(`insert_text in ${hint.file}`);
      } else if (hint.op === 'rename_file' && hint.newContent) {
        const newAbs = path.isAbsolute(hint.newContent) ? hint.newContent : path.resolve(cwd, hint.newContent);
        fs.renameSync(abs, newAbs);
        applied.push(`rename_file ${hint.file} → ${hint.newContent}`);
      }
    } catch (err) {
      applied.push(`ERROR applying ${hint.op} in ${hint.file}: ${String(err).slice(0, 120)}`);
    }
  }

  const output = `Applied ${applied.length} hint(s):\n${applied.join('\n')}`;
  return { currentStepOutput: output, codeContext: fileUpdates };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -10
```

Expected: no errors in new files.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/toolExecutor.ts
git commit -m "feat: toolExecutor — edit kind with mini-reader LLM call and AST-first hint application"
```

---

## Task 10: toolExecutor — create + delete

**Files:**
- Modify: `packages/agent/src/nodes/sub/executor/toolExecutor.ts`

- [ ] **Step 1: Implement executeCreateStep and executeDeleteStep**

Replace the `executeCreateStep` and `executeDeleteStep` stubs in `toolExecutor.ts` with:

Add to imports at top:
```typescript
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { writeFileTool } from '@robocode-packages/tools';
import { CREATE_FILE_SYSTEM, buildCreateFileHuman } from '../../../prompts/sub/executor';
```

Replace `executeCreateStep`:
```typescript
async function executeCreateStep(
  state: ExecutorStateType,
  step: { id: string; title: string; files: string[] }
): Promise<{ currentStepOutput: string }> {
  const { cwd, codeContext } = state;
  const targetFile = step.files[0];
  if (!targetFile) return { currentStepOutput: 'Error: no target file for create step' };

  const abs = path.isAbsolute(targetFile) ? targetFile : path.resolve(cwd, targetFile);

  // If file already exists, fall back to edit
  if (fs.existsSync(abs)) {
    const editResult = await executeEditStep(state, { ...step, expected_output: step.title });
    return editResult;
  }

  // Find adjacent files for pattern reference
  const dir = path.dirname(abs);
  const adjacentFiles: Record<string, string> = {};
  try {
    const siblings = fs.readdirSync(dir).filter(f => f.endsWith('.ts') || f.endsWith('.tsx')).slice(0, 3);
    for (const sib of siblings) {
      const sibPath = path.join(dir, sib);
      adjacentFiles[path.relative(cwd, sibPath)] = fs.readFileSync(sibPath, 'utf-8').slice(0, 3000);
    }
  } catch { /* dir may not exist yet */ }

  const model = getModel(false);
  const result = await model.invoke([
    new SystemMessage(CREATE_FILE_SYSTEM),
    new HumanMessage(buildCreateFileHuman(step.title, targetFile, { ...codeContext, ...adjacentFiles })),
  ]);

  const content = typeof result.content === 'string' ? result.content : String(result.content);
  await writeFileTool.invoke({ path: abs, content });
  return { currentStepOutput: `Created ${targetFile} (${content.split('\n').length} lines)` };
}
```

Replace `executeDeleteStep`:
```typescript
async function executeDeleteStep(
  state: ExecutorStateType,
  step: { id: string; files: string[] }
): Promise<{ currentStepOutput: string }> {
  const { cwd, autoApprove, sessionId } = state;
  const file = step.files[0];
  if (!file) return { currentStepOutput: 'Error: no file specified for delete step' };
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);

  if (!autoApprove) {
    const pendingToolCall = { id: crypto.randomUUID(), name: 'delete_file', args: { path: abs }, risk: 'destructive' as const, description: `Delete ${file}` };
    EventBus.emit('agent:tool_pending', { sessionId, toolCall: pendingToolCall, source: 'git' as const });
    const decision = interrupt({ type: 'delete_confirmation', file });
    if (decision !== 'approve' && decision !== 'y') {
      return { currentStepOutput: `Delete of ${file} rejected by user` };
    }
  }

  if (fs.existsSync(abs)) {
    fs.unlinkSync(abs);
    return { currentStepOutput: `Deleted ${file}` };
  }
  return { currentStepOutput: `File not found: ${file}` };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/toolExecutor.ts
git commit -m "feat: toolExecutor — create and delete step kinds"
```

---

## Task 11: summarizer node + node barrel export

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/summarizer.ts`
- Create: `packages/agent/src/nodes/sub/executor/index.ts`

- [ ] **Step 1: Create summarizer**

Create `packages/agent/src/nodes/sub/executor/summarizer.ts`:

```typescript
import { EventBus } from '@robocode-packages/core';
import { runGit, debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../main/subagents/executor/state';
import type { StepResult } from '@robocode-packages/shared';

export const summarizerNode = async (state: ExecutorStateType) => {
  const { plan, dynamicSteps, stepsState, stepsResults, cwd, sessionId } = state;
  const allSteps = [...(plan?.steps ?? []), ...dynamicSteps];

  // Collect changed files from git diff
  const diffStat = await runGit('diff --name-only HEAD', cwd).catch(() => '');
  const changedFiles = diffStat
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // Build per-step result table
  const stepsResult: StepResult[] = allSteps.map(step => ({
    stepId: step.id,
    status: (stepsState[step.id] ?? 'skipped') as StepResult['status'],
    output: stepsResults[step.id] ?? '',
    retries: 0,
  }));

  const done = stepsResult.filter(r => r.status === 'done').length;
  const failed = stepsResult.filter(r => r.status === 'failed').length;
  const skipped = stepsResult.filter(r => r.status === 'skipped').length;

  const summary = [
    `Execution complete: ${done} done, ${failed} failed, ${skipped} skipped.`,
    changedFiles.length > 0 ? `Changed files: ${changedFiles.join(', ')}` : 'No files changed.',
  ].join(' ');

  debug('[executor:summarizer]', summary);
  EventBus.emit('agent:execution_complete', { sessionId, summary, changedFiles, stepsResult });

  return {
    executionSummary: summary,
    executionChangedFiles: changedFiles,
    executionStepsResult: stepsResult,
  };
};
```

- [ ] **Step 2: Create node barrel export**

Create `packages/agent/src/nodes/sub/executor/index.ts`:

```typescript
export * from './initialize';
export * from './stepSelector';
export * from './toolExecutor';
export * from './stepReviewer';
export * from './askUser';
export * from './summarizer';
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/summarizer.ts packages/agent/src/nodes/sub/executor/index.ts
git commit -m "feat: summarizerNode — diff, step results, execution_complete event"
```

---

## Task 12: Executor subgraph + ExecutorAgent

**Files:**
- Create: `packages/agent/src/main/subagents/executor/graph.ts`
- Create: `packages/agent/src/main/subagents/executor/index.ts`

- [ ] **Step 1: Create executor graph**

Create `packages/agent/src/main/subagents/executor/graph.ts`:

```typescript
import { StateGraph, START, END } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
import { ExecutorState } from './state';
import {
  initializeNode,
  stepSelectorNode, afterStepSelector,
  toolExecutorNode,
  stepReviewerNode, afterStepReviewer,
  askUserNode, afterAskUser,
  summarizerNode,
} from '../../nodes/sub/executor';

export function createExecutorGraph() {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(ExecutorState)
    .addNode('initialize', initializeNode)
    .addNode('step_selector', stepSelectorNode)
    .addNode('tool_executor', toolExecutorNode)
    .addNode('step_reviewer', stepReviewerNode)
    .addNode('ask_user', askUserNode)
    .addNode('summarizer', summarizerNode)
    .addEdge(START, 'initialize')
    .addEdge('initialize', 'step_selector')
    .addConditionalEdges('step_selector', afterStepSelector, {
      tool_executor: 'tool_executor',
      summarizer: 'summarizer',
    })
    .addEdge('tool_executor', 'step_reviewer')
    .addConditionalEdges('step_reviewer', afterStepReviewer, {
      step_selector: 'step_selector',
      tool_executor: 'tool_executor',
      ask_user: 'ask_user',
    })
    .addConditionalEdges('ask_user', afterAskUser, {
      tool_executor: 'tool_executor',
      step_selector: 'step_selector',
    })
    .addEdge('summarizer', END);

  return graph.compile({ checkpointer });
}

export const executorGraph = createExecutorGraph();
```

- [ ] **Step 2: Create ExecutorAgent singleton**

Create `packages/agent/src/main/subagents/executor/index.ts`:

```typescript
import { Agent } from '../../base';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { IAgent } from '@robocode-packages/shared';
import type { CompiledGraphType } from '@langchain/langgraph';
import type { Plan } from '@robocode-packages/shared';
import { executorGraph } from './graph';

export interface ExecutorTask {
  plan: Plan;
  sessionId: string;
  cwd: string;
  autoApprove?: boolean;
  config?: RunnableConfig;
}

export class ExecutorAgent extends Agent<CompiledGraphType> implements IAgent<CompiledGraphType> {
  name = 'executor';
  static instance: ExecutorAgent;

  constructor(model: CompiledGraphType) { super(model); }

  public async run(params: ExecutorTask) {
    if (!this.session) throw new Error('Session not set. Call setSession(sessionId) before running.');
    const config = params.config
      ? { ...params.config, configurable: { ...(params.config.configurable ?? {}), ...(this.config.configurable ?? {}) } }
      : this.config;

    return this.graphOrModel.invoke(
      {
        plan: params.plan,
        sessionId: params.sessionId,
        cwd: params.cwd ?? this.session.cwd,
        autoApprove: params.autoApprove ?? false,
      },
      config
    );
  }

  public static getInstance(model: CompiledGraphType) {
    if (!ExecutorAgent.instance) ExecutorAgent.instance = new ExecutorAgent(model);
    return ExecutorAgent.instance;
  }
}

export const executorAgent = ExecutorAgent.getInstance(executorGraph);
export * from './state';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/main/subagents/executor/graph.ts packages/agent/src/main/subagents/executor/index.ts
git commit -m "feat: executor subgraph and ExecutorAgent singleton"
```

---

## Task 13: delegateExecutor root node

**Files:**
- Create: `packages/agent/src/nodes/root/delegateExecutor.ts`

- [ ] **Step 1: Create delegateExecutor**

Create `packages/agent/src/nodes/root/delegateExecutor.ts`:

```typescript
import { debug } from '@robocode-packages/shared';
import { executorAgent } from '../../main/subagents/executor';
import type { RootStateType } from '../../main/root';

export const delegateExecutorNode = async (state: RootStateType) => {
  const { plan, sessionId, cwd, autoApprove } = state;

  if (!plan) {
    debug('[delegateExecutor] no plan — skipping');
    return {};
  }

  debug('[delegateExecutor] starting executor with', plan.steps.length, 'steps');

  // Delete stale executor checkpoint so each plan starts from clean state.
  await executorAgent.deleteCheckpoint();

  try {
    const result = await executorAgent.run({ plan, sessionId, cwd, autoApprove: autoApprove ?? false });
    return {
      executionSummary: result.executionSummary ?? null,
      executionChangedFiles: result.executionChangedFiles ?? [],
      executionStepsResult: result.executionStepsResult ?? [],
    };
  } catch (err: unknown) {
    const isInterrupt =
      err != null && typeof err === 'object' && 'name' in err &&
      (err as { name: string }).name === 'GraphInterrupt';
    if (!isInterrupt) throw err;
    debug('[delegateExecutor] executor interrupted — awaiting user input');
    return {};
  }
};
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -10
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/root/delegateExecutor.ts
git commit -m "feat: delegateExecutorNode — runs executor subgraph, handles interrupt"
```

---

## Task 14: Root graph wiring + planApproval + buildGitIntent + planner prompt

**Files:**
- Modify: `packages/agent/src/main/root/graph.ts`
- Modify: `packages/agent/src/main/root/state.ts`
- Modify: `packages/agent/src/nodes/planApproval.ts`
- Modify: `packages/agent/src/nodes/root/buildGitIntent.ts`
- Modify: `packages/agent/src/prompts/planner.ts`

- [ ] **Step 1: Add execution output fields to RootState**

In `packages/agent/src/main/root/state.ts`, add to imports (add `StepResult` to the shared import line). Then add inside `Annotation.Root({...})`:

```typescript
executionSummary: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
executionChangedFiles: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),
executionStepsResult: Annotation<StepResult[]>({ reducer: (_, n) => n, default: () => [] }),
```

- [ ] **Step 2: Update planApproval to route to executor_loop**

In `packages/agent/src/nodes/planApproval.ts`, find the two `goto` values that route to `'reader'` or `'edit_intent'` and replace both with `'executor_loop'`:

```typescript
// Replace this:
if (!plan) {
  return new Command({ goto: 'edit_intent', update: { planApproved: true } });
}
// With:
if (!plan) {
  return new Command({ goto: 'executor_loop', update: { planApproved: true } });
}

// Replace this at the end:
const nonInspectSteps = plan.steps.filter((s) => s.kind !== 'inspect');
const nextNode = nonInspectSteps.length > 0 ? 'reader' : 'edit_intent';
return new Command({ goto: nextNode, update: { planApproved: true, plan } });
// With:
return new Command({ goto: 'executor_loop', update: { planApproved: true, plan } });
```

- [ ] **Step 3: Update buildGitIntent to use executionChangedFiles**

In `packages/agent/src/nodes/root/buildGitIntent.ts`, update the `filesToStage` derivation:

```typescript
// Replace:
const filesToStage = [...new Set(editorAppliedFiles)];
// With:
const filesToStage = [...new Set(state.executionChangedFiles?.length ? state.executionChangedFiles : state.editorAppliedFiles)];
```

Also destructure `executionChangedFiles` from state — check the current destructuring line and add it.

- [ ] **Step 4: Update planner prompt for bash step format**

In `packages/agent/src/prompts/planner.ts`, add to the Rules section:

```typescript
// In the rules string, add after "Always include a verification step...":
`- For bash steps (kind: 'bash'), write the command in the title with prefix "Run: " e.g. "Run: npx tsc --noEmit" or "Run: pnpm test src/foo.test.ts".
- Each step is executed independently in a DAG — be explicit about file paths and symbol names in each step's title and expected_output.`
```

- [ ] **Step 5: Rewrite root graph**

Replace the full contents of `packages/agent/src/main/root/graph.ts`:

```typescript
import { StateGraph, END, START } from '@langchain/langgraph';
import { RootState, type RootStateType } from './state';
import { Checkpointer } from '@robocode-packages/core';
import { contextNode, routerIntentNode } from '../../nodes/root';
import { collectRouterAnswersNode, collectRouterAnswersRouter } from '../../nodes/root/collectRouterAnswers';
import { collectPlannerAnswersNode, collectPlannerAnswersRouter } from '../../nodes/root/collectPlannerAnswers';
import { plannerNode, plannerRouter } from '../../nodes/planner';
import { planApprovalNode } from '../../nodes/planApproval';
import { delegateExecutorNode } from '../../nodes/root/delegateExecutor';
import { buildGitIntentNode } from '../../nodes/root/buildGitIntent';
import { delegateGitNode } from '../../nodes/root/delegateGit';
import { routerIntentAgent } from '../subagents/routerIntent';
import { fileSelectorGraph } from '../subagents/fileSelector';

export const buildGraph = () => {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(RootState)
    .addNode('context_selector', contextNode)
    .addNode('router_intent', routerIntentNode(routerIntentAgent))
    .addNode('collect_router_answers', collectRouterAnswersNode)
    .addNode('file_selector', async (state: RootStateType) => {
      const result = await fileSelectorGraph.invoke({
        goal: state.routerIntent.userRequest,
        keywords: state.routerIntent.keywords,
        cwd: state.cwd,
        sessionId: state.sessionId,
      });
      return { selectedFiles: result.selectedFiles };
    })
    .addNode('planner', plannerNode)
    .addNode('collect_planner_answers', collectPlannerAnswersNode)
    .addNode('plan_approval', planApprovalNode)
    .addNode('executor_loop', delegateExecutorNode)
    .addNode('build_git_intent', buildGitIntentNode)
    .addNode('delegate_git', delegateGitNode)
    .addEdge(START, 'context_selector')
    .addEdge('context_selector', 'router_intent')
    .addConditionalEdges('router_intent', collectRouterAnswersRouter)
    .addEdge('collect_router_answers', 'router_intent')
    .addEdge('file_selector', 'planner')
    .addConditionalEdges('planner', plannerRouter)
    .addConditionalEdges('collect_planner_answers', collectPlannerAnswersRouter)
    // plan_approval always returns Command({goto}) — no addEdge needed
    .addEdge('executor_loop', 'build_git_intent')
    .addEdge('build_git_intent', 'delegate_git')
    .addEdge('delegate_git', END);

  return graph.compile({ checkpointer });
};

export const agent = buildGraph();
```

- [ ] **Step 6: Delete removed files**

```bash
rm packages/agent/src/nodes/root/reader.ts
rm packages/agent/src/nodes/root/collectReaderAnswers.ts
rm packages/agent/src/nodes/root/editIntent.ts
rm -rf packages/agent/src/nodes/root/editIntent/
rm packages/agent/src/nodes/root/delegateWriter.ts
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -20
```

Expected: no errors in source files. (Pre-existing test file errors are acceptable.)

- [ ] **Step 8: Run full test suite**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass. Tests that referenced deleted nodes (reader, editIntent, delegateWriter) will fail — fix by removing those test cases or updating imports.

- [ ] **Step 9: Commit**

```bash
git add packages/agent/src/main/root/graph.ts packages/agent/src/main/root/state.ts packages/agent/src/nodes/planApproval.ts packages/agent/src/nodes/root/buildGitIntent.ts packages/agent/src/prompts/planner.ts
git commit -m "feat: wire executor_loop into root graph, remove reader/editIntent/delegateWriter pipeline"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: all packages build without errors.

- [ ] **Step 2: Full test suite**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3: TypeScript across all packages**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json && \
npx tsc --noEmit --project packages/config/tsconfig.json && \
npx tsc --noEmit --project packages/tools/tsconfig.json && \
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "node_modules" | grep -v "__tests__" | head -20
```

Expected: no errors in source files.

- [ ] **Step 4: Lint**

```bash
pnpm lint 2>&1 | grep "packages/agent/src/nodes/sub/executor\|packages/agent/src/main/subagents/executor\|packages/shared/src/schemas/executor" | grep "error" | head -20
```

Fix any lint errors in new files.

- [ ] **Step 5: Commit lint fixes if needed**

```bash
git add -p
git commit -m "chore: lint fixes in executor loop implementation"
```
