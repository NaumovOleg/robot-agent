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

const NonEmptyTextSchema = z.string().trim().min(1);

export const ExecutorHintSchema = z
  .object({
    op: z.enum([
      'replace_node', 'insert_node', 'remove_node', 'rename_symbol',
      'replace_text', 'insert_text', 'remove_text',
      'create_file', 'delete_file', 'rename_file',
    ]),
    file: RelativePathSchema,
    nodeType: z.string().trim().min(1).nullable().optional(),
    symbol: z.string().trim().min(1).nullable().optional(),
    newSymbol: z.string().trim().min(1).nullable().optional(),
    anchor: z.string().trim().min(1).nullable().optional(),
    newContent: NonEmptyTextSchema.nullable().optional(),
    // rename_file destination, repo-relative
    target: RelativePathSchema.nullable().optional(),
    // insert_text placement relative to anchor; defaults to 'after'
    insertMode: z.enum(['before', 'after', 'start', 'end']).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const need = (field: keyof typeof data, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message });

    const hasAnchor = typeof data.anchor === 'string' && data.anchor.length > 0;
    const hasNodeType = typeof data.nodeType === 'string' && data.nodeType.length > 0;
    const hasSymbol = typeof data.symbol === 'string' && data.symbol.length > 0;
    const hasNewSymbol = typeof data.newSymbol === 'string' && data.newSymbol.length > 0;
    const hasNewContent = typeof data.newContent === 'string' && data.newContent.length > 0;
    const hasTarget = typeof data.target === 'string' && data.target.length > 0;

    switch (data.op) {
      case 'create_file':
        if (!hasNewContent) need('newContent', 'newContent is required for create_file.');
        break;
      case 'rename_file':
        if (!hasTarget) need('target', 'target is required for rename_file.');
        if (hasTarget && data.target === data.file) {
          need('target', 'target must differ from file for rename_file.');
        }
        break;
      case 'replace_text':
        if (!hasAnchor) need('anchor', 'anchor is required for replace_text.');
        if (!hasNewContent) need('newContent', 'newContent is required for replace_text.');
        break;
      case 'insert_text': {
        if (!hasNewContent) need('newContent', 'newContent is required for insert_text.');
        const mode = data.insertMode ?? 'after';
        if ((mode === 'before' || mode === 'after') && !hasAnchor) {
          need('anchor', `anchor is required for insert_text when insertMode is "${mode}".`);
        }
        break;
      }
      case 'remove_text':
        if (!hasAnchor) need('anchor', 'anchor is required for remove_text.');
        break;
      case 'replace_node':
        if (!hasNodeType) need('nodeType', 'nodeType is required for replace_node.');
        if (!hasSymbol) need('symbol', 'symbol is required for replace_node.');
        if (!hasNewContent) need('newContent', 'newContent is required for replace_node.');
        break;
      case 'insert_node':
        if (!hasNodeType) need('nodeType', 'nodeType is required for insert_node.');
        if (!hasNewContent) need('newContent', 'newContent is required for insert_node.');
        break;
      case 'remove_node':
        if (!hasNodeType) need('nodeType', 'nodeType is required for remove_node.');
        if (!hasSymbol) need('symbol', 'symbol is required for remove_node.');
        break;
      case 'rename_symbol':
        if (!hasSymbol) need('symbol', 'symbol is required for rename_symbol.');
        if (!hasNewSymbol) need('newSymbol', 'newSymbol is required for rename_symbol.');
        if (hasSymbol && hasNewSymbol && data.symbol === data.newSymbol) {
          need('newSymbol', 'newSymbol must differ from symbol for rename_symbol.');
        }
        break;
      default:
        break;
    }
  });
export type ExecutorHint = z.infer<typeof ExecutorHintSchema>;

export const MiniReaderOutputSchema = z.object({
  hints: z.array(ExecutorHintSchema).max(30),
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
