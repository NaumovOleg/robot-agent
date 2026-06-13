import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const isRelativeRepoPath = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.split(/[\\/]/).includes('..')) return false;
  return true;
};

const extractFileFromLocation = (location: string): string => location?.split(':')[0]?.trim() ?? '';

const normalizeLineRange = (val: unknown): string => {
  if (val == null) return '';
  if (typeof val === 'number') return String(Math.floor(val));
  if (typeof val === 'string') return val.trim();
  return '';
};

const clipStr =
  (max: number) =>
  (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    return t.length > max ? t.slice(0, max) : t;
  };

// robust extraction for LLM garbage shapes
const toStringArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') {
        const o = x as any;
        return (o.name || o.text || o.value || '').toString().trim();
      }
      return '';
    })
    .filter(Boolean);
};

// ─────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────

const FilePath = z.string().trim().min(1).max(260).refine(isRelativeRepoPath, {
  message: 'Must be relative repo path',
});

const LineRange = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform(normalizeLineRange)
  .pipe(z.string().max(40));

const Location = z.string().trim().min(1).max(300);

const Id = z.string().trim().min(1).max(160);

// ─────────────────────────────────────────────────────────────
// Function / Class / Import models (LLM tolerant)
// ─────────────────────────────────────────────────────────────

const FunctionSchema = z.object({
  name: Id,
  nodeType: z.string().nullable().default(null),
  parentNodeType: z.string().nullable().default(null),

  signature: z.string().nullable().default(null),

  params: z.preprocess(toStringArray, z.array(z.string()).default([])),

  returnType: z.string().nullable().default(null),

  location: z.string().nullable().default(null),

  bodyPreview: z.string().nullable().default(null),

  calls: z.preprocess(toStringArray, z.array(z.string()).default([])),
});

const ClassSchema = z.object({
  name: Id,
  methods: z.preprocess(toStringArray, z.array(z.string()).default([])),
  properties: z.preprocess(toStringArray, z.array(z.string()).default([])),
  location: z.string().nullable().default(null),
});

const ImportSchema = z.object({
  source: z.string().min(1),
  specifiers: z.preprocess(toStringArray, z.array(z.string()).default([])),
  isDefault: z.boolean().default(false),
  location: z.string().nullable().default(null),
});

// ─────────────────────────────────────────────────────────────
// References
// ─────────────────────────────────────────────────────────────

const ReferenceSchema = z.object({
  symbol: Id,
  usages: z
    .array(
      z.object({
        file: FilePath,
        line: z.number().int().positive(),
        context: z.string().default(''),
      })
    )
    .default([]),
});

// ─────────────────────────────────────────────────────────────
// Key findings
// ─────────────────────────────────────────────────────────────

const KeyFinding = z.object({
  file: FilePath,
  lines: LineRange,
  content: z.preprocess(clipStr(6000), z.string()),
  comment: z.string(),
});

// ─────────────────────────────────────────────────────────────
// Operation hints (simplified + safer)
// ─────────────────────────────────────────────────────────────

const OperationHint = z.object({
  op: z.enum([
    'create_file',
    'delete_file',
    'rename_file',
    'replace_node',
    'insert_node',
    'remove_node',
    'rename_symbol',
  ]),

  file: FilePath,
  lines: LineRange.optional(),

  nodeType: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  newSymbol: z.string().nullable().optional(),

  anchor: z.string().nullable().optional(),

  details: z.string(),
});

// ─────────────────────────────────────────────────────────────
// Edit strategy
// ─────────────────────────────────────────────────────────────

const EditStrategy = z.object({
  goal: z.string(),

  filesToModify: z.array(FilePath).default([]),

  changeType: z.enum(['add', 'modify', 'delete', 'refactor', 'rename']),

  instructions: z.string(),

  constraints: z.array(z.string()).default([]),

  operationHints: z.array(OperationHint).default([]),
});

// ─────────────────────────────────────────────────────────────
// Root schema
// ─────────────────────────────────────────────────────────────

export const ReaderOutputSchema = z
  .object({
    status: z.enum(['sufficient', 'insufficient', 'blocked']).default('sufficient'),

    summary: z.string(),

    language: z.string().nullable().default(null),

    filesAnalyzed: z.array(FilePath).default([]),

    functions: z.array(FunctionSchema).default([]),

    classes: z.array(ClassSchema).default([]),

    imports: z.array(ImportSchema).default([]),

    references: z.array(ReferenceSchema).default([]),

    unresolvedQuestions: z.array(z.string()).default([]),

    keyFindings: z.array(KeyFinding).default([]),

    potentialEditStrategy: EditStrategy.nullable().default(null),
  })
  .superRefine((data, ctx) => {
    const files = new Set(data.filesAnalyzed);

    const check = (file: string, path: (string | number)[]) => {
      if (file && !files.has(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `File not in filesAnalyzed: ${file}`,
        });
      }
    };

    for (const [i, fn] of data.functions.entries()) {
      if (fn.location) check(extractFileFromLocation(fn.location), ['functions', i, 'location']);
    }

    for (const [i, cls] of data.classes.entries()) {
      if (cls.location) check(extractFileFromLocation(cls.location), ['classes', i, 'location']);
    }

    for (const [i, imp] of data.imports.entries()) {
      if (imp.location) check(extractFileFromLocation(imp.location), ['imports', i, 'location']);
    }

    for (const [i, ref] of data.references.entries()) {
      for (const [j, u] of ref.usages.entries()) {
        check(u.file, ['references', i, 'usages', j, 'file']);
      }
    }

    for (const [i, kf] of data.keyFindings.entries()) {
      check(kf.file, ['keyFindings', i, 'file']);
    }
  });
