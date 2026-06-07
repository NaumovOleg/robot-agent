import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { RunnableConfig } from '@langchain/core/runnables';

function findAllOccurrences(cwd: string, symbol: string): Array<{ file: string; content: string }> {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const excludes = [
    '--glob=!node_modules/**',
    '--glob=!dist/**',
    '--glob=!.git/**',
  ].join(' ');

  try {
    const raw = execSync(`rg -l "${escaped}" ${excludes} .`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return raw
      .split('\n')
      .filter(Boolean)
      .map((file) => ({
        file: path.resolve(cwd, file),
        content: fs.readFileSync(path.resolve(cwd, file), 'utf-8'),
      }));
  } catch {
    return [];
  }
}

export const renameSymbolTool = tool(
  async ({ file: _file, symbol, newSymbol }: { file: string; symbol: string; newSymbol: string }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    if (symbol === newSymbol) return `Error: newSymbol is identical to symbol`;

    const occurrences = findAllOccurrences(cwd, symbol);
    if (occurrences.length === 0) {
      return `Symbol "${symbol}" not found in any file under ${cwd}`;
    }

    let totalReplacements = 0;
    const modifiedFiles: string[] = [];

    for (const { file: targetFile, content } of occurrences) {
      const wordBoundary = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = content.match(wordBoundary);
      if (!matches) continue;

      const updated = content.replace(wordBoundary, newSymbol);
      fs.writeFileSync(targetFile, updated, 'utf-8');
      totalReplacements += matches.length;
      modifiedFiles.push(path.relative(cwd, targetFile));
    }

    return `Renamed "${symbol}" → "${newSymbol}" in ${modifiedFiles.length} file(s), ${totalReplacements} replacement(s):\n${modifiedFiles.join('\n')}`;
  },
  {
    name: 'rename_symbol',
    description: `Rename a symbol (function, class, variable, type) across all files in the project.
Uses ripgrep to find all occurrences, then replaces with word-boundary matching.
file: the file where the symbol is defined (used as reference; all project files are searched).`,
    schema: z.object({
      file: z.string().describe('File where the symbol is defined'),
      symbol: z.string().describe('Current symbol name'),
      newSymbol: z.string().describe('New symbol name'),
    }),
  }
);
