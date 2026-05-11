import fs from 'node:fs';
import path from 'node:path';
import {
  type ProjectContext,
  getFileTree,
  getGitBranch,
  detectTechStack,
} from '@robocode-packages/shared';

const contextCache = new Map<string, { ts: number; ctx: ProjectContext }>();
const CACHE_TTL = 60_000;

export const gatherProjectContext = async (cwd?: string): Promise<ProjectContext> => {
  const root = cwd ?? process.cwd();

  const cached = contextCache.get(root);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.ctx;

  let packageJson: Record<string, unknown> | null = null;
  try {
    const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
    packageJson = JSON.parse(raw);
  } catch {}

  const [gitBranch, structure] = await Promise.all([getGitBranch(root), getFileTree(root)]);

  const ctx: ProjectContext = {
    cwd: root,
    projectName: (packageJson?.name as string) ?? path.basename(root),
    packageJson,
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

  if (ctx.gitBranch) {
    lines.push(`- Git branch: ${ctx.gitBranch}`);
  }

  if (ctx.structure) {
    lines.push(`\n## File structure\n\`\`\`\n${ctx.structure}\n\`\`\``);
  }

  return lines.join('\n');
};
