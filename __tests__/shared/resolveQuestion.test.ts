import { resolveQuestion } from '@robocode-packages/shared';
import type { RootStateType } from '@robocode-packages/shared';

const state = (overrides: Partial<RootStateType>): RootStateType =>
  ({
    clarificationSource: null,
    question: null,
    router: { userRequests: [] },
    plan: null,
    ...overrides,
  }) as RootStateType;

describe('resolveQuestion', () => {
  it('returns the router intent question for router source', () => {
    const q = resolveQuestion(
      state({
        clarificationSource: 'router',
        router: { userRequests: [], intent: { question: 'Which file?' } as never },
      })
    );
    expect(q).toBe('Which file?');
  });

  it('returns state.question for planner source (the real clarifying question)', () => {
    const q = resolveQuestion(
      state({ clarificationSource: 'planner', question: 'Rename filenames too?' })
    );
    expect(q).toBe('Rename filenames too?');
  });

  it('falls back to plan.clarifying_questions[0] when state.question is empty', () => {
    const q = resolveQuestion(
      state({
        clarificationSource: 'planner',
        question: null,
        plan: { clarifying_questions: ['Any exceptions?'] } as never,
      })
    );
    expect(q).toBe('Any exceptions?');
  });

  it('does NOT return the generic fallback when a planner question exists', () => {
    const q = resolveQuestion(
      state({ clarificationSource: 'planner', question: 'Case sensitive?' })
    );
    expect(q).not.toBe('Could you provide more details?');
  });

  it('uses a planner-specific fallback when nothing is set', () => {
    const q = resolveQuestion(state({ clarificationSource: 'planner' }));
    expect(q).toBe('Could you clarify the task before I start planning?');
  });
});
