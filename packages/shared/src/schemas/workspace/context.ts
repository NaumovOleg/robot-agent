import { z } from 'zod';

/**
 * Represents a single file selected by the file selector.
 *
 * - `path`: relative path to the file
 * - `content`: full text content of the file
 * - `score`: relevance score (0–1)
 * - `truncated`: whether the content was truncated to fit context limits
 */
export const SelectedFileSchema = z.object({
  path: z.string().describe('Relative path to the file'),
  content: z.string().describe('Full text content of the file'),
  score: z.number().describe('Relevance score (0–1)'),
  truncated: z.boolean().describe('Whether content was truncated'),
});

/**
 * Pre-loop snapshot of the workspace state.
 *
 * Contains git state, config file contents, and project metadata at the point the loop begins.
 * These are read once and passed to the agent as-is; they are not updated during the edit session.
 *
 * - `cwd`: current working directory
 * - `gitStatus`: output of `git status --short`
 * - `gitLog`: recent commit messages
 * - `gitDiff`: output of `git diff --no-color` (can be empty if no uncommitted changes)
 * - `tsconfig`, `packageJson`, `eslintConfig`, `envExample`, `roboMd`: nullable config file contents
 */
export const WorkspaceContextSchema = z.object({
  cwd: z.string().describe('Current working directory'),
  gitStatus: z.string().describe('Output of git status --short'),
  gitLog: z.string().describe('Recent commit messages'),
  gitDiff: z.string().describe('Output of git diff --no-color'),
  tsconfig: z.string().nullable().describe('Contents of tsconfig.json if present'),
  packageJson: z.string().nullable().describe('Contents of package.json if present'),
  eslintConfig: z.string().nullable().describe('Contents of eslint config if present'),
  envExample: z.string().nullable().describe('Contents of .env.example if present'),
  roboMd: z.string().nullable().describe('Contents of .ROBO.md if present'),
});

export type SelectedFile = z.infer<typeof SelectedFileSchema>;
