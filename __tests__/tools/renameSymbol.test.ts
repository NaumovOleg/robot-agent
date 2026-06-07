import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renameSymbolTool } from '@robocode-packages/tools';

test('renames all occurrences of a symbol in a file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-test-'));
  const file = path.join(dir, 'foo.ts');
  fs.writeFileSync(file, `export function myFunction() {}\nmyFunction();\n`);

  const result = await renameSymbolTool.invoke(
    { file: file, symbol: 'myFunction', newSymbol: 'renamedFunction' },
    { configurable: { cwd: dir, sessionId: '' } }
  );

  const updated = fs.readFileSync(file, 'utf-8');
  expect(updated).toContain('renamedFunction');
  expect(updated).not.toContain('myFunction');
  expect(result).toContain('renamed');

  fs.rmSync(dir, { recursive: true });
});

test('returns error when symbol equals newSymbol', async () => {
  const result = await renameSymbolTool.invoke(
    { file: 'src/foo.ts', symbol: 'foo', newSymbol: 'foo' },
    { configurable: { cwd: process.cwd(), sessionId: '' } }
  );
  expect(result).toContain('identical');
});

test('returns not-found message when symbol does not exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-test-'));
  const result = await renameSymbolTool.invoke(
    { file: path.join(dir, 'foo.ts'), symbol: 'nonExistentSymbol12345', newSymbol: 'bar' },
    { configurable: { cwd: dir, sessionId: '' } }
  );
  expect(result).toContain('not found');
  fs.rmSync(dir, { recursive: true });
});
