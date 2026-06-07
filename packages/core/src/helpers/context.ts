import fs from 'node:fs';
import path from 'node:path';
import {
  type ProjectContext,
  getFileTree,
  getGitBranch,
  detectTechStack,
  getValidationCommands,
} from '@robocode-packages/shared';

const contextCache = new Map<string, { ts: number; ctx: ProjectContext }>();
const CACHE_TTL = 60_000;
const POLICY_FILES = ['README.md', 'CLAUDE.md', 'AGENTS.md'];
const POLICY_PREVIEW_LIMIT = 2_000;

const getPackageScripts = (pkg: Record<string, unknown> | null): string[] => {
  const scripts = pkg?.scripts as Record<string, unknown> | undefined;
  if (!scripts) return [];

  return Object.entries(scripts)
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
    .map(([name, command]) => `${name}: ${String(command).trim()}`);
};

const getPolicyFiles = (cwd: string): string[] =>
  POLICY_FILES.filter((file) => fs.existsSync(path.join(cwd, file)));

const readPolicyDocuments = (cwd: string): { file: string; content: string }[] =>
  POLICY_FILES.filter((file) => fs.existsSync(path.join(cwd, file))).map((file) => {
    const fullPath = path.join(cwd, file);
    const raw = fs.readFileSync(fullPath, 'utf-8').trim();
    return {
      file,
      content:
        raw.length > POLICY_PREVIEW_LIMIT ? `${raw.slice(0, POLICY_PREVIEW_LIMIT - 3)}...` : raw,
    };
  });

export const gatherProjectContext = async (cwd?: string): Promise<ProjectContext> => {
  const root = cwd ?? process.cwd();

  const cached = contextCache.get(root);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.ctx;

  let packageJson: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
    packageJson = JSON.parse(raw);
  } catch (error) {
    /* empty */
  }

  const [gitBranch, structure] = await Promise.all([getGitBranch(root), getFileTree(root)]);

  const ctx: ProjectContext = {
    cwd: root,
    projectName: (packageJson?.name as string) ?? path.basename(root),
    packageJson,
    packageScripts: getPackageScripts(packageJson),
    policyFiles: getPolicyFiles(root),
    policyDocuments: readPolicyDocuments(root),
    validationCommands: getValidationCommands(root, packageJson),
    gitBranch,
    techStack: detectTechStack(packageJson),
    structure,
  };

  contextCache.set(root, { ts: Date.now(), ctx });
  return ctx;
};

export const formatProjectContext = (ctx: ProjectContext): string => {
  const lines: string[] = [
    `## Project Context`,
    `- Name: ${ctx.projectName}`,
    `- Directory: ${ctx.cwd}`,
    `- Tech stack: ${ctx.techStack.join(', ') || 'unknown'}`,
  ];

  if (ctx.packageScripts.length > 0) {
    lines.push(`\n## Package scripts`);
    lines.push(...ctx.packageScripts.map((script) => `- ${script}`));
  }

  if (ctx.policyFiles.length > 0) {
    lines.push(`\n## Policy files`);
    lines.push(...ctx.policyFiles.map((file) => `- ${file}`));
  }

  if (ctx.policyDocuments.length > 0) {
    lines.push(`\n## Policy excerpts`);
    for (const doc of ctx.policyDocuments) {
      lines.push(`### ${doc.file}`);
      lines.push('```text');
      lines.push(doc.content);
      lines.push('```');
    }
  }

  if (ctx.validationCommands.length > 0) {
    lines.push(`\n## Validation commands`);
    lines.push(...ctx.validationCommands.map((command) => `- ${command}`));
  }

  if (ctx.gitBranch) {
    lines.push(`- Git branch: ${ctx.gitBranch}`);
  }

  if (ctx.structure) {
    lines.push(`\n## File structure\n\`\`\`\n${ctx.structure}\n\`\`\``);
  }

  return lines.join('\n');
};
