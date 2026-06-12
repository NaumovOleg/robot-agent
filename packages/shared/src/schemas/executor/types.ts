import { z } from 'zod';

export const StepStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'skipped']);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepReviewStatusSchema = z.enum(['sufficient', 'insufficient', 'blocked']);
export type StepReviewStatus = z.infer<typeof StepReviewStatusSchema>;

export const StepResultSchema = z.object({
  stepId: z.string(),
  status: z.enum(['done', 'failed', 'skipped']),
  output: z.string(),
  retries: z.number().int().min(0),
});
export type StepResult = z.infer<typeof StepResultSchema>;

// Hint schema for mini-reader LLM output (edit steps).
// For AST ops: newContent is the actual replacement code.
// For text ops: newContent is the new text; anchor is the old text to find.
export const ExecutorHintSchema = z.object({
  op: z.enum([
    'replace_node', 'insert_node', 'remove_node', 'rename_symbol',
    'replace_text', 'insert_text', 'remove_text',
    'create_file', 'delete_file', 'rename_file',
  ]),
  file: z.string(),
  nodeType: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  newSymbol: z.string().nullable().optional(),
  anchor: z.string().nullable().optional(),
  newContent: z.string().nullable().optional(),
  // rename_file destination, repo-relative
  target: z.string().nullable().optional(),
  // insert_text placement relative to anchor; defaults to 'after'
  insertMode: z.enum(['before', 'after', 'start', 'end']).nullable().optional(),
});
export type ExecutorHint = z.infer<typeof ExecutorHintSchema>;

export const MiniReaderOutputSchema = z.object({
  hints: z.array(ExecutorHintSchema).max(30),
});

export const StepReviewOutputSchema = z.object({
  status: StepReviewStatusSchema,
  reason: z.string(),
});

// ─── Executor runtime types ───────────────────────────────────────────────────

export interface ReaderDigest {
  stepId: string;
  summary: string;
  keyFindings: { file: string; lines: string; content: string; comment: string }[];
  operationHints: unknown[];
}

export type EscalationDecision = 'skip' | 'retry' | 'abort';

export interface VerifyCommands {
  typeCheck: string | null;
  testRunner: string | null;
  lint: string | null;
}
