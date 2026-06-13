import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyStepNode } from '../../../packages/agent/src/nodes/sub/executor/verifyStep';

const mkState = (
  cwd: string,
  verifyCommands: Record<string, string | null>,
  files = ['src/a.ts'],
  baselineErrors: string[] = []
) =>
  ({
    plan: {
      goal: 'g',
      clarifying_questions: [],
      risk: 'low',
      assumptions: [],
      constraints: [],
      files_affected: files,
      gitStep: null,
      steps: [
        { id: 'edit-a', kind: 'edit', title: 't', files, depends_on: [], expected_output: 'e' },
      ],
    },
    context: null,
    cwd,
    sessionId: 's',
    stepResults: [],
    stepStates: {},
    currentStepId: 'edit-a',
    currentHints: [],
    key_findings: {},
    fileSnapshots: {},
    retryCounts: {},
    appliedOps: {},
    lastError: null,
    userGuidance: null,
    verifyOutput: null,
    escalationDecision: null,
    baselineErrors,
    verifyCommands: { typeCheck: null, testRunner: null, lint: null, ...verifyCommands },
  }) as never;

describe('verifyStepNode', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-verify-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/a.ts'), 'x');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('passes when typeCheck command succeeds', async () => {
    const res = await verifyStepNode(mkState(dir, { typeCheck: 'node -e "process.exit(0)"' }));
    expect(res.lastError).toBeNull();
  });

  it('DEFERS typeCheck while another mutating step is still pending', async () => {
    // A failing typeCheck command — but a second create step is pending, so this
    // is NOT the final mutation and tsc must NOT run (no false failure).
    const state = {
      ...(mkState(dir, { typeCheck: 'node -e "process.exit(1)"' }) as Record<string, unknown>),
      plan: {
        goal: 'g',
        clarifying_questions: [],
        risk: 'low',
        assumptions: [],
        constraints: [],
        files_affected: ['src/a.ts'],
        gitStep: null,
        steps: [
          {
            id: 'edit-a',
            kind: 'edit',
            title: 't',
            files: ['src/a.ts'],
            depends_on: [],
            expected_output: 'e',
          },
          {
            id: 'create-b',
            kind: 'create',
            title: 't',
            files: ['src/b.ts'],
            depends_on: [],
            expected_output: 'e',
          },
        ],
      },
      stepStates: { 'edit-a': 'running', 'create-b': 'pending' },
    };
    const res = await verifyStepNode(state as never);
    expect(res.lastError).toBeNull();
    expect(res.verifyPassed).toBeNull(); // nothing ran
  });

  it('reports the error files when the final typeCheck fails', async () => {
    const cmd =
      'node -e "console.error(\'src/types/router.ts(1,1): error TS2678: x\'); process.exit(1)"';
    const res = await verifyStepNode(mkState(dir, { typeCheck: cmd }));
    expect(res.lastError).toMatch(/Type check failed/);
    expect(res.errorFiles).toContain('src/types/router.ts');
  });

  it('fails with output tail when typeCheck fails', async () => {
    const res = await verifyStepNode(
      mkState(dir, {
        typeCheck: 'node -e "console.error(\'error TS2304: boom\'); process.exit(1)"',
      })
    );
    expect(res.lastError).toMatch(/Type check failed/);
    expect(res.verifyOutput).toContain('TS2304');
  });

  it('passes when the only type errors are pre-existing (in the baseline)', async () => {
    // tsc reports a baseline error every run; the step introduced nothing new.
    const cmd =
      'node -e "console.error(\'foo.ts(1,1): error TS2304: pre-existing\'); process.exit(1)"';
    const res = await verifyStepNode(
      mkState(dir, { typeCheck: cmd }, ['src/a.ts'], ['foo.ts|error TS2304: pre-existing'])
    );
    expect(res.lastError).toBeNull();
  });

  it('fails only on errors not present in the baseline', async () => {
    const cmd =
      "node -e \"console.error('foo.ts(1,1): error TS2304: pre-existing'); console.error('src/a.ts(3,3): error TS2345: new break'); process.exit(1)\"";
    const res = await verifyStepNode(
      mkState(dir, { typeCheck: cmd }, ['src/a.ts'], ['foo.ts|error TS2304: pre-existing'])
    );
    expect(res.lastError).toMatch(/TS2345: new break/);
    expect(res.lastError).not.toMatch(/pre-existing/);
  });

  it('runs related test file when testRunner configured and test exists', async () => {
    await fs.writeFile(path.join(dir, 'src/a.test.ts'), 'x');
    // echo back the args so we can assert the test file was targeted
    const res = await verifyStepNode(
      mkState(dir, { testRunner: 'node -e "console.log(process.argv.slice(1).join(\' \'))" --' })
    );
    expect(res.lastError).toBeNull();
    expect(res.verifyOutput).toContain('src/a.test.ts');
  });

  it('skips silently when no commands configured', async () => {
    const res = await verifyStepNode(mkState(dir, {}));
    expect(res.lastError).toBeNull();
    expect(res.verifyOutput).toBeNull();
  });

  it('runs tests for every step file that has one', async () => {
    await fs.writeFile(path.join(dir, 'src/b.ts'), 'x');
    await fs.writeFile(path.join(dir, 'src/a.test.ts'), 'x');
    await fs.writeFile(path.join(dir, 'src/b.test.ts'), 'x');
    const res = await verifyStepNode(
      mkState(dir, { testRunner: 'node -e "console.log(process.argv.slice(1).join(\' \'))" --' }, [
        'src/a.ts',
        'src/b.ts',
      ])
    );
    expect(res.lastError).toBeNull();
    // last verified file's output retained
    expect(res.verifyOutput).toContain('src/b.test.ts');
  });

  it('fails when a related test run fails', async () => {
    await fs.writeFile(path.join(dir, 'src/a.test.ts'), 'x');
    const res = await verifyStepNode(
      mkState(dir, {
        testRunner: 'node -e "console.error(\'assertion failed\'); process.exit(1)" --',
      })
    );
    expect(res.lastError).toMatch(/Tests failed \(src\/a\.test\.ts\)/);
    expect(res.verifyOutput).toContain('assertion failed');
  });

  it('returns null verifyOutput when testRunner configured but no tests exist', async () => {
    const res = await verifyStepNode(mkState(dir, { testRunner: 'node -e "process.exit(0)"' }));
    expect(res.lastError).toBeNull();
    expect(res.verifyOutput).toBeNull();
  });
});
