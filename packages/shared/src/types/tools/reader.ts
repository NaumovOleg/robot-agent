import type { z } from 'zod';
import type { ReaderInputSchema, ReaderOutputSchema, AnalyzeAstToolSchema } from '../../schemas';
export type ReaderInput = z.infer<typeof ReaderInputSchema>;
export type ReaderOutput = z.infer<typeof ReaderOutputSchema>;
export type AstAnalyzerInput = z.infer<typeof AnalyzeAstToolSchema>;
