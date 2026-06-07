import { buildTurnSummary } from '../../apps/cli/src/utils/turnSummary';
import type { ToolActivity } from '../../apps/cli/src/types/chat';

const makeActivity = (name: string, status: 'done' | 'error' = 'done'): ToolActivity => ({
  id: `${name}-1`,
  name,
  input: { path: 'src/foo.ts' },
  status,
  startedAt: 1000,
  finishedAt: 3000,
});

describe('buildTurnSummary', () => {
  it('groups tool verbs and computes duration', () => {
    const result = buildTurnSummary(
      [makeActivity('read_file'), makeActivity('edit_file')],
      { tokens: 0, cost: 0 }
    );
    expect(result.groups).toContainEqual({ verb: 'Read', count: 1 });
    expect(result.groups).toContainEqual({ verb: 'Patched', count: 1 });
    expect(result.durationSec).toBe(2);
    expect(result.hasError).toBe(false);
  });

  it('includes tokens and cost', () => {
    const result = buildTurnSummary(
      [makeActivity('bash')],
      { tokens: 4218, cost: 0.04 }
    );
    expect(result.tokens).toBe(4218);
    expect(result.cost).toBeCloseTo(0.04);
  });

  it('sets hasError true when any activity errored', () => {
    const result = buildTurnSummary(
      [makeActivity('bash', 'error')],
      { tokens: 0, cost: 0 }
    );
    expect(result.hasError).toBe(true);
  });
});
