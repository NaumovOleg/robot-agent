import { PlannerOutputSchema } from '../../schemas';

import type { z } from 'zod';

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;

export interface Plan extends PlannerOutput {
  schema_version?: string;
  approved?: boolean;
  reason?: string;
  attempt?: number;
}

export const parsePlannerOutput = (raw: unknown): Plan => {
  const result = PlannerOutputSchema.parse(raw);
  return {
    ...result,
    clarifying_questions: result.clarifying_questions ?? [],
    assumptions: result.assumptions ?? [],
    files_affected: result.files_affected ?? [],
    constraints: result.constraints ?? [],
    steps: result.steps.map((step) => ({
      ...step,
      files: step.files ?? [],
      depends_on: step.depends_on ?? [],
    })),
  };
};
