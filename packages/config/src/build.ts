import type { SupportedLanguage } from './supportedLanguages';
export const BUILD_TOOL_MAP: Record<
  SupportedLanguage,
  { name: string; config: string; build: string; typeCheck: string | null }[]
> = {
  typescript: [
    { name: 'tsc', config: 'tsconfig.json', build: 'tsc --build', typeCheck: 'tsc --noEmit' },
    { name: 'vite', config: 'vite.config.ts', build: 'vite build', typeCheck: 'tsc --noEmit' },
    {
      name: 'esbuild',
      config: 'esbuild.config.js',
      build: 'node esbuild.config.js',
      typeCheck: 'tsc --noEmit',
    },
  ],
  javascript: [
    { name: 'vite', config: 'vite.config.js', build: 'vite build', typeCheck: null },
    { name: 'webpack', config: 'webpack.config.js', build: 'webpack', typeCheck: null },
    { name: 'rollup', config: 'rollup.config.js', build: 'rollup -c', typeCheck: null },
  ],
  python: [
    { name: 'poetry', config: 'pyproject.toml', build: 'poetry build', typeCheck: 'mypy .' },
    { name: 'setuptools', config: 'setup.py', build: 'python setup.py build', typeCheck: null },
  ],
  rust: [
    {
      name: 'cargo',
      config: 'Cargo.toml',
      build: 'cargo build --release',
      typeCheck: 'cargo check',
    },
  ],
  go: [{ name: 'go', config: 'go.mod', build: 'go build ./...', typeCheck: 'go vet ./...' }],
  java: [
    { name: 'maven', config: 'pom.xml', build: 'mvn package', typeCheck: 'mvn compile' },
    {
      name: 'gradle',
      config: 'build.gradle',
      build: 'gradle build',
      typeCheck: 'gradle compileJava',
    },
  ],
  kotlin: [
    {
      name: 'gradle',
      config: 'build.gradle.kts',
      build: 'gradle build',
      typeCheck: 'gradle compileKotlin',
    },
  ],
  ruby: [{ name: 'bundler', config: 'Gemfile', build: 'bundle exec rake', typeCheck: null }],
  php: [{ name: 'composer', config: 'composer.json', build: 'composer install', typeCheck: null }],
  csharp: [
    { name: 'dotnet', config: '*.csproj', build: 'dotnet build', typeCheck: 'dotnet build' },
  ],
  cpp: [{ name: 'cmake', config: 'CMakeLists.txt', build: 'cmake --build .', typeCheck: null }],
  c: [{ name: 'make', config: 'Makefile', build: 'make', typeCheck: null }],
  swift: [{ name: 'spm', config: 'Package.swift', build: 'swift build', typeCheck: 'swift build' }],
  unknown: [],
};
