# Pipeline Refactor: Context → Router Intent → File Selector → Planner → Reader (per step) → Edit Intent

**Date:** 2026-05-27  
**Status:** Approved

---

## Goal

Refactor the root graph pipeline so it runs end-to-end from a user request to a structured `EditIntent`. The pipeline has six stages, each with optional human-in-the-loop clarification:

```
context_selector
  → router_intent → [collect_router_answers loop]
  → file_selector
  → planner → [collect_planner_answers loop]
  → plan_approval
  → step_reader (once per non-inspect plan step) → [collect_reader_answers loop]
  → advance_step (loop back or proceed)
  → edit_intent
  → END
```

Three problems drive this refactor:

1. `routerIntent` clarification is architecturally broken — it uses a subgraph interrupt that the root graph cannot observe, so the root proceeds with incomplete intent data.
2. Clarification events are inconsistent — `routerIntent` uses a bespoke event pair; planner and reader each have their own shape. The frontend has to handle three different patterns.
3. The reader subagent is not wired into the root graph at all, and `editIntentNode` falls back to parsing raw message content instead of reading structured state.

---

## Architecture

### Full Root Graph

```
START
  → context_selector
  → router_intent
  --[needsClarification=true]--> collect_router_answers → router_intent  (loop until clear)
  --[needsClarification=false]--> file_selector
  → planner
  --[has clarifying_questions, no answers yet]--> collect_planner_answers → planner  (loop)
  --[clear or answers present]--> plan_approval
  → step_reader
  --[readerOutput.unresolved_questions > 0]--> collect_reader_answers  (loop)
  --[no questions]--> advance_step
  collect_reader_answers --[all answered]--> advance_step
  advance_step --[more non-inspect steps remain]--> step_reader
  advance_step --[all steps done]--> edit_intent
  → END
```

### Clarification Contract (unified)

All three clarification nodes share one event shape and one resume path:

**Emit:** `agent:question_pending`

```ts
{
  sessionId: string;
  question: string;
  questionIndex: number;
  totalQuestions: number;
  type: 'router_intent' | 'planner' | 'reader';
}
```

**Resume:** `agent:resume:clarification` → `RoboAgent.resumeClarification()` → `agent.invoke(new Command({ resume: answer }), rootConfig)`

This means the frontend needs exactly one question handler and one resume call regardless of which stage is asking.

---

## Component Changes

### 1. routerIntent subgraph — simplify to pure classifier

**Files changed:**

`packages/agent/src/main/subagents/routerIntent/graph.ts`

- Remove `clarification` node and conditional edge
- Remove `Checkpointer` (no interrupt in subgraph anymore)
- Graph: `START → agent → END`

`packages/agent/src/main/subagents/routerIntent/state.ts`

- Remove `question` field
- Remove `answer` field
- Remaining fields: `messages`, `sessionId`, `context`, `cwd`, `intent`

`packages/agent/src/nodes/sub/routerIntent/agent.ts`

- Return `{ intent }` only — drop `question` from return value

`packages/agent/src/nodes/sub/routerIntent/clarification.ts`

- **Delete** — clarification moves to root graph

`packages/agent/src/main/subagents/routerIntent/router.ts`

- **Delete** — no conditional routing in subgraph

`packages/agent/src/main/subagents/routerIntent/index.ts` (RouterIntentAgent class)

- Remove `resume()` method
- Remove `EventBus.on('agent:clarification:router-intent:answer', ...)` listener
- Update `run()` — no longer needs to omit `answer` from params type

### 2. Shared event contract

`packages/shared/src/types/event.ts`

- Remove `agent:clarification:router-intent:question`
- Remove `agent:clarification:router-intent:answer`
- Update `agent:question_pending` — add `type: 'router_intent' | 'planner' | 'reader'`

### 3. Root graph — new nodes + full rewiring

#### Fix: `nodes/root/routerIntent.ts`

- Accept `RootStateType` (current code uses `RouterIntentStateType` — type bug)
- Before calling `agent.run()`, inject `answeredClarificationQuestions` as a context block appended to the last user message:
  ```
  Previously answered clarifications:
  Q: <question>
  A: <answer>
  ...
  ```
- Return `{ routerIntent: result.intent }` — not the whole subgraph state (current code returns the full state object, mismatching `RootState.routerIntent: IntentRouterSchemaType`)

#### New: `nodes/root/collectRouterAnswers.ts`

```ts
export const collectRouterAnswersNode = async (state: RootStateType) => {
  const question = state.routerIntent?.question;
  if (!question) return {};

  EventBus.emit('agent:question_pending', {
    sessionId: state.sessionId,
    question,
    questionIndex: (state.answeredClarificationQuestions?.length ?? 0) + 1,
    totalQuestions: (state.answeredClarificationQuestions?.length ?? 0) + 1,
    type: 'router_intent',
  });

  const answer = interrupt({ type: 'router_intent', question });

  return {
    answeredClarificationQuestions: [
      ...(state.answeredClarificationQuestions ?? []),
      { question, answer: String(answer) },
    ],
  };
};
```

Direct edge back to `router_intent` (always re-classify after answering).

#### Fix: `nodes/root/collectPlannerAnswers.ts`

- Add `type: 'planner'` to `agent:question_pending` emit

#### New: `nodes/root/stepReader.ts`

- Filter plan steps: `nonInspectSteps = state.plan.steps.filter(s => s.kind !== 'inspect')`
- Get current step: `nonInspectSteps[state.currentPlanStepIndex]`
- Call `readerAgent.run()`:
  ```ts
  {
    task: `${currentStep.title}. Expected: ${currentStep.expected_output}`,
    focus: [...currentStep.files, ...state.selectedFiles],
    user_goal: state.plan.goal,
    current_plan_step: currentStep.title,
    instructions: [...state.plan.constraints, ...state.plan.assumptions].join('\n'),
  }
  ```
- Return `{ readerOutput: result.editIntentInputPayload, readerOutputs: [...(state.readerOutputs ?? []), result.editIntentInputPayload] }`
- Router: `readerOutput.unresolved_questions.length > 0` → `collect_reader_answers`; else → `advance_step`

#### New: `nodes/root/advanceStep.ts`

- Increment `currentPlanStepIndex`
- Reset `readerOutput: null` only — do NOT reset `answeredReaderQuestions` (they accumulate across steps so `editIntentNode` sees all Q&A)
- Router: `nonInspectSteps[newIndex]` exists → `step_reader`; else → `edit_intent`

#### Fix: `nodes/root/collectReaderAnswers.ts`

- Remove `parseReaderPayload(lastMsg?.content)` — read from `state.readerOutput` directly
- Add `type: 'reader'` to `agent:question_pending` emit
- When computing `nextIdx`, filter `answeredReaderQuestions` to only entries whose `question` appears in `state.readerOutput.unresolved_questions` — this correctly handles accumulated answers from previous steps without a reset
- Router: more questions for this step → `collect_reader_answers`; all answered → `advance_step`

#### Root graph wiring (`main/root/graph.ts`)

Replace current `plan_approval → debug → END` with:

```
plan_approval → step_reader
step_reader --[conditional]--> collect_reader_answers | advance_step
collect_reader_answers --[loop/conditional]--> collect_reader_answers | advance_step
advance_step --[conditional]--> step_reader | edit_intent
edit_intent → END
```

Remove `debug` node.

Also add:

```
router_intent --[conditional]--> collect_router_answers | file_selector
collect_router_answers --[direct edge]--> router_intent
```

### 4. RootState additions

`packages/agent/src/main/root/state.ts`

```ts
currentPlanStepIndex: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
readerOutputs: Annotation<ReaderOutput[]>({ reducer: (_, n) => n, default: () => [] }),
editIntent: Annotation<IntentSchema | null>({ reducer: (_, n) => n, default: () => null }),
```

`readerOutput` (already exists) is reused as the per-step working slot; it gets reset to `null` by `advanceStep` between steps.

### 5. editIntentNode — clean up and adapt to readerOutputs array

`packages/agent/src/nodes/root/editIntent.ts`

- Remove the message-parsing fallback (`lastMessage.content` JSON parse path) — always use `state.readerOutputs`
- If `state.readerOutputs` is empty (all plan steps were `inspect`-only), return `{ editIntent: null }` early
- Merge evidence across all step outputs before invoking the LLM:
  ```ts
  const merged: ReaderOutput = {
    ...readerOutputs[readerOutputs.length - 1], // base: last output's metadata
    key_findings: readerOutputs.flatMap((o) => o.key_findings ?? []),
    functions: readerOutputs.flatMap((o) => o.functions ?? []),
    classes: readerOutputs.flatMap((o) => o.classes ?? []),
    imports: readerOutputs.flatMap((o) => o.imports ?? []),
    references: readerOutputs.flatMap((o) => o.references ?? []),
  };
  ```
- `answeredReaderQuestions` from state covers all steps (they accumulate across advances)
- Store result in `state.editIntent`
- The `EDIT_INTENT_SYSTEM_PROMPT` and `EDIT_INTENT_HUMAN_PROMPT` are unchanged — they already accept `ReaderOutput`

### 6. RoboAgent cleanup

`packages/agent/src/index.ts`

- Remove `EventBus.onPattern('agent:clarification:*:answer', ...)` handler (this was the broken routerIntent resume path)
- `resumeClarification` (listens on `agent:resume:clarification`) already handles the root graph resume — no changes needed

---

## State Field Reference (complete)

| Field                            | Type                     | Owner                   | Reset by                                   |
| -------------------------------- | ------------------------ | ----------------------- | ------------------------------------------ |
| `context`                        | `ProjectContext`         | context_selector        | —                                          |
| `routerIntent`                   | `IntentRouterSchemaType` | router_intent           | —                                          |
| `answeredClarificationQuestions` | `{question,answer}[]`    | collect_router_answers  | —                                          |
| `selectedFiles`                  | `string[]`               | file_selector           | —                                          |
| `plan`                           | `Plan \| null`           | planner                 | —                                          |
| `answeredPlannerQuestions`       | `{question,answer}[]`    | collect_planner_answers | —                                          |
| `planApproved`                   | `boolean`                | plan_approval           | —                                          |
| `currentPlanStepIndex`           | `number`                 | advance_step            | —                                          |
| `readerOutput`                   | `ReaderOutput \| null`   | step_reader             | advance_step (→ null)                      |
| `readerOutputs`                  | `ReaderOutput[]`         | step_reader             | —                                          |
| `answeredReaderQuestions`        | `{question,answer}[]`    | collect_reader_answers  | never reset — accumulates across all steps |
| `editIntent`                     | `IntentSchema \| null`   | edit_intent             | —                                          |

---

## Files Created

| Path                                                    | Description                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/agent/src/nodes/root/collectRouterAnswers.ts` | New clarification node for router intent                                         |
| `packages/agent/src/nodes/root/stepReader.ts`           | Runs reader for one plan step                                                    |
| `packages/agent/src/nodes/root/advanceStep.ts`          | Increments step index, resets per-step state, routes to next step or edit_intent |

## Files Deleted

| Path                                                         | Reason                                     |
| ------------------------------------------------------------ | ------------------------------------------ |
| `packages/agent/src/nodes/sub/routerIntent/clarification.ts` | Clarification moved to root graph          |
| `packages/agent/src/main/subagents/routerIntent/router.ts`   | Subgraph no longer has conditional routing |

---

## Out of Scope

- Parallel execution of plan steps (DAG `depends_on` evaluation) — sequential processing only for now
- Re-running reader with clarification answers (answers go to `editIntentNode` only)
- Editor subagent wiring (after `editIntent`)
- Git subagent

---

## Verification Checklist

- [ ] `routerIntentGraph` compiles with no checkpointer, no clarification node
- [ ] Single user message → router classifies intent → root graph proceeds to file_selector
- [ ] Ambiguous message → `agent:question_pending` with `type: 'router_intent'` emitted → `agent:resume:clarification` resumes root graph → router re-classifies → proceeds
- [ ] Planner questions use same `agent:question_pending` shape with `type: 'planner'`
- [ ] Plan with 2 edit steps → reader runs twice, `readerOutputs` has 2 entries
- [ ] Plan with 0 non-inspect steps → advance_step skips directly to edit_intent
- [ ] Reader unresolved question → `agent:question_pending` with `type: 'reader'` → resume → advance_step
- [ ] `editIntentNode` receives merged `ReaderOutput`, produces non-null `IntentSchema`
- [ ] TypeScript `tsc --noEmit` passes for `packages/agent` and `packages/shared`
