# Pipeline Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the root graph pipeline from a broken/incomplete state to a fully wired end-to-end flow: context → router_intent (with clarification loop) → file_selector → planner (with clarification loop) → plan_approval → step_reader (once per non-inspect plan step, with clarification loop) → edit_intent.

**Architecture:** All human-in-the-loop clarification is handled via LangGraph `interrupt()` in the root graph (not in subgraphs). A single unified `agent:question_pending` event with a `type` discriminator replaces the bespoke per-stage event pairs. The routerIntent subgraph becomes a pure single-turn LLM classifier with no interrupt logic of its own. The reader runs once per non-inspect plan step, accumulating evidence into `readerOutputs[]`; `editIntentNode` merges all evidence at the end.

**Tech Stack:** LangGraph (`@langchain/langgraph`), LangChain (`@langchain/core`), Zod, TypeScript, pnpm monorepo, Jest

---

## File Map

### Created
- `packages/agent/src/nodes/root/collectRouterAnswers.ts` — clarification node + router for router_intent stage
- `packages/agent/src/nodes/root/stepReader.ts` — runs readerAgent for one plan step + router
- `packages/agent/src/nodes/root/advanceStep.ts` — increments step index, resets per-step reader state, routes to next step or edit_intent
- `__tests__/agent/pipelineRouters.test.ts` — unit tests for all new pure router functions

### Modified
- `packages/shared/src/types/event.ts` — add `type` to `agent:question_pending`; remove `agent:clarification:router-intent:*`
- `packages/agent/src/main/subagents/routerIntent/graph.ts` — remove clarification node + checkpointer; `START → agent → END`
- `packages/agent/src/main/subagents/routerIntent/state.ts` — remove `question` and `answer` fields
- `packages/agent/src/nodes/sub/routerIntent/agent.ts` — return `{ intent }` only
- `packages/agent/src/nodes/sub/routerIntent/index.ts` — remove clarification export
- `packages/agent/src/main/subagents/routerIntent/index.ts` — remove `resume()`, remove event listener, update `run()` signature
- `packages/agent/src/nodes/root/routerIntent.ts` — use `RootStateType`, inject clarification context, return `{ routerIntent: result.intent }`
- `packages/agent/src/nodes/root/collectPlannerAnswers.ts` — add `type: 'planner'` to event emit
- `packages/agent/src/nodes/root/collectReaderAnswers.ts` — read from `state.readerOutput` directly; filter answers by current step; add `type: 'reader'`; router goes to `advance_step`
- `packages/agent/src/nodes/root/editIntent.ts` — remove message-parsing fallback; use `state.readerOutputs[]`; merge evidence; guard empty array
- `packages/agent/src/nodes/planApproval.ts` — update `Command goto` from `'debug'` to `'step_reader'` / `END`
- `packages/agent/src/main/root/state.ts` — add `currentPlanStepIndex`, `readerOutputs`, `editIntent`
- `packages/agent/src/main/root/graph.ts` — full rewire; add new nodes; remove `debug` node
- `packages/agent/src/nodes/root/index.ts` — export new nodes
- `packages/agent/src/index.ts` — remove `onPattern` handler

### Deleted
- `packages/agent/src/nodes/sub/routerIntent/clarification.ts`
- `packages/agent/src/main/subagents/routerIntent/router.ts`

---

## Task 1: Update shared event types

**Files:**
- Modify: `packages/shared/src/types/event.ts`

- [ ] **Step 1: Update `agent:question_pending` and remove router-intent events**

Open `packages/shared/src/types/event.ts`. Make these three changes:

1. Remove `agent:clarification:router-intent:question` and `agent:clarification:router-intent:answer` entries entirely.

2. Update `agent:question_pending` to add the `type` discriminator:

```ts
'agent:question_pending': {
  sessionId: string;
  question: string;
  questionIndex: number;
  totalQuestions: number;
  type: 'router_intent' | 'planner' | 'reader';
};
```

The final file should look like this (showing only the changed/removed lines in context):

```ts
// REMOVE these two lines:
// 'agent:clarification:router-intent:question': { sessionId: string; question: string };
// 'agent:clarification:router-intent:answer': { sessionId: string; answer: string };

// UPDATE this entry:
'agent:question_pending': {
  sessionId: string;
  question: string;
  questionIndex: number;
  totalQuestions: number;
  type: 'router_intent' | 'planner' | 'reader';
};
```

- [ ] **Step 2: Type-check the shared package**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json
```

Expected: no errors. If the agent package references the removed events, those errors are expected and will be fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/event.ts
git commit -m "feat: unify clarification events — add type discriminator to agent:question_pending"
```

---

## Task 2: Simplify routerIntent subgraph

**Files:**
- Modify: `packages/agent/src/main/subagents/routerIntent/state.ts`
- Modify: `packages/agent/src/main/subagents/routerIntent/graph.ts`
- Modify: `packages/agent/src/nodes/sub/routerIntent/agent.ts`
- Modify: `packages/agent/src/nodes/sub/routerIntent/index.ts`
- Modify: `packages/agent/src/main/subagents/routerIntent/index.ts`
- Delete: `packages/agent/src/nodes/sub/routerIntent/clarification.ts`
- Delete: `packages/agent/src/main/subagents/routerIntent/router.ts`

- [ ] **Step 1: Simplify `RouterIntentState` — remove `question` and `answer`**

Replace the entire content of `packages/agent/src/main/subagents/routerIntent/state.ts`:

```ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { ProjectContext, IntentRouterSchemaType } from '@robocode-packages/shared';

export const RouterIntentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  context: Annotation<ProjectContext>({ reducer: (_, n) => n }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => process.cwd() }),
  intent: Annotation<IntentRouterSchemaType | undefined>({ reducer: (_, n) => n }),
});

export type RouterIntentStateType = typeof RouterIntentState.State;
```

- [ ] **Step 2: Simplify `routerIntentAgent` node — return `{ intent }` only**

Replace the entire content of `packages/agent/src/nodes/sub/routerIntent/agent.ts`:

```ts
import { IntentRouterSchema, debug } from '@robocode-packages/shared';
import { createBaseModel } from '../../../utils';
import { ROUTER_INTENT } from '../../../prompts';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { RouterIntentStateType } from '../../../main/subagents/routerIntent';

export const routerIntentAgent = async (state: RouterIntentStateType) => {
  const lastMessage = state.messages.at(-1);

  const model = createBaseModel(true).withStructuredOutput(IntentRouterSchema);
  const userText = lastMessage?.toFormattedString() ?? '';
  const message = new HumanMessage(userText);

  const intent = await model.invoke([new SystemMessage(ROUTER_INTENT(state.context)), message]);
  debug('ROUTER INTENT', intent);
  return { intent };
};
```

- [ ] **Step 3: Simplify `routerIntentGraph` — pure `START → agent → END`, no checkpointer**

Replace the entire content of `packages/agent/src/main/subagents/routerIntent/graph.ts`:

```ts
import { START, StateGraph } from '@langchain/langgraph';
import { routerIntentAgent } from '../../../nodes/sub/routerIntent';
import { RouterIntentState } from './state';

export function createGraph() {
  const graph = new StateGraph(RouterIntentState)
    .addNode('agent', routerIntentAgent)
    .addEdge(START, 'agent');

  return graph.compile();
}

export const routerIntentGraph = createGraph();
```

- [ ] **Step 4: Update `RouterIntentAgent` class — remove `resume()` and event listener**

Replace the entire content of `packages/agent/src/main/subagents/routerIntent/index.ts`:

```ts
import { Agent } from '../../base';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { CompiledGraphType } from '@langchain/langgraph';
import type { IAgent } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';
import { EventBus } from '@robocode-packages/core';
import { routerIntentGraph } from './graph';
import type { RouterIntentStateType } from './state';

export type ReaderTool = StructuredToolInterface;

export class RouterIntentAgent
  extends Agent<CompiledGraphType>
  implements IAgent<CompiledGraphType>
{
  name = 'routerIntent';
  static instance: RouterIntentAgent;

  constructor(model: CompiledGraphType) {
    super(model);
    EventBus.on('agent:set-session', this.setSession.bind(this));
    EventBus.on('agent:delete-checkpoint:reader', this.deleteCheckpoint.bind(this));
    EventBus.on('agent:stop', this.stop.bind(this));
  }

  public async run(params: Omit<RouterIntentStateType, 'intent'>) {
    if (!this.session) {
      throw new Error('Session not set. Call setSession(sessionId) before running the agent.');
    }

    debug('INITIALIZE INTENT', params);

    return this.graphOrModel.invoke(
      {
        messages: params.messages,
        sessionId: this.session.id,
        cwd: this.session?.cwd,
        context: params.context,
      },
      {
        configurable: { thread_id: this.thread },
      }
    );
  }

  public static getInstance(model: CompiledGraphType) {
    if (!RouterIntentAgent.instance) {
      RouterIntentAgent.instance = new RouterIntentAgent(model);
    }
    return RouterIntentAgent.instance;
  }
}

export const routerIntentAgent = RouterIntentAgent.getInstance(routerIntentGraph);
export * from './state';
```

- [ ] **Step 5: Update subagent node index — remove clarification export**

Replace `packages/agent/src/nodes/sub/routerIntent/index.ts`:

```ts
export * from './agent';
```

- [ ] **Step 6: Delete obsolete files**

```bash
rm packages/agent/src/nodes/sub/routerIntent/clarification.ts
rm packages/agent/src/main/subagents/routerIntent/router.ts
```

- [ ] **Step 7: Type-check the agent package**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
```

Expected: errors only in files not yet updated in this plan (`routerIntent.ts` root node, `index.ts` RoboAgent, `graph.ts`). No errors inside the files changed in this task.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/main/subagents/routerIntent/ packages/agent/src/nodes/sub/routerIntent/
git commit -m "refactor: simplify routerIntent subgraph to pure classifier — remove interrupt/clarification"
```

---

## Task 3: Fix routerIntentNode (root)

**Files:**
- Modify: `packages/agent/src/nodes/root/routerIntent.ts`

The current node uses `RouterIntentStateType` (wrong — it runs inside the root graph which uses `RootStateType`), returns the full subgraph state instead of just `intent`, and doesn't inject clarification context.

- [ ] **Step 1: Rewrite `routerIntentNode`**

Replace the entire content of `packages/agent/src/nodes/root/routerIntent.ts`:

```ts
import type { IAgent } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';
import type { CompiledGraphType } from '@langchain/langgraph';
import type { RootStateType } from '../../main/root/state';
import { HumanMessage } from '@langchain/core/messages';

export const routerIntentNode =
  (agent: IAgent<CompiledGraphType>) => async (state: RootStateType) => {
    const { messages, context, cwd, sessionId, answeredClarificationQuestions } = state;

    debug('ROUTER INTENT FROM MAIN', { sessionId, cwd });

    const clarificationBlock =
      answeredClarificationQuestions?.length
        ? `\n\nPreviously answered clarifications:\n${answeredClarificationQuestions
            .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
            .join('\n')}`
        : '';

    const lastMessage = messages.at(-1);
    const enrichedMessages =
      clarificationBlock && lastMessage
        ? [
            ...messages.slice(0, -1),
            new HumanMessage((lastMessage.content as string ?? '') + clarificationBlock),
          ]
        : messages;

    const result = await agent.run({
      messages: enrichedMessages,
      context,
      cwd,
      sessionId,
    });

    debug('ROUTER INTENT RESPONSE', result.intent);
    return { routerIntent: result.intent };
  };
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "routerIntent.ts"
```

Expected: no errors in `nodes/root/routerIntent.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/root/routerIntent.ts
git commit -m "fix: routerIntentNode — use RootStateType, inject clarification context, return intent only"
```

---

## Task 4: Expand RootState

**Files:**
- Modify: `packages/agent/src/main/root/state.ts`

- [ ] **Step 1: Add `currentPlanStepIndex`, `readerOutputs`, `editIntent`**

The current state file has these imports and `Annotation.Root({...})`. Add three new fields. The final state file:

```ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  Plan,
  PendingToolCall,
  ProjectContext,
  ReaderOutput,
  IntentRouterSchemaType,
  IntentSchemaType,
} from '@robocode-packages/shared';

export const RootState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  plan: Annotation<Plan | null>({ reducer: (_, n) => n, default: () => null }),
  context: Annotation<ProjectContext>({ reducer: (_, n) => n }),
  pendingToolCall: Annotation<PendingToolCall | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  toolApproved: Annotation<boolean | null>({ reducer: (_, n) => n, default: () => null }),
  verificationRequired: Annotation<boolean>({
    reducer: (_, n) => n ?? false,
    default: () => false,
  }),
  verificationStatus: Annotation<'pass' | 'fail' | 'skipped' | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  iterationCount: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  planApproved: Annotation<boolean>({ reducer: (_, n) => n ?? false, default: () => false }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => process.cwd() }),
  replanCount: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  readerOutput: Annotation<ReaderOutput | null>({ reducer: (_, n) => n, default: () => null }),
  answeredReaderQuestions: Annotation<{ question: string; answer: string }[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  answeredPlannerQuestions: Annotation<{ question: string; answer: string }[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  answeredClarificationQuestions: Annotation<{ question: string; answer: string }[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  routerIntent: Annotation<IntentRouterSchemaType>({ reducer: (_, n) => n }),
  selectedFiles: Annotation<string[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
  currentPlanStepIndex: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  readerOutputs: Annotation<ReaderOutput[]>({ reducer: (_, n) => n, default: () => [] }),
  editIntent: Annotation<IntentSchemaType | null>({ reducer: (_, n) => n, default: () => null }),
});

export type RootStateType = typeof RootState.State;
```

Note: `IntentSchemaType` must be exported from `@robocode-packages/shared`. Check `packages/shared/src/schemas/editor/intent.ts` — if it exports `IntentSchema` but not `IntentSchemaType`, add: `export type IntentSchemaType = z.infer<typeof IntentSchema>;` there and re-export it from the shared package index.

- [ ] **Step 2: Verify `IntentSchemaType` is exported from shared**

```bash
grep -r "IntentSchemaType\|IntentSchema" packages/shared/src --include="*.ts" | grep "export"
```

If `IntentSchemaType` is not yet exported, add it to wherever `IntentSchema` is defined:

```ts
export type IntentSchemaType = z.infer<typeof IntentSchema>;
```

And ensure it appears in `packages/shared/src/index.ts` or the relevant barrel export.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "state.ts"
```

Expected: no errors in `main/root/state.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/main/root/state.ts packages/shared/src/
git commit -m "feat: add currentPlanStepIndex, readerOutputs, editIntent to RootState"
```

---

## Task 5: Add `collectRouterAnswers` node and write router tests

**Files:**
- Create: `packages/agent/src/nodes/root/collectRouterAnswers.ts`
- Create: `__tests__/agent/pipelineRouters.test.ts`

- [ ] **Step 1: Write failing tests for `collectRouterAnswersRouter`**

Create `__tests__/agent/pipelineRouters.test.ts`:

```ts
import type { RootStateType } from '../../packages/agent/src/main/root/state';

// Minimal state factory — only the fields each router reads
const makeState = (overrides: Partial<RootStateType>): RootStateType =>
  ({ answeredClarificationQuestions: [], answeredReaderQuestions: [], ...overrides }) as unknown as RootStateType;

// ── collectRouterAnswersRouter ─────────────────────────────────────────────
import { collectRouterAnswersRouter } from '../../packages/agent/src/nodes/root/collectRouterAnswers';

describe('collectRouterAnswersRouter', () => {
  it('routes to collect_router_answers when needsClarification is true and question is set', () => {
    const state = makeState({
      routerIntent: { needsClarification: true, question: 'What framework?' } as RootStateType['routerIntent'],
    });
    expect(collectRouterAnswersRouter(state)).toBe('collect_router_answers');
  });

  it('routes to file_selector when needsClarification is false', () => {
    const state = makeState({
      routerIntent: { needsClarification: false, question: '' } as RootStateType['routerIntent'],
    });
    expect(collectRouterAnswersRouter(state)).toBe('file_selector');
  });

  it('routes to file_selector when routerIntent is undefined', () => {
    const state = makeState({ routerIntent: undefined as unknown as RootStateType['routerIntent'] });
    expect(collectRouterAnswersRouter(state)).toBe('file_selector');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "collectRouterAnswersRouter" --no-coverage
```

Expected: FAIL — `collectRouterAnswers` module not found.

- [ ] **Step 3: Create `collectRouterAnswers.ts`**

Create `packages/agent/src/nodes/root/collectRouterAnswers.ts`:

```ts
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '../../main/root/state';

export const collectRouterAnswersNode = async (state: RootStateType) => {
  const question = state.routerIntent?.question;
  if (!question) return {};

  const prevAnswered = state.answeredClarificationQuestions?.length ?? 0;
  debug('[collectRouterAnswers] asking:', question);

  EventBus.emit('agent:question_pending', {
    sessionId: state.sessionId,
    question,
    questionIndex: prevAnswered + 1,
    totalQuestions: prevAnswered + 1,
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

export const collectRouterAnswersRouter = (state: RootStateType): string => {
  if (state.routerIntent?.needsClarification && state.routerIntent?.question) {
    return 'collect_router_answers';
  }
  return 'file_selector';
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "collectRouterAnswersRouter" --no-coverage
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/collectRouterAnswers.ts __tests__/agent/pipelineRouters.test.ts
git commit -m "feat: add collectRouterAnswers node with unified question_pending event"
```

---

## Task 6: Fix `collectPlannerAnswers` and `collectReaderAnswers`

**Files:**
- Modify: `packages/agent/src/nodes/root/collectPlannerAnswers.ts`
- Modify: `packages/agent/src/nodes/root/collectReaderAnswers.ts`

- [ ] **Step 1: Add `type: 'planner'` to `collectPlannerAnswers` emit**

In `packages/agent/src/nodes/root/collectPlannerAnswers.ts`, find the `EventBus.emit('agent:question_pending', {...})` call and add `type: 'planner'`:

```ts
EventBus.emit('agent:question_pending', {
  sessionId,
  question,
  questionIndex: nextIdx + 1,
  totalQuestions: questions.length,
  type: 'planner',
});
```

No other changes to this file.

- [ ] **Step 2: Write failing tests for updated `collectReaderAnswersRouter`**

Add to `__tests__/agent/pipelineRouters.test.ts`:

```ts
// ── collectReaderAnswersRouter ─────────────────────────────────────────────
import { collectReaderAnswersRouter } from '../../packages/agent/src/nodes/root/collectReaderAnswers';

describe('collectReaderAnswersRouter', () => {
  it('loops to collect_reader_answers when current step questions are not fully answered', () => {
    const state = makeState({
      readerOutput: { unresolvedQuestions: ['Q1', 'Q2'] } as RootStateType['readerOutput'],
      answeredReaderQuestions: [{ question: 'Q1', answer: 'A1' }],
    });
    expect(collectReaderAnswersRouter(state)).toBe('collect_reader_answers');
  });

  it('routes to advance_step when all current step questions are answered', () => {
    const state = makeState({
      readerOutput: { unresolvedQuestions: ['Q1'] } as RootStateType['readerOutput'],
      answeredReaderQuestions: [{ question: 'Q1', answer: 'A1' }],
    });
    expect(collectReaderAnswersRouter(state)).toBe('advance_step');
  });

  it('routes to advance_step when no questions exist', () => {
    const state = makeState({
      readerOutput: { unresolvedQuestions: [] } as unknown as RootStateType['readerOutput'],
      answeredReaderQuestions: [],
    });
    expect(collectReaderAnswersRouter(state)).toBe('advance_step');
  });

  it('does not count answers from previous steps toward current step quota', () => {
    // Step 1 had Q_prev answered; step 2 has Q_current unanswered
    const state = makeState({
      readerOutput: { unresolvedQuestions: ['Q_current'] } as RootStateType['readerOutput'],
      answeredReaderQuestions: [{ question: 'Q_prev', answer: 'A_prev' }],
    });
    expect(collectReaderAnswersRouter(state)).toBe('collect_reader_answers');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "collectReaderAnswersRouter" --no-coverage
```

Expected: FAIL — router goes to `edit_intent` (old routing) not `advance_step`.

- [ ] **Step 4: Rewrite `collectReaderAnswers.ts`**

Replace the entire content of `packages/agent/src/nodes/root/collectReaderAnswers.ts`:

```ts
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '../../main/root/state';

export const collectReaderAnswersNode = async (state: RootStateType) => {
  const { sessionId, readerOutput, answeredReaderQuestions = [] } = state;
  const questions = readerOutput?.unresolvedQuestions ?? [];
  if (questions.length === 0) return {};

  // Only count answers for this step's questions (answers from prior steps accumulate in state)
  const currentStepAnswered = answeredReaderQuestions.filter((qa) =>
    questions.includes(qa.question)
  );

  const nextIdx = currentStepAnswered.length;
  const question = questions[nextIdx];
  if (!question) return {};

  debug('[collectReaderAnswers] asking:', question, `(${nextIdx + 1}/${questions.length})`);

  EventBus.emit('agent:question_pending', {
    sessionId,
    question,
    questionIndex: nextIdx + 1,
    totalQuestions: questions.length,
    type: 'reader',
  });

  const answer = interrupt({
    type: 'reader_question',
    question,
    questionIndex: nextIdx + 1,
    totalQuestions: questions.length,
  });

  return {
    answeredReaderQuestions: [...answeredReaderQuestions, { question, answer: String(answer) }],
  };
};

export const collectReaderAnswersRouter = (state: RootStateType): string => {
  const questions = state.readerOutput?.unresolvedQuestions ?? [];
  const currentStepAnswered = (state.answeredReaderQuestions ?? []).filter((qa) =>
    questions.includes(qa.question)
  );
  if (currentStepAnswered.length < questions.length) return 'collect_reader_answers';
  return 'advance_step';
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "collectReaderAnswersRouter" --no-coverage
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/nodes/root/collectPlannerAnswers.ts packages/agent/src/nodes/root/collectReaderAnswers.ts __tests__/agent/pipelineRouters.test.ts
git commit -m "fix: collectPlannerAnswers/collectReaderAnswers — unified events, per-step answer filtering, route to advance_step"
```

---

## Task 7: Add `stepReader` node

**Files:**
- Create: `packages/agent/src/nodes/root/stepReader.ts`

- [ ] **Step 1: Write failing tests for `stepReaderRouter`**

Add to `__tests__/agent/pipelineRouters.test.ts`:

```ts
// ── stepReaderRouter ───────────────────────────────────────────────────────
import { stepReaderRouter } from '../../packages/agent/src/nodes/root/stepReader';

describe('stepReaderRouter', () => {
  it('routes to collect_reader_answers when readerOutput has unresolved questions', () => {
    const state = makeState({
      readerOutput: { unresolvedQuestions: ['Where is auth?'] } as RootStateType['readerOutput'],
    });
    expect(stepReaderRouter(state)).toBe('collect_reader_answers');
  });

  it('routes to advance_step when no unresolved questions', () => {
    const state = makeState({
      readerOutput: { unresolvedQuestions: [] } as unknown as RootStateType['readerOutput'],
    });
    expect(stepReaderRouter(state)).toBe('advance_step');
  });

  it('routes to advance_step when readerOutput is null', () => {
    const state = makeState({ readerOutput: null });
    expect(stepReaderRouter(state)).toBe('advance_step');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "stepReaderRouter" --no-coverage
```

Expected: FAIL — `stepReader` module not found.

- [ ] **Step 3: Create `stepReader.ts`**

Create `packages/agent/src/nodes/root/stepReader.ts`:

```ts
import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '../../main/root/state';
import { readerAgent } from '../../main/subagents/reader';

export const getNonInspectSteps = (state: RootStateType) =>
  (state.plan?.steps ?? []).filter((s) => s.kind !== 'inspect');

export const stepReaderNode = async (state: RootStateType) => {
  const nonInspectSteps = getNonInspectSteps(state);
  const currentStep = nonInspectSteps[state.currentPlanStepIndex ?? 0];
  if (!currentStep) return {};

  debug('[stepReader] running for step:', currentStep.title, `(index ${state.currentPlanStepIndex})`);

  const result = await readerAgent.run({
    task: `${currentStep.title}. Expected outcome: ${currentStep.expected_output}`,
    focus: [...currentStep.files, ...(state.selectedFiles ?? [])],
    user_goal: state.plan!.goal,
    current_plan_step: currentStep.title,
    instructions: [
      ...(state.plan?.constraints ?? []),
      ...(state.plan?.assumptions ?? []),
    ].join('\n'),
  });

  const readerOutput = result.editIntentInputPayload;
  debug('[stepReader] reader output status:', readerOutput?.status);

  return {
    readerOutput,
    readerOutputs: [...(state.readerOutputs ?? []), readerOutput],
  };
};

export const stepReaderRouter = (state: RootStateType): string => {
  if ((state.readerOutput?.unresolvedQuestions?.length ?? 0) > 0) {
    return 'collect_reader_answers';
  }
  return 'advance_step';
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "stepReaderRouter" --no-coverage
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/stepReader.ts __tests__/agent/pipelineRouters.test.ts
git commit -m "feat: add stepReader node — runs readerAgent per non-inspect plan step"
```

---

## Task 8: Add `advanceStep` node

**Files:**
- Create: `packages/agent/src/nodes/root/advanceStep.ts`

- [ ] **Step 1: Write failing tests for `advanceStepRouter`**

Add to `__tests__/agent/pipelineRouters.test.ts`:

```ts
// ── advanceStepRouter ──────────────────────────────────────────────────────
import { advanceStepRouter } from '../../packages/agent/src/nodes/root/advanceStep';

describe('advanceStepRouter', () => {
  const makePlan = (steps: { kind: string }[]) =>
    ({ steps } as unknown as RootStateType['plan']);

  it('routes to step_reader when more non-inspect steps remain after current index', () => {
    const state = makeState({
      plan: makePlan([{ kind: 'edit' }, { kind: 'edit' }]),
      currentPlanStepIndex: 1, // index 1 < length 2
    });
    expect(advanceStepRouter(state)).toBe('step_reader');
  });

  it('routes to edit_intent when all non-inspect steps are processed', () => {
    const state = makeState({
      plan: makePlan([{ kind: 'edit' }]),
      currentPlanStepIndex: 1, // index 1 >= length 1
    });
    expect(advanceStepRouter(state)).toBe('edit_intent');
  });

  it('routes to edit_intent when plan has only inspect steps', () => {
    const state = makeState({
      plan: makePlan([{ kind: 'inspect' }]),
      currentPlanStepIndex: 0,
    });
    expect(advanceStepRouter(state)).toBe('edit_intent');
  });

  it('routes to edit_intent when plan is null', () => {
    const state = makeState({ plan: null, currentPlanStepIndex: 0 });
    expect(advanceStepRouter(state)).toBe('edit_intent');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts -t "advanceStepRouter" --no-coverage
```

Expected: FAIL — `advanceStep` module not found.

- [ ] **Step 3: Create `advanceStep.ts`**

Create `packages/agent/src/nodes/root/advanceStep.ts`:

```ts
import { debug } from '@robocode-packages/shared';
import type { RootStateType } from '../../main/root/state';

const getNonInspectSteps = (state: RootStateType) =>
  (state.plan?.steps ?? []).filter((s) => s.kind !== 'inspect');

export const advanceStepNode = async (state: RootStateType) => {
  const nextIndex = (state.currentPlanStepIndex ?? 0) + 1;
  debug('[advanceStep] advancing to step index:', nextIndex);
  return {
    currentPlanStepIndex: nextIndex,
    readerOutput: null,
  };
};

export const advanceStepRouter = (state: RootStateType): string => {
  const nonInspectSteps = getNonInspectSteps(state);
  if ((state.currentPlanStepIndex ?? 0) < nonInspectSteps.length) {
    return 'step_reader';
  }
  return 'edit_intent';
};
```

- [ ] **Step 4: Run all pipeline router tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/pipelineRouters.test.ts --no-coverage
```

Expected: PASS, all tests (collectRouterAnswersRouter × 3, collectReaderAnswersRouter × 4, stepReaderRouter × 3, advanceStepRouter × 4 = 14 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/advanceStep.ts __tests__/agent/pipelineRouters.test.ts
git commit -m "feat: add advanceStep node — increments step index, routes to step_reader or edit_intent"
```

---

## Task 9: Fix `editIntentNode`

**Files:**
- Modify: `packages/agent/src/nodes/root/editIntent.ts`

- [ ] **Step 1: Rewrite `editIntentNode` to use `readerOutputs[]`**

The node currently has two input paths (answered-questions path reading `state.readerOutput`, and a message-parsing fallback). Both are replaced with a single path reading `state.readerOutputs`. Replace the entire content:

```ts
import type { RootStateType } from '../../main/root';
import {
  buildEditIntent,
  debug,
  IntentSchema,
  ReaderOutputSchema,
} from '@robocode-packages/shared';
import { EDIT_INTENT_SYSTEM_PROMPT, EDIT_INTENT_HUMAN_PROMPT } from '../../prompts/editIntent';
import { createBaseModel } from '../../utils';
import * as fs from 'node:fs';
import * as path from 'node:path';

const normalizeCreateLikeTextInserts = (edits: unknown[], repoRoot: string): unknown[] => {
  return edits.map((edit) => {
    if (!edit || typeof edit !== 'object') return edit;
    const record = edit as Record<string, unknown>;

    if (record.mode !== 'text' || record.action !== 'insert') return edit;

    const insertMode = record.insertMode;
    const hasCreateLikeInsertMode = insertMode === 'start' || insertMode === 'end';
    const hasAnchor = record.anchor != null;
    if (!hasCreateLikeInsertMode || hasAnchor) return edit;

    const file = typeof record.file === 'string' ? record.file : '';
    if (!file) return edit;

    const absPath = path.resolve(repoRoot, file);
    if (fs.existsSync(absPath)) return edit;

    return {
      file,
      lines: record.lines ?? null,
      id: record.id ?? null,
      mode: 'file',
      action: 'insert',
      insertText: typeof record.insertText === 'string' ? record.insertText : '',
      reasoning: typeof record.reasoning === 'string' ? record.reasoning : 'Create missing file.',
    };
  });
};

export const editIntentNode = async (state: RootStateType) => {
  const { readerOutputs = [], answeredReaderQuestions = [] } = state;

  if (readerOutputs.length === 0) {
    debug('[editIntent] no reader outputs — skipping');
    return { editIntent: null };
  }

  // Merge evidence across all step outputs; use last output as the base for metadata
  const base = readerOutputs[readerOutputs.length - 1];
  const merged = ReaderOutputSchema.safeParse({
    ...base,
    key_findings: readerOutputs.flatMap((o) => o.key_findings ?? []),
    functions: readerOutputs.flatMap((o) => o.functions ?? []),
    classes: readerOutputs.flatMap((o) => o.classes ?? []),
    imports: readerOutputs.flatMap((o) => o.imports ?? []),
    references: readerOutputs.flatMap((o) => o.references ?? []),
  });

  if (!merged.success) {
    debug('[editIntent] merged reader output failed validation', merged.error.format());
    return { editIntent: null };
  }

  const output = merged.data;

  const scaffold = buildEditIntent(output);
  debug('[editIntent] scaffold built');

  const model = createBaseModel(true).withStructuredOutput(IntentSchema, {
    method: 'functionCalling',
  });

  try {
    const result = await model.invoke([
      { role: 'system', content: EDIT_INTENT_SYSTEM_PROMPT },
      { role: 'user', content: EDIT_INTENT_HUMAN_PROMPT(scaffold, output, answeredReaderQuestions) },
    ]);

    const normalizedEdits = normalizeCreateLikeTextInserts(
      Array.isArray((result as { edits?: unknown[] })?.edits)
        ? (result as { edits: unknown[] }).edits
        : [],
      state.cwd || process.cwd()
    );

    const editIntent = IntentSchema.parse({
      ...(result as Record<string, unknown>),
      edits: normalizedEdits,
    });

    debug('[editIntent] output confidence:', editIntent.confidence);
    return { editIntent };
  } catch (err) {
    debug('[editIntent] LLM failed', { error: String(err) });
    return { editIntent: null };
  }
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "editIntent.ts"
```

Expected: no errors in `nodes/root/editIntent.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/root/editIntent.ts
git commit -m "fix: editIntentNode — use readerOutputs array, merge evidence, remove message-parsing fallback"
```

---

## Task 10: Update `planApprovalNode` goto targets

**Files:**
- Modify: `packages/agent/src/nodes/planApproval.ts`

The current node hardcodes `goto: 'debug'` in both Command returns. The `debug` node is being removed. Update to route approved plans to `step_reader` (or `edit_intent` when no non-inspect steps) and rejected plans to `END`.

- [ ] **Step 1: Update `planApprovalNode`**

Replace the entire content of `packages/agent/src/nodes/planApproval.ts`:

```ts
import type { RootStateType } from '../main/root/state';
import { Command, END, interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { HumanMessage } from '@langchain/core/messages';
import { debug } from '@robocode-packages/shared';

export const planApprovalNode = async (state: RootStateType) => {
  const { plan, sessionId } = state;
  debug('PLAN FOR APPROVAL', plan);

  // All returns must be Commands so the graph has consistent outgoing routing
  if (!plan) {
    return new Command({ goto: 'edit_intent', update: { planApproved: true } });
  }

  EventBus.emit('agent:plan_pending', { sessionId, plan });

  const decision = interrupt({ type: 'plan_approval', plan });
  const approved = decision === 'approve' || decision === 'y';
  EventBus.emit('agent:plan_decision', { sessionId, approved, plan });

  if (!approved) {
    const userRejectMessage = new HumanMessage({
      content: `User rejected the plan: ${JSON.stringify(plan)}`,
    });
    return new Command({
      goto: END,
      update: { planApproved: false, plan: null, messages: [userRejectMessage] },
    });
  }

  const nonInspectSteps = plan.steps.filter((s) => s.kind !== 'inspect');
  const nextNode = nonInspectSteps.length > 0 ? 'step_reader' : 'edit_intent';

  return new Command({
    goto: nextNode,
    update: { planApproved: true, plan },
  });
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "planApproval.ts"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/planApproval.ts
git commit -m "fix: planApprovalNode — route approved plans to step_reader/edit_intent, rejected to END"
```

---

## Task 11: Rewire root graph

**Files:**
- Modify: `packages/agent/src/main/root/graph.ts`
- Modify: `packages/agent/src/nodes/root/index.ts`

- [ ] **Step 1: Update root node exports**

Replace `packages/agent/src/nodes/root/index.ts`:

```ts
export * from './agent';
export * from './askUser';
export * from './context';
export * from './tools';
export * from './editIntent';
export * from './afterTool';
export * from './collectReaderAnswers';
export * from './collectPlannerAnswers';
export * from './collectRouterAnswers';
export * from './routerIntent';
export * from './stepReader';
export * from './advanceStep';
```

- [ ] **Step 2: Rewrite root graph**

Replace the entire content of `packages/agent/src/main/root/graph.ts`:

```ts
import { StateGraph, END, START } from '@langchain/langgraph';
import { RootState, type RootStateType } from './state';
import { Checkpointer } from '@robocode-packages/core';
import { contextNode, routerIntentNode } from '../../nodes/root';
import { collectRouterAnswersNode, collectRouterAnswersRouter } from '../../nodes/root/collectRouterAnswers';
import { collectPlannerAnswersNode, collectPlannerAnswersRouter } from '../../nodes/root/collectPlannerAnswers';
import { plannerNode, plannerRouter } from '../../nodes/planner';
import { planApprovalNode } from '../../nodes/planApproval';
import { stepReaderNode, stepReaderRouter } from '../../nodes/root/stepReader';
import { collectReaderAnswersNode, collectReaderAnswersRouter } from '../../nodes/root/collectReaderAnswers';
import { advanceStepNode, advanceStepRouter } from '../../nodes/root/advanceStep';
import { editIntentNode } from '../../nodes/root/editIntent';
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
    .addNode('step_reader', stepReaderNode)
    .addNode('collect_reader_answers', collectReaderAnswersNode)
    .addNode('advance_step', advanceStepNode)
    .addNode('edit_intent', editIntentNode)
    .addEdge(START, 'context_selector')
    .addEdge('context_selector', 'router_intent')
    .addConditionalEdges('router_intent', collectRouterAnswersRouter)
    .addEdge('collect_router_answers', 'router_intent')
    .addEdge('file_selector', 'planner')
    .addConditionalEdges('planner', plannerRouter)
    .addConditionalEdges('collect_planner_answers', collectPlannerAnswersRouter)
    // plan_approval always returns Command({goto}) — no addEdge needed for this node
    .addConditionalEdges('step_reader', stepReaderRouter)
    .addConditionalEdges('collect_reader_answers', collectReaderAnswersRouter)
    .addConditionalEdges('advance_step', advanceStepRouter)
    .addEdge('edit_intent', END);

  return graph.compile({ checkpointer });
};

export const agent = buildGraph();
```

- [ ] **Step 3: Type-check the full agent package**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
```

Expected: errors only in `index.ts` (RoboAgent, fixed next task). All graph/node files should be clean.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/main/root/graph.ts packages/agent/src/nodes/root/index.ts
git commit -m "feat: rewire root graph — full pipeline context→router→planner→step_reader→edit_intent"
```

---

## Task 12: Clean up RoboAgent and delete obsolete code

**Files:**
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Remove the broken `onPattern` handler from RoboAgent**

In `packages/agent/src/index.ts`, find and remove this block in the `constructor`:

```ts
EventBus.onPattern('agent:clarification:*:answer', (event, payload) => {
  const { sessionId, answer } = payload as { sessionId: string; answer: string };
  const source = event.match(/^agent:clarification:(.+):answer$/)?.[1];
  AuditService.append(sessionId, event, { answer });
  if (source === 'router-intent') {
    routerIntentAgent.resume({ sessionId, answer }).catch((err) => {
      debug('[resumeRouterIntent] error:', err);
    });
  }
});
```

Also remove the unused `routerIntentAgent` import if it is no longer used anywhere else in the file.

- [ ] **Step 2: Full type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
```

Expected: zero errors.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all existing tests pass. The `rootRoute.test.ts` tests the old `router` function from `main/root/route.ts` — that file still exists and hasn't changed, so those tests should still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "fix: remove broken routerIntent onPattern handler from RoboAgent"
```

---

## Task 13: Smoke test the pipeline

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

Expected: exits 0.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 3: Type-check all packages**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json && npx tsc --noEmit --project packages/shared/tsconfig.json
```

Expected: zero errors in both.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: pipeline refactor complete — context→router→planner→step_reader→edit_intent"
```
