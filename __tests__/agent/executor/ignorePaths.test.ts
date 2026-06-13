import { isIgnoredPath } from '../../../packages/agent/src/nodes/sub/executor/ignorePaths';
import { errorFilesFrom } from '../../../packages/agent/src/nodes/sub/executor/verifyErrors';

describe('isIgnoredPath', () => {
  it.each([
    'dist/index.js',
    'apps/cli/dist/index.js',
    'node_modules/x/index.d.ts',
    'build/out.js',
    '.git/config',
    'packages/x/coverage/lcov.info',
    'target/debug/main',
  ])('ignores %s', (p) => {
    expect(isIgnoredPath(p)).toBe(true);
  });

  it.each(['src/app.tsx', 'src/types/router.ts', 'apps/cli/src/screens/faq/index.tsx'])(
    'keeps %s',
    (p) => {
      expect(isIgnoredPath(p)).toBe(false);
    }
  );
});

describe('errorFilesFrom skips generated paths', () => {
  it('drops dist/node_modules, keeps source files', () => {
    const files = errorFilesFrom([
      'src/app.tsx|error TS1',
      'apps/cli/dist/index.js|error TS2',
      'node_modules/ink/index.d.ts|error TS3',
    ]);
    expect(files).toEqual(['src/app.tsx']);
  });
});
