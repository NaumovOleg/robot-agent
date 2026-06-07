import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { type Match, detectProjectLanguage, TOOL_NAMES } from '@robocode-packages/shared';
import type { RunnableConfig } from '@langchain/core/runnables';
import fs from 'node:fs';
import path from 'node:path';
import { DEFINITION_PATTERNS, CONTEXT_LINES } from '@robocode-packages/config';
import {
  hasRipgrep,
  searchWithRipgrep,
  searchWithGrep,
  formatMatches,
  inferKind,
} from '../../utils';

const FILE_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  ruby: ['.rb'],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  php: ['.php'],
  swift: ['.swift'],
  dart: ['.dart'],
  csharp: ['.cs'],
};

export const findDefinitionTool = tool(
  async ({ symbol, language, file }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const detectedLang = language ?? detectProjectLanguage(cwd);
    const extensions = FILE_EXTENSIONS[detectedLang] ?? ['.ts', '.js'];
    const patterns = DEFINITION_PATTERNS[detectedLang] ?? DEFINITION_PATTERNS.typescript;

    if (file) {
      const targetPath = path.isAbsolute(file) ? file : path.resolve(cwd, file);
      try {
        const content = fs.readFileSync(targetPath, 'utf-8');
        const lines = content.split('\n');
        const results: Match[] = [];

        for (const patternTemplate of patterns) {
          const pattern = patternTemplate.replace(/\{name\}/g, symbol);
          const regex = new RegExp(pattern);

          lines.forEach((line, i) => {
            if (regex.test(line)) {
              results.push({
                file: path.relative(cwd, targetPath),
                line: i + 1,
                column: 0,
                kind: inferKind(line),
                content: line.trim(),
                context_before: lines.slice(i, i + CONTEXT_LINES + 1),
                context_after: [],
                context: lines.slice(i, i + CONTEXT_LINES + 1),
              });
            }
          });
        }

        return formatMatches(results, symbol);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        return `Error reading ${file}: ${err.message}`;
      }
    }

    const useRg = await hasRipgrep();
    let allDefs: Match[] = [];

    for (const patternTemplate of patterns) {
      const pattern = patternTemplate.replace(/\{name\}/g, symbol);
      const filePattern =
        extensions.length > 1
          ? `{${extensions.map((e) => `*${e}`).join(',')}}`
          : `*${extensions[0]}`;
      try {
        const match = await (useRg
          ? searchWithRipgrep(pattern, cwd, { filePattern })
          : searchWithGrep(pattern, cwd, {
              filePattern,
              maxResults: extensions.length,
            }));

        allDefs.push(...match);
      } catch {
        /* empty */
      }
    }

    const seen = new Set<string>();
    allDefs = allDefs.filter((d) => {
      const key = `${d.file}:${d.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    allDefs.sort((a, b) => {
      const aExact = a.content.includes(`${symbol}(`);
      const bExact = b.content.includes(`${symbol}(`);
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return a.file.localeCompare(b.file);
    });

    return formatMatches(allDefs.slice(0, 10), symbol);
  },
  {
    name: TOOL_NAMES.find_definition,
    description: `Find where a symbol (function, class, type, variable) is defined.
Supports: TypeScript, JavaScript, Python, Go, Rust, Ruby, Java, PHP, Swift, Dart.
Use before editing to find exact file and line.
Use after grep to locate the actual definition (not just usages).`,
    schema: z.object({
      symbol: z
        .string()
        .describe('Symbol name to find e.g. "handleAuth", "UserService", "Profile"'),
      language: z
        .enum([
          'typescript',
          'javascript',
          'python',
          'go',
          'rust',
          'ruby',
          'java',
          'kotlin',
          'php',
          'swift',
          'dart',
          'csharp',
        ])
        .optional()
        .describe('Language to search. Auto-detected from project if omitted.'),
      file: z
        .string()
        .optional()
        .describe('Search only in this file. Faster than full project search.'),
    }),
  }
);
