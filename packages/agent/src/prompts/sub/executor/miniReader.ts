import type { PlannerOutput, ReaderDigest } from '@robocode-packages/shared';

type PlanStep = PlannerOutput['steps'][number];

export interface MiniReaderPromptInput {
  step: PlanStep;
  goal: string;
  constraints: string[];
  files: { file: string; content: string }[];
  // operationHints from digests are intentionally not rendered — summary+keyFindings carry the prompt signal
  findings: ReaderDigest[];
  // Repo-relative paths created/changed by earlier steps in this plan.
  producedFiles?: string[];
  // Existing sibling files to mirror conventions from when creating new files.
  references?: { file: string; content: string }[];
  // Files the last verification errors point to — editable to fix cross-file errors.
  errorFiles?: { file: string; content: string }[];
  // Project import path aliases (e.g. "@screens" → "src/screens/index.ts").
  aliases?: { alias: string; path: string }[];
  // The type errors still outstanding for this step (persist across retries).
  outstandingErrors?: string | null;
  lastError: string | null;
  userGuidance: string | null;
  appliedOps: string[];
}

const MAX_FILE_CHARS = 30_000;

export const withLineNumbers = (content: string): string =>
  content
    .split('\n')
    .map((line, i) => `${i + 1} | ${line}`)
    .join('\n');

export const buildMiniReaderPrompt = (input: MiniReaderPromptInput): string => {
  const { step, goal, constraints, files, findings, producedFiles, references, errorFiles, aliases, outstandingErrors, lastError, userGuidance, appliedOps } =
    input;

  const referenceBlocks = (references ?? [])
    .map(({ file, content }) => `### ${file}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const errorFileBlocks = (errorFiles ?? [])
    .map(({ file, content }) => {
      const clipped =
        content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + '\n…[truncated]' : content;
      return `### ${file}\n\`\`\`\n${withLineNumbers(clipped)}\n\`\`\``;
    })
    .join('\n\n');

  const aliasBlock = (aliases ?? []).map((a) => `- ${a.alias} → ${a.path}`).join('\n');

  const fileBlocks = files
    .map(({ file, content }) => {
      const clipped =
        content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + '\n…[truncated]'
          : content;
      return `### ${file}\n\`\`\`\n${withLineNumbers(clipped)}\n\`\`\``;
    })
    .join('\n\n');

  const findingBlocks = findings
    .map((digest) => {
      const keyFindings = digest.keyFindings
        .map((f) => `- ${f.file}:${f.lines} — ${f.comment}\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n');
      return `### From step "${digest.stepId}"\n${digest.summary}\n${keyFindings}`;
    })
    .join('\n\n');

  const retryBlock = lastError
    ? `
## PREVIOUS ATTEMPT FAILED
The files have been ROLLED BACK to their pre-attempt state. Produce a corrected set of hints.

Error:
${lastError}

Operations the failed attempt applied (now reverted):
${appliedOps.map((op) => `- ${op}`).join('\n') || '- none'}
${userGuidance ? `\nUser guidance:\n${userGuidance}` : ''}`
    : '';

  return `You are the edit generator inside a code-editing loop. Produce a minimal ordered list of atomic edit hints that implement ONE plan step. The hints are applied MECHANICALLY in order — no human or model fixes them afterwards.

## Plan goal
${goal}

## Current step
id: ${step.id}
kind: ${step.kind}
title: ${step.title}
expected output: ${step.expected_output}
files: ${step.files.join(', ') || '(none listed)'}

## Hard constraints
${constraints.map((c) => `- ${c}`).join('\n') || '- none'}

## Investigation findings (from inspect steps)
${findingBlocks || '(none)'}
${
  producedFiles && producedFiles.length > 0
    ? `
## Files created or changed by EARLIER steps in this plan (they exist on disk NOW)
When importing, exporting, or referencing these, use their EXACT path — do NOT
guess a different name or assume an index barrel exists.
${producedFiles.map((f) => `- ${f}`).join('\n')}
`
    : ''
}
${
  referenceBlocks
    ? `
## Reference files (existing files of the same kind — MIRROR their conventions)
When creating a new file, follow the import/export/style conventions shown here.
Do not introduce patterns these files don't use.
${referenceBlocks}
`
    : ''
}
${
  aliasBlock
    ? `
## Import path aliases (tsconfig "paths" / module resolution)
Each alias maps to ONE exact module (usually a barrel index). \`@x/sub/File\` does
NOT resolve unless that alias is a wildcard. To import a file not re-exported by a
barrel, use a relative path or add it to the barrel.
${aliasBlock}
`
    : ''
}${
  errorFileBlocks
    ? `
## Files with verification errors (you MAY edit these to fix the errors)
The last type check reported errors in these files. Emit hints to fix them — e.g.
add a missing union member, fix an import path — in addition to the step's files.
${errorFileBlocks}
`
    : ''
}${
  outstandingErrors
    ? `
## Outstanding type errors you MUST resolve (still failing)
Fix ALL of these. They persist until the whole project type-checks; do not lose
track of them even if your previous attempt failed on something else.
\`\`\`
${outstandingErrors}
\`\`\`
`
    : ''
}## Current file contents (fresh from disk, line-numbered)
${fileBlocks || '(no existing files — this step creates new ones)'}
${retryBlock}

## Output contract
First decide a status:
- "edits"   — the step needs changes; return >= 1 hint.
- "noop"    — the step's intent is ALREADY present on disk; return no hints, set "reason".
- "blocked" — you cannot complete the step from the information available; return no hints, set "reason".
Always set "reason" to a one-line explanation.

## Edit ops (use the fewest, smallest edits that work)
- edit_text { file, oldText, newText } — the primary op for ALL text changes.
  - "oldText" is a VERBATIM substring copied from the file content above WITHOUT the
    "N | " line-number prefix, and must occur EXACTLY ONCE. Add surrounding context
    until it is unique. Wrong: "8 } from './x';". Right: "} from './x';".
  - "newText" is the complete replacement text — real code, no placeholders.
  - INSERT a line: set "oldText" to an existing neighbor line and "newText" to that
    same neighbor line plus your added line(s).
  - DELETE a construct: set "oldText" to the construct plus a boundary line and
    "newText" to the boundary line alone (newText cannot be empty).
  - ADD to a list/union/enum/import: include an existing neighbor in oldText and add
    just the new item — NEVER retype the whole declaration (causes duplicate-identifier errors).
- create_file { file, newText } — entire file content. Mirror the import/export/style
  conventions of the reference files shown above; do not invent patterns.
- delete_file { file } — remove a file.
- rename_file { file, target } — move/rename to repo-relative "target".
- rename_symbol { file, symbol, newSymbol } — rename a symbol and ALL its usages in the
  file at once. Use ONE rename_symbol; do NOT also emit edit_text for the same rename.
  Available only for languages with a tree-sitter grammar; otherwise use edit_text.
- replace_node { file, nodeType, symbol, newText } — structural rewrite of a NAMED node
  (a whole function/class/type alias/enum). Prefer this over a huge edit_text block when
  you can name the node. "nodeType" is a tree-sitter grammar node type. For TypeScript/
  JavaScript common types: function_declaration, class_declaration, interface_declaration,
  type_alias_declaration, enum_declaration, lexical_declaration (const/let). For other
  languages, use that language's tree-sitter node names. Available only for languages with
  a grammar; otherwise use edit_text.

## General rules
- Prefer edit_text with a tight unique oldText. Use replace_node only for large structural rewrites.
- Make the SMALLEST edit that works — anchor only the characters you change.
- Only import or declare what you actually use; unused declarations fail strict type checks.
- Do not touch files outside the step's scope unless the expected output requires it.
- These rules are language-agnostic; the examples above are TypeScript/JavaScript but the
  ops work for any language (text ops always; AST ops where a grammar exists).`;
};
