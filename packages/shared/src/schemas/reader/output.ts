import { z } from 'zod';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isRelativeRepoPath = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.split(/[\\/]/).includes('..')) return false;
  return true;
};

const extractFileFromLocation = (location: string): string => location.split(':')[0]?.trim() ?? '';

const normalizeLineRange = (val: unknown): string => {
  if (val == null) return '';
  if (typeof val === 'number') return String(Math.floor(val));
  if (typeof val === 'string') return val.trim();
  return '';
};

const clipStr =
  (max: number) =>
  (v: unknown): unknown => {
    if (v == null) return v;
    if (typeof v !== 'string') return v;
    const t = v.trim();
    return t.length > max ? t.slice(0, max) : t;
  };

// ─── Primitives ───────────────────────────────────────────────────────────────

const RelativeFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine(isRelativeRepoPath, {
    message:
      'File path must be relative to the repository root and must not contain ".." or absolute prefixes.',
  })
  .describe('Relative path from repository root. Example: src/foo.ts');

/**
 * LLM-robust line range: accepts string "N", "N-M", number N, null, or undefined.
 * Always outputs a string. Empty string means unknown.
 */
const LineRangeSchema = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform(normalizeLineRange)
  .pipe(z.string().max(40))
  .describe('Line range in the file. Format: "N" or "N-M". Empty string when unknown.');

const LocationSchema = z
  .string()
  .trim()
  .min(3)
  .max(300)
  .describe(
    'File location with line info. Format: "path/to/file.ts:N" or "path/to/file.ts:N-M" or "path/to/file.ts:N:col".'
  );

const ShortTextSchema = z.string().trim().min(1).max(320);

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .describe('Symbol or identifier name as it appears in source.');

const SourceSnippetSchema = z
  .preprocess(clipStr(6000), z.string().min(1).max(6000))
  .describe(
    'Verbatim source code excerpt. Preserve original formatting and indentation. Do not rewrite into prose.'
  );

// ─── Reader structures ────────────────────────────────────────────────────────

const ReaderFunctionSchema = z
  .object({
    name: IdentifierSchema.describe('Function or component name as declared in source.'),
    nodeType: ShortTextSchema.nullable()
      .default(null)
      .describe('Tree-sitter node type. Example: arrow_function, function_declaration.'),
    parentNodeType: ShortTextSchema.nullable()
      .default(null)
      .describe('Parent node type for disambiguation. Example: variable_declarator.'),
    signature: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe('Function signature as observed in source. Do not include body.'),
    params: z
      .array(z.string().trim().min(1).max(180))
      .max(60)
      .default([])
      .describe('Parameter names or type annotations as they appear in source.'),
    returnType: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .nullable()
      .default(null)
      .describe('Return type annotation if present.'),
    location: LocationSchema.describe(
      'Location of the function definition. Example: src/app.tsx:43'
    ),
    bodyPreview: z
      .preprocess(clipStr(1400), z.string().min(1).max(1400).nullable().default(null))
      .describe('First 1-5 lines of the function body verbatim. Auto-truncated at 1400 chars.'),
    calls: z
      .array(IdentifierSchema)
      .max(120)
      .default([])
      .describe('Names of functions or hooks called inside this function.'),
  })
  .strict();

const ReaderClassSchema = z
  .object({
    name: IdentifierSchema.describe('Class name as declared.'),
    methods: z
      .array(IdentifierSchema)
      .max(120)
      .default([])
      .describe('Method names defined on this class.'),
    properties: z
      .array(IdentifierSchema)
      .max(120)
      .default([])
      .describe('Property names defined on this class.'),
    location: LocationSchema,
  })
  .strict();

const ReaderImportSchema = z
  .object({
    source: z
      .string()
      .trim()
      .min(1)
      .max(260)
      .describe("Import source path or package name. Example: '@hooks', 'react'."),
    specifiers: z
      .array(IdentifierSchema)
      .max(80)
      .default([])
      .describe('Named or default specifiers imported from this source.'),
    isDefault: z.boolean().default(false).describe('True if this is a default import.'),
    location: z
      .preprocess((v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'string') return v;
        // LLM sometimes generates { startLine, endLine } object — convert to line range string
        if (typeof v === 'object') {
          const obj = v as Record<string, unknown>;
          const start = obj.startLine ?? obj.start ?? obj.line ?? '';
          const end = obj.endLine ?? obj.end ?? '';
          if (start && end && start !== end) return `${start}-${end}`;
          if (start) return String(start);
          return '';
        }
        return '';
      }, z.string().max(300).default(''))
      .describe('File and line where this import statement appears.'),
  })
  .strict();

const ReaderReferenceUsageSchema = z
  .object({
    file: RelativeFilePathSchema,
    line: z.number().int().min(1).describe('1-based line number of the usage.'),
    context: z
      .string()
      .trim()
      .max(700)
      .default('')
      .describe('Short verbatim code excerpt showing how the symbol is used on this line.'),
  })
  .strict();

const ReaderReferenceSchema = z.object({
  symbol: IdentifierSchema.describe('Symbol name being tracked.'),
  usages: z
    .array(ReaderReferenceUsageSchema)
    .max(400)
    .default([])
    .describe('All observed usages of this symbol across inspected files.'),
});
// Not strict: LLM sometimes embeds top-level fields (key_findings, potential_edit_strategy)
// inside reference objects by mistake — strip them silently rather than rejecting.
// ─── Key findings ─────────────────────────────────────────────────────────────

export const ReaderKeyFindingSchema = z
  .object({
    file: RelativeFilePathSchema,
    lines: LineRangeSchema,
    content: SourceSnippetSchema,
    comment: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .describe(
        'Why this finding matters for the planned edit. Reference specific symbols or lines.'
      ),
  })
  .strict();

// ─── Operation hints ──────────────────────────────────────────────────────────

const AST_OPS = new Set(['replace_node', 'insert_node', 'remove_node'] as const);

const SYMBOL_OPS = new Set(['replace_node', 'remove_node', 'rename_symbol'] as const);

const ANCHOR_REQUIRED_OPS = new Set(['replace_text', 'remove_text'] as const);

const CREATE_OPS = new Set(['create_file'] as const);

const OperationHintSchema = z
  .object({
    op: z
      .enum([
        'create_file',
        'delete_file',
        'rename_file',
        'replace_node',
        'insert_node',
        'remove_node',
        'rename_symbol',
        'replace_text',
        'insert_text',
        'remove_text',
      ])
      .describe('Atomic operation category for the edit planner.'),
    file: RelativeFilePathSchema.describe(
      'Target file. For create_file this is the path of the file to create.'
    ),
    lines: LineRangeSchema,
    nodeType: ShortTextSchema.nullable()
      .default(null)
      .describe(
        'Required for AST ops (replace_node, insert_node, remove_node). Tree-sitter node type. Example: variable_declarator.'
      ),
    symbol: IdentifierSchema.nullable()
      .default(null)
      .describe(
        'Symbol name exactly as declared. Required for replace_node, remove_node, and rename_symbol.'
      ),
    newSymbol: IdentifierSchema.nullable()
      .default(null)
      .describe('Required for rename_symbol. The new symbol name after rename.'),
    anchor: z
      .preprocess((val) => {
        if (val == null || typeof val !== 'string') return val;
        // LLMs sometimes emit multi-line anchors — take only the first non-empty line.
        const firstLine = val.split(/[\r\n]/)[0]?.trim() ?? '';
        return firstLine.length > 280 ? firstLine.slice(0, 280) : firstLine;
      }, z.string().trim().min(1).max(300).nullable().default(null))
      .describe(
        'Required for text ops (replace_text, insert_text, remove_text). ' +
          'Single-line verbatim substring copied from file source. No newlines.'
      ),
    details: z
      .string()
      .trim()
      .min(1)
      .max(420)
      .describe('One concise implementation instruction for this atomic operation.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (AST_OPS.has(data.op as any) && !data.nodeType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nodeType'],
        message: `nodeType is required for op "${data.op}".`,
      });
    }

    if (SYMBOL_OPS.has(data.op as any) && !data.symbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['symbol'],
        message: `symbol is required for op "${data.op}".`,
      });
    }

    if (data.op === 'rename_symbol' && !data.newSymbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newSymbol'],
        message: 'newSymbol is required for rename_symbol.',
      });
    }

    if (
      data.op === 'rename_symbol' &&
      data.symbol &&
      data.newSymbol &&
      data.symbol === data.newSymbol
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newSymbol'],
        message: 'newSymbol must differ from symbol.',
      });
    }

    if (ANCHOR_REQUIRED_OPS.has(data.op as any) && !data.anchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchor'],
        message: `anchor is required for op "${data.op}".`,
      });
    }
  });

// ─── Edit strategy ────────────────────────────────────────────────────────────

const PotentialEditStrategySchema = z
  .object({
    goal: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .describe(
        "Single concrete objective. Example: 'Add FAQ route and integrate into navigation and app switch'."
      ),
    files_to_modify: z
      .array(RelativeFilePathSchema)
      .max(60)
      .default([])
      .describe(
        'Files that require modifications. Include new files to be created so operation_hints can reference them.'
      ),
    change_type: z
      .enum(['add', 'modify', 'delete', 'refactor', 'rename', 'create'])
      .describe('Primary change category.'),
    instructions: z
      .string()
      .trim()
      .min(1)
      .max(8200)
      .describe(
        'Concrete numbered implementation steps for the writer agent. Reference specific file paths, symbol names, and line numbers.'
      ),
    constraints: z
      .array(z.string().trim().min(1).max(240))
      .max(40)
      .default([])
      .describe('Hard rules that must be preserved during editing.'),
    operation_hints: z
      .array(OperationHintSchema)
      .max(120)
      .default([])
      .describe(
        'Ordered atomic edit hints for the edit-intent planner. One hint per logical change. ' +
          'For create_file ops, the file may not yet be in filesAnalyzed.'
      ),
  })
  .strict();

// ─── Root output schema ───────────────────────────────────────────────────────

export const ReaderOutputSchema = z
  // Not strict: LLM generates unknown top-level fields (e.g. "constructs") — strip silently.
  .object({
    schemaVersion: z
      .literal('reader.output.v2')
      .default('reader.output.v2')
      .describe('Schema version identifier. Always "reader.output.v2".'),
    status: z
      .enum(['sufficient', 'insufficient', 'blocked'])
      .default('sufficient')
      .describe(
        '"sufficient": evidence is complete for safe edit planning. ' +
          '"insufficient": more inspection needed. ' +
          '"blocked": cannot proceed due to missing access or unresolvable dependency.'
      ),
    summary: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Concise evidence-based summary for orchestrator and writer agents. ' +
          'Include key symbol names, file paths, and line ranges relevant to the planned edit.'
      ),
    language: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .nullable()
      .default(null)
      .describe("Primary detected language. Example: 'typescript', 'python'."),
    filesAnalyzed: z
      .array(RelativeFilePathSchema)
      .max(300)
      .default([])
      .describe('Unique list of files directly inspected. Used to validate cross-references.'),
    functions: z
      .array(ReaderFunctionSchema)
      .max(400)
      .default([])
      .describe('Functions and components extracted from inspected files.'),
    classes: z
      .array(ReaderClassSchema)
      .max(250)
      .default([])
      .describe('Classes extracted from inspected files.'),
    imports: z
      .array(ReaderImportSchema)
      .max(500)
      .default([])
      .describe('Import statements extracted from inspected files.'),
    references: z
      .array(ReaderReferenceSchema)
      .max(400)
      .default([])
      .describe('Symbol usages tracked across inspected files.'),
    unresolvedQuestions: z
      .array(z.string().trim().min(1).max(240))
      .max(40)
      .default([])
      .describe('Questions that remain unanswered after inspection and may affect edit safety.'),
    key_findings: z
      .array(ReaderKeyFindingSchema)
      .max(180)
      .default([])
      .describe(
        'Important code-level insights that directly inform the edit plan. ' +
          'Include verbatim snippets with exact indentation.'
      ),
    potential_edit_strategy: PotentialEditStrategySchema.nullable()
      .default(null)
      .describe('Structured edit plan. Null if status is "insufficient" or "blocked".'),
  })
  .superRefine((data, ctx) => {
    // ── status / strategy consistency ─────────────────────────────────────────
    // Note: sufficient + null strategy is accepted — buildEditIntent falls back to
    // key_findings / functions / imports when potential_edit_strategy is absent.

    if (data.status !== 'sufficient' && data.potential_edit_strategy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['potential_edit_strategy'],
        message: 'potential_edit_strategy must be null when status is "insufficient" or "blocked".',
      });
    }

    if (
      (data.status === 'insufficient' || data.status === 'blocked') &&
      data.unresolvedQuestions.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unresolvedQuestions'],
        message:
          'At least one unresolvedQuestion is required when status is "insufficient" or "blocked".',
      });
    }

    // ── cross-reference validation ─────────────────────────────────────────────
    const analyzedSet = new Set(data.filesAnalyzed);

    const ensureAnalyzed = (file: string, path: (string | number)[]) => {
      if (file && !analyzedSet.has(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `File "${file}" is referenced but not listed in filesAnalyzed.`,
        });
      }
    };

    data.functions.forEach((fn, i) => {
      const file = extractFileFromLocation(fn.location);
      if (!file) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['functions', i, 'location'],
          message: `Cannot extract file from location "${fn.location}".`,
        });
      } else {
        ensureAnalyzed(file, ['functions', i, 'location']);
      }
    });

    data.classes.forEach((cls, i) => {
      const file = extractFileFromLocation(cls.location);
      if (!file) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['classes', i, 'location'],
          message: `Cannot extract file from location "${cls.location}".`,
        });
      } else {
        ensureAnalyzed(file, ['classes', i, 'location']);
      }
    });

    data.imports.forEach((imp, i) => {
      if (!imp.location) return; // location is optional — skip cross-ref check when absent
      const file = extractFileFromLocation(imp.location);
      if (file) ensureAnalyzed(file, ['imports', i, 'location']);
    });

    data.references.forEach((ref, ri) => {
      ref.usages.forEach((usage, ui) => {
        ensureAnalyzed(usage.file, ['references', ri, 'usages', ui, 'file']);
      });
    });

    data.key_findings.forEach((finding, i) => {
      ensureAnalyzed(finding.file, ['key_findings', i, 'file']);
    });

    // NOTE: previously this required at least one of functions/classes/imports/
    // references to be non-empty for a "sufficient" output. That made the reader
    // HARD-FAIL (OUTPUT_PARSING_FAILURE) whenever the LLM returned a thin but
    // valid summary, which then failed the whole executor inspect step. A thin
    // output is still usable — the summary feeds the mini-reader and target files
    // are re-read fresh — so the requirement was removed.

    // ── strategy cross-refs ────────────────────────────────────────────────────
    const strategy = data.potential_edit_strategy;
    if (!strategy) return;

    const modifySet = new Set(strategy.files_to_modify);

    // Deduplicate files_to_modify
    const seenModify = new Set<string>();
    strategy.files_to_modify.forEach((file, i) => {
      if (seenModify.has(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['potential_edit_strategy', 'files_to_modify', i],
          message: `Duplicate entry "${file}" in files_to_modify.`,
        });
      }
      seenModify.add(file);
    });

    strategy.operation_hints.forEach((hint, i) => {
      if (CREATE_OPS.has(hint.op as any)) return;

      ensureAnalyzed(hint.file, ['potential_edit_strategy', 'operation_hints', i, 'file']);

      if (!modifySet.has(hint.file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['potential_edit_strategy', 'operation_hints', i, 'file'],
          message: `Operation hint references "${hint.file}" which is not in files_to_modify.`,
        });
      }
    });
  });
