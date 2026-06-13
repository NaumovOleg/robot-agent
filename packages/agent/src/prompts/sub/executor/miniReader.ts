import type { PlannerOutput, ReaderDigest } from '@robocode-packages/shared';

type PlanStep = PlannerOutput['steps'][number];

export interface MiniReaderPromptInput {
  step: PlanStep;
  goal: string;
  constraints: string[];
  files: { file: string; content: string }[];
  // operationHints from digests are intentionally not rendered — summary+keyFindings carry the prompt signal
  findings: ReaderDigest[];
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
  const { step, goal, constraints, files, findings, lastError, userGuidance, appliedOps } = input;

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

## Current file contents (fresh from disk, line-numbered)
${fileBlocks || '(no existing files — this step creates new ones)'}
${retryBlock}

## Output rules
- CRITICAL: the file content above is shown with "N | " line-number prefixes for
  YOUR reference only. NEVER copy the "N | " (or the bare number) into an anchor.
  The anchor must be the raw source text only. Wrong: "8 } from './x';". Right:
  "} from './x';".
- "anchor" must be a VERBATIM substring copied from the file content above (without the "N | " line-number prefix) and must occur exactly once in the file.
- "newContent" is the complete replacement/insertion text — real code, correct indentation, no placeholders.
- For create_file, "newContent" is the entire file content.
- For insert_text, set "insertMode" (before|after|start|end); the default is "after".
- For rename_file, set "target" to the new repo-relative path.
- To rename a symbol (a variable/function/component and ALL its usages in a file),
  emit ONE rename_symbol hint with "symbol" and "newSymbol". It renames every
  occurrence in the file at once. Do NOT also add replace_text hints for the same
  rename, and do NOT use replace_text to rename one occurrence at a time — that
  leaves other usages dangling and breaks the type check. "nodeType" is optional
  for rename_symbol and ignored.
- Prefer replace_text with a tight unique anchor over AST ops, EXCEPT for renames.
- MAKE THE SMALLEST EDIT THAT WORKS. Anchor only the few characters you actually
  change, not whole declarations or blocks. A larger anchor risks re-emitting
  surrounding code incorrectly.
- When ADDING an item to an existing list, union, enum, object, or import, INSERT
  just the new item — do NOT replace and re-type the whole declaration. Example:
  to add 'faq' to \`type Route = 'a' | 'b';\`, use replace_text with anchor \`'b';\`
  and newContent \`'b' | 'faq';\` (or insert_text). NEVER reproduce existing
  members again — duplicating them causes "Duplicate identifier" type errors.
- Do not touch files outside the step's scope unless strictly required by the expected output.`;
};
