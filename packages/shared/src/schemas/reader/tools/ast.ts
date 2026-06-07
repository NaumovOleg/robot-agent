import { z } from 'zod';

const SymbolNameSchema = z
  .string()
  .trim()
  .max(160)
  .default('')
  .describe("Symbol name for 'references' queries.");

export const AnalyzeAstToolSchema = z
  .object({
    filePath: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .describe('Absolute or relative path to the file to analyze.'),
    queryType: z
      .enum(['functions', 'classes', 'imports', 'references'])
      .describe('What to extract from the AST.'),
    symbolName: SymbolNameSchema,
    includeBody: z
      .boolean()
      .default(false)
      .describe('When true, include short body previews in extracted function/class results.'),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasSymbol = data.symbolName.length > 0;
    if (data.queryType === 'references' && !hasSymbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['symbolName'],
        message: 'symbolName is required when queryType is "references".',
      });
    }

    if (data.queryType !== 'references' && hasSymbol) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['symbolName'],
        message: 'symbolName must be empty unless queryType is "references".',
      });
    }
  });
