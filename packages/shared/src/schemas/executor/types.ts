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
// edit_text: oldText is the verbatim text to find, newText is its replacement.
// replace_node / create_file: newText is the replacement / full-file code.
// AST ops (replace_node, rename_symbol) target by nodeType/symbol.
const isRelativeRepoPath = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.split(/[\\/]/).includes('..')) return false;
  return true;
};

const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine(isRelativeRepoPath, {
    message:
      'Path must be relative to the repository root and must not contain ".." or absolute prefixes.',
  });

export const ExecutorHintSchema = z
  .object({
    op: z.enum([
      'edit_text', 'replace_node', 'rename_symbol',
      'create_file', 'delete_file', 'rename_file',
    ]),
    file: RelativePathSchema,
    // edit_text / create_file / replace_node payload.
    // No .trim() on oldText/newText: code content must be preserved verbatim.
    oldText: z.string().min(1).nullable().optional(),
    newText: z.string().min(1).nullable().optional(),
    // AST targeting
    nodeType: z.string().trim().min(1).nullable().optional(),
    symbol: z.string().trim().min(1).nullable().optional(),
    newSymbol: z.string().trim().min(1).nullable().optional(),
    // rename_file destination, repo-relative
    target: RelativePathSchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const need = (field: keyof typeof data, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });

    const has = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

    switch (data.op) {
      case 'edit_text':
        if (!has(data.oldText)) need('oldText', 'oldText is required for edit_text.');
        if (!has(data.newText)) need('newText', 'newText is required for edit_text.');
        break;
      case 'create_file':
        if (!has(data.newText)) need('newText', 'newText is required for create_file.');
        break;
      case 'rename_file':
        if (!has(data.target)) need('target', 'target is required for rename_file.');
        if (has(data.target) && data.target === data.file) {
          need('target', 'target must differ from file for rename_file.');
        }
        break;
      case 'replace_node':
        if (!has(data.nodeType)) need('nodeType', 'nodeType is required for replace_node.');
        if (!has(data.symbol)) need('symbol', 'symbol is required for replace_node.');
        if (!has(data.newText)) need('newText', 'newText is required for replace_node.');
        break;
      case 'rename_symbol':
        if (!has(data.symbol)) need('symbol', 'symbol is required for rename_symbol.');
        if (!has(data.newSymbol)) need('newSymbol', 'newSymbol is required for rename_symbol.');
        if (has(data.symbol) && has(data.newSymbol) && data.symbol === data.newSymbol) {
          need('newSymbol', 'newSymbol must differ from symbol for rename_symbol.');
        }
        break;
      case 'delete_file':
        // only `file` is required — no extra fields
        break;
    }
  });
export type ExecutorHint = z.infer<typeof ExecutorHintSchema>;

export const MiniReaderStatusSchema = z.enum(['edits', 'noop', 'blocked']);
export type MiniReaderStatus = z.infer<typeof MiniReaderStatusSchema>;

export const MiniReaderOutputSchema = z
  .object({
    status: MiniReaderStatusSchema,
    reason: z.string().trim().min(1),
    hints: z.array(ExecutorHintSchema).max(30).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.status === 'edits' && data.hints.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hints'],
        message: 'status "edits" requires at least one hint. Use "noop" if nothing needs changing, or "blocked" if you cannot proceed.',
      });
    }
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
