import {
  AnalyzeAstToolSchema,
  ReaderInputSchema,
  ReaderOutputSchema,
} from '../../packages/shared/src/schemas';

describe('reader schemas', () => {
  it('parses valid reader input with defaults', () => {
    const parsed = ReaderInputSchema.parse({
      task: 'Inspect routing logic',
      user_goal: 'Add FAQ route',
      current_plan_step: 'Find switch cases',
    });

    expect(parsed.focus).toEqual([]);
    expect(parsed.maxDepth).toBe(2);
    expect(parsed.instructions).toBe('');
  });

  it('fills current_plan_step default when omitted', () => {
    const parsed = ReaderInputSchema.parse({
      task: 'Inspect screen registration',
      user_goal: 'Add FAQ screen',
    });

    expect(parsed.current_plan_step).toBe('General codebase investigation');
  });

  it('accepts valid reader output and applies defaults', () => {
    const parsed = ReaderOutputSchema.parse({
      summary: 'Route switch is implemented in src/app.tsx and can host faq case.',
      filesAnalyzed: ['src/app.tsx'],
      functions: [
        {
          name: 'Screen',
          signature: 'const Screen = () => {',
          params: [],
          location: 'src/app.tsx:8',
        },
      ],
      key_findings: [
        {
          file: 'src/app.tsx',
          lines: '27-40',
          content: "switch (route) {\n  case 'welcome':\n    return <WelcomeScreen key=\"welcome\" />;\n}",
          comment: 'Main route switch block.',
        },
      ],
      potential_edit_strategy: {
        goal: 'Add faq branch in route switch',
        files_to_modify: ['src/app.tsx'],
        change_type: 'add',
        instructions:
          "Add `case 'faq'` in Screen switch and return an inline FAQ component near existing cases.",
        constraints: ['Preserve existing route behavior'],
      },
    });

    expect(parsed.language).toBeNull();
    expect(parsed.unresolvedQuestions).toEqual([]);
    expect(parsed.potential_edit_strategy?.files_to_modify).toEqual(['src/app.tsx']);
  });

  it('rejects findings and strategy files that are not in filesAnalyzed', () => {
    expect(() =>
      ReaderOutputSchema.parse({
        summary: 'Observed mismatch between inspected and strategy files.',
        filesAnalyzed: ['src/a.ts'],
        key_findings: [
          {
            file: 'src/b.ts',
            lines: '10',
            content: 'const value = 1;',
            comment: 'Should fail because file not analyzed.',
          },
        ],
        potential_edit_strategy: {
          goal: 'Update file not analyzed',
          files_to_modify: ['src/c.ts'],
          change_type: 'modify',
          instructions: 'Change c.ts',
          constraints: [],
        },
      })
    ).toThrow();
  });

  it('requires AST evidence for sufficient output when analyzed files are code files', () => {
    expect(() =>
      ReaderOutputSchema.parse({
        summary: 'Collected enough evidence for code edit.',
        status: 'sufficient',
        filesAnalyzed: ['src/router.ts'],
        key_findings: [
          {
            file: 'src/router.ts',
            lines: '1-3',
            content: "export type Route = 'welcome';",
            comment: 'Route declaration is present.',
          },
        ],
        potential_edit_strategy: {
          goal: 'Update route type',
          files_to_modify: ['src/router.ts'],
          change_type: 'modify',
          instructions: "Add 'faq' to Route type.",
          constraints: [],
        },
      })
    ).toThrow(/analyzed code files/);
  });

  it('enforces ast analyzer symbolName rules', () => {
    expect(() =>
      AnalyzeAstToolSchema.parse({
        filePath: 'src/app.tsx',
        queryType: 'references',
        includeBody: false,
      })
    ).toThrow();

    expect(() =>
      AnalyzeAstToolSchema.parse({
        filePath: 'src/app.tsx',
        queryType: 'imports',
        symbolName: 'App',
        includeBody: false,
      })
    ).toThrow();

    expect(() =>
      AnalyzeAstToolSchema.parse({
        filePath: 'src/app.tsx',
        queryType: 'references',
        symbolName: 'App',
        includeBody: false,
      })
    ).not.toThrow();
  });
});
