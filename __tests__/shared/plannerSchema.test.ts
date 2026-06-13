import { PlannerOutputSchema } from '../../packages/shared/src/schemas';

const basePlan = (steps: unknown[]) => ({
  goal: 'Add a FAQ page',
  clarifying_questions: [],
  risk: 'medium' as const,
  assumptions: [],
  constraints: [],
  files_affected: ['src/screens/faq/index.tsx'],
  gitStep: null,
  steps,
});

describe('PlannerOutputSchema — create-step inspect dependency', () => {
  it('accepts a create step for a NEW file with no inspect dependency', () => {
    // A create step makes a file that does not exist yet, so it cannot (and must
    // not be required to) depend on an inspect step. This previously threw a
    // ZodError and forced a planner retry.
    const parsed = PlannerOutputSchema.parse(
      basePlan([
        {
          id: 'create-faq-component',
          kind: 'create',
          title: 'Create the FAQ page component',
          files: ['src/screens/faq/index.tsx'],
          depends_on: [],
          expected_output: 'FAQ component created and compiles.',
        },
      ])
    );
    expect(parsed.steps[0].kind).toBe('create');
  });

  it('still requires an edit step to depend on an inspect step', () => {
    expect(() =>
      PlannerOutputSchema.parse(
        basePlan([
          {
            id: 'edit-router',
            kind: 'edit',
            title: 'Edit router types',
            files: ['src/types/router.ts'],
            depends_on: [],
            expected_output: 'Route added.',
          },
        ])
      )
    ).toThrow(/must depend on an inspect step/);
  });
});
