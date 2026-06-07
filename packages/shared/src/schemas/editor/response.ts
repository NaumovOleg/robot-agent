import { z } from 'zod';

export const EditorResponseSchema = z.object({
  role: z
    .literal('writer_response')
    .describe('Identifies this payload as a writer subagent response.'),

  success: z.boolean().describe('Indicates whether the write operation completed successfully.'),

  changes: z
    .array(
      z.object({
        file: z.string().describe('Path to the file that was modified.'),

        status: z
          .enum(['created', 'updated', 'deleted'])
          .describe('Type of change applied to the file.'),

        diff_preview: z
          .string()
          .describe(
            'Short human-readable diff preview showing what changed (e.g. +added / -removed lines).'
          ),

        lines_changed: z
          .number()
          .int()
          .nonnegative()
          .describe('Number of lines affected in this change.'),
      })
    )
    .describe('List of all file-level changes performed by the writer.'),

  errors: z
    .array(z.string())
    .default([])
    .describe('List of errors encountered during writing process.'),

  unresolved: z
    .array(z.string())
    .default([])
    .describe('Open issues that could not be resolved during execution.'),
});
