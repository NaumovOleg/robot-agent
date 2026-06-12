import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyNode } from '../../../packages/agent/src/nodes/sub/executor/apply';
import type { ExecutorHint } from '@robocode-packages/shared';

const mkState = (cwd: string, hints: ExecutorHint[], extra: Record<string, unknown> = {}) =>
  ({
    plan: null, context: null, cwd, sessionId: 's', stepResults: [],
    stepStates: {}, currentStepId: 'edit-a', currentHints: hints,
    readerFindings: {}, fileSnapshots: {}, retryCounts: {}, appliedOps: {},
    lastError: null, userGuidance: null, verifyOutput: null, escalationDecision: null,
    verifyCommands: { typeCheck: null, testRunner: null, lint: null },
    ...extra,
  }) as never;

const hint = (partial: Partial<ExecutorHint> & Pick<ExecutorHint, 'op' | 'file'>): ExecutorHint =>
  ({ nodeType: null, symbol: null, newSymbol: null, anchor: null, newContent: null,
     target: null, insertMode: null, ...partial }) as ExecutorHint;

describe('applyNode', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-apply-'));
    await fs.writeFile(path.join(dir, 'a.ts'), 'const a = 1;\n');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('snapshots target files, applies all hints in order, records appliedOps', async () => {
    const res = await applyNode(
      mkState(dir, [
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'const a = 1;', newContent: 'const a = 2;' }),
        hint({ op: 'insert_text', file: 'a.ts', anchor: 'const a = 2;', insertMode: 'after', newContent: '\nconst b = 3;' }),
      ])
    );
    expect(res.lastError).toBeNull();
    expect(res.fileSnapshots?.['edit-a']?.['a.ts']).toBe('const a = 1;\n');
    expect(res.appliedOps?.['edit-a']).toHaveLength(2);
    const content = await fs.readFile(path.join(dir, 'a.ts'), 'utf-8');
    expect(content).toContain('const a = 2;\nconst b = 3;');
  });

  it('keeps existing snapshot on retry (does not overwrite with mutated content)', async () => {
    const res = await applyNode(
      mkState(
        dir,
        [hint({ op: 'replace_text', file: 'a.ts', anchor: 'const a = 1;', newContent: 'const a = 5;' })],
        { fileSnapshots: { 'edit-a': { 'a.ts': 'PRISTINE' } } }
      )
    );
    expect(res.fileSnapshots?.['edit-a']?.['a.ts']).toBe('PRISTINE');
  });

  it('stops at the first failing hint and reports which one', async () => {
    const res = await applyNode(
      mkState(dir, [
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'NOPE', newContent: 'x' }),
        hint({ op: 'create_file', file: 'never.ts', newContent: 'x' }),
      ])
    );
    expect(res.lastError).toMatch(/hint 1\/2/);
    expect(res.lastError).toMatch(/Target not found/);
    await expect(fs.access(path.join(dir, 'never.ts'))).rejects.toThrow();
  });
});
