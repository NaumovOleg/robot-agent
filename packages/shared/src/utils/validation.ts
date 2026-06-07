import fs from 'node:fs';
import path from 'node:path';

type PackageManager = 'pnpm' | 'yarn' | 'npm';

const hasFile = (cwd: string, filePath: string): boolean => fs.existsSync(path.join(cwd, filePath));

const detectPackageManager = (cwd: string, pkg: Record<string, unknown> | null): PackageManager => {
  const declared = String(pkg?.packageManager ?? '').toLowerCase();
  if (declared.startsWith('pnpm')) return 'pnpm';
  if (declared.startsWith('yarn')) return 'yarn';
  if (declared.startsWith('npm')) return 'npm';

  if (hasFile(cwd, 'pnpm-lock.yaml')) return 'pnpm';
  if (hasFile(cwd, 'yarn.lock')) return 'yarn';
  return 'npm';
};

const runScriptCommand = (pm: PackageManager, scriptName: string): string => {
  if (pm === 'npm') return `npm run ${scriptName}`;
  return `${pm} run ${scriptName}`;
};

const execCommand = (pm: PackageManager, command: string): string => {
  if (pm === 'pnpm') return `pnpm exec ${command}`;
  if (pm === 'yarn') return `yarn ${command}`;
  return `npx ${command}`;
};

export const getValidationCommands = (
  cwd: string,
  pkg: Record<string, unknown> | null
): string[] => {
  const scripts = (pkg?.scripts as Record<string, unknown> | undefined) ?? {};
  const pm = detectPackageManager(cwd, pkg);

  const commands: string[] = [];
  const scriptOrder = ['validate', 'check', 'typecheck', 'lint', 'test', 'build'];

  for (const scriptName of scriptOrder) {
    if (typeof scripts[scriptName] === 'string' && String(scripts[scriptName]).trim()) {
      commands.push(runScriptCommand(pm, scriptName));
    }
  }

  if (commands.length === 0) {
    if (hasFile(cwd, 'tsconfig.json')) {
      commands.push(execCommand(pm, 'tsc --noEmit'));
    }

    if (hasFile(cwd, 'eslint.config.js') || hasFile(cwd, '.eslintrc') || hasFile(cwd, '.eslintrc.json')) {
      commands.push(execCommand(pm, 'eslint . --ext .ts,.tsx,.js,.jsx'));
    }

    if (hasFile(cwd, 'vitest.config.ts') || hasFile(cwd, 'vitest.config.js')) {
      commands.push(execCommand(pm, 'vitest run'));
    }
  }

  return [...new Set(commands)].slice(0, 4);
};
