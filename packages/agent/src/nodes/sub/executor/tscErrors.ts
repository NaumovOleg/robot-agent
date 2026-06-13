// Parses type-checker output into stable, position-independent error signatures
// so the executor can tell NEW errors (introduced by a step) apart from
// pre-existing project noise (e.g. test files lacking jest types). Line/column
// are dropped because they shift as files are edited; file + code + message are
// stable for an unchanged error.
export const parseTscErrors = (output: string): string[] => {
  const sigs = new Set<string>();
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();
    // tsc: "path/file.ts(12,5): error TS2304: Cannot find name 'X'."
    const withPos = line.match(/^(.*?)\(\d+,\d+\):\s*(error TS\d+:.*)$/);
    if (withPos) {
      sigs.add(`${withPos[1].trim()}|${withPos[2].trim()}`);
      continue;
    }
    // Other type checkers / positionless lines: keep the "error ...:" payload.
    const positionless = line.match(/\b(error(?: TS\d+)?:\s.*)$/);
    if (positionless && !/\(\d+,\d+\)/.test(line)) {
      sigs.add(positionless[1].trim());
    }
  }
  return [...sigs];
};

// Returns the error signatures present in `current` but not in `baseline`.
export const newTscErrors = (current: string[], baseline: string[] = []): string[] => {
  const seen = new Set(baseline ?? []);
  return current.filter((sig) => !seen.has(sig));
};
