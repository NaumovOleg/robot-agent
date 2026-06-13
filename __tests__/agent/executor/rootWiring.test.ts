import { afterPlanner, afterPlanApproval } from '../../../packages/agent/src/graphs/rootRouting';

const plan = {
  goal: 'g', clarifying_questions: [], risk: 'low', assumptions: [], constraints: [],
  files_affected: [], gitStep: null,
  steps: [{ id: 'edit-a', kind: 'edit', title: 't', files: [], depends_on: [], expected_output: 'e' }],
};

describe('afterPlanner', () => {
  it('routes to question_node on planner clarification', () => {
    expect(afterPlanner({ clarificationSource: 'planner', plan } as never)).toBe('question_node');
  });
  it('routes to plan_approval when a plan with steps exists', () => {
    expect(afterPlanner({ clarificationSource: null, plan } as never)).toBe('plan_approval');
  });
  it('falls back to agent without a plan', () => {
    expect(afterPlanner({ clarificationSource: null, plan: null } as never)).toBe('agent');
  });
});

describe('afterPlanApproval', () => {
  it('routes approved plans to executor', () => {
    expect(afterPlanApproval({ planApproved: true } as never)).toBe('executor');
  });
  it('routes rejected plans to agent', () => {
    expect(afterPlanApproval({ planApproved: false } as never)).toBe('agent');
  });
});
