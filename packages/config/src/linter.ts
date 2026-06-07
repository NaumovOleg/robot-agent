import type { SupportedLanguage } from './supportedLanguages';
export const LINTER_MAP: Record<
  SupportedLanguage,
  { name: string; configs: string[]; run: string }[]
> = {
  typescript: [
    {
      name: 'eslint',
      configs: [
        'eslint.config.js',
        'eslint.config.mjs',
        '.eslintrc.json',
        '.eslintrc.js',
        '.eslintrc',
      ],
      run: 'npx eslint --max-warnings=0',
    },
    { name: 'biome', configs: ['biome.json'], run: 'npx biome check' },
  ],
  javascript: [
    {
      name: 'eslint',
      configs: ['eslint.config.js', '.eslintrc.json', '.eslintrc'],
      run: 'npx eslint --max-warnings=0',
    },
    { name: 'biome', configs: ['biome.json'], run: 'npx biome check' },
  ],
  python: [
    { name: 'ruff', configs: ['ruff.toml', 'pyproject.toml'], run: 'ruff check .' },
    { name: 'flake8', configs: ['.flake8', 'setup.cfg'], run: 'flake8 .' },
    { name: 'pylint', configs: ['.pylintrc', 'pyproject.toml'], run: 'pylint src' },
    { name: 'mypy', configs: ['mypy.ini', 'pyproject.toml'], run: 'mypy .' },
  ],
  rust: [{ name: 'clippy', configs: [], run: 'cargo clippy -- -D warnings' }],
  go: [
    { name: 'golangci', configs: ['.golangci.yml', '.golangci.yaml'], run: 'golangci-lint run' },
  ],
  java: [{ name: 'checkstyle', configs: ['checkstyle.xml'], run: 'mvn checkstyle:check' }],
  kotlin: [{ name: 'ktlint', configs: ['.editorconfig'], run: 'ktlint' }],
  ruby: [{ name: 'rubocop', configs: ['.rubocop.yml'], run: 'rubocop' }],
  php: [{ name: 'phpstan', configs: ['phpstan.neon'], run: 'vendor/bin/phpstan analyse' }],
  csharp: [
    { name: 'dotnet-format', configs: ['.editorconfig'], run: 'dotnet format --verify-no-changes' },
  ],
  cpp: [{ name: 'clang-tidy', configs: ['.clang-tidy'], run: 'clang-tidy' }],
  c: [{ name: 'clang-tidy', configs: ['.clang-tidy'], run: 'clang-tidy' }],
  swift: [{ name: 'swiftlint', configs: ['.swiftlint.yml'], run: 'swiftlint' }],
  unknown: [],
};
