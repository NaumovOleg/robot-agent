import { computeCost } from '@robocode-packages/shared';

describe('computeCost', () => {
  it('computes cost for sonnet', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(18.0); // $3 input + $15 output per 1M
  });

  it('computes cache read discount', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.30);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const cost = computeCost('unknown-model', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(3.0);
  });

  it('returns 0 for zero tokens', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBe(0);
  });
});
