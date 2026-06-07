import type { WorkspaceContext, SelectedFile } from '@robocode-packages/shared';

export function buildSystemPrompt(ctx: WorkspaceContext, files: SelectedFile[]): string {
  const sections: string[] = [];

  sections.push(`You are an autonomous coding agent. You receive a task and complete it by calling tools.

Rules:
- Always inspect code before editing. Read the relevant files first.
- Use edit_file for targeted changes. Use write_file only for new files or full rewrites.
- Run run_tests after modifying code that has tests.
- After completing a related group of edits, call verify_edits with the appropriate check command (e.g. \`npx tsc --noEmit\`, \`npm test\`, \`cargo check\`). Fix all errors before finishing. Skip only when the change clearly needs no verification (e.g. docs, comments).
- For complex changes affecting multiple files, call request_approval with your plan first.
- Call analyze_code when you need AST-level understanding: cross-file refactors, rename operations, or when reading the file alone is insufficient.
- Prefer small, focused edits over large replacements.
- Never guess at file contents — use read_file if a file was not pre-loaded.`);

  if (ctx.roboMd) {
    sections.push(`## Project Instructions (.ROBO.md)\n\n${ctx.roboMd}`);
  }

  sections.push(`## Workspace

**Directory:** ${ctx.cwd}
**Git Status:**
\`\`\`
${ctx.gitStatus || '(clean)'}
\`\`\`
**Recent Commits:**
\`\`\`
${ctx.gitLog || '(none)'}
\`\`\`
${ctx.gitDiff ? `**Unstaged Changes (truncated):**\n\`\`\`diff\n${ctx.gitDiff.slice(0, 4000)}\n\`\`\`` : ''}`);

  if (ctx.packageJson) {
    try {
      const pkg = JSON.parse(ctx.packageJson);
      const relevant = {
        name: pkg.name,
        scripts: pkg.scripts,
        dependencies: Object.keys(pkg.dependencies ?? {}),
        devDependencies: Object.keys(pkg.devDependencies ?? {}),
      };
      sections.push(`## Package\n\n\`\`\`json\n${JSON.stringify(relevant, null, 2)}\n\`\`\``);
    } catch {
      /* skip malformed */
    }
  }

  if (ctx.tsconfig) {
    sections.push(`## TypeScript Config\n\n\`\`\`json\n${ctx.tsconfig.slice(0, 2000)}\n\`\`\``);
  }

  if (files.length > 0) {
    const fileSections = files.map((f) => {
      const truncNote = f.truncated ? `\n*(truncated — ${f.path} has more lines, use read_file to see all)*` : '';
      return `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\`${truncNote}`;
    });
    sections.push(`## Pre-loaded Files (${files.length} most relevant)\n\n${fileSections.join('\n\n')}`);
  }

  return sections.join('\n\n---\n\n');
}
