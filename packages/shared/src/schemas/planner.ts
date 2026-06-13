import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

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

// ─── Plan step ────────────────────────────────────────────────────────────────

export const PlanStepSchema = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, 'Lowercase kebab-case e.g. "inspect-token-service"')
    .describe('Unique step identifier. Used in depends_on references.'),

  kind: z
    .enum(['inspect', 'edit', 'create', 'delete'])
    .describe(
      'inspect = read/analyze only — NO writes. ' +
        'edit    = modify existing file. ' +
        'create  = new file that does not exist yet. ' +
        'delete  = remove a file.'
    ),

  title: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .describe(
      'Short imperative description referencing specific symbols or files. ' +
        'Example: "Read TokenService to understand refresh logic"'
    ),

  files: z
    .array(RelativeFilePath)
    .max(40)
    .default([])
    .describe(
      'Files this step will read or modify. ' +
        'Must be relative paths. Empty is allowed only for verification/orchestration steps that do not target a specific file.'
    ),

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
    .describe(
      'IDs of steps that must complete before this one. ' +
        'Every edit/create/delete step must depend on at least one inspect step covering the same files.'
    ),

  expected_output: z
    .string()
    .trim()
    .min(1)
    .max(400)
    .describe(
      'Concrete verifiable success criteria referencing specific symbols and commands. ' +
        'Good:  "TokenService.refreshToken() exists, tsc --noEmit reports no errors" ' +
        'Bad:   "The feature is implemented correctly"'
    ),
});

// ─── Git step (optional) ──────────────────────────────────────────────────────

const GitStepSchema = z
  .object({
    branch: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .default(null)
      .describe('Branch to create before committing. Null = stay on current branch.'),
    push: z.boolean().describe('Push after committing. Always requires user approval.'),
    amend: z.boolean().default(false).describe('Amend last commit instead of creating a new one.'),
  })
  .strict();

// ─── Root output schema ───────────────────────────────────────────────────────

export const PlannerOutputSchema = z
  .object({
    // ── What will be done ───────────────────────────────────────────────────
    goal: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .describe(
        'Single sentence: what will be accomplished and why it matters. ' +
          'Reference specific symbols or modules when possible. ' +
          'Example: "Add POST /auth/refresh that rotates the refresh token on each use."'
      ),

    // ── Clarification ───────────────────────────────────────────────────────
    clarifying_questions: z
      .array(z.string().trim().min(1).max(300))
      .max(5)
      .default([])
      .describe(
        'Questions to ask the user when the task is ambiguous about WHAT to change (not HOW). ' +
          'Empty array [] means the task is clear enough to plan immediately. ' +
          'When non-empty: steps should still be a best-effort plan.'
      ),

    // ── Risk and constraints ────────────────────────────────────────────────
    risk: z
      .enum(['low', 'medium', 'high'])
      .describe(
        'low    = read-only or trivial isolated change, new tests. ' +
          'medium = modifies existing logic, adds to existing module. ' +
          'high   = deletes code, cross-cutting rename, changes public API, touches entry points.'
      ),

    assumptions: z
      .array(z.string().trim().min(1).max(160))
      .max(20)
      .default([])
      .describe(
        'Facts inferred about the codebase that the plan depends on. ' +
          'The reader will verify these. Be explicit. ' +
          'Example: "TokenService is injected via NestJS DI as a singleton"'
      ),

    constraints: z
      .array(z.string().trim().min(1).max(240))
      .max(10)
      .default([])
      .describe(
        'Hard rules the implementation must follow regardless of what the reader finds. ' +
          'Always include type-check constraint for typed languages. ' +
          'Example: "Do not change the public TokenService interface"'
      ),

    // ── File targeting ──────────────────────────────────────────────────────
    files_affected: z
      .array(RelativeFilePath)
      .max(40)
      .default([])
      .describe(
        'Complete list of files that will be created, edited, or deleted. ' +
          'Must equal the union of all non-inspect step.files.'
      ),

    // ── Execution steps (DAG) ───────────────────────────────────────────────
    steps: z
      .array(PlanStepSchema)
      .min(1)
      .max(10)
      .describe(
        'Ordered DAG of atomic work units. ' +
          'Inspect steps ALWAYS come before edit/create/delete steps on the same files. ' +
          'No circular dependencies. No orphaned depends_on references.'
      ),

    // ── Optional git step ───────────────────────────────────────────────────
    gitStep: GitStepSchema.nullable()
      .default(null)
      .describe('Git operations after edits complete. Null = no git step.'),
  })
  .strict()

  // ─── Cross-field validation ──────────────────────────────────────────────
  .superRefine((data, ctx) => {
    const stepsById = new Map(data.steps.map((s, i) => [s.id, { step: s, index: i }]));
    const adjacency = new Map<string, string[]>(
      data.steps.map((s) => [s.id, [...s.depends_on]])
    );

    const hasPath = (from: string, to: string): boolean => {
      if (from === to) return true;
      const visited = new Set<string>();
      const queue = [from];
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const dep of adjacency.get(current) ?? []) {
          if (dep === to) return true;
          if (!visited.has(dep)) queue.push(dep);
        }
      }
      return false;
    };

    // 1. Step IDs must be unique
    const ids = data.steps.map((s) => s.id);
    const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicateIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: `Duplicate step IDs: ${duplicateIds.join(', ')}`,
      });
    }

    // 2. depends_on must reference existing step IDs
    const idSet = new Set(ids);
    data.steps.forEach((step, i) => {
      step.depends_on.forEach((depId) => {
        const dep = stepsById.get(depId);
        if (!dep || !idSet.has(depId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', i, 'depends_on'],
            message: `Step "${step.id}" depends on unknown step "${depId}".`,
          });
          return;
        }

        // depends_on must only point to earlier steps in the array (ordered DAG)
        if (dep.index >= i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', i, 'depends_on'],
            message: `Step "${step.id}" depends on "${depId}" which must appear earlier in steps.`,
          });
        }
        // No self-dependency
        if (depId === step.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', i, 'depends_on'],
            message: `Step "${step.id}" cannot depend on itself.`,
          });
        }
      });
    });

    // 2b. No cycles (ordered check catches most; this guards malformed manual plans)
    const visit = (id: string, stack: Set<string>, done: Set<string>): void => {
      if (done.has(id)) return;
      if (stack.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps'],
          message: `Cycle detected in depends_on graph at step "${id}".`,
        });
        return;
      }
      stack.add(id);
      for (const dep of adjacency.get(id) ?? []) visit(dep, stack, done);
      stack.delete(id);
      done.add(id);
    };
    const done = new Set<string>();
    for (const id of ids) visit(id, new Set<string>(), done);

    // 3. Every edit/create/delete step must depend on at least one inspect step
    //    that covers at least one of its files
    const inspectCoverage = new Map<string, Set<string>>(); // file → set of inspect step IDs
    data.steps.forEach((step) => {
      if (step.kind === 'inspect') {
        step.files.forEach((file) => {
          if (!inspectCoverage.has(file)) inspectCoverage.set(file, new Set());
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          inspectCoverage.get(file)!.add(step.id);
        });
      }
    });

    data.steps.forEach((step, i) => {
      // inspect: nothing to depend on. create: makes a NEW file — there is
      // nothing to inspect, so requiring an inspect dependency is impossible.
      // bash-only (no files): nothing to inspect either.
      if (step.kind === 'inspect' || step.kind === 'create' || step.files.length === 0) return;

      const hasInspectDep = step.files.some((file) => {
        const inspectors = inspectCoverage.get(file) ?? new Set();
        return [...inspectors].some((inspectId) => hasPath(step.id, inspectId));
      });

      if (!hasInspectDep) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', i, 'depends_on'],
          message:
            `Step "${step.id}" (${step.kind}) must depend on an inspect step ` +
            `that covers at least one of its files: [${step.files.join(', ')}].`,
        });
      }
    });

    // 4. files_affected must equal union of non-inspect step files
    const nonInspectFiles = new Set(
      data.steps.filter((s) => s.kind !== 'inspect').flatMap((s) => s.files)
    );
    const affectedSet = new Set(data.files_affected);
    nonInspectFiles.forEach((file) => {
      if (!affectedSet.has(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files_affected'],
          message: `File "${file}" appears in a non-inspect step but is missing from files_affected.`,
        });
      }
    });
    data.files_affected.forEach((file) => {
      if (!nonInspectFiles.has(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['files_affected'],
          message: `File "${file}" is listed in files_affected but not used by any non-inspect step.`,
        });
      }
    });

    // 5. delete intent implies high risk
    const hasDeleteStep = data.steps.some((s) => s.kind === 'delete');
    if (hasDeleteStep && data.risk !== 'high') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['risk'],
        message: 'risk must be "high" when any step has kind="delete".',
      });
    }

    // 6. clarifying_questions empty → steps must be non-empty (already enforced by min(1))
    // clarifying_questions non-empty → allowed to still have steps (best-effort plan)
  });

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
