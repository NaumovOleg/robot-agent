import type { Match } from '@robocode-packages/shared';
import { execAsync } from '@robocode-packages/shared';
import { IGNORE_DIRS, CONTEXT_LINES, MAX_FILES_RESULTS } from '@robocode-packages/config';
import path from 'node:path';
import fs from 'node:fs';

export const hasRipgrep = async (): Promise<boolean> => {
  try {
    await execAsync('rg --version', { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
};

export const searchWithRipgrep = async (
  pattern: string,
  cwd: string,
  opts: {
    filePattern?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    maxResults: number;
    contextLines: number;
  }
): Promise<string> => {
  const flags = [
    '--json',
    `--context ${opts.contextLines}`,
    `--max-count ${opts.maxResults}`,
    opts.caseSensitive ? '' : '--ignore-case',
    opts.wholeWord ? '--word-regexp' : '',
    opts.filePattern ? `--glob "${opts.filePattern}"` : '',
    ...[...IGNORE_DIRS].map((d) => `--glob "!${d}"`),
  ]
    .filter(Boolean)
    .join(' ');

  const { stdout } = await execAsync(`rg ${flags} "${pattern.replace(/"/g, '\\"')}" .`, {
    cwd,
    timeout: 15_000,
  });

  return stdout;
};

export const parseRipgrepJson = (raw: string, cwd: string): Match[] => {
  const matches: Match[] = [];
  const contextBefore: string[] = [];

  for (const line of raw.split('\n').filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === 'context') {
        contextBefore.push(parsed.data.lines.text?.trimEnd() ?? '');
        if (contextBefore.length > CONTEXT_LINES) contextBefore.shift();
      }

      if (parsed.type === 'match') {
        const filePath = path.relative(cwd, parsed.data.path.text);
        const lineNum = parsed.data.line_number;
        const text = parsed.data.lines.text?.trimEnd() ?? '';
        const colStart = parsed.data.submatches?.[0]?.start ?? 0;

        matches.push({
          file: filePath,
          line: lineNum,
          column: colStart + 1,
          content: text,
          context_before: [...contextBefore],
          context_after: [],
        });

        contextBefore.length = 0;
      }
    } catch {
      /* empty */
    }
  }

  return matches;
};

export const searchWithGrep = async (
  pattern: string,
  cwd: string,
  opts: {
    filePattern?: string;
    caseSensitive?: boolean;
    wholeWord?: boolean;
    maxResults: number;
  }
): Promise<Match[]> => {
  const flags = [
    '-rn',
    '--include=' + (opts.filePattern ?? '*'),
    opts.caseSensitive ? '' : '-i',
    opts.wholeWord ? '-w' : '',
    ...[...IGNORE_DIRS].map((d) => `--exclude-dir=${d}`),
  ]
    .filter(Boolean)
    .join(' ');

  const matches: Match[] = [];

  try {
    const { stdout } = await execAsync(`grep ${flags} "${pattern.replace(/"/g, '\\"')}" .`, {
      cwd,
      timeout: 15_000,
    });

    for (const line of stdout.split('\n').filter(Boolean).slice(0, opts.maxResults)) {
      const match = line.match(/^(.+?):(\d+):(.*)/);
      if (!match) continue;

      const [, file, lineStr, content] = match;
      const lineNum = Number.parseInt(lineStr, 10);
      let contextBefore: string[] = [];
      let contextAfter: string[] = [];

      try {
        const fullPath = path.resolve(cwd, file);
        const fileContent = fs.readFileSync(fullPath, 'utf-8').split('\n');
        const idx = lineNum - 1;
        contextBefore = fileContent.slice(Math.max(0, idx - CONTEXT_LINES), idx);
        contextAfter = fileContent.slice(idx + 1, idx + 1 + CONTEXT_LINES);
      } catch {
        /* empty */
      }

      matches.push({
        file,
        line: lineNum,
        column: 1,
        content: content?.trimEnd() ?? '',
        context_before: contextBefore,
        context_after: contextAfter,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 1) throw err;
  }

  return matches;
};

export const formatMatches = (matches: Match[], pattern: string): string => {
  if (matches.length === 0) {
    return `No matches found for: ${pattern}`;
  }

  const grouped = new Map<string, Match[]>();
  for (const match of matches) {
    if (!grouped.has(match.file)) grouped.set(match.file, []);
    grouped.get(match.file)?.push(match);
  }

  const lines: string[] = [
    `Found ${matches.length} match${matches.length === 1 ? '' : 'es'} in ${grouped.size} file${grouped.size === 1 ? '' : 's'}`,
    '',
  ];

  for (const [file, fileMatches] of grouped.entries()) {
    lines.push(`── ${file}`);
    for (const match of fileMatches) {
      for (const ctx of match.context_before) {
        lines.push(
          `  ${String(match.line - match.context_before.indexOf(ctx) - 1).padStart(4)} │ ${ctx}`
        );
      }
      lines.push(`▶ ${String(match.line).padStart(4)} │ ${match.content}`);
      for (let i = 0; i < match.context_after.length; i++) {
        lines.push(`  ${String(match.line + i + 1).padStart(4)} │ ${match.context_after[i]}`);
      }

      lines.push('');
    }
  }

  if (matches.length >= MAX_FILES_RESULTS) {
    lines.push(`... results truncated at ${MAX_FILES_RESULTS}. Use a more specific pattern.`);
  }

  return lines.join('\n');
};
