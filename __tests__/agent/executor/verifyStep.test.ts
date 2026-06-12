import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyStepNode } from '../../../packages/agent/src/nodes/sub/executor/verifyStep';

const mkState = (cwd: string, verifyCommands: Record<string, string | null>, files = ['src/a.ts']) =>
  ({
    plan: {
      goal: 'g', clarifying_questions: [], risk: 'low', assumptions: [], constraints: [],
      files_affected: files, gitStep: null,
      steps: [{ id: 'edit-a', kind: 'edit', title: 't', files, depends_on: [], expected_output: 'e' }],
    },
    context: null, cwd, sessionId: 's', stepResults: [], stepStates: {},
    currentStepId: 'edit-a', currentHints: [], readerFindings: {}, fileSnapshots: {},
    retryCounts: {}, appliedOps: {}, lastError: null, userGuidance: null,
    verifyOutput: null, escalationDecision: null,
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

  it('fails with output tail when typeCheck fails', async () => {
    const res = await verifyStepNode(
      mkState(dir, { typeCheck: 'node -e "console.error(\'error TS2304: boom\'); process.exit(1)"' })
    );
    expect(res.lastError).toMatch(/Type check failed/);
    expect(res.verifyOutput).toContain('TS2304');
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
});
