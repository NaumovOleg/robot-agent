import { z } from 'zod';

const RelativeFilePath = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine((v) => !v.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(v), {
    message: 'Must be a repository-relative path e.g. "src/auth/middleware.ts"',
  })
  .refine((v) => !v.split(/[\\/]/).includes('..'), {
    message: 'Path must not traverse parent directories.',
  });

export const PlanStepSchema = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, 'Lowercase kebab-case e.g. "read-auth-middleware"'),
  kind: z
    .enum(['inspect', 'edit', 'create', 'delete'])
    .describe(
      'inspect = read/analyze only, edit = modify existing, create = new file, delete = remove file'
    ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .describe('Short imperative description e.g. "Read auth middleware to understand JWT flow"'),
  files: z
    .array(RelativeFilePath)
    .max(40)
    .default([])
    .describe('Files this step will read or modify. Empty for bash-only steps.'),
  depends_on: z
    .array(
      z
        .string()
        .trim()
        .min(3)
        .max(64)
        .regex(/^[a-z][a-z0-9-]*$/)
    )
    .max(12)
    .default([])
    .describe('IDs of steps that must complete before this one runs.'),
  expected_output: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      'Concrete success criteria e.g. "JWT validation passes, tsc reports no errors in auth/middleware.ts"'
    ),
});

export const PlannerOutputSchema = z.object({
  goal: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe('Single sentence: what will be accomplished and why it matters.'),
  clarifying_questions: z
    .array(z.string().trim().min(1).max(300))
    .max(5)
    .default([])
    .describe(
      'Questions to ask the user when the task is ambiguous. Empty array means the task is clear enough to plan immediately.'
    ),
  assumptions: z
    .array(z.string().trim().min(1).max(160))
    .max(20)
    .default([])
    .describe(
      'Assumptions made about the codebase or requirements e.g. "Auth uses Express middleware pattern"'
    ),
  risk: z
    .enum(['low', 'medium', 'high'])
    .describe(
      'low = read-only or trivial change, medium = modifies existing logic, high = deletes code or cross-cutting change'
    ),
  files_affected: z
    .array(RelativeFilePath)
    .max(40)
    .default([])
    .describe('Complete list of files that will be created, edited, or deleted across all steps.'),
  constraints: z
    .array(z.string().trim().min(1).max(240))
    .max(10)
    .default([])
    .describe(
      'Hard rules the implementation must follow e.g. "Do not change the public API", "Must stay compatible with Node 18"'
    ),
  steps: z
    .array(PlanStepSchema)
    .min(1)
    .max(10)
    .describe(
      'Ordered execution steps forming a DAG. Each step is one atomic unit of work. Inspect steps come first.'
    ),
  gitStep: z
    .object({
      branch: z
        .string()
        .nullable()
        .optional()
        .describe('Branch to create before committing, e.g. "feature/add-faq". Omit to stay on current branch.'),
      push: z.boolean().describe('Push after committing. Always requires user approval.'),
      amend: z.boolean().default(false).describe('Amend last commit instead of creating a new one.'),
    })
    .nullable()
    .optional()
    .describe('Git operations after edits. Null or omitted = no git step.'),
});
