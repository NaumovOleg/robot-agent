import { applyTextInsert } from '../../packages/shared/src/utils/editor/textOps';

describe('textOps guards', () => {
  it('throws when before/after insert has no anchor', () => {
    expect(() =>
      applyTextInsert('const a = 1;\n', {
        mode: 'text',
        action: 'insert',
        file: 'src/a.ts',
        lines: null,
        id: null,
        anchor: null,
        insertMode: 'after',
        insertText: '\nconst b = 2;',
        reasoning: 'insert b',
      } as any)
    ).toThrow(/anchor is required/i);
  });
});
