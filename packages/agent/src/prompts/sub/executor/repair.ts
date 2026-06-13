import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutorHint } from '@robocode-packages/shared';
import { withLineNumbers } from './miniReader';

export interface RepairPromptInput {
  failed: { hint: ExecutorHint; reason: string }[];
  cwd: string;
}

const MAX_FILE_CHARS = 20_000;

// Builds a focused re-prompt containing ONLY the hints that failed to resolve, each
// with its error and the current (line-numbered) content of its file. The model
// returns corrected hints for exactly these, in the same order.
export const buildRepairPrompt = async (input: RepairPromptInput): Promise<string> => {
  const blocks: string[] = [];
  for (const { hint, reason } of input.failed) {
    const abs = path.resolve(input.cwd, hint.file);
    const content = await fs.readFile(abs, 'utf-8').catch(() => null);
    const fileBlock =
      content === null
        ? '(file not found on disk)'
        : `\`\`\`\n${withLineNumbers(content.slice(0, MAX_FILE_CHARS))}\n\`\`\``;
    blocks.push(
      `### Failed ${hint.op} on ${hint.file}\n` +
        `Error: ${reason}\n` +
        `Original hint: ${JSON.stringify({ op: hint.op, oldText: hint.oldText, newText: hint.newText, symbol: hint.symbol, nodeType: hint.nodeType, target: hint.target })}\n` +
        `Current file (line-numbered, do NOT copy the "N | " prefix into oldText):\n${fileBlock}`
    );
  }

  return `Some edit hints failed to resolve against the file on disk. Fix ONLY the hints below.

For each failure, emit a corrected hint. The most common causes:
- oldText was not a verbatim unique substring of the file — copy the exact text (no "N | " prefix), and add surrounding context until it occurs exactly once.
- replace_node / rename_symbol targeted a node that doesn't exist or the language has no AST grammar — re-express the change as edit_text.

Return ONE corrected hint per failure, in the SAME ORDER, with status "edits". Do not add unrelated hints.

${blocks.join('\n\n')}`;
};
