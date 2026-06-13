import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { initNode } from '../../../packages/agent/src/nodes/sub/executor/init';
import { findRelatedTestFile } from '../../../packages/agent/src/nodes/sub/executor/relatedTest';
import type { ExecutorStateType } from '../../../packages/agent/src/subagents/executor/state';

const basePlan = {
  goal: 'g',
  clarifying_questions: [],
  risk: 'low' as const,
  assumptions: [],
  constraints: [],
  files_affected: ['src/a.ts'],
  gitStep: null,
  steps: [
    {
      id: 'inspect-a',
      kind: 'inspect' as const,
      title: 't',
      files: ['src/a.ts'],
      depends_on: [],
      expected_output: 'e',
    },
    {
      id: 'edit-a',
      kind: 'edit' as const,
      title: 't',
      files: ['src/a.ts'],
      depends_on: ['inspect-a'],
      expected_output: 'e',
    },
  ],
};

const state = (overrides: Partial<ExecutorStateType>): ExecutorStateType =>
  ({
    plan: basePlan as never,
    context: null,
    cwd: '/tmp',
    sessionId: 's',
    stepResults: [],
    stepStates: {},
    currentStepId: null,
    currentHints: [],
    key_findings: {},
    fileSnapshots: {},
    retryCounts: {},
    appliedOps: {},
    lastError: null,
    userGuidance: null,
    verifyOutput: null,
    escalationDecision: null,
    verifyCommands: { typeCheck: null, testRunner: null, lint: null },
    ...overrides,
  }) as ExecutorStateType;

describe('initNode', () => {
  it('marks all steps pending and derives verify commands from context', async () => {
    const res = await initNode(
      state({
        context: {
          cwd: '/tmp',
          git: {},
          project: { name: 'p', frameworks: [] },
          structure: [],
          entryPoints: [],
          language: { primary: 'typescript', typeCheck: 'tsc --noEmit', testRunner: 'jest' },
        },
      })
    );
    expect(res.stepStates).toEqual({ 'inspect-a': 'pending', 'edit-a': 'pending' });
    expect(res.verifyCommands).toEqual({
      typeCheck: 'tsc --noEmit',
      testRunner: 'jest',
      lint: null,
    });
  });

  it('fails fast on a dependency cycle', async () => {
    const cyclic = {
      ...basePlan,
      steps: [
        {
          id: 'edit-a',
          kind: 'edit' as const,
          title: 't',
          files: ['src/a.ts'],
          depends_on: ['edit-b'],
          expected_output: 'e',
        },
        {
          id: 'edit-b',
          kind: 'edit' as const,
          title: 't',
          files: ['src/a.ts'],
          depends_on: ['edit-a'],
          expected_output: 'e',
        },
      ],
    };
    const res = await initNode(state({ plan: cyclic as never }));
    expect(res.lastError).toMatch(/cycle/i);
  });

  it('fails when plan is missing', async () => {
    const res = await initNode(state({ plan: null }));
    expect(res.lastError).toMatch(/no plan/i);
  });
});

describe('findRelatedTestFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-rt-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/foo.ts'), 'x');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('finds sibling test file', async () => {
    await fs.writeFile(path.join(dir, 'src/foo.test.ts'), 'x');
    expect(await findRelatedTestFile('src/foo.ts', dir)).toBe('src/foo.test.ts');
  });

  it('finds __tests__ sibling', async () => {
    await fs.mkdir(path.join(dir, 'src/__tests__'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/__tests__/foo.test.ts'), 'x');
    expect(await findRelatedTestFile('src/foo.ts', dir)).toBe('src/__tests__/foo.test.ts');
  });

  it('returns null when nothing matches', async () => {
    expect(await findRelatedTestFile('src/foo.ts', dir)).toBeNull();
  });
});
