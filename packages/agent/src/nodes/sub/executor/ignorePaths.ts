// Generated, vendored, or VCS directories the executor must never read as a
// reference, surface as an editable error file, or write to. Matched by path
// segment so it works at any depth (e.g. "apps/cli/dist/index.js").
const IGNORED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.robocode',
  'target', // rust
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  '.output',
]);

export const isIgnoredPath = (relPath: string): boolean => {
  if (!relPath) return false;
  return relPath
    .replace(/\\/g, '/')
    .split('/')
    .some((seg) => IGNORED_SEGMENTS.has(seg));
};
