import { z } from 'zod';

const isRelativeRepoPath = (value: string): boolean => {
  if (!value) return false;
  if (value.startsWith('/')) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.split(/[\\/]/).includes('..')) return false;
  return true;
};

const extractFileFromLocation = (location: string): string => location?.split(':')[0]?.trim() ?? '';
const LOCATION_PATTERN = /^[^:\n]+:\d+(?::\d+|-\d+(?::\d+)?)?$/;
const LINE_RANGE_PATTERN = /^$|^\d+$|^\d+-\d+$/;

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

const toStringArray = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        const values = [o.name, o.text, o.value, o.callee];
        const candidate = values.find((entry) => {
          if (typeof entry === 'string') return true;
          if (!entry || typeof entry !== 'object') return false;
          return (
            typeof (entry as Record<string, unknown>).name === 'string' ||
            typeof (entry as Record<string, unknown>).object === 'string'
          );
        });
        if (typeof candidate === 'string') return candidate.trim();
        if (candidate && typeof candidate === 'object') {
          const rec = candidate as Record<string, unknown>;
          const name = typeof rec.name === 'string' ? rec.name : '';
          const object = typeof rec.object === 'string' ? rec.object : '';
          const property = typeof rec.property === 'string' ? rec.property : '';
          const dotted = [object, property].filter(Boolean).join('.');
          return (name || dotted).trim();
        }
      }
      return '';
    })
    .filter(Boolean);
};

const normalizeReaderOutputInput = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const strategyRaw = source.potential_edit_strategy;
  const strategy =
    strategyRaw && typeof strategyRaw === 'object' && !Array.isArray(strategyRaw)
      ? (strategyRaw as Record<string, unknown>)
      : null;
  const normalizedStrategy = strategy
    ? {
        ...strategy,
        files_to_modify: strategy.files_to_modify ?? strategy.filesToModify,
        change_type: strategy.change_type ?? strategy.changeType,
        operation_hints: strategy.operation_hints ?? strategy.operationHints,
      }
    : strategyRaw;

  return {
    ...source,
    status: source.status ?? 'sufficient',
    files_analyzed: source.files_analyzed ?? source.filesAnalyzed,
    unresolved_questions: source.unresolved_questions ?? source.unresolvedQuestions,
    key_findings: source.key_findings ?? source.keyFindings,
    potential_edit_strategy: normalizedStrategy,
  };
};

const FilePath = z.string().trim().min(1).max(260).refine(isRelativeRepoPath, {
  message: 'Must be relative repo path',
});

const LineRange = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform(normalizeLineRange)
  .pipe(z.string().max(40).regex(LINE_RANGE_PATTERN, 'Invalid line range format'));

const Location = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .regex(LOCATION_PATTERN, 'Invalid location format');

const Id = z.string().trim().min(1).max(160);

const FunctionSchema = z
  .object({
    name: Id,
    nodeType: z.string().trim().min(1).max(120).nullable().default(null),
    parentNodeType: z.string().trim().min(1).max(120).nullable().default(null),
    signature: z.preprocess(clipStr(1600), z.string().nullable().default(null)),
    params: z.preprocess(toStringArray, z.array(z.string().trim().min(1).max(200)).default([])),
    returnType: z.string().trim().min(1).max(200).nullable().default(null),
    location: Location.nullable().default(null),
    bodyPreview: z.preprocess(clipStr(2000), z.string().nullable().default(null)),
    calls: z.preprocess(toStringArray, z.array(z.string().trim().min(1).max(200)).default([])),
  })
  .strip();

const ClassSchema = z
  .object({
    name: Id,
    methods: z.preprocess(toStringArray, z.array(z.string().trim().min(1).max(200)).default([])),
    properties: z.preprocess(toStringArray, z.array(z.string().trim().min(1).max(200)).default([])),
    location: Location.nullable().default(null),
  })
  .strip();

const ImportSchema = z
  .object({
    source: z.string().trim().min(1).max(320),
    specifiers: z.preprocess(toStringArray, z.array(z.string().trim().min(1).max(200)).default([])),
    isDefault: z.boolean().default(false),
    location: Location.nullable().default(null),
  })
  .strip();

const ReferenceSchema = z
  .object({
    symbol: Id,
    usages: z
      .array(
        z
          .object({
            file: FilePath,
            line: z.number().int().positive(),
            context: z.preprocess(clipStr(1200), z.string().default('')),
          })
          .strip()
      )
      .max(400)
      .default([]),
  })
  .strip();

const KeyFinding = z
  .object({
    file: FilePath,
    lines: LineRange,
    content: z.preprocess(clipStr(6000), z.string().trim().min(1).max(6000)),
    comment: z.preprocess(clipStr(1200), z.string().trim().min(1).max(1200)),
  })
  .strip();

const BaseHint = z
  .object({
    file: FilePath,
    lines: LineRange.optional().default(''),
    details: z.preprocess(clipStr(1600), z.string().trim().min(1).max(1600)),
    nodeType: z.string().trim().min(1).max(120).nullable().optional().default(null),
    symbol: z.string().trim().min(1).max(200).nullable().optional().default(null),
    newSymbol: z.string().trim().min(1).max(200).nullable().optional().default(null),
    anchor: z
      .preprocess(clipStr(400), z.string().trim().min(1).max(400))
      .nullable()
      .optional()
      .default(null),
  })
  .strip();

const AstNodeOpHint = BaseHint.extend({
  op: z.enum(['replace_node', 'insert_node', 'remove_node']),
  nodeType: z.string().trim().min(1).max(120),
  anchor: z.preprocess(clipStr(300), z.string().trim().min(1).max(300)).optional(),
});

const RenameSymbolHint = BaseHint.extend({
  op: z.literal('rename_symbol'),
  nodeType: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(200),
  newSymbol: z.string().trim().min(1).max(200),
});

const CreateFileHint = BaseHint.extend({
  op: z.literal('create_file'),
  anchor: z.null().optional().default(null),
});

const TextOrFileHint = BaseHint.extend({
  op: z.enum(['delete_file', 'rename_file', 'replace_text', 'insert_text', 'remove_text']),
  anchor: z.preprocess(clipStr(400), z.string().trim().min(1).max(400)),
});

const OperationHint = z.discriminatedUnion('op', [
  AstNodeOpHint,
  RenameSymbolHint,
  CreateFileHint,
  TextOrFileHint,
]);

const EditStrategy = z
  .object({
    goal: z.preprocess(clipStr(1200), z.string().trim().min(1).max(1200)),
    files_to_modify: z.array(FilePath).max(120).default([]),
    change_type: z.enum(['add', 'modify', 'delete', 'refactor', 'rename']),
    instructions: z.preprocess(clipStr(3000), z.string().trim().min(1).max(3000)),
    constraints: z
      .array(z.preprocess(clipStr(500), z.string().trim().min(1).max(500)))
      .max(60)
      .default([]),
    operation_hints: z.array(OperationHint).max(180).default([]),
  })
  .strip()
  .superRefine((data, ctx) => {
    const filesToModify = new Set(data.files_to_modify);
    for (const [i, hint] of data.operation_hints.entries()) {
      if (hint.op !== 'create_file' && !filesToModify.has(hint.file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['operation_hints', i, 'file'],
          message: `Hint file must be declared in files_to_modify: ${hint.file}`,
        });
      }
    }
  });

const ReaderOutputCommonSchema = z
  .object({
    schemaVersion: z.literal('reader.output.v2').default('reader.output.v2'),
    status: z.enum(['sufficient', 'insufficient', 'blocked']).default('sufficient'),
    summary: z.preprocess(clipStr(4000), z.string().trim().min(1).max(4000)),
    language: z.preprocess(clipStr(80), z.string().trim().min(1).max(80).nullable().default(null)),
    files_analyzed: z.array(FilePath).max(500).default([]),
    functions: z.array(FunctionSchema).max(400).default([]),
    classes: z.array(ClassSchema).max(400).default([]),
    imports: z.array(ImportSchema).max(800).default([]),
    references: z.array(ReferenceSchema).max(400).default([]),
    unresolved_questions: z.array(z.preprocess(clipStr(600), z.string().trim().min(1).max(600))),
    key_findings: z.array(KeyFinding).max(200).default([]),
    potential_edit_strategy: EditStrategy.nullable(),
  })
  .strip();

const ReaderOutputSufficient = ReaderOutputCommonSchema.extend({
  status: z.literal('sufficient'),
  unresolved_questions: z
    .array(z.preprocess(clipStr(600), z.string().trim().min(1).max(600)))
    .max(50)
    .default([]),
  potential_edit_strategy: EditStrategy,
});

const ReaderOutputInsufficientOrBlocked = ReaderOutputCommonSchema.extend({
  status: z.enum(['insufficient', 'blocked']),
  unresolved_questions: z
    .array(z.preprocess(clipStr(600), z.string().trim().min(1).max(600)))
    .min(1)
    .max(50),
  potential_edit_strategy: z.null(),
});

export const ReaderOutputSchema = z
  .preprocess(
    normalizeReaderOutputInput,
    z.discriminatedUnion('status', [ReaderOutputSufficient, ReaderOutputInsufficientOrBlocked])
  )
  .superRefine((data, ctx) => {
    const files = new Set(data.files_analyzed);

    const check = (
      file: string,
      path: (string | number)[],
      opts?: { allowMissingAnalyzed?: boolean }
    ) => {
      if (!file) return;
      if (opts?.allowMissingAnalyzed) return;
      if (!files.has(file)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `File not in files_analyzed: ${file}`,
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

    for (const [i, kf] of data.key_findings.entries()) {
      check(kf.file, ['key_findings', i, 'file']);
    }

    if (data.status === 'sufficient') {
      if (
        data.key_findings.length === 0 &&
        data.potential_edit_strategy.operation_hints.length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['key_findings'],
          message: 'Sufficient output must include key_findings or operation_hints evidence.',
        });
      }
      const filesToModify = new Set(data.potential_edit_strategy.files_to_modify);
      for (const [i, file] of data.potential_edit_strategy.files_to_modify.entries()) {
        check(file, ['potential_edit_strategy', 'files_to_modify', i]);
      }
      for (const [i, hint] of data.potential_edit_strategy.operation_hints.entries()) {
        check(hint.file, ['potential_edit_strategy', 'operation_hints', i, 'file'], {
          allowMissingAnalyzed: hint.op === 'create_file',
        });
        if (hint.op !== 'create_file' && !filesToModify.has(hint.file)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['potential_edit_strategy', 'operation_hints', i, 'file'],
            message: `Hint file must be in files_to_modify: ${hint.file}`,
          });
        }
      }
    }
  });
