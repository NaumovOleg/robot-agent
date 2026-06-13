import { stepReviewNode } from '../../../packages/agent/src/nodes/sub/executor/stepReview';

const baseState = (overrides: Record<string, unknown>) =>
  ({
    plan: {
      goal: 'g',
      clarifying_questions: [],
      risk: 'low',
      assumptions: [],
      constraints: [],
      files_affected: ['src/a.ts'],
      gitStep: null,
      steps: [
        {
          id: 'edit-a',
          kind: 'edit',
          title: 't',
          files: ['src/a.ts'],
          depends_on: [],
          expected_output: 'e',
        },
      ],
    },
    cwd: '/tmp',
    sessionId: 's',
    currentStepId: 'edit-a',
    stepStates: { 'edit-a': 'running' },
    stepResults: [],
    currentHints: [],
    key_findings: {},
    fileSnapshots: {},
    retryCounts: {},
    appliedOps: { 'edit-a': ['rename_symbol src/a.ts'] },
    lastError: null,
    userGuidance: null,
    verifyOutput: null,
    verifyPassed: null,
    escalationDecision: null,
    verifyCommands: { typeCheck: 'tsc --noEmit', testRunner: null, lint: null },
    baselineErrors: [],
    ...overrides,
  }) as never;

describe('stepReviewNode — verification authoritative', () => {
  it('marks the step done WITHOUT the LLM judge when verification passed', async () => {
    // verifyPassed === true must short-circuit to done. If this path called the
    // LLM, getModel would throw (no profile in tests) — so reaching done proves
    // the judge was skipped.
    const res = await stepReviewNode(baseState({ verifyPassed: true }));
    expect(res.stepStates).toMatchObject({ 'edit-a': 'done' });
    expect(res.stepResults?.[0]).toMatchObject({ stepId: 'edit-a', status: 'done' });
    expect(res.lastError).toBeNull();
  });

  it('routes a mechanical failure to retry without consulting the judge', async () => {
    const res = await stepReviewNode(
      baseState({ lastError: 'apply failed: anchor not found', verifyPassed: false })
    );
    // retry path: no stepStates change (stays running), retryCounts bumped
    expect(res.retryCounts).toMatchObject({ 'edit-a': 1 });
    expect(res.stepStates).toBeUndefined();
  });
});
