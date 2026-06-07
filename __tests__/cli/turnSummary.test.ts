import { buildTurnSummary } from '../../apps/cli/src/utils/turnSummary';
import type { ToolActivity } from '../../apps/cli/src/types/chat';

const make = (name: string, status: ToolActivity['status'] = 'done', extra: Partial<ToolActivity> = {}): ToolActivity => ({
  id: `${name}-1`,
  name,
  input: {},
  status,
  startedAt: 1000,
  finishedAt: 3000,
  ...extra,
});

describe('buildTurnSummary', () => {
  it('groups tools by verb category', () => {
    const result = buildTurnSummary([make('read_file'), make('grep'), make('read_file')]);
    expect(result.groups).toContainEqual({ verb: 'Read', count: 2 });
    expect(result.groups).toContainEqual({ verb: 'Searched', count: 1 });
  });

  it('calculates duration across all activities', () => {
    const result = buildTurnSummary([
      make('read_file', 'done', { startedAt: 1000, finishedAt: 5000 }),
      make('grep',      'done', { startedAt: 2000, finishedAt: 8000 }),
    ]);
    expect(result.durationSec).toBe(7); // (8000 - 1000) / 1000
  });

  it('sets hasError when any activity errored', () => {
    expect(buildTurnSummary([make('read_file'), make('bash', 'error')]).hasError).toBe(true);
  });

  it('does not set hasError when all activities succeeded', () => {
    expect(buildTurnSummary([make('read_file'), make('grep')]).hasError).toBe(false);
  });

  it('returns empty groups for empty input', () => {
    expect(buildTurnSummary([]).groups).toHaveLength(0);
  });

  it('uses tool name as fallback verb for unknown tools', () => {
    const result = buildTurnSummary([make('custom_tool')]);
    expect(result.groups[0]?.verb).toBe('custom_tool');
  });

  it('includes children in grouping', () => {
    const parent = make('bash', 'done', {
      children: [make('read_file', 'done'), make('grep', 'done')],
    });
    const result = buildTurnSummary([parent]);
    expect(result.groups).toContainEqual({ verb: 'Read', count: 1 });
    expect(result.groups).toContainEqual({ verb: 'Searched', count: 1 });
  });

  it('sets hasError when a child errored', () => {
    const parent = make('bash', 'done', {
      children: [make('read_file', 'error')],
    });
    expect(buildTurnSummary([parent]).hasError).toBe(true);
  });
});
