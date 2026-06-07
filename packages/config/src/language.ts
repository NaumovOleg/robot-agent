import type { SupportedLanguage } from './supportedLanguages';

export const LANG_SIGNATURES: { lang: SupportedLanguage; files: string[] }[] = [
  { lang: 'typescript', files: ['tsconfig.json', 'tsconfig.base.json'] },
  {
    lang: 'python',
    files: [
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'Pipfile',
      'poetry.lock',
      'requirements.txt',
    ],
  },
  { lang: 'rust', files: ['Cargo.toml'] },
  { lang: 'go', files: ['go.mod'] },
  { lang: 'java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
  { lang: 'kotlin', files: ['build.gradle.kts'] },
  { lang: 'ruby', files: ['Gemfile', '.ruby-version'] },
  { lang: 'php', files: ['composer.json'] },
  { lang: 'csharp', files: ['*.csproj', '*.sln', 'global.json'] },
  { lang: 'swift', files: ['Package.swift', '*.xcodeproj'] },
  { lang: 'cpp', files: ['CMakeLists.txt', 'Makefile', 'meson.build'] },
];
