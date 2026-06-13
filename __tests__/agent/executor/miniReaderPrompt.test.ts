import { buildMiniReaderPrompt } from '../../../packages/agent/src/prompts/sub/executor/miniReader';

const step = {
  id: 'edit-a', kind: 'edit' as const, title: 'Add salute()', files: ['src/a.ts'],
  depends_on: ['inspect-a'], expected_output: 'salute exported; tsc clean',
};

describe('buildMiniReaderPrompt', () => {
  it('includes step, goal, constraints, file contents with line numbers, findings', () => {
    const prompt = buildMiniReaderPrompt({
      step,
      goal: 'Add greeting feature',
      constraints: ['do not change public API'],
      files: [{ file: 'src/a.ts', content: 'line one\nline two' }],
      findings: [{ stepId: 'inspect-a', summary: 'a.ts exports greet()', keyFindings: [], operationHints: [] }],
      lastError: null,
      userGuidance: null,
      appliedOps: [],
    });
    expect(prompt).toContain('Add salute()');
    expect(prompt).toContain('Add greeting feature');
    expect(prompt).toContain('do not change public API');
    expect(prompt).toContain('1 | line one');
    expect(prompt).toContain('a.ts exports greet()');
    expect(prompt).not.toContain('PREVIOUS ATTEMPT FAILED');
  });

  it('lists files produced by earlier steps with their exact paths', () => {
    const prompt = buildMiniReaderPrompt({
      step, goal: 'g', constraints: [], files: [], findings: [],
      producedFiles: ['src/screens/faq/FAQ.tsx'],
      lastError: null, userGuidance: null, appliedOps: [],
    });
    expect(prompt).toContain('Files created or changed by EARLIER steps');
    expect(prompt).toContain('src/screens/faq/FAQ.tsx');
  });

  it('omits the produced-files section when none exist', () => {
    const prompt = buildMiniReaderPrompt({
      step, goal: 'g', constraints: [], files: [], findings: [],
      producedFiles: [],
      lastError: null, userGuidance: null, appliedOps: [],
    });
    expect(prompt).not.toContain('Files created or changed by EARLIER steps');
  });

  it('includes reference files to mirror conventions', () => {
    const prompt = buildMiniReaderPrompt({
      step, goal: 'g', constraints: [], files: [], findings: [],
      references: [{ file: 'src/screens/Profile.tsx', content: 'export const Profile = () => null;' }],
      lastError: null, userGuidance: null, appliedOps: [],
    });
    expect(prompt).toContain('MIRROR their conventions');
    expect(prompt).toContain('src/screens/Profile.tsx');
    expect(prompt).toContain('export const Profile');
  });

  it('includes retry context when lastError is present', () => {
    const prompt = buildMiniReaderPrompt({
      step, goal: 'g', constraints: [], files: [], findings: [],
      lastError: 'Type check failed: error TS2304',
      userGuidance: 'use the existing helper',
      appliedOps: ['replace_text src/a.ts'],
    });
    expect(prompt).toContain('PREVIOUS ATTEMPT FAILED');
    expect(prompt).toContain('error TS2304');
    expect(prompt).toContain('use the existing helper');
    expect(prompt).toContain('replace_text src/a.ts');
  });

  it('truncates oversized file content', () => {
    const big = 'x'.repeat(31_000);
    const prompt = buildMiniReaderPrompt({
      step, goal: 'g', constraints: [], findings: [],
      files: [{ file: 'src/big.ts', content: big }],
      lastError: null, userGuidance: null, appliedOps: [],
    });
    expect(prompt).toContain('…[truncated]');
    expect(prompt.length).toBeLessThan(big.length + 5_000);
  });
});
