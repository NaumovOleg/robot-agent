import { fileExists, firstExisting, loadJsonFile, readFileSafe } from '../../utils';
import path from 'node:path';
import type {
  SupportedLanguage,
  LinterContext,
  BuildToolContext,
  TestRunnerContext,
  PackageManagerContext,
  ModuleResolutionContext,
  WorkspaceContext,
  DirtyWorkspaceContext,
} from '../../types';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import {
  LANG_SIGNATURES,
  LINTER_MAP,
  BUILD_TOOL_MAP,
  TEST_RUNNER_MAP,
  PM_SIGNATURES,
  FRAMEWORK_SIGNATURES,
  ENTRY_POINTS_BY_LANG,
  IGNORE_DIRS,
} from '@robocode-packages/config';

export const detectLanguages = async (cwd: string): Promise<SupportedLanguage[]> => {
  const found: SupportedLanguage[] = [];

  for (const { lang, files } of LANG_SIGNATURES) {
    for (const f of files) {
      if (f.includes('*')) {
        // glob pattern — scan top-level
        try {
          const entries = await fs.readdir(cwd);
          const ext = f.replace('*', '');
          if (entries.some((e) => e.endsWith(ext))) {
            found.push(lang);
            break;
          }
        } catch {
          /* skip */
        }
        continue;
      }
      if (await fileExists(path.join(cwd, f))) {
        found.push(lang);
        break;
      }
    }
  }

  return found.length > 0 ? found : ['unknown'];
};

export const detectLinter = async (
  cwd: string,
  lang: SupportedLanguage
): Promise<LinterContext | null> => {
  const candidates = LINTER_MAP[lang] ?? [];
  for (const { name, configs, run } of candidates) {
    if (configs.length === 0) {
      return { name, configFile: '', runCommand: run };
    }
    const found = await firstExisting(cwd, configs);
    if (found) return { name, configFile: found, runCommand: run };
  }
  return null;
};

export const detectBuildTool = async (
  cwd: string,
  lang: SupportedLanguage
): Promise<BuildToolContext | null> => {
  const candidates = BUILD_TOOL_MAP[lang] ?? [];
  for (const { name, config, build, typeCheck } of candidates) {
    if (config.includes('*')) {
      try {
        const entries = await fs.readdir(cwd);
        const ext = config.replace('*', '');
        if (entries.some((e) => e.endsWith(ext))) {
          return { name, configFile: config, buildCommand: build, typeCheckCommand: typeCheck };
        }
      } catch {
        /* skip */
      }
      continue;
    }
    if (await fileExists(path.join(cwd, config))) {
      return { name, configFile: config, buildCommand: build, typeCheckCommand: typeCheck };
    }
  }
  return null;
};

export const detectTestRunner = async (
  cwd: string,
  lang: SupportedLanguage
): Promise<TestRunnerContext | null> => {
  const candidates = TEST_RUNNER_MAP[lang] ?? [];
  for (const { name, configs, run } of candidates) {
    if (configs.length === 0) return { name, configFile: null, runCommand: run };
    const found = await firstExisting(cwd, configs);
    if (found) return { name, configFile: found, runCommand: run };
  }
  return null;
};

export const detectPackageManager = async (cwd: string): Promise<PackageManagerContext> => {
  for (const { name, file, install, add } of PM_SIGNATURES) {
    if (await fileExists(path.join(cwd, file))) {
      return { name, lockFile: file, installCommand: install, addCommand: add };
    }
  }
  return { name: 'unknown', lockFile: null, installCommand: '', addCommand: '' };
};

export const buildModuleResolution = async (
  cwd: string,
  langs: SupportedLanguage[]
): Promise<ModuleResolutionContext> => {
  const res: ModuleResolutionContext = {
    aliases: {},
    baseUrl: null,
    srcLayout: false,
    moduleName: null,
    crateRoot: null,
    sourceRoots: [],
  };

  // TypeScript / JavaScript — path aliases
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tsconfig: any =
    (await loadJsonFile(path.join(cwd, 'tsconfig.json'))) ??
    (await loadJsonFile(path.join(cwd, 'tsconfig.base.json')));
  if (tsconfig) {
    res.aliases = tsconfig.compilerOptions?.paths ?? {};
    res.baseUrl = tsconfig.compilerOptions?.baseUrl ?? null;
  }

  // Python — src layout detection
  if (langs.includes('python')) {
    res.srcLayout = await fileExists(path.join(cwd, 'src'));
  }

  // Go — module name from go.mod
  if (langs.includes('go')) {
    const goMod = await readFileSafe(path.join(cwd, 'go.mod'));
    if (goMod) {
      const match = goMod.match(/^module\s+(\S+)/m);
      res.moduleName = match?.[1] ?? null;
    }
  }

  // Rust — crate root
  if (langs.includes('rust')) {
    const cargoToml = await readFileSafe(path.join(cwd, 'Cargo.toml'));
    if (cargoToml) {
      const match = cargoToml.match(/\[package\][\s\S]*?name\s*=\s*"([^"]+)"/);
      res.crateRoot = match?.[1] ?? null;
    }
  }

  // Java/Kotlin — source roots
  if (langs.includes('java') || langs.includes('kotlin')) {
    for (const root of ['src/main/java', 'src/main/kotlin', 'src']) {
      if (await fileExists(path.join(cwd, root))) {
        res.sourceRoots.push(root);
      }
    }
  }

  return res;
};

export const detectFrameworks = async (
  cwd: string,
  langs: SupportedLanguage[]
): Promise<string[]> => {
  const detected: string[] = [];

  // JS/TS — package.json
  if (langs.includes('typescript') || langs.includes('javascript')) {
    const pkg = await loadJsonFile(path.join(cwd, 'package.json'));
    if (pkg) {
      const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      for (const [fw, sigs] of Object.entries(FRAMEWORK_SIGNATURES)) {
        if (sigs.some((s) => allDeps.includes(s))) detected.push(fw);
      }
    }
  }

  // Python — pyproject.toml or requirements.txt
  if (langs.includes('python')) {
    const pyproject = await readFileSafe(path.join(cwd, 'pyproject.toml'));
    const requirements = await readFileSafe(path.join(cwd, 'requirements.txt'));
    const content = (pyproject ?? '') + (requirements ?? '');
    for (const [fw, sigs] of Object.entries(FRAMEWORK_SIGNATURES)) {
      if (sigs.some((s) => content.toLowerCase().includes(s.toLowerCase()))) {
        detected.push(fw);
      }
    }
  }

  // Java/Kotlin — pom.xml or build.gradle
  if (langs.includes('java') || langs.includes('kotlin')) {
    const pom = await readFileSafe(path.join(cwd, 'pom.xml'));
    const gradle =
      (await readFileSafe(path.join(cwd, 'build.gradle'))) ??
      (await readFileSafe(path.join(cwd, 'build.gradle.kts')));
    const content = (pom ?? '') + (gradle ?? '');
    if (content.includes('spring-boot')) detected.push('spring');
    if (content.includes('quarkus')) detected.push('quarkus');
  }

  return [...new Set(detected)];
};

// ─── Project name ─────────────────────────────────────────────────────────────

export const detectProjectName = async (
  cwd: string,
  langs: SupportedLanguage[]
): Promise<string> => {
  if (langs.includes('typescript') || langs.includes('javascript')) {
    const pkg = await loadJsonFile(path.join(cwd, 'package.json'));
    if (pkg?.name) return pkg.name;
  }
  if (langs.includes('rust')) {
    const cargo = await readFileSafe(path.join(cwd, 'Cargo.toml'));
    const match = cargo?.match(/name\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }
  if (langs.includes('go')) {
    const goMod = await readFileSafe(path.join(cwd, 'go.mod'));
    const match = goMod?.match(/^module\s+(\S+)/m);
    if (match) return match[1].split('/').at(-1) ?? 'unknown';
  }
  if (langs.includes('python')) {
    const pyproject = await readFileSafe(path.join(cwd, 'pyproject.toml'));
    const match = pyproject?.match(/name\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  }
  // fallback to directory name
  return path.basename(cwd);
};

export const findEntryPoints = async (
  cwd: string,
  langs: SupportedLanguage[]
): Promise<string[]> => {
  const candidates = langs.flatMap((l) => ENTRY_POINTS_BY_LANG[l] ?? []);
  const found: string[] = [];
  await Promise.all(
    candidates.map(async (c) => {
      if (await fileExists(path.join(cwd, c))) found.push(c);
    })
  );
  return found;
};

export const getDirectoryTree = async (
  cwd: string,
  maxDepth: number
): Promise<Record<string, string[]>> => {
  const tree: Record<string, string[]> = {};

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name);

    const relDir = path.relative(cwd, dir) || '.';
    if (dirs.length > 0) tree[relDir] = dirs;

    await Promise.all(dirs.map((d) => walk(path.join(dir, d), depth + 1)));
  };

  await walk(cwd, 0);
  return tree;
};

export const cleanContext = (ctx: DirtyWorkspaceContext): WorkspaceContext => ({
  cwd: ctx.cwd,
  git: {
    branch: ctx.git?.branch,
    staged: ctx.git?.status?.staged,
    unstaged: ctx.git?.status?.unstaged,
    recentCommits: ctx.git?.recentCommits?.slice(0, 5),
  },
  language: {
    primary: ctx.language.primary,
    linter: ctx.language.linter?.runCommand,
    typeCheck: ctx.language.buildTool?.typeCheckCommand,
    build: ctx.language.buildTool?.buildCommand,
    packageManager:
      ctx.language.packageManager?.name !== 'unknown'
        ? ctx.language.packageManager?.name
        : undefined,
    aliases: Object.entries(ctx.language.moduleResolution?.aliases ?? {}).map(([name, paths]) => ({
      name,
      path: paths[0],
    })),
  },
  project: ctx.project,
  structure: Object.entries(ctx.structure ?? {}).map(([path, children]) => ({
    path,
    children,
  })),
  entryPoints: ctx.entryPoints,
});
