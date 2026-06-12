import { decideStepOutcome } from '../../../packages/agent/src/nodes/sub/executor/stepReview';

describe('decideStepOutcome', () => {
  it('sufficient → done', () => {
    expect(decideStepOutcome('sufficient', 0)).toBe('done');
  });

  it('insufficient under the retry cap → retry', () => {
    expect(decideStepOutcome('insufficient', 0)).toBe('retry');
    expect(decideStepOutcome('insufficient', 1)).toBe('retry');
  });

  it('insufficient at the cap → failed', () => {
    expect(decideStepOutcome('insufficient', 2)).toBe('failed');
  });

  it('blocked → failed immediately regardless of retries', () => {
    expect(decideStepOutcome('blocked', 0)).toBe('failed');
  });
});
