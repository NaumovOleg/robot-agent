// Parses a type-checker / compiler / linter's output into stable,
// position-independent error signatures. The verify COMMAND itself is
// language-driven (context.language.typeCheck → tsc, mypy, cargo check, go build,
// eslint, …); this parser recognises the two dominant error-line shapes so the
// executor can diff "new vs pre-existing" errors and locate the files involved
// across languages. Line/column are dropped because they shift as files are
// edited; file + message stay stable for an unchanged error.
export const parseVerifyErrors = (output: string): string[] => {
  const sigs = new Set<string>();
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();

    // tsc: "path/file.ts(12,5): error TS2304: Cannot find name 'X'."
    const tsc = line.match(/^(.*?)\(\d+,\d+\):\s*(error\b.*)$/);
    if (tsc) {
      sigs.add(`${tsc[1].trim()}|${tsc[2].trim()}`);
      continue;
    }

    // Unix/eslint/gcc/clang/clippy/ruff: "path/file.ext:12:5: error: msg"
    // (column optional, separator ':' or ' - ').
    const unix = line.match(/^(\S.*?\.\w+):\d+(?::\d+)?(?::| -)\s*((?:error|fatal error)\b.*)$/i);
    if (unix) {
      sigs.add(`${unix[1].trim()}|${unix[2].trim()}`);
      continue;
    }

    // Positionless fallback for tools without file/line prefixes:
    // "error: ...", "error[E0001]: ...", "error TS2304: ...".
    const positionless = line.match(/\b(error(?:\[[^\]]+\])?(?:\s+TS\d+)?:\s.*)$/i);
    if (positionless && !/\(\d+,\d+\)/.test(line) && !/:\d+:\d+/.test(line)) {
      sigs.add(positionless[1].trim());
    }
  }
  return [...sigs];
};

// Signatures present in `current` but not in `baseline`.
export const newVerifyErrors = (current: string[], baseline: string[] = []): string[] => {
  const seen = new Set(baseline ?? []);
  return current.filter((sig) => !seen.has(sig));
};

// Unique repo-relative files named in error signatures ("file|msg"). Skips
// absolute and parent-escaping paths so only in-repo files surface.
export const errorFilesFrom = (signatures: string[]): string[] => {
  const files = new Set<string>();
  for (const sig of signatures) {
    const file = sig.split('|')[0]?.trim();
    if (file && !file.startsWith('/') && !file.startsWith('..') && /[./]/.test(file)) {
      files.add(file);
    }
  }
  return [...files];
};
