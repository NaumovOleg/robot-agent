// ─── Language detection ───────────────────────────────────────────────────────

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'ruby'
  | 'php'
  | 'csharp'
  | 'cpp'
  | 'c'
  | 'swift'
  | 'unknown';

export interface LanguageContext {
  primary: SupportedLanguage;
  all: SupportedLanguage[];
  // language-specific config files found
  configFiles: string[];
  // which linter/formatter is available
  linter: LinterContext | null;
  // build tool
  buildTool: BuildToolContext | null;
  // test runner
  testRunner: TestRunnerContext | null;
  // package manager (universal — covers all ecosystems)
  packageManager: PackageManagerContext;
  // module resolution hints for reader/import_graph
  moduleResolution: ModuleResolutionContext;
}

export interface LinterContext {
  name: string; // eslint | ruff | clippy | golangci | rubocop | phpstan | etc.
  configFile: string;
  runCommand: string; // exact command executor uses
}

export interface BuildToolContext {
  name: string; // tsc | cargo | go build | maven | gradle | etc.
  configFile: string;
  buildCommand: string;
  typeCheckCommand: string | null;
}

export interface TestRunnerContext {
  name: string; // jest | vitest | pytest | cargo test | go test | rspec | etc.
  configFile: string | null;
  runCommand: string; // exact command step_reviewer uses
}

export interface PackageManagerContext {
  name: string; // npm | pnpm | yarn | bun | pip | cargo | go mod | maven | gradle | composer | gem
  lockFile: string | null;
  installCommand: string;
  addCommand: string; // add a dependency
}

export interface ModuleResolutionContext {
  // TS/JS
  aliases: Record<string, string[]>;
  baseUrl: string | null;
  // Python
  srcLayout: boolean; // src/ layout vs flat
  // Go
  moduleName: string | null;
  // Rust
  crateRoot: string | null;
  // Java/Kotlin
  sourceRoots: string[];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitContext {
  branch: string;
  status: {
    staged: string[];
    unstaged: string[];
    untracked: string[];
    conflicted: string[];
  };
  recentCommits: { hash: string; message: string }[];
}

export interface ProjectContext {
  name: string;
  frameworks: string[];
}

export interface DirtyWorkspaceContext {
  cwd: string;
  git: GitContext | null;
  language: LanguageContext;
  project: ProjectContext;
  structure: Record<string, string[]>;
  entryPoints: string[];
}

export interface WorkspaceContext {
  cwd: string;
  git: {
    branch?: string;
    staged?: string[];
    unstaged?: string[];
    recentCommits?: { hash: string; message: string }[];
  };
  language: {
    primary: SupportedLanguage;
    linter?: string;
    typeCheck?: string | null;
    testRunner?: string | null;
    build?: string;
    packageManager?: string;
    aliases?: { name: string; path: string }[];
  };
  project: ProjectContext;
  structure: { path: string; children: string[] }[];
  entryPoints: string[];
}

export interface CacheEntry {
  context: ProjectContext;
  timestamp: number;
  watchedFiles: Map<string, number>;
  gitSignature: string | null;
}
