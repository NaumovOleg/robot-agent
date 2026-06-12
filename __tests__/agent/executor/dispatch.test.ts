import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutorHint } from '@robocode-packages/shared';
import { dispatchHint } from '../../../packages/agent/src/nodes/sub/executor/dispatch';

const hint = (partial: Partial<ExecutorHint> & Pick<ExecutorHint, 'op' | 'file'>): ExecutorHint =>
  ({ nodeType: null, symbol: null, newSymbol: null, anchor: null, newContent: null,
     target: null, insertMode: null, ...partial }) as ExecutorHint;

describe('dispatchHint', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-dispatch-'));
    await fs.writeFile(
      path.join(dir, 'a.ts'),
      'export const greet = () => {\n  return "hi";\n};\n'
    );
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const read = (f: string) => fs.readFile(path.join(dir, f), 'utf-8');

  it('replace_text replaces a unique anchor', async () => {
    await dispatchHint(
      hint({ op: 'replace_text', file: 'a.ts', anchor: 'return "hi";', newContent: 'return "hello";' }),
      dir
    );
    expect(await read('a.ts')).toContain('return "hello";');
  });

  it('replace_text fails on missing anchor with exact error', async () => {
    await expect(
      dispatchHint(
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'nope', newContent: 'x' }),
        dir
      )
    ).rejects.toThrow(/Target not found/);
  });

  it('insert_text inserts after anchor', async () => {
    await dispatchHint(
      hint({
        op: 'insert_text', file: 'a.ts', anchor: 'export const greet = () => {',
        insertMode: 'after', newContent: '\n  // inserted',
      }),
      dir
    );
    expect(await read('a.ts')).toContain('{\n  // inserted');
  });

  it('remove_text removes the anchor', async () => {
    await dispatchHint(
      hint({ op: 'remove_text', file: 'a.ts', anchor: '  return "hi";\n' }),
      dir
    );
    expect(await read('a.ts')).not.toContain('return "hi"');
  });

  it('rename_symbol renames via AST', async () => {
    await dispatchHint(
      hint({
        op: 'rename_symbol', file: 'a.ts',
        nodeType: 'variable_declarator', symbol: 'greet', newSymbol: 'salute',
      }),
      dir
    );
    expect(await read('a.ts')).toContain('export const salute');
  });

  it('create_file creates with content and parent dirs', async () => {
    await dispatchHint(
      hint({ op: 'create_file', file: 'src/new.ts', newContent: 'export const n = 1;\n' }),
      dir
    );
    expect(await read('src/new.ts')).toBe('export const n = 1;\n');
  });

  it('delete_file removes the file', async () => {
    await dispatchHint(hint({ op: 'delete_file', file: 'a.ts' }), dir);
    await expect(read('a.ts')).rejects.toThrow();
  });

  it('rename_file moves the file', async () => {
    await dispatchHint(hint({ op: 'rename_file', file: 'a.ts', target: 'b.ts' }), dir);
    expect(await read('b.ts')).toContain('greet');
  });

  it('rejects path traversal', async () => {
    await expect(
      dispatchHint(hint({ op: 'create_file', file: '../escape.ts', newContent: 'x' }), dir)
    ).rejects.toThrow(/escapes repository root|traverse/i);
  });

  it('fails when an edit produces broken syntax', async () => {
    await expect(
      dispatchHint(
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'return "hi";', newContent: 'return {{{;' }),
        dir
      )
    ).rejects.toThrow(/Syntax error/);
    // file is left written — rollback is the caller's job via snapshots
  });

  it('fails on missing required fields with a clear message', async () => {
    await expect(
      dispatchHint(hint({ op: 'replace_text', file: 'a.ts', anchor: null, newContent: 'x' }), dir)
    ).rejects.toThrow(/anchor.*required/i);
  });
});
