import {
  parseEscalationAnswer,
  collectDependents,
} from '../../../packages/agent/src/nodes/sub/executor/escalate';
import { dedupeStepResults } from '../../../packages/agent/src/nodes/sub/executor/finalize';
import { digestReaderOutput } from '../../../packages/agent/src/nodes/sub/executor/readerStep';

describe('parseEscalationAnswer', () => {
  it('recognizes skip and abort keywords', () => {
    expect(parseEscalationAnswer('skip')).toEqual({ decision: 'skip', guidance: null });
    expect(parseEscalationAnswer(' Abort ')).toEqual({ decision: 'abort', guidance: null });
  });

  it('recognizes stop as abort', () => {
    expect(parseEscalationAnswer('stop')).toEqual({ decision: 'abort', guidance: null });
  });

  it('treats anything else as retry with guidance', () => {
    expect(parseEscalationAnswer('use the helper in utils.ts')).toEqual({
      decision: 'retry',
      guidance: 'use the helper in utils.ts',
    });
    expect(parseEscalationAnswer('retry')).toEqual({ decision: 'retry', guidance: null });
  });
});

describe('collectDependents', () => {
  const steps = [
    { id: 'a', depends_on: [] },
    { id: 'b', depends_on: ['a'] },
    { id: 'c', depends_on: ['b'] },
    { id: 'd', depends_on: [] },
  ];
  it('collects transitive dependents', () => {
    expect(collectDependents(steps as never, 'a').sort()).toEqual(['b', 'c']);
  });
  it('returns empty for a leaf', () => {
    expect(collectDependents(steps as never, 'd')).toEqual([]);
  });
});

describe('dedupeStepResults', () => {
  it('keeps the last entry per stepId', () => {
    const out = dedupeStepResults([
      { stepId: 'a', status: 'failed', output: 'x', retries: 2 },
      { stepId: 'b', status: 'done', output: 'y', retries: 0 },
      { stepId: 'a', status: 'done', output: 'z', retries: 0 },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.stepId === 'a')?.status).toBe('done');
  });
});

describe('digestReaderOutput', () => {
  it('clips findings and extracts hints', () => {
    const digest = digestReaderOutput('inspect-a', {
      schemaVersion: 'reader.output.v2',
      status: 'sufficient',
      summary: 'S',
      language: 'typescript',
      files_analyzed: ['src/a.ts'],
      functions: [],
      classes: [],
      imports: [],
      references: [],
      unresolved_questions: [],
      key_findings: Array.from({ length: 30 }, (_, i) => ({
        file: 'src/a.ts',
        lines: String(i),
        content: 'x'.repeat(2000),
        comment: `c${i}`,
      })),
      potential_edit_strategy: {
        goal: 'g',
        files_to_modify: ['src/a.ts'],
        change_type: 'modify',
        instructions: 'i',
        constraints: [],
        operation_hints: [
          {
            op: 'replace_text',
            file: 'src/a.ts',
            anchor: 'x',
            details: 'd',
            lines: '',
            nodeType: null,
            symbol: null,
            newSymbol: null,
          },
        ],
      },
    } as never);
    expect(digest.stepId).toBe('inspect-a');
    expect(digest.keyFindings.length).toBeLessThanOrEqual(15);
    expect(digest.keyFindings[0].content.length).toBeLessThanOrEqual(800);
    expect(digest.operationHints).toHaveLength(1);
  });
});
