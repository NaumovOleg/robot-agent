import type { SupportedLanguage } from './supportedLanguages';
export const TEST_RUNNER_MAP: Record<
  SupportedLanguage,
  { name: string; configs: string[]; run: string }[]
> = {
  typescript: [
    { name: 'vitest', configs: ['vitest.config.ts', 'vitest.config.js'], run: 'npx vitest run' },
    {
      name: 'jest',
      configs: ['jest.config.ts', 'jest.config.js', 'jest.config.json'],
      run: 'npx jest',
    },
  ],
  javascript: [
    { name: 'vitest', configs: ['vitest.config.js'], run: 'npx vitest run' },
    { name: 'jest', configs: ['jest.config.js', 'jest.config.json'], run: 'npx jest' },
    { name: 'mocha', configs: ['.mocharc.yml', '.mocharc.json'], run: 'npx mocha' },
  ],
  python: [
    { name: 'pytest', configs: ['pytest.ini', 'pyproject.toml', 'setup.cfg'], run: 'pytest' },
    { name: 'unittest', configs: [], run: 'python -m unittest discover' },
  ],
  rust: [{ name: 'cargo test', configs: [], run: 'cargo test' }],
  go: [{ name: 'go test', configs: [], run: 'go test ./...' }],
  java: [
    { name: 'junit-maven', configs: ['pom.xml'], run: 'mvn test' },
    { name: 'junit-gradle', configs: ['build.gradle'], run: 'gradle test' },
  ],
  kotlin: [{ name: 'junit-gradle', configs: ['build.gradle.kts'], run: 'gradle test' }],
  ruby: [{ name: 'rspec', configs: ['.rspec', 'spec'], run: 'bundle exec rspec' }],
  php: [
    { name: 'phpunit', configs: ['phpunit.xml', 'phpunit.xml.dist'], run: 'vendor/bin/phpunit' },
  ],
  csharp: [{ name: 'dotnet test', configs: ['*.csproj'], run: 'dotnet test' }],
  cpp: [{ name: 'ctest', configs: ['CMakeLists.txt'], run: 'ctest' }],
  c: [{ name: 'make test', configs: ['Makefile'], run: 'make test' }],
  swift: [{ name: 'swift test', configs: ['Package.swift'], run: 'swift test' }],
  unknown: [],
};
