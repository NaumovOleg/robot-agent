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

  it('accepts transitive inspect dependency chains deeper than one edge', () => {
    const parsed = PlannerOutputSchema.parse(
      {
        ...basePlan([
        {
          id: 'inspect-router',
          kind: 'inspect',
          title: 'Inspect router',
          files: ['src/types/router.ts'],
          depends_on: [],
          expected_output: 'Route type located.',
        },
        {
          id: 'edit-router-base',
          kind: 'edit',
          title: 'Adjust base router declarations',
          files: ['src/types/router.ts'],
          depends_on: ['inspect-router'],
          expected_output: 'Base declarations updated.',
        },
        {
          id: 'edit-router-final',
          kind: 'edit',
          title: 'Finalize route changes',
          files: ['src/types/router.ts'],
          depends_on: ['edit-router-base'],
          expected_output: 'Final route shape applied.',
        },
        ]),
        files_affected: ['src/types/router.ts'],
      }
    );
    expect(parsed.steps).toHaveLength(3);
  });

  it('rejects dependencies that point to later steps', () => {
    expect(() =>
      PlannerOutputSchema.parse(
        {
          ...basePlan([
          {
            id: 'edit-first',
            kind: 'edit',
            title: 'Edit first',
            files: ['src/types/router.ts'],
            depends_on: ['inspect-later'],
            expected_output: 'Done.',
          },
          {
            id: 'inspect-later',
            kind: 'inspect',
            title: 'Inspect later',
            files: ['src/types/router.ts'],
            depends_on: [],
            expected_output: 'Inspected.',
          },
          ]),
          files_affected: ['src/types/router.ts'],
        }
      )
    ).toThrow(/must appear earlier/i);
  });

  it('rejects extra files_affected entries not covered by non-inspect steps', () => {
    expect(() =>
      PlannerOutputSchema.parse({
        ...basePlan([
          {
            id: 'create-faq-component',
            kind: 'create',
            title: 'Create FAQ page',
            files: ['src/screens/faq/index.tsx'],
            depends_on: [],
            expected_output: 'Created.',
          },
        ]),
        files_affected: ['src/screens/faq/index.tsx', 'src/unused.ts'],
      })
    ).toThrow(/files_affected/i);
  });
});
