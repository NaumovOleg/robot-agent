import { z } from 'zod';

export const GitOpResultSchema = z.object({
  op: z.string(),
  status: z.enum(['ok', 'skipped', 'failed']),
  output: z.string(),
  error: z.string().optional(),
});

export const GitIntentSchema = z.object({
  filesToStage: z.array(z.string()),
  commitMessage: z.string(),
  branch: z.string().optional(),
  push: z.boolean(),
  amend: z.boolean().default(false),
});

export type GitIntentType = z.infer<typeof GitIntentSchema>;
export type GitOpResult = z.infer<typeof GitOpResultSchema>;
