import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutorHint } from '@robocode-packages/shared';
import { dispatchHint } from '../../../packages/agent/src/nodes/sub/executor/dispatch';

const hint = (partial: Partial<ExecutorHint> & Pick<ExecutorHint, 'op' | 'file'>): ExecutorHint =>
  ({ nodeType: null, symbol: null, newSymbol: null, oldText: null, newText: null,
     target: null, ...partial }) as ExecutorHint;

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

  it('edit_text replaces a unique anchor', async () => {
    await dispatchHint(
      hint({ op: 'edit_text', file: 'a.ts', oldText: 'return "hi";', newText: 'return "hello";' }),
      dir
    );
    expect(await read('a.ts')).toContain('return "hello";');
  });

  it('edit_text fails on missing anchor with exact error', async () => {
    await expect(
      dispatchHint(
        hint({ op: 'edit_text', file: 'a.ts', oldText: 'nope', newText: 'x' }),
        dir
      )
    ).rejects.toThrow(/oldText not found|Target not found/);
  });

  it('tolerates a leaked line-number prefix in a text anchor', async () => {
    // The mini-reader sees "2 |   return "hi";" and sometimes copies "2 " into the
    // anchor. The stripped form must still match.
    await dispatchHint(
      hint({ op: 'edit_text', file: 'a.ts', oldText: '2   return "hi";', newText: '  return "yo";' }),
      dir
    );
    expect(await read('a.ts')).toContain('return "yo";');
  });

  it('tolerates a "N | " line-number prefix in a text anchor', async () => {
    // Converts insert_text-after to edit_text: oldText is the anchor (with prefix),
    // newText is anchor + inserted content.
    await dispatchHint(
      hint({
        op: 'edit_text', file: 'a.ts',
        oldText: '1 | export const greet = () => {',
        newText: 'export const greet = () => {\n  // hi',
      }),
      dir
    );
    expect(await read('a.ts')).toContain('{\n  // hi');
  });

  it('insert after anchor: edit_text with old=anchor, new=anchor+insert', async () => {
    await fs.writeFile(path.join(dir, 'bar.ts'), "export * from './ctx';\nexport * from './provider';\n");
    await dispatchHint(
      hint({
        op: 'edit_text', file: 'bar.ts',
        oldText: "export * from './provider';",
        newText: "export * from './provider';\nexport * from './faq';",
      }),
      dir
    );
    const out = await read('bar.ts');
    expect(out).not.toContain("provider';export");
    expect(out).toContain("export * from './provider';\nexport * from './faq';");
  });

  it('edit_text is a no-op when the change is already applied (idempotent)', async () => {
    // Simulates a redundant rename hint: a prior rename_symbol already turned
    // <App /> into <Page />, so this edit_text anchor is gone but the new
    // text is present. Must be a no-op, not a step failure.
    await fs.writeFile(path.join(dir, 'a.tsx'), 'export const Root = () => <Page />;\n');
    const res = await dispatchHint(
      hint({ op: 'edit_text', file: 'a.tsx', oldText: '<App />', newText: '<Page />' }),
      dir
    );
    expect(res.summary).toMatch(/already applied/);
    expect(await read('a.tsx')).toContain('<Page />');
  });

  it('insert after anchor: edit_text inserts content after the matched text', async () => {
    await dispatchHint(
      hint({
        op: 'edit_text', file: 'a.ts',
        oldText: 'export const greet = () => {',
        newText: 'export const greet = () => {\n  // inserted',
      }),
      dir
    );
    expect(await read('a.ts')).toContain('{\n  // inserted');
  });

  it('remove_text via edit_text: include boundary in oldText, keep only boundary in newText', async () => {
    await dispatchHint(
      hint({ op: 'edit_text', file: 'a.ts', oldText: '{\n  return "hi";\n', newText: '{\n' }),
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
      hint({ op: 'create_file', file: 'src/new.ts', newText: 'export const n = 1;\n' }),
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

  it('refuses to write to a generated/vendor path (dist)', async () => {
    await expect(
      dispatchHint(hint({ op: 'create_file', file: 'dist/x.ts', newText: 'export const x = 1;' }), dir)
    ).rejects.toThrow(/generated|build output|dist/i);
  });

  it('rejects path traversal', async () => {
    await expect(
      dispatchHint(hint({ op: 'create_file', file: '../escape.ts', newText: 'x' }), dir)
    ).rejects.toThrow(/escapes repository root|traverse/i);
  });

  it('fails when an edit produces broken syntax', async () => {
    await expect(
      dispatchHint(
        hint({ op: 'edit_text', file: 'a.ts', oldText: 'return "hi";', newText: 'return {{{;' }),
        dir
      )
    ).rejects.toThrow(/Syntax error/);
    // Syntax is checked before writing: broken edits do not corrupt the file on disk.
    expect(await read('a.ts')).toContain('return "hi";');
  });

  it('fails on missing required fields with a clear message', async () => {
    await expect(
      dispatchHint(hint({ op: 'edit_text', file: 'a.ts', oldText: null, newText: 'x' }), dir)
    ).rejects.toThrow(/oldText.*required/i);
  });

  it('replace_node replaces the node body', async () => {
    await dispatchHint(
      hint({ op: 'replace_node', file: 'a.ts', nodeType: 'variable_declarator', symbol: 'greet',
             newText: 'const greet = () => "replaced"' }),
      dir
    );
    const content = await read('a.ts');
    expect(content).toContain('"replaced"');
    expect(content).not.toContain('"hi"');
  });

  it('prepend to file: edit_text with oldText=first line, newText=header+first line', async () => {
    await dispatchHint(
      hint({
        op: 'edit_text', file: 'a.ts',
        oldText: 'export const greet = () => {',
        newText: '// header\nexport const greet = () => {',
      }),
      dir
    );
    expect((await read('a.ts')).startsWith('// header\n')).toBe(true);
  });

  it('append to file: edit_text with oldText=last line, newText=last line+footer', async () => {
    await dispatchHint(
      hint({
        op: 'edit_text', file: 'a.ts',
        oldText: '};\n',
        newText: '};\n// footer\n',
      }),
      dir
    );
    expect((await read('a.ts')).endsWith('// footer\n')).toBe(true);
  });

  it('edit_text fails on ambiguous anchor', async () => {
    await fs.writeFile(path.join(dir, 'a.ts'), 'let x = 1;\nlet y = 1;\nlet z = 1;\n');
    // ensure substring "= 1;" appears multiple times
    await expect(
      dispatchHint(hint({ op: 'edit_text', file: 'a.ts', oldText: '= 1;', newText: '= 2;' }), dir)
    ).rejects.toThrow(/not unique|Expected unique target|multiple|ambiguous/i);
  });
});
