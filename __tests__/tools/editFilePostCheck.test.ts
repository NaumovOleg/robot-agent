import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editFileTool } from '@robocode-packages/tools';

describe('editFileTool post-check', () => {
  test('successful edit on JS file returns diff without tsc notes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'));
    const file = path.join(dir, 'foo.js');
    fs.writeFileSync(file, 'const x = 1;\n');

    const result = await editFileTool.invoke(
      { path: file, old_str: 'const x = 1;', new_str: 'const x = 2;' },
      { configurable: { cwd: dir, sessionId: '' } }
    );

    expect(result).toContain('Edited:');
    expect(result).not.toContain('TypeScript errors');
    fs.rmSync(dir, { recursive: true });
  });

  test('non-TS file does not trigger tsc', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'));
    const file = path.join(dir, 'foo.json');
    fs.writeFileSync(file, '{"x": 1}');

    const result = await editFileTool.invoke(
      { path: file, old_str: '"x": 1', new_str: '"x": 2' },
      { configurable: { cwd: dir, sessionId: '' } }
    );

    expect(result).toContain('Edited:');
    expect(result).not.toContain('TypeScript errors');
    fs.rmSync(dir, { recursive: true });
  });
});
