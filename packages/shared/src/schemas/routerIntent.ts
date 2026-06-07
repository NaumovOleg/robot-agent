import { z } from 'zod';

// ─── Primitives ───────────────────────────────────────────────────────────────

const KeywordSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .describe('Identifier that appears literally in source code — fed to ripgrep.');

const RelativeFilePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine((v) => !v.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(v), {
    message: 'Must be a relative path e.g. "src/auth/token.ts"',
  });

// ─── Command intent (run_command only) ───────────────────────────────────────

const CommandIntentSchema = z
  .object({
    type: z
      .enum(['build', 'type_check', 'test', 'lint', 'install', 'custom'])
      .describe(
        'build       → compile the project. ' +
          'type_check  → run type checker without emitting. ' +
          'test        → run test suite. ' +
          'lint        → run linter. ' +
          'install     → install dependencies. ' +
          'custom      → any other shell command.'
      ),
    command: z
      .string()
      .trim()
      .max(400)
      .nullable()
      .default(null)
      .describe(
        'Exact shell command to run if determinable from the request and workspace context. ' +
          'Null if the executor must infer it from the build tool / test runner / linter detected.'
      ),
    targetFiles: z
      .array(RelativeFilePathSchema)
      .max(20)
      .default([])
      .describe('Files or directories to scope the command to, if the user mentioned them.'),
  })
  .strict();

// ─── Main schema ──────────────────────────────────────────────────────────────

export const IntentRouterSchema = z
  .object({
    schemaVersion: z.literal('intent.router.v4').default('intent.router.v4'),

    intent: z
      .enum([
        'add_feature',
        'bugfix',
        'refactor',
        'delete',
        'explain',
        'code_search',
        'run_command',
        'question',
        'unknown',
      ])
      .describe(
        'add_feature  → create new functionality that does not exist yet.\n' +
          'bugfix       → fix broken or incorrect behaviour.\n' +
          'refactor     → restructure code without changing external behaviour.\n' +
          'delete       → remove code, files, or dead code.\n' +
          'explain      → read and explain existing code. No edits.\n' +
          'code_search  → locate something in the codebase. No edits.\n' +
          'run_command  → execute shell / build / test / lint. No planner.\n' +
          'question     → general knowledge question. No codebase access.\n' +
          'unknown      → cannot determine. Will trigger clarification.'
      ),

    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Model confidence in this classification (0–1). ' +
          'Below 0.5 should set needsClarification=true unless the request is unambiguous.'
      ),

    reasoning: z
      .string()
      .trim()
      .min(1)
      .max(800)
      .describe(
        'Short explanation of why this intent, pipeline, scope and risk were chosen. ' +
          'Reference specific words from the user request.'
      ),

    // ── Pipeline routing ──────────────────────────────────────────────────────

    pipeline: z
      .enum(['full', 'read_only', 'direct_answer', 'direct_command'])
      .describe(
        'full           → file_selector → planner → reader → executor → summarizer.\n' +
          '                 Use for: add_feature | bugfix | refactor | delete.\n' +
          'read_only      → file_selector → reader → answer. Executor does NOT run.\n' +
          '                 Use for: explain | code_search.\n' +
          'direct_answer  → LLM answers immediately. No codebase access.\n' +
          '                 Use for: question.\n' +
          'direct_command → bash execution only. No file_selector, no planner.\n' +
          '                 Use for: run_command.'
      ),

    shouldSearchCodebase: z
      .boolean()
      .describe(
        'True  → file_selector must run to find relevant files via grep.\n' +
          'False → intent is question/run_command, OR user gave all file paths explicitly.'
      ),

    // ── File targeting ────────────────────────────────────────────────────────

    keywords: z
      .array(KeywordSchema)
      .max(30)
      .default([])
      .describe(
        'Identifiers fed to ripgrep. Must appear LITERALLY in source code.\n' +
          'Include: function names, class names, interface names, type names,\n' +
          '         file path fragments, route paths (/api/refresh),\n' +
          '         config keys (JWT_SECRET), env var names,\n' +
          '         error message substrings, ORM model names,\n' +
          '         decorator names (@Injectable), package paths (@auth/token).\n' +
          'Exclude: generic verbs (add, fix, change), common syntax (function, const, return).'
      ),

    explicitFiles: z
      .array(RelativeFilePathSchema)
      .max(20)
      .default([])
      .describe(
        'Relative file paths the user explicitly named in the request. ' +
          'When shouldSearchCodebase=false and these are present, ' +
          'planner receives them directly — file_selector is skipped.'
      ),

    // ── Risk and scope ────────────────────────────────────────────────────────

    scope: z
      .enum(['single_file', 'multi_file', 'project_wide', 'unknown'])
      .describe(
        'single_file   → one file or function clearly targeted.\n' +
          'multi_file    → multiple files within one module or directory.\n' +
          'project_wide  → renames across project, shared types, API contract changes.\n' +
          'unknown       → cannot determine from the request alone.'
      ),

    estimatedRisk: z
      .enum(['low', 'medium', 'high'])
      .describe(
        'low    → read-only, new isolated helper, writing tests, running commands.\n' +
          'medium → modifying existing logic, adding to an existing module.\n' +
          'high   → delete, project_wide scope, rename symbols, public API change, entry point change.'
      ),

    // ── Run command metadata ──────────────────────────────────────────────────

    commandIntent: CommandIntentSchema.nullable()
      .default(null)
      .describe('Populated only when intent=run_command. ' + 'Null for all other intents.'),

    // ── Clarification ─────────────────────────────────────────────────────────

    needsClarification: z
      .boolean()
      .describe(
        'True when the request is too ambiguous to route confidently. ' +
          'Triggers ask_user before any pipeline starts. ' +
          'Set false once clarification has been received.'
      ),

    question: z
      .string()
      .trim()
      .max(300)
      .default('')
      .describe(
        'One focused clarifying question when needsClarification=true. ' +
          'Must be specific enough that the answer unblocks routing. ' +
          'Empty string when needsClarification=false.'
      ),
  })
  .strict()
  .superRefine((data, ctx) => {
    // ── pipeline must match intent ─────────────────────────────────────────
    const expectedPipeline: Record<string, string> = {
      add_feature: 'full',
      bugfix: 'full',
      refactor: 'full',
      delete: 'full',
      explain: 'read_only',
      code_search: 'read_only',
      run_command: 'direct_command',
      question: 'direct_answer',
      unknown: 'full',
    };

    if (expectedPipeline[data.intent] && data.pipeline !== expectedPipeline[data.intent]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pipeline'],
        message: `pipeline must be "${expectedPipeline[data.intent]}" when intent is "${data.intent}".`,
      });
    }

    // ── direct pipelines must not search codebase ──────────────────────────
    if (
      (data.pipeline === 'direct_answer' || data.pipeline === 'direct_command') &&
      data.shouldSearchCodebase
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shouldSearchCodebase'],
        message: `shouldSearchCodebase must be false when pipeline is "${data.pipeline}".`,
      });
    }

    // ── commandIntent required for run_command ─────────────────────────────
    if (data.intent === 'run_command' && data.commandIntent === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commandIntent'],
        message: 'commandIntent is required when intent is "run_command".',
      });
    }

    // ── commandIntent must be null for non run_command ─────────────────────
    if (data.intent !== 'run_command' && data.commandIntent !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commandIntent'],
        message: 'commandIntent must be null when intent is not "run_command".',
      });
    }

    // ── question required when needsClarification ──────────────────────────
    if (data.needsClarification && !data.question.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['question'],
        message: 'question is required when needsClarification is true.',
      });
    }

    // ── question must be empty when no clarification needed ────────────────
    if (!data.needsClarification && data.question.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['question'],
        message: 'question must be empty string when needsClarification is false.',
      });
    }

    // ── low confidence should trigger clarification ────────────────────────
    if (data.confidence < 0.45 && !data.needsClarification && data.intent !== 'unknown') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['needsClarification'],
        message: `confidence is ${data.confidence} — below 0.45 requires needsClarification=true or intent="unknown".`,
      });
    }

    // ── risk / scope consistency ───────────────────────────────────────────
    if (data.estimatedRisk === 'high' && data.scope === 'single_file' && data.intent !== 'delete') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedRisk'],
        message:
          'estimatedRisk="high" with scope="single_file" is contradictory unless intent="delete".',
      });
    }

    // ── project_wide scope implies high risk ───────────────────────────────
    if (data.scope === 'project_wide' && data.estimatedRisk === 'low') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedRisk'],
        message: 'estimatedRisk cannot be "low" when scope is "project_wide".',
      });
    }

    // ── delete intent must be high risk ───────────────────────────────────
    if (data.intent === 'delete' && data.estimatedRisk !== 'high') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedRisk'],
        message: 'estimatedRisk must be "high" when intent is "delete".',
      });
    }

    // ── read_only / direct pipelines need no keywords ─────────────────────
    // soft: keywords can still be present for read_only (grep still runs)
    // but direct_answer and direct_command should not have keywords
    if (
      (data.pipeline === 'direct_answer' || data.pipeline === 'direct_command') &&
      data.keywords.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keywords'],
        message: `keywords must be empty when pipeline is "${data.pipeline}".`,
      });
    }
  });
