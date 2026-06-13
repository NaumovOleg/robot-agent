import type { ExecutorHint } from '@robocode-packages/shared';
import {
  summarizeHint,
  summarizeState,
} from '../../../packages/agent/src/nodes/sub/executor/summary';

const hint = (p: Partial<ExecutorHint> & Pick<ExecutorHint, 'op' | 'file'>): ExecutorHint =>
  ({ nodeType: null, symbol: null, newSymbol: null, anchor: null, newContent: null,
     target: null, insertMode: null, ...p }) as ExecutorHint;

describe('summarizeHint', () => {
  it('describes a rename with old→new', () => {
    expect(
      summarizeHint(hint({ op: 'rename_symbol', file: 'a.ts', symbol: 'App', newSymbol: 'Page' }))
    ).toBe('rename_symbol a.ts App→Page');
  });

  it('describes a text op with a clipped anchor', () => {
    expect(
      summarizeHint(hint({ op: 'replace_text', file: 'a.ts', anchor: 'const x = 1;' }))
    ).toBe('replace_text a.ts @"const x = 1;"');
  });

  it('describes a file op', () => {
    expect(summarizeHint(hint({ op: 'create_file', file: 'src/new.ts' }))).toBe(
      'create_file src/new.ts'
    );
  });
});

describe('summarizeState', () => {
  it('renders current step, per-step status, and retry counts', () => {
    const line = summarizeState({
      plan: {
        steps: [
          { id: 'inspect-a' },
          { id: 'edit-a' },
        ],
      },
      stepStates: { 'inspect-a': 'done', 'edit-a': 'running' },
      currentStepId: 'edit-a',
      retryCounts: { 'edit-a': 1 },
    } as never);
    expect(line).toContain('current=edit-a');
    expect(line).toContain('inspect-a:done');
    expect(line).toContain('edit-a:running');
    expect(line).toContain('edit-a=1');
  });
});
