import { IntentSchema } from '../../packages/shared/src/schemas/editor/intent';

describe('IntentSchema editor contract', () => {
  it('normalizes insert_text anchor to null for start mode', () => {
    const parsed = IntentSchema.parse({
      edits: [
        {
          mode: 'text',
          action: 'insert',
          file: 'src/a.ts',
          lines: null,
          id: null,
          anchor: { type: 'exact', value: 'should be ignored', match: 'unique', occurrence: 1 },
          insertMode: 'start',
          insertText: '// header\n',
          reasoning: 'Add file header',
        },
      ],
      verification: ['Run tests'],
      confidence: 0.8,
    });

    expect(parsed.edits[0]).toMatchObject({ mode: 'text', action: 'insert', anchor: null });
  });

  it('normalizes remove target to null when it does not include anchor', () => {
    const parsed = IntentSchema.parse({
      edits: [
        {
          mode: 'text',
          action: 'remove',
          file: 'src/a.ts',
          lines: null,
          id: null,
          anchor: { type: 'exact', value: 'const x = 1;', match: 'unique', occurrence: 1 },
          target: 'completely different text',
          reasoning: 'Remove obsolete declaration',
        },
      ],
      verification: ['Run tests'],
      confidence: 0.8,
    });

    const edit = parsed.edits[0] as any;
    expect(edit.target).toBeNull();
  });

  it('rejects oversized edit lists', () => {
    expect(() =>
      IntentSchema.parse({
        edits: Array.from({ length: 81 }, (_, i) => ({
          mode: 'text',
          action: 'replace',
          file: `src/f${i}.ts`,
          lines: null,
          id: null,
          anchor: { type: 'exact', value: 'x', match: 'unique', occurrence: 1 },
          replaceWith: 'y',
          before: null,
          reasoning: 'Bulk replace',
        })),
        verification: ['Run tests'],
        confidence: 0.8,
      })
    ).toThrow(/at most 80/i);
  });
});
