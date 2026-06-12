import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  takeSnapshot,
  restoreSnapshot,
} from '../../../packages/agent/src/nodes/sub/executor/snapshots';

describe('snapshots', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-snap-'));
    await fs.writeFile(path.join(dir, 'a.ts'), 'original A');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('captures existing files and marks missing files as null', async () => {
    const snap = await takeSnapshot(dir, ['a.ts', 'missing.ts']);
    expect(snap['a.ts']).toBe('original A');
    expect(snap['missing.ts']).toBeNull();
  });

  it('restore rewrites modified files and deletes created ones', async () => {
    const snap = await takeSnapshot(dir, ['a.ts', 'new.ts']);
    await fs.writeFile(path.join(dir, 'a.ts'), 'mutated');
    await fs.writeFile(path.join(dir, 'new.ts'), 'created later');

    await restoreSnapshot(dir, snap);

    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf-8')).toBe('original A');
    await expect(fs.access(path.join(dir, 'new.ts'))).rejects.toThrow();
  });

  it('restore tolerates already-absent files marked null', async () => {
    const snap = await takeSnapshot(dir, ['missing.ts']);
    await expect(restoreSnapshot(dir, snap)).resolves.toBeUndefined();
  });

  it('takeSnapshot dedupes repeated paths', async () => {
    const snap = await takeSnapshot(dir, ['a.ts', 'a.ts']);
    expect(Object.keys(snap)).toEqual(['a.ts']);
  });
});
