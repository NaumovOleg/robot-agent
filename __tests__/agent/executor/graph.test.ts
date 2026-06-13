// Integration test for the executor subgraph.
// Mocking strategy: jest.unstable_mockModule + dynamic await import (ESM pattern).
// Mock path: '../../../packages/agent/src/utils/model' — the model module that both
// miniReaderNode and stepReviewNode import via the utils barrel. If this does not
// intercept (LLM error in test), fall back to mocking the barrel path
// '../../../packages/agent/src/utils'.
//
// recursionLimit: 100 passed on all invoke() calls — the default (25) is sufficient
// for these test cases but 100 is passed preemptively per plan guidance.
import { jest } from '@jest/globals';
import { GraphValueError, MemorySaver, Command } from '@langchain/langgraph';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// queue of structured outputs returned by mocked withStructuredOutput().invoke()
const llmQueue: unknown[] = [];

jest.unstable_mockModule('../../../packages/agent/src/utils/model', () => ({
  createBaseModel: jest.fn(),
  getModel: jest.fn(() => ({
    withStructuredOutput: () => ({
      invoke: async () => {
        if (llmQueue.length === 0) throw new Error('llmQueue empty');
        return llmQueue.shift();
      },
    }),
  })),
}));

const { createExecutorGraph } = await import(
  '../../../packages/agent/src/subagents/executor/graph'
);

const plan = (steps: unknown[]) => ({
  goal: 'test goal', clarifying_questions: [], risk: 'low', assumptions: [],
  constraints: [], files_affected: ['src/a.ts'], gitStep: null, steps,
});

describe('executor graph (mocked LLM)', () => {
  let dir: string;
  beforeEach(async () => {
    llmQueue.length = 0;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-graph-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('happy path: edit step applies hints, reviews sufficient, finishes done', async () => {
    llmQueue.push(
      // mini_reader output (new 3-state contract)
      {
        status: 'edits',
        reason: 'bump a to 2',
        hints: [{ op: 'edit_text', file: 'src/a.ts', oldText: 'export const a = 1;', newText: 'export const a = 2;' }],
      }
      // step_review no longer calls the LLM — it's a programmatic gate now.
    );

    const graph = createExecutorGraph();
    const result = await graph.invoke({
      plan: plan([
        { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'a === 2' },
      ]),
      context: null, cwd: dir, sessionId: 's',
    }, { recursionLimit: 100 });

    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]).toMatchObject({ stepId: 'edit-a', status: 'done' });
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toContain('a = 2');
    expect(llmQueue).toHaveLength(0);
  });

  it('retry path: bad anchor rolls back, second attempt succeeds', async () => {
    llmQueue.push(
      { status: 'edits', reason: 'first try', hints: [{ op: 'edit_text', file: 'src/a.ts', oldText: 'WRONG ANCHOR', newText: 'x' }] }, // attempt 1 → validate/apply fails
      { status: 'edits', reason: 'second try', hints: [{ op: 'edit_text', file: 'src/a.ts', oldText: 'export const a = 1;', newText: 'export const a = 3;' }] } // attempt 2
    );

    const graph = createExecutorGraph();
    const result = await graph.invoke({
      plan: plan([
        { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'a === 3' },
      ]),
      context: null, cwd: dir, sessionId: 's',
    }, { recursionLimit: 100 });

    expect(result.stepResults[0]).toMatchObject({ stepId: 'edit-a', status: 'done' });
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toContain('a = 3');
    expect(llmQueue).toHaveLength(0);
  });

  it('exhausted retries roll files back and escalate via interrupt', async () => {
    // 3 failing attempts (initial + 2 retries), each consumes one mini_reader output.
    // step_review short-circuits (no LLM call) when lastError is set, so no
    // review outputs are needed in the queue.
    for (let i = 0; i < 3; i++) {
      llmQueue.push({ status: 'edits', reason: 'bad attempt', hints: [{ op: 'edit_text', file: 'src/a.ts', oldText: 'WRONG', newText: 'x' }] });
    }

    // Without a checkpointer, interrupt() in the escalate node throws GraphValueError
    // to the caller (LangGraph converts interrupt-without-checkpointer to GraphValueError)
    // — assert it escapes, then assert rollback happened.
    await expect(
      createExecutorGraph().invoke({
        plan: plan([
          { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'x' },
        ]),
        context: null, cwd: dir, sessionId: 's',
      }, { recursionLimit: 100 })
    ).rejects.toBeInstanceOf(GraphValueError);

    // every failed attempt was rolled back — file is pristine
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toBe('export const a = 1;\n');
  });

  it('escalation interrupt pauses, then resumes via Command({resume}) to completion', async () => {
    // 3 failing attempts → exhausted retries → escalate interrupt.
    for (let i = 0; i < 3; i++) {
      llmQueue.push({ status: 'edits', reason: 'bad attempt', hints: [{ op: 'edit_text', file: 'src/a.ts', oldText: 'WRONG', newText: 'x' }] });
    }

    // Compile WITH a checkpointer so the escalate interrupt pauses (instead of
    // throwing) and can be resumed — exercising the same interrupt/resume path
    // the root graph drives in production.
    const graph = createExecutorGraph(new MemorySaver());
    const config = { configurable: { thread_id: 't-escalate' }, recursionLimit: 100 };
    const input = {
      plan: plan([
        { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'x' },
      ]),
      context: null, cwd: dir, sessionId: 's',
    };

    // First invoke runs until the escalate interrupt and pauses.
    const paused = await graph.invoke(input, config);
    expect(paused.__interrupt__).toBeDefined();
    // file rolled back to pristine before the pause
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toBe('export const a = 1;\n');

    // Resume with "skip": the loop finishes cleanly, no throw, results recorded.
    const final = await graph.invoke(new Command({ resume: 'skip' }), config);
    expect(final.stepResults.some((r: { stepId: string }) => r.stepId === 'edit-a')).toBe(true);
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toBe('export const a = 1;\n');
  });
});
