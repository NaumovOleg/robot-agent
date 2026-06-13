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

  it('tolerates a leaked line-number prefix in a text anchor', async () => {
    // The mini-reader sees "2 |   return "hi";" and sometimes copies "2 " into the
    // anchor. The stripped form must still match.
    await dispatchHint(
      hint({ op: 'replace_text', file: 'a.ts', anchor: '2   return "hi";', newContent: '  return "yo";' }),
      dir
    );
    expect(await read('a.ts')).toContain('return "yo";');
  });

  it('tolerates a "N | " line-number prefix in a text anchor', async () => {
    await dispatchHint(
      hint({ op: 'insert_text', file: 'a.ts', anchor: '1 | export const greet = () => {', insertMode: 'after', newContent: '\n  // hi' }),
      dir
    );
    expect(await read('a.ts')).toContain('{\n  // hi');
  });

  it('replace_text matches a multi-line anchor reproduced with different whitespace', async () => {
    await fs.writeFile(
      path.join(dir, 'sw.ts'),
      'switch (x) {\n  case 1:\n    return a;\n  default:\n    return b;\n}\n'
    );
    // model collapsed the block onto one line with single spaces
    await dispatchHint(
      hint({
        op: 'replace_text', file: 'sw.ts',
        anchor: 'case 1: return a;',
        newContent: 'case 1:\n    return c;',
      }),
      dir
    );
    expect(await read('sw.ts')).toContain('return c;');
  });

  it('insert_text matches a single-line anchor against a multi-line import', async () => {
    await fs.writeFile(path.join(dir, 'imp.ts'), 'import {\n  A,\n  B,\n} from "./x";\n');
    await dispatchHint(
      hint({ op: 'insert_text', file: 'imp.ts', anchor: 'import { A,', insertMode: 'after', newContent: '\n  C,' }),
      dir
    );
    expect(await read('imp.ts')).toContain('C,');
  });

  it('replace_text is a no-op when the change is already applied (idempotent)', async () => {
    // Simulates a redundant rename hint: a prior rename_symbol already turned
    // <App /> into <Page />, so this replace_text anchor is gone but the new
    // text is present. Must be a no-op, not a step failure.
    await fs.writeFile(path.join(dir, 'a.tsx'), 'export const Root = () => <Page />;\n');
    const res = await dispatchHint(
      hint({ op: 'replace_text', file: 'a.tsx', anchor: '<App />', newContent: '<Page />' }),
      dir
    );
    expect(res.summary).toMatch(/already applied/);
    expect(await read('a.tsx')).toContain('<Page />');
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

  it('rename_symbol renames the declaration AND every usage', async () => {
    await fs.writeFile(
      path.join(dir, 'comp.tsx'),
      'const App = () => null;\nexport const Root = () => <App />;\n'
    );
    await dispatchHint(
      hint({ op: 'rename_symbol', file: 'comp.tsx', nodeType: 'variable_declarator', symbol: 'App', newSymbol: 'Page' }),
      dir
    );
    const out = await read('comp.tsx');
    expect(out).toContain('const Page = () => null;');
    expect(out).toContain('<Page />');
    expect(out).not.toContain('App');
  });

  it('rename_symbol tolerates a wrong (TS-compiler-style) nodeType', async () => {
    // LLMs often emit "VariableDeclaration" instead of the tree-sitter type;
    // rename locates by symbol text, so it must still work.
    await dispatchHint(
      hint({ op: 'rename_symbol', file: 'a.ts', nodeType: 'VariableDeclaration', symbol: 'greet', newSymbol: 'salute' }),
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

  it('replace_node replaces the node body', async () => {
    await dispatchHint(
      hint({ op: 'replace_node', file: 'a.ts', nodeType: 'variable_declarator', symbol: 'greet',
             newContent: 'const greet = () => "replaced"' }),
      dir
    );
    const content = await read('a.ts');
    expect(content).toContain('"replaced"');
    expect(content).not.toContain('"hi"');
  });

  it('remove_node removes the node', async () => {
    await dispatchHint(
      hint({ op: 'remove_node', file: 'a.ts', nodeType: 'variable_declarator', symbol: 'greet' }),
      dir
    );
    expect(await read('a.ts')).not.toContain('greet');
  });

  it('insert_node appends snippet to end of file', async () => {
    await dispatchHint(
      hint({ op: 'insert_node', file: 'a.ts', nodeType: 'function_declaration',
             newContent: 'export const extra = 1;' }),
      dir
    );
    expect((await read('a.ts')).trimEnd().endsWith('export const extra = 1;')).toBe(true);
  });

  it('insert_text start mode needs no anchor', async () => {
    await dispatchHint(
      hint({ op: 'insert_text', file: 'a.ts', insertMode: 'start', newContent: '// header\n' }),
      dir
    );
    expect((await read('a.ts')).startsWith('// header\n')).toBe(true);
  });

  it('insert_text end mode appends', async () => {
    await dispatchHint(
      hint({ op: 'insert_text', file: 'a.ts', insertMode: 'end', newContent: '// footer\n' }),
      dir
    );
    expect((await read('a.ts')).endsWith('// footer\n')).toBe(true);
  });

  it('replace_text fails on ambiguous anchor', async () => {
    await fs.writeFile(path.join(dir, 'a.ts'), 'let x = 1;\nlet x2 = 1;\n'.replace('x2', 'y') + 'let z = 1;\n');
    // ensure substring "= 1;" appears multiple times
    await expect(
      dispatchHint(hint({ op: 'replace_text', file: 'a.ts', anchor: '= 1;', newContent: '= 2;' }), dir)
    ).rejects.toThrow(/Expected unique target/);
  });
});
