import { z } from 'zod';

const FocusEntrySchema = z
  .string()
  .trim()
  .min(1)
  .max(220)
  .describe('File path, directory, or topic keyword to prioritize.');

export const ReaderInputSchema = z
  .object({
    task: z
      .string()
      .trim()
      .min(1)
      .max(1200)
      .describe(
        "What to investigate in the codebase. Use clear natural language. Example: 'Trace authentication flow from CLI entrypoint to token persistence.'"
      ),
    focus: z
      .array(FocusEntrySchema)
      .max(40)
      .default([])
      .describe(
        "Optional prioritization list of paths/patterns. Example: ['src/auth', 'src/config', 'refresh token']"
      ),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(8)
      .default(2)
      .describe('How deep to traverse directories when exploring.'),
    user_goal: z.string().trim().min(1).max(1000).describe('Original high-level user objective.'),
    current_plan_step: z
      .string()
      .trim()
      .min(1)
      .max(400)
      .optional()
      .nullable()
      .default('General codebase investigation')
      .describe('Current execution/planning step this read supports.'),
    instructions: z
      .string()
      .trim()
      .max(1200)
      .default('')
      .describe('Additional instructions that refine output behavior.'),
  })
  .strict();
