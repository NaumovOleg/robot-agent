import { READER_FINALIZER_PROMPT } from '../../packages/agent/src/prompts/sub/reader/finalizer';

describe('READER_FINALIZER_PROMPT', () => {
  it('enforces evidence-based structured output with actionable strategy rules', () => {
    const prompt = READER_FINALIZER_PROMPT({
      task: 'Add a new faq route to the CLI app',
      cwd: '/repo',
      user_goal: 'Add FAQ route',
      current_plan_step: 'Inspect routing',
      instructions: 'Focus on src/app.tsx',
      focus: ['src/app.tsx'],
    });

    expect(prompt).toContain('Return one valid JSON object that matches the structured schema.');
    expect(prompt).toContain('Use change type by intent');
    expect(prompt).toContain('`add`: introduces new behavior/branch/component/export/file.');
    expect(prompt).toContain('`files_to_modify` must be a subset of `filesAnalyzed`.');
    expect(prompt).toContain('target the exact observed symbol name');
    expect(prompt).toContain('set `potential_edit_strategy` to `null`');
    expect(prompt).toContain('If `status` is `sufficient` and analyzed files include code files');
  });
});
