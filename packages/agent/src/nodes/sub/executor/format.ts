import * as path from 'node:path';
import { debug, runCommand, detectLanguage } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

// Per-language formatter command. Resolves the formatter from the file's language,
// not a single project-wide assumption. Returns a shell command template that takes
// a quoted file path, or null when the language has no default formatter here.
const formatterFor = (language: string, file: string): string | null => {
  const q = `'${file.replace(/'/g, `'\\''`)}'`;
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
    case 'json':
    case 'css':
    case 'scss':
    case 'markdown':
      return `npx --no-install prettier --write ${q}`;
    case 'go':
      return `gofmt -w ${q}`;
    case 'rust':
      return `rustfmt ${q}`;
    case 'python':
      return `black -q ${q}`;
    default:
      return null;
  }
};

// Runs the per-language formatter on each file this attempt touched, AFTER apply and
// BEFORE verify. Normalizes whitespace/indent regardless of what the model emitted,
// so strict matching is safe to ship. Never blocks: a missing or failing formatter
// is logged and skipped — a correct edit must not fail because prettier isn't installed.
export const formatNode = async (state: ExecutorStateType) => {
  const { cwd, producedFiles } = state;
  const files = [...new Set(producedFiles ?? [])];

  for (const file of files) {
    const language = path.extname(file).toLowerCase() === '.tsx' ? 'tsx' : detectLanguage(file);
    const cmd = formatterFor(language, file);
    if (!cmd) continue;
    const result = await runCommand(cmd, cwd);
    if (!result.ok) {
      debug('[executor/format] skipped (formatter unavailable or failed):', file, '—', result.output.slice(0, 200));
    } else {
      debug('[executor/format] formatted', file);
    }
  }

  return {};
};
