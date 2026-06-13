import { combineClarifyingQuestions } from '../../../packages/agent/src/nodes/root/planner';

describe('combineClarifyingQuestions', () => {
  it('returns a single question verbatim', () => {
    expect(combineClarifyingQuestions(['Rename filenames too?'])).toBe('Rename filenames too?');
  });

  it('numbers and includes ALL questions when there are several', () => {
    const out = combineClarifyingQuestions([
      'Rename filenames too?',
      'Any exceptions?',
      'Case sensitive?',
    ]);
    expect(out).toContain('1. Rename filenames too?');
    expect(out).toContain('2. Any exceptions?');
    expect(out).toContain('3. Case sensitive?');
  });
});
