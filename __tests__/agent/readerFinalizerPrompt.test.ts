import { READER_FINALIZER_PROMPT } from '../../packages/agent/src/prompts/sub/reader/finalizer';

describe('READER_FINALIZER_PROMPT', () => {
  it('asks for a schema-valid JSON object focused on the consumed fields', () => {
    const prompt = READER_FINALIZER_PROMPT({
      task: 'Add a new faq route to the CLI app',
      cwd: '/repo',
      user_goal: 'Add FAQ route',
      current_plan_step: 'Inspect routing',
      instructions: 'Focus on src/app.tsx',
      focus: ['src/app.tsx'],
    });

    expect(prompt).toMatch(/valid JSON object/i);
    expect(prompt).toContain('schemaVersion');
    expect(prompt).toContain('summary');
    expect(prompt).toContain('key_findings');
    expect(prompt).toContain('files_analyzed');
    // focus list is rendered
    expect(prompt).toContain('src/app.tsx');
  });

  it('treats AST evidence as optional and drops the strict status gates', () => {
    const prompt = READER_FINALIZER_PROMPT({
      task: 't',
      cwd: '/repo',
      user_goal: 'g',
      current_plan_step: 's',
    });
    expect(prompt).not.toMatch(/at least one of[\s\S]*MUST be non-empty/);
    expect(prompt).not.toMatch(/MUST set[\s\S]*status[\s\S]*insufficient/);
    expect(prompt).toMatch(/OPTIONAL/);
    expect(prompt).toMatch(/summary[\s\S]*key_findings/);
  });
});
