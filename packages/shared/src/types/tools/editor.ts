import type { z } from 'zod';
import type { EditorRequestSchema, EditorResponseSchema } from '../../schemas';
export type EditorRequest = z.infer<typeof EditorRequestSchema>;
export type EditorResponse = z.infer<typeof EditorResponseSchema>;
