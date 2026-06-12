import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ExecutorHintSchema,
  runCommand,
  checkSyntax,
} from '@robocode-packages/shared';

describe('ExecutorHintSchema extensions', () => {
  it('accepts rename_file with target', () => {
    const hint = ExecutorHintSchema.parse({
      op: 'rename_file',
      file: 'src/a.ts',
      target: 'src/b.ts',
    });
    expect(hint.target).toBe('src/b.ts');
  });

  it('accepts insert_text with insertMode', () => {
    const hint = ExecutorHintSchema.parse({
      op: 'insert_text',
      file: 'src/a.ts',
      anchor: 'const x = 1;',
      insertMode: 'after',
      newContent: '\nconst y = 2;',
    });
    expect(hint.insertMode).toBe('after');
  });
});

describe('runCommand', () => {
  it('returns ok=true with output for a passing command', async () => {
    const res = await runCommand('node -e "console.log(42)"', process.cwd());
    expect(res.ok).toBe(true);
    expect(res.output).toContain('42');
  });

  it('returns ok=false with captured output for a failing command', async () => {
    const res = await runCommand(
      'node -e "console.error(\'boom\'); process.exit(1)"',
      process.cwd()
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain('boom');
  });
});

describe('checkSyntax', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-syntax-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('passes valid typescript', async () => {
    const file = path.join(dir, 'ok.ts');
    const res = await checkSyntax(file, 'export const a = 1;\n');
    expect(res.ok).toBe(true);
  });

  it('fails broken typescript with a line hint', async () => {
    const file = path.join(dir, 'bad.ts');
    const res = await checkSyntax(file, 'export const a = {;\n');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/line \d+/i);
  });

  it('skips unsupported extensions', async () => {
    const file = path.join(dir, 'data.xyz');
    const res = await checkSyntax(file, '{{{{ totally not code');
    expect(res.ok).toBe(true);
  });
});
