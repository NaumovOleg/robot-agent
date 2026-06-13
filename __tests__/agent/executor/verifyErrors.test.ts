import {
  parseVerifyErrors,
  newVerifyErrors,
  errorFilesFrom,
} from '../../../packages/agent/src/nodes/sub/executor/verifyErrors';

describe('parseVerifyErrors (multi-language)', () => {
  it('parses tsc errors and drops line/col', () => {
    const out = parseVerifyErrors(
      "src/app.tsx(63,5): error TS2304: Cannot find name 'X'.\n" +
        "src/app.tsx(70,1): error TS2304: Cannot find name 'X'."
    );
    expect(out).toContain("src/app.tsx|error TS2304: Cannot find name 'X'.");
  });

  it('parses unix/eslint/gcc/clippy "file:line:col: error" format', () => {
    const out = parseVerifyErrors('src/main.rs:12:9: error: cannot find value `x`');
    expect(out).toEqual(['src/main.rs|error: cannot find value `x`']);
  });

  it('parses a positionless "error TS...:" line', () => {
    const out = parseVerifyErrors("error TS2304: Cannot find name 'X'.");
    expect(out).toEqual(["error TS2304: Cannot find name 'X'."]);
  });
});

describe('newVerifyErrors', () => {
  it('returns only errors absent from the baseline', () => {
    expect(newVerifyErrors(['a|x', 'b|y'], ['a|x'])).toEqual(['b|y']);
  });
});

describe('errorFilesFrom', () => {
  it('extracts unique in-repo files', () => {
    const files = errorFilesFrom([
      'src/app.tsx|error TS2678',
      'src/app.tsx|error TS2307',
      'src/types/router.ts|error TS2678',
      'error TS2304: positionless', // no file → skipped
      '/abs/path.ts|error', // absolute → skipped
    ]);
    expect(files.sort()).toEqual(['src/app.tsx', 'src/types/router.ts']);
  });
});
