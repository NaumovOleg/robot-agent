import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findReferenceFile } from '../../../packages/agent/src/nodes/sub/executor/referenceFile';

describe('findReferenceFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-ref-'));
    await fs.mkdir(path.join(dir, 'src/screens'), { recursive: true });
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('finds an existing sibling of the same extension', async () => {
    await fs.writeFile(path.join(dir, 'src/screens/Profile.tsx'), 'export const Profile = () => <div/>;\n');
    const ref = await findReferenceFile(dir, 'src/screens/Faq.tsx');
    expect(ref?.file).toBe('src/screens/Profile.tsx');
    expect(ref?.content).toContain('export const Profile');
  });

  it('falls back to the parent directory', async () => {
    // target lives in src/screens/faq/ (empty); sibling is in src/screens/ (parent)
    await fs.writeFile(path.join(dir, 'src/screens/Profile.tsx'), 'export const Profile = () => <div/>;\n');
    const ref = await findReferenceFile(dir, 'src/screens/faq/index.tsx');
    expect(ref?.file).toBe('src/screens/Profile.tsx');
  });

  it('prefers the shortest example', async () => {
    await fs.writeFile(path.join(dir, 'src/screens/Big.tsx'), 'x'.repeat(2000));
    await fs.writeFile(path.join(dir, 'src/screens/Small.tsx'), 'export const Small = 1;\n');
    const ref = await findReferenceFile(dir, 'src/screens/Faq.tsx');
    expect(ref?.file).toBe('src/screens/Small.tsx');
  });

  it('returns null when no sibling of the same kind exists', async () => {
    await fs.writeFile(path.join(dir, 'src/screens/notes.md'), '# notes');
    expect(await findReferenceFile(dir, 'src/screens/Faq.tsx')).toBeNull();
  });
});
