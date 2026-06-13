import { z } from 'zod';

const RelativeFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine((value) => !value.startsWith('/'), {
    message: 'File path must be relative to repository root.',
  })
  .refine((value) => !/^[A-Za-z]:[\\/]/.test(value), {
    message: 'Windows absolute file paths are not allowed.',
  })
  .refine((value) => !value.split(/[\\/]/).includes('..'), {
    message: 'File path cannot include parent directory traversal (..).',
  })
  .describe(
    'Relative file path from repository root. Examples: src/app.tsx, packages/shared/src/index.ts'
  );

// Preprocess: strip to null if not valid "N" or "N-M" format
const LineRangeSchema = z
  .preprocess(
    (v) => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v !== 'string') return null;
      const trimmed = v.trim();
      if (/^\d+(?:-\d+)?$/.test(trimmed)) {
        const parts = trimmed.split('-').map(Number);
        if (parts.length === 2 && parts[1] < parts[0]) return null;
        return trimmed;
      }
      return null;
    },
    z
      .string()
      .nullable()
      .default(null)
      .describe('Optional line range associated with the edit. Example: "43-52".')
  );

// Preprocess: strip invalid IDs to null rather than rejecting
const EditIdSchema = z
  .preprocess(
    (v) => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v !== 'string') return null;
      const trimmed = v.trim().toLowerCase().replace(/[_\s]+/g, '-');
      return /^[a-z][a-z0-9-]*$/.test(trimmed) && trimmed.length >= 3
        ? trimmed.slice(0, 96)
        : null;
    },
    z
      .string()
      .nullable()
      .default(null)
      .describe(
        'Optional stable identifier in lowercase kebab-case. Example: "rename-app-declaration".'
      )
  );

// Preprocess: collapse multi-line reasoning to first non-empty line
const ShortReasoningSchema = z
  .preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const firstLine = v.split('\n').find((l) => l.trim()) ?? v;
      return firstLine.trim().slice(0, 160);
    },
    z.string().trim().min(1).max(160).describe('Short factual justification. One sentence maximum.')
  );

// Preprocess: collapse multi-line verification steps to first non-empty line
const ShortVerificationStepSchema = z
  .preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const firstLine = v.split('\n').find((l) => l.trim()) ?? v;
      return firstLine.trim().slice(0, 120);
    },
    z.string().trim().min(1).max(120).describe('Concise validation step.')
  );

const SourceCodeSchema = z
  .string()
  .min(1)
  .describe('Valid source code only. Never markdown or prose.');

// Preprocess anchor value: take first non-empty line, strip to 300 chars.
// LLM sometimes generates multi-line anchors — normalize silently rather than rejecting.
const AnchorSchema = z
  .object({
    type: z
      .enum(['exact', 'contains'])
      .describe(
        '"exact": The value must match the file content character-for-character including whitespace and indentation. ' +
          '"contains": A short stable substring that uniquely identifies the location — pick a single line, not a multi-line block.'
      ),
    value: z.preprocess(
      (v) => {
        if (typeof v !== 'string') return v;
        const firstLine = v.split(/\r?\n/).find((l) => l.trim()) ?? v;
        return firstLine.slice(0, 300);
      },
      z
        .string()
        .min(1)
        .max(300)
        .describe(
          `Anchor text used to locate code in the source file.
    ## Rules
      - Preserve original formatting exactly when type is "exact", including indentation, tabs, spacing, JSX layout, and line breaks.
      - Never minify, compact, normalize whitespace, collapse multi-line code into a single line, or rewrite the source formatting.
      - For type "contains", prefer a short stable substring instead of a large block.
      - Anchor must be a single line.`
        )
    ),
    match: z
      .enum(['unique', 'nth'])
      .default('unique')
      .describe(
        '`unique` requires exactly one match in the file. `nth` selects the 1-based occurrence.'
      ),
    occurrence: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(1)
      .describe('1-based occurrence used only when match is "nth".'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.match === 'unique' && data.occurrence !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['occurrence'],
        message: 'occurrence must be 1 when match is "unique".',
      });
    }
  });

const BaseEditSchema = z.object({
  file: RelativeFilePathSchema,
  lines: LineRangeSchema,
  id: EditIdSchema,
});

const TextReplaceEditSchema = BaseEditSchema.extend({
  mode: z.literal('text'),
  action: z.literal('replace'),
  anchor: AnchorSchema.describe('Required for text/replace. Use a single stable anchor line.'),
  replaceWith: SourceCodeSchema.describe(
    `Required for text/replace. The exact replacement source code.
      - Single-line change: anchor is one line, replaceWith is one line, before is null.
      - Multi-line change: replaceWith spans multiple lines. Set before to the exact existing multi-line block when known.
      Never include surrounding unchanged lines.
      Must materially differ from the matched source.`
  ),
  before: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Exact existing source block being replaced, copied verbatim from the file. ' +
      'Set when replaceWith is multi-line and you know the current content. ' +
      'Must include anchor.value as a substring when provided. Null is acceptable — the executor will locate the block.'
    ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
})
  .strict()
  .superRefine((data, ctx) => {
    if (data.replaceWith === data.anchor.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replaceWith'],
        message: 'replaceWith must differ from anchor.value.',
      });
    }
    // Strip before when it doesn't contain anchor.value — executor falls back to anchor.value as old_str
  })
  .transform((data) => {
    if (data.before != null && !data.before.includes(data.anchor.value)) {
      return { ...data, before: null };
    }
    return data;
  });

const TextInsertEditSchema = BaseEditSchema.extend({
  mode: z.literal('text'),
  action: z.literal('insert'),
  anchor: AnchorSchema.nullable()
    .default(null)
    .describe(
      'Required only when insertMode is "before" or "after". Not used for "start" or "end".'
    ),
  insertMode: z.enum(['before', 'after', 'start', 'end']).describe(
    `Required for text/insert.
      - "before": Insert before anchor line.
      - "after": Insert after anchor line.
      - "start": Top of file.
      - "end": Bottom of file.`
  ),
  insertText: SourceCodeSchema.describe(
    'Required for text/insert. Include correct indentation and newlines.'
  ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
})
  .strict()
  .superRefine((data, ctx) => {
    const needsAnchor = data.insertMode === 'before' || data.insertMode === 'after';
    if (needsAnchor && !data.anchor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchor'],
        message: 'anchor is required for insertMode "before" and "after".',
      });
    }
    // Note: anchor with start/end is silently ignored by executor — no need to error
  })
  .transform((data) => {
    // Strip anchor when insertMode is start/end — executor doesn't use it there
    const needsAnchor = data.insertMode === 'before' || data.insertMode === 'after';
    if (!needsAnchor && data.anchor) {
      return { ...data, anchor: null };
    }
    return data;
  });

const TextRemoveEditSchema = BaseEditSchema.extend({
  mode: z.literal('text'),
  action: z.literal('remove'),
  anchor: AnchorSchema.describe('Required for text/remove. Use a single stable anchor line.'),
  target: SourceCodeSchema.nullable()
    .default(null)
    .describe(
      'Optional for text/remove. Exact verbatim code block to remove when known; null means remove anchor.value.'
    ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
})
  .strict()
  .transform((data) => {
    // When target does not include anchor, runtime would reject; normalize to null
    // so executor safely falls back to anchor.value.
    if (data.target != null && !data.target.includes(data.anchor.value)) {
      return { ...data, target: null };
    }
    return data;
  });

export const TextEditSchema = z.union([
  TextReplaceEditSchema,
  TextInsertEditSchema,
  TextRemoveEditSchema,
]);

const AstReplaceEditSchema = BaseEditSchema.extend({
  mode: z.literal('ast'),
  action: z.literal('replace'),
  nodeType: z
    .string()
    .trim()
    .min(1)
    .describe(
      `Required for ast mode. Tree-sitter node type.
      Examples: "variable_declarator" for "const Foo = ...", "function_declaration" for "function foo() {}", "class_declaration" for classes.`
    ),
  symbol: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Required for ast mode. The symbol name exactly as it appears in the declaration. Example: "App".'
    ),
  parentNodeType: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      'Optional for ast mode. Narrows the match when the same symbol exists in multiple node types. Example: "program", "variable_statement".'
    ),
  beforeSnippet: SourceCodeSchema.nullable()
    .default(null)
    .describe(
      'Optional observed source snippet for the node before replacement. Must be copied from reader evidence when available.'
    ),
  afterSnippet: SourceCodeSchema.describe(
    `Required for ast/replace. Full desired function or class body after edit.
      Valid source code only.`
  ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
})
  .strict()
  .superRefine((data, ctx) => {
    if (data.beforeSnippet && data.beforeSnippet === data.afterSnippet) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['afterSnippet'],
        message: 'afterSnippet must differ from beforeSnippet.',
      });
    }
    // lines is optional — tree-sitter resolves by symbol name, not line number
  });

const AstInsertEditSchema = BaseEditSchema.extend({
  mode: z.literal('ast'),
  action: z.literal('insert'),
  nodeType: z
    .string()
    .trim()
    .min(1)
    .describe(
      `Required for ast mode. Tree-sitter node type.
      Examples: "variable_declarator" for "const Foo = ...", "function_declaration" for "function foo() {}", "class_declaration" for classes.`
    ),
  insertSnippet: SourceCodeSchema.describe(
    'Required for ast/insert. Full new function or class to insert. Valid source code only.'
  ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
}).strict();

const AstRemoveEditSchema = BaseEditSchema.extend({
  mode: z.literal('ast'),
  action: z.literal('remove'),
  nodeType: z
    .string()
    .trim()
    .min(1)
    .describe(
      `Required for ast mode. Tree-sitter node type.
      Examples: "variable_declarator" for "const Foo = ...", "function_declaration" for "function foo() {}", "class_declaration" for classes.`
    ),
  symbol: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Required for ast mode. The symbol name exactly as it appears in the declaration. Example: "App".'
    ),
  parentNodeType: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      'Optional for ast mode. Narrows the match when the same symbol exists in multiple node types. Example: "program", "variable_statement".'
    ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
}).strict();
// lines is optional — tree-sitter resolves by symbol name, not line number

const AstRenameEditSchema = BaseEditSchema.extend({
  mode: z.literal('ast'),
  action: z.literal('rename'),
  nodeType: z
    .string()
    .trim()
    .min(1)
    .describe(
      `Required for ast mode. Tree-sitter node type.
      Examples: "variable_declarator" for "const Foo = ...", "function_declaration" for "function foo() {}", "class_declaration" for classes.`
    ),
  symbol: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Required for ast mode. The symbol name exactly as it appears in the declaration. Example: "App".'
    ),
  newSymbol: z
    .string()
    .trim()
    .min(1)
    .describe(
      `Required for ast/rename. The new name after renaming. Example: "Page".
      Generate one ast/rename edit for the declaration site only — JSX usages get separate text/replace edits.`
    ),
  parentNodeType: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      'Optional for ast mode. Narrows the match when the same symbol exists in multiple node types. Example: "program", "variable_statement".'
    ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
})
  .strict()
  .superRefine((data, ctx) => {
    if (data.symbol === data.newSymbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newSymbol'],
        message: 'newSymbol must differ from symbol.',
      });
    }
    // lines is optional — tree-sitter resolves by symbol name, not line number
  });

export const AstEditSchema = z.union([
  AstReplaceEditSchema,
  AstInsertEditSchema,
  AstRemoveEditSchema,
  AstRenameEditSchema,
]);

const FileInsertEditSchema = BaseEditSchema.extend({
  mode: z.literal('file'),
  action: z.literal('insert'),
  insertText: SourceCodeSchema.describe(
    'Required for file/insert. Valid source code only with correct indentation and newlines.'
  ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
}).strict();

const FileRemoveEditSchema = BaseEditSchema.extend({
  mode: z.literal('file'),
  action: z.literal('remove'),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
}).strict();

const FileRenameEditSchema = BaseEditSchema.extend({
  mode: z.literal('file'),
  action: z.literal('rename'),
  target: RelativeFilePathSchema.describe(
    'Required for file/rename. Destination file path after rename or move.'
  ),
  reasoning: ShortReasoningSchema.describe(
    'Why this specific edit is needed. Name the symbol, line, or finding that motivates it.'
  ),
})
  .strict()
  .superRefine((data, ctx) => {
    if (data.file === data.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target'],
        message: 'file/rename target must differ from file.',
      });
    }
  });

export const FileEditSchema = z.union([
  FileInsertEditSchema,
  FileRemoveEditSchema,
  FileRenameEditSchema,
]);

export const EditSchema = z.union([TextEditSchema, AstEditSchema, FileEditSchema]);

export const IntentSchema = z
  .object({
    edits: z
      .array(EditSchema)
      .max(80)
      .describe(
        'Ordered edit operations. Use an empty array only when evidence is insufficient for safe required edits.'
      ),
    verification: z
      .array(ShortVerificationStepSchema)
      .max(12)
      .default([])
      .describe('Post-edit validation steps. 1-4 steps when edits exist; [] when no edits.'),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'How complete and unambiguous the analysis is. 0.9–1.0: all locations clear. 0.7–0.9: minor gaps. Below 0.7: incomplete.'
      ),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.edits.length > 0 && data.verification.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verification'],
        message: 'At least one verification step is required when edits are present.',
      });
    }

    if (data.edits.length === 0 && data.verification.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verification'],
        message: 'verification must be empty when edits are empty.',
      });
    }

    if (data.edits.length === 0 && data.confidence > 0.69) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message: 'confidence must be below 0.7 when no edits are produced.',
      });
    }

    const ids = new Set<string>();
    data.edits.forEach((edit, index) => {
      if (!edit.id) return;
      if (ids.has(edit.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edits', index, 'id'],
          message: `Duplicate edit id "${edit.id}".`,
        });
      } else {
        ids.add(edit.id);
      }
    });
  });

export type IntentSchemaType = z.infer<typeof IntentSchema>;
