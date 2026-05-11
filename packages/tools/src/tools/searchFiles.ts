import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RunnableConfig } from '@langchain/core/runnables';
import { type Match, TOOL_NAMES } from '@robocode-packages/shared';
import { CONTEXT_LINES, MAX_FILES_RESULTS } from '@robocode-packages/config';
import {
  hasRipgrep,
  searchWithRipgrep,
  parseRipgrepJson,
  searchWithGrep,
  formatMatches,
} from '../utils';

export const searchFilesTool = tool(
  async (
    {
      pattern,
      file_pattern,
      case_sensitive = false,
      whole_word = false,
      max_results = MAX_FILES_RESULTS,
    },
    config?: RunnableConfig
  ) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    try {
      const useRg = await hasRipgrep();
      let matches: Match[];

      if (useRg) {
        const raw = await searchWithRipgrep(pattern, cwd, {
          filePattern: file_pattern,
          caseSensitive: case_sensitive,
          wholeWord: whole_word,
          maxResults: max_results,
          contextLines: CONTEXT_LINES,
        });
        matches = parseRipgrepJson(raw, cwd);
      } else {
        matches = await searchWithGrep(pattern, cwd, {
          filePattern: file_pattern,
          caseSensitive: case_sensitive,
          wholeWord: whole_word,
          maxResults: max_results,
        });
      }

      return formatMatches(matches.slice(0, max_results), pattern);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  },
  {
    name: TOOL_NAMES.search_files,
    description: `Search for a pattern across all files with context around each match.
Better than grep for code search — shows surrounding lines and groups results by file.
Use for:
- Finding function/class definitions: search_files("function handleAuth")
- Finding all usages: search_files("useProfile")  
- Finding imports: search_files("from '@robocode")
- Finding TODO comments: search_files("TODO|FIXME", file_pattern="*.ts")
- Regex patterns: search_files("export (const|function) \\w+")`,
    schema: z.object({
      pattern: z.string().describe('Search pattern. Supports regex.'),
      file_pattern: z.string().optional().describe('File glob pattern e.g. "*.ts" or "*.{ts,tsx}"'),
      case_sensitive: z.boolean().optional().describe('Case sensitive search. Default: false'),
      whole_word: z.boolean().optional().describe('Match whole words only. Default: false'),
      max_results: z.number().int().min(1).max(200).optional().describe('Max results. Default: 50'),
    }),
  }
);
