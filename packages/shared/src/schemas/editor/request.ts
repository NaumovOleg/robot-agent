import { z } from 'zod';
import { IntentSchema } from './intent';

export const EditorRequestSchema = z.object({
  editIntent: IntentSchema.describe('Structured edit plan produced by editIntentNode.'),
  sessionId: z.string().describe('Active session ID.'),
  cwd: z.string().describe('Working directory for resolving relative file paths.'),
  autoApprove: z
    .boolean()
    .default(false)
    .describe('When true, skip approval interrupts for all edits including destructive ones.'),
});
