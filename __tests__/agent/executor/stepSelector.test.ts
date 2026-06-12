import {
  pickNextStep,
  stepSelectorNode,
} from '../../../packages/agent/src/nodes/sub/executor/stepSelector';
import type { PlannerOutput, StepStatus } from '@robocode-packages/shared';

type PlanStep = PlannerOutput['steps'][number];

const step = (id: string, depends_on: string[] = [], kind: PlanStep['kind'] = 'edit'): PlanStep =>
  ({ id, kind, title: id, files: ['src/a.ts'], depends_on, expected_output: 'e' });

describe('pickNextStep', () => {
  it('respects depends_on order', () => {
    const steps = [step('b', ['a']), step('a', [], 'inspect')];
    const states: Record<string, StepStatus> = { a: 'pending', b: 'pending' };
    expect(pickNextStep(steps, states)?.id).toBe('a');
    states.a = 'done';
    expect(pickNextStep(steps, states)?.id).toBe('b');
  });

  it('returns null when everything is done', () => {
    expect(pickNextStep([step('a', [], 'inspect')], { a: 'done' })).toBeNull();
  });

  it('does not pick steps blocked by failed/skipped deps', () => {
    const steps = [step('a', [], 'inspect'), step('b', ['a'])];
    expect(pickNextStep(steps, { a: 'failed', b: 'pending' })).toBeNull();
    expect(pickNextStep(steps, { a: 'skipped', b: 'pending' })).toBeNull();
  });
});

describe('stepSelectorNode', () => {
  it('marks unreachable pending steps skipped and records results', async () => {
    const plan = {
      goal: 'g', clarifying_questions: [], risk: 'low' as const, assumptions: [],
      constraints: [], files_affected: [], gitStep: null,
      steps: [step('a', [], 'inspect'), step('b', ['a'])],
    };
    const res = await stepSelectorNode({
      plan, sessionId: 's', stepStates: { a: 'failed', b: 'pending' },
      retryCounts: {}, stepResults: [],
    } as never);
    expect(res.currentStepId).toBeNull();
    expect(res.stepStates).toMatchObject({ b: 'skipped' });
    expect(res.stepResults?.[0]).toMatchObject({ stepId: 'b', status: 'skipped' });
  });
});
