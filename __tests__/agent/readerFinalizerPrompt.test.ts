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
  });

  it('treats AST evidence as optional, focusing on summary + key_findings', () => {
    const prompt = READER_FINALIZER_PROMPT({
      task: 't',
      cwd: '/repo',
      user_goal: 'g',
      current_plan_step: 's',
    });
    // The strict "AST evidence required / must be non-empty / must set insufficient"
    // rules were removed to match the tolerant reader schema.
    expect(prompt).not.toMatch(/at least one of[\s\S]*MUST be non-empty/);
    expect(prompt).not.toMatch(/MUST set[\s\S]*status[\s\S]*insufficient/);
    expect(prompt).toMatch(/OPTIONAL[\s\S]*supporting evidence/);
    expect(prompt).toMatch(/summary[\s\S]*key_findings/);
  });
});
