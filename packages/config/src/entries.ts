import type { SupportedLanguage } from './supportedLanguages';
export const ENTRY_POINTS_BY_LANG: Record<SupportedLanguage, string[]> = {
  typescript: ['src/index.ts', 'src/main.ts', 'src/app.ts', 'src/server.ts', 'index.ts'],
  javascript: ['src/index.js', 'src/main.js', 'src/app.js', 'index.js'],
  python: ['src/main.py', 'main.py', 'app.py', 'src/__main__.py', '__main__.py'],
  rust: ['src/main.rs', 'src/lib.rs'],
  go: ['main.go', 'cmd/main.go', 'cmd/server/main.go'],
  java: ['src/main/java/Main.java', 'src/main/java/Application.java'],
  kotlin: ['src/main/kotlin/Main.kt', 'src/main/kotlin/Application.kt'],
  ruby: ['app.rb', 'config/application.rb', 'lib/main.rb'],
  php: ['index.php', 'public/index.php', 'src/index.php'],
  csharp: ['Program.cs', 'src/Program.cs'],
  cpp: ['main.cpp', 'src/main.cpp'],
  c: ['main.c', 'src/main.c'],
  swift: ['Sources/main.swift', 'Sources/App/main.swift'],
  unknown: [],
};
