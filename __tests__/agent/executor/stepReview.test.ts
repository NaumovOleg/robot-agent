import { decideStepOutcome } from '../../../packages/agent/src/nodes/sub/executor/stepReview';
import { MAX_STEP_RETRIES } from '../../../packages/agent/src/subagents/executor/state';

describe('decideStepOutcome', () => {
  it('sufficient → done', () => {
    expect(decideStepOutcome('sufficient', 0)).toBe('done');
  });

  it('insufficient under the retry cap → retry', () => {
    expect(decideStepOutcome('insufficient', 0)).toBe('retry');
    expect(decideStepOutcome('insufficient', MAX_STEP_RETRIES - 1)).toBe('retry');
  });

  it('insufficient at the cap → failed', () => {
    expect(decideStepOutcome('insufficient', MAX_STEP_RETRIES)).toBe('failed');
  });

  it('blocked → failed immediately regardless of retries', () => {
    expect(decideStepOutcome('blocked', 0)).toBe('failed');
  });
});
