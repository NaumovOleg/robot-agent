export const MAX_LINES_DEFAULT = 250;
export const MAX_LINES_FULL = 500;
export const LARGE_FILE_THRESHOLD = 500;
export const MAX_AGENT_ITERATIONS = 100;
export const CONTEXT_LINES = 3;

export const TOOL_RISK: Record<string, 'safe' | 'moderate' | 'destructive'> = {
  list_dir: 'safe',
  read_file: 'safe',
  glob: 'safe',
  grep: 'safe',
  git_status: 'safe',
  git_diff: 'safe',
  git_log: 'safe',
  git_blame: 'safe',
  git_show: 'safe',
  git_branch: 'safe',
  edit_file: 'moderate',
  write_file: 'destructive',
  bash: 'destructive',
  search_files: 'safe',
  replace_lines: 'moderate',
};

export const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.nuxt',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  'out',
  '.output',
  '.vercel',
  '.netlify',
]);

export const COMPRESS_HISTORY_THRESHOLD = 10_000;

export const CONTEXT_TTL_MS = 30_000;

export const WATCHED_FILES = [
  // universal
  'README.md',
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.gitignore',
  '.editorconfig',
  '.prettierrc',
  '.prettierrc.json',
  '.eslintrc',
  '.eslintrc.json',
  'CLAUDE.md',
  'AGENTS.md',

  // javascript / typescript
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsup.config.ts',
  'vite.config.ts',
  'webpack.config.js',
  'next.config.js',
  'babel.config.js',

  // python
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'poetry.lock',
  'Pipfile',
  'Pipfile.lock',
  'setup.py',
  'setup.cfg',
  '.python-version',

  // rust
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',

  // go
  'go.mod',
  'go.sum',

  // java / kotlin / scala
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'gradle.properties',

  // ruby
  'Gemfile',
  'Gemfile.lock',
  '.ruby-version',

  // php
  'composer.json',
  'composer.lock',

  // c#
  '*.sln',
  '*.csproj',
  'Directory.Build.props',
  'NuGet.config',

  // swift
  'Package.swift',
  'Podfile',
  'Podfile.lock',

  // docker / infra
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',

  // ci/cd
  '.github/workflows',
  '.gitlab-ci.yml',

  // misc config
  'Makefile',
  'justfile',
  '.npmrc',
  '.yarnrc',
  '.tool-versions',
];

export const MAX_FILES_RESULTS = 50;
