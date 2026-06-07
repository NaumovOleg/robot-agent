# Agent Full Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current multi-node pipeline (router_intent → planner → executor subagent chain) with a simple free agent loop: pre-loop context builder feeds workspace + top-K files into a system prompt, then the LLM calls flat tools iteratively until done.

**Architecture:** Pre-loop phase (context_selector + file_selector) assembles WorkspaceContext and SelectedFile[] before `graph.invoke()`. The root LangGraph graph is simplified to `agent_node → tools_node → agent_node` with a `summarizer` exit node. All subagent capability (deep code analysis) is exposed as an `analyze_code` tool that wraps the existing reader subgraph.

**Tech Stack:** TypeScript, LangGraph, LangChain, web-tree-sitter (already installed), Zod, ripgrep (existing grep node), Jest

---

## File Map

### New files
| File | Purpose |
|---|---|
| `packages/shared/src/schemas/workspace/context.ts` | WorkspaceContext, SelectedFile Zod schemas |
| `packages/agent/src/context/selector.ts` | Reads disk pre-loop: git, tsconfig, package.json, .ROBO.md |
| `packages/agent/src/context/file_selector/keywords.ts` | extract_keywords — LLM call expanding task terms |
| `packages/agent/src/context/file_selector/score.ts` | TF-IDF + recency scorer |
| `packages/agent/src/context/file_selector/index.ts` | Orchestrates grep → score → select_top_k |
| `packages/agent/src/main/prompt.ts` | System prompt assembly from WorkspaceContext + files |
| `packages/agent/src/main/agent_node.ts` | Main LLM node: builds messages, invokes model |
| `packages/agent/src/main/tools_node.ts` | ToolNode + permission check + parallel dispatch |
| `packages/agent/src/main/summarizer.ts` | Final node: git diff + prose summary |
| `packages/agent/src/main/graph.ts` | Root LangGraph graph (replaces main/root/graph.ts) |
| `packages/tools/src/tools/control/requestApproval.ts` | interrupt() + agent:plan_pending event |
| `packages/tools/src/tools/subagent/analyzeCode.ts` | Wraps reader subgraph as a tool |
| `packages/tools/src/tools/symbol/renameSymbol.ts` | tree-sitter locate + grep references + edit_file each |
| `__tests__/agent/freeAgentLoop.test.ts` | Integration test for new graph |

### Modified files
| File | Change |
|---|---|
| `packages/shared/src/schemas/workspace/context.ts` | NEW (see above) |
| `packages/agent/src/main/root/state.ts` | Replace with simplified RootState |
| `packages/agent/src/index.ts` | Rewrite RoboAgent: pre-loop + simplified resume |
| `packages/tools/src/tools/editor/editFile.ts` | Add tsc --noEmit + eslint post-check |
| `packages/shared/src/types/event.ts` | Remove obsolete events, simplify agent:plan_pending |
| `packages/config/src/index.ts` | Update TOOL_RISK for new tool names |
| `packages/tools/src/index.ts` | Export new tools |
| `packages/shared/src/index.ts` | Export new schemas |
| `packages/agent/src/nodes/sub/fileSelector/keywords.ts` | Replace stub with real LLM call |
| `packages/agent/src/nodes/sub/fileSelector/scoring.ts` | Replace heuristics with TF-IDF + recency |
| `packages/agent/src/nodes/sub/fileSelector/grep.ts` | Use ripgrep --json -l, respect excludes |

### Deleted files
- `packages/agent/src/main/subagents/editor/` (entire directory)
- `packages/agent/src/main/subagents/git/` (entire directory)
- `packages/agent/src/main/subagents/executor/` (entire directory)
- `packages/agent/src/main/subagents/planner/` (entire directory)
- `packages/agent/src/main/subagents/routerIntent/` (entire directory)
- `packages/agent/src/main/root/` (entire directory — replaced by `main/graph.ts`)
- `packages/agent/src/nodes/root/` (entire directory)
- `packages/agent/src/nodes/sub/editor/` (entire directory)
- `packages/agent/src/nodes/sub/executor/` (entire directory)
- `packages/agent/src/nodes/sub/git/` (entire directory)
- `packages/agent/src/nodes/sub/routerIntent/` (entire directory)
- `packages/agent/src/nodes/planApproval.ts`
- `packages/agent/src/nodes/planner.ts`
- `packages/agent/src/nodes/replan.ts`
- `packages/agent/src/nodes/toolApproval.ts`
- `packages/agent/src/nodes/verify.ts`
- `packages/agent/src/prompts/editIntent.ts`
- `packages/agent/src/prompts/hintToEdit.ts`
- `packages/agent/src/prompts/planner.ts`
- `packages/agent/src/prompts/replan.ts`
- `packages/agent/src/prompts/sub/executor.ts`
- `packages/agent/src/prompts/sub/git.ts`
- `packages/agent/src/prompts/sub/intentRouter.ts`
- `packages/agent/src/prompts/sub/writer.ts`
- `packages/agent/src/utils/plan.ts`
- `packages/agent/src/utils/replan.ts`
- `packages/agent/src/utils/routings.ts`
- `packages/tools/src/tools/root/` (entire directory — delegate tools removed)
- `packages/tools/src/tools/validateProject.ts`
- `packages/tools/src/tools/undo.ts`

---

## Task 1: WorkspaceContext and SelectedFile Zod schemas

**Files:**
- Create: `packages/shared/src/schemas/workspace/context.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Test: `__tests__/shared/workspaceContext.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/shared/workspaceContext.test.ts
import { WorkspaceContextSchema, SelectedFileSchema } from '@robocode-packages/shared';

test('WorkspaceContextSchema parses valid object', () => {
  const result = WorkspaceContextSchema.safeParse({
    cwd: '/home/user/project',
    gitStatus: 'M src/foo.ts',
    gitLog: 'abc123 feat: add feature',
    gitDiff: '',
    tsconfig: '{"compilerOptions":{}}',
    packageJson: '{"name":"app"}',
    eslintConfig: null,
    envExample: null,
    roboMd: null,
  });
  expect(result.success).toBe(true);
});

test('SelectedFileSchema parses valid object', () => {
  const result = SelectedFileSchema.safeParse({
    path: 'src/foo.ts',
    content: 'export const x = 1;',
    score: 0.85,
    truncated: false,
  });
  expect(result.success).toBe(true);
});

test('WorkspaceContextSchema rejects missing cwd', () => {
  const result = WorkspaceContextSchema.safeParse({ gitStatus: '' });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/workspaceContext.test.ts
```
Expected: FAIL — `WorkspaceContextSchema` not found

- [ ] **Step 3: Create the schema file**

```typescript
// packages/shared/src/schemas/workspace/context.ts
import { z } from 'zod';

export const SelectedFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  score: z.number(),
  truncated: z.boolean(),
});

export const WorkspaceContextSchema = z.object({
  cwd: z.string(),
  gitStatus: z.string(),
  gitLog: z.string(),
  gitDiff: z.string(),
  tsconfig: z.string().nullable(),
  packageJson: z.string().nullable(),
  eslintConfig: z.string().nullable(),
  envExample: z.string().nullable(),
  roboMd: z.string().nullable(),
});

export type SelectedFile = z.infer<typeof SelectedFileSchema>;
export type WorkspaceContext = z.infer<typeof WorkspaceContextSchema>;
```

- [ ] **Step 4: Export from shared package**

Add to `packages/shared/src/index.ts`:
```typescript
export * from './schemas/workspace/context';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/workspaceContext.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/workspace/context.ts packages/shared/src/index.ts __tests__/shared/workspaceContext.test.ts
git commit -m "feat: add WorkspaceContext and SelectedFile Zod schemas"
```

---

## Task 2: Simplified RootState

**Files:**
- Modify: `packages/agent/src/main/root/state.ts`

- [ ] **Step 1: Replace the state file**

```typescript
// packages/agent/src/main/root/state.ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { WorkspaceContext, SelectedFile } from '@robocode-packages/shared';

export const RootState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  cwd: Annotation<string>({
    reducer: (_, n) => n,
    default: () => process.cwd(),
  }),
  workspaceContext: Annotation<WorkspaceContext | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  selectedFiles: Annotation<SelectedFile[]>({
    reducer: (_, n) => n,
    default: () => [],
  }),
});

export type RootStateType = typeof RootState.State;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -30
```
Expected: errors only from files that import removed state fields (those files will be deleted in Task 14)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/root/state.ts
git commit -m "feat: simplify RootState to messages, sessionId, cwd, workspaceContext, selectedFiles"
```

---

## Task 3: Context selector

**Files:**
- Create: `packages/agent/src/context/selector.ts`
- Test: `__tests__/agent/contextSelector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/contextSelector.test.ts
import { jest } from '@jest/globals';

jest.mock('node:child_process', () => ({
  execSync: (cmd: string) => {
    if (cmd.includes('git status')) return Buffer.from('M src/foo.ts');
    if (cmd.includes('git log')) return Buffer.from('abc123 feat: add');
    if (cmd.includes('git diff')) return Buffer.from('');
    return Buffer.from('');
  },
}));

jest.mock('node:fs', () => ({
  existsSync: () => false,
  readFileSync: () => { throw Object.assign(new Error(), { code: 'ENOENT' }); },
}));

test('context selector returns WorkspaceContext', async () => {
  const { runContextSelector } = await import('../../packages/agent/src/context/selector.js');
  const ctx = await runContextSelector('/tmp/project');
  expect(ctx.cwd).toBe('/tmp/project');
  expect(ctx.gitStatus).toBe('M src/foo.ts');
  expect(ctx.tsconfig).toBeNull();
  expect(ctx.roboMd).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/contextSelector.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement context selector**

```typescript
// packages/agent/src/context/selector.ts
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceContext } from '@robocode-packages/shared';

function tryExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return '';
  }
}

function tryRead(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function findEslintConfig(cwd: string): string | null {
  for (const name of ['.eslintrc', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js', 'eslint.config.mjs']) {
    const content = tryRead(path.join(cwd, name));
    if (content !== null) return content.slice(0, 500);
  }
  return null;
}

function readEnvExample(cwd: string): string | null {
  const raw = tryRead(path.join(cwd, '.env.example'));
  if (!raw) return null;
  // strip values, keep key names only
  return raw
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => l.split('=')[0])
    .join('\n');
}

export async function runContextSelector(cwd: string): Promise<WorkspaceContext> {
  const [gitStatus, gitLog, gitDiff, tsconfig, packageJson, eslintConfig, envExample, roboMd] =
    await Promise.all([
      Promise.resolve(tryExec('git status --short', cwd)),
      Promise.resolve(tryExec('git log --oneline -10', cwd)),
      Promise.resolve(tryExec('git diff HEAD', cwd).slice(0, 8000)),
      Promise.resolve(tryRead(path.join(cwd, 'tsconfig.json'))),
      Promise.resolve(tryRead(path.join(cwd, 'package.json'))),
      Promise.resolve(findEslintConfig(cwd)),
      Promise.resolve(readEnvExample(cwd)),
      Promise.resolve(tryRead(path.join(cwd, '.ROBO.md'))),
    ]);

  return { cwd, gitStatus, gitLog, gitDiff, tsconfig, packageJson, eslintConfig, envExample, roboMd };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/contextSelector.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/context/selector.ts __tests__/agent/contextSelector.test.ts
git commit -m "feat: context selector — reads git, tsconfig, package.json, .ROBO.md pre-loop"
```

---

## Task 4: File selector — upgrade keywords, scoring, grep

**Files:**
- Modify: `packages/agent/src/nodes/sub/fileSelector/keywords.ts`
- Modify: `packages/agent/src/nodes/sub/fileSelector/scoring.ts`
- Modify: `packages/agent/src/nodes/sub/fileSelector/grep.ts`
- Create: `packages/agent/src/context/file_selector/score.ts`
- Test: `__tests__/agent/fileSelector.test.ts`

- [ ] **Step 1: Write the TF-IDF scorer test**

```typescript
// __tests__/agent/fileSelector.test.ts
import { tfidfScore } from '../../packages/agent/src/context/file_selector/score.js';

test('scores file higher when more unique keywords match', () => {
  const grepResults = [
    { file: 'src/auth.ts', matchedKeywords: ['login', 'token', 'session'] },
    { file: 'src/utils.ts', matchedKeywords: ['token'] },
  ];
  const allFiles = grepResults.map((r) => r.file);
  const scores = grepResults.map((r) => tfidfScore(r, grepResults, allFiles, []));
  expect(scores[0]).toBeGreaterThan(scores[1]);
});

test('recency bonus applied for recently changed files', () => {
  const grepResults = [
    { file: 'src/a.ts', matchedKeywords: ['foo'] },
    { file: 'src/b.ts', matchedKeywords: ['foo'] },
  ];
  const allFiles = grepResults.map((r) => r.file);
  const recentFiles = ['src/a.ts'];
  const scoreA = tfidfScore(grepResults[0], grepResults, allFiles, recentFiles);
  const scoreB = tfidfScore(grepResults[1], grepResults, allFiles, recentFiles);
  expect(scoreA).toBeGreaterThan(scoreB);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/fileSelector.test.ts
```
Expected: FAIL

- [ ] **Step 3: Create the TF-IDF scorer**

```typescript
// packages/agent/src/context/file_selector/score.ts

export interface GrepResult {
  file: string;
  matchedKeywords: string[];
}

export function tfidfScore(
  result: GrepResult,
  allResults: GrepResult[],
  allFiles: string[],
  recentFiles: string[],
): number {
  const totalDocs = allFiles.length || 1;
  let score = 0;

  for (const kw of result.matchedKeywords) {
    const tf = result.matchedKeywords.filter((k) => k === kw).length;
    const docsWithKw = allResults.filter((r) => r.matchedKeywords.includes(kw)).length;
    const idf = Math.log(totalDocs / (docsWithKw + 1));
    score += tf * idf;
  }

  if (recentFiles.includes(result.file)) {
    score += 0.2;
  }

  return score;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/fileSelector.test.ts
```
Expected: PASS

- [ ] **Step 5: Upgrade the grep node to use ripgrep --json -l with excludes**

Replace `packages/agent/src/nodes/sub/fileSelector/grep.ts`:

```typescript
import { execSync } from 'node:child_process';
import type { FileSelectorState } from '@robocode-packages/shared';

const EXCLUDES = [
  '--glob=!node_modules/**',
  '--glob=!dist/**',
  '--glob=!.git/**',
  '--glob=!**/*.snap',
  '--glob=!**/*.lock',
  '--glob=!pnpm-lock.yaml',
];

export const grepNode = async (state: FileSelectorState) => {
  const cwd = state.cwd || process.cwd();
  const fileSet = new Map<string, Set<string>>();

  for (const keyword of state.keywords) {
    if (!keyword.trim()) continue;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const raw = execSync(
        `rg --json -l "${escaped}" ${EXCLUDES.join(' ')} .`,
        { cwd, stdio: ['pipe', 'pipe', 'pipe'] }
      ).toString();

      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'match' || obj.type === 'begin') {
            const file = obj.data?.path?.text;
            if (file) {
              if (!fileSet.has(file)) fileSet.set(file, new Set());
              fileSet.get(file)!.add(keyword);
            }
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* no matches for this keyword */ }
  }

  return {
    grepResults: Array.from(fileSet.entries()).map(([file, kws]) => ({
      file,
      matchedKeywords: Array.from(kws),
    })),
  };
};
```

- [ ] **Step 6: Upgrade the keywords node to use a real LLM call**

Replace `packages/agent/src/nodes/sub/fileSelector/keywords.ts`:

```typescript
import type { FileSelectorState } from '@robocode-packages/shared';
import { debug } from '@robocode-packages/shared';
import { createBaseModel } from '../../../agent/src/utils/model';
import { z } from 'zod';

const KeywordsSchema = z.object({
  keywords: z.array(z.string()).describe('Search terms to find relevant files'),
});

export const extractKeywordsNode = async (state: FileSelectorState) => {
  if (state.keywords.length > 0) return { keywords: state.keywords };

  const llm = createBaseModel(false).withStructuredOutput(KeywordsSchema);

  const prompt = `Extract search terms to find relevant source files for this task.
Return function names, class names, file name fragments, import paths, config keys, and error strings.
Task: ${state.goal}`;

  try {
    const result = await llm.invoke(prompt);
    debug('FILE_SELECTOR_KEYWORDS_LLM', result.keywords);
    return { keywords: result.keywords };
  } catch {
    // fallback to simple split
    const keywords = state.goal.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    return { keywords };
  }
};
```

Note: `createBaseModel` is in `packages/agent/src/utils/model.ts` — import path from fileSelector node: `'../../../utils/model'`

- [ ] **Step 7: Upgrade the scoring node to use TF-IDF**

Replace `packages/agent/src/nodes/sub/fileSelector/scoring.ts`:

```typescript
import { execSync } from 'node:child_process';
import type { FileSelectorState } from '@robocode-packages/shared';
import { tfidfScore } from '../../../context/file_selector/score';

function getRecentFiles(cwd: string): string[] {
  try {
    const raw = execSync('git log --oneline -10 --name-only --pretty=format:', {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return raw.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export const scoringNode = async (state: FileSelectorState) => {
  const recentFiles = getRecentFiles(state.cwd || process.cwd());
  const allFiles = state.grepResults.map((r) => r.file);

  const scored = state.grepResults.map((r) => ({
    file: r.file,
    score: tfidfScore(r, state.grepResults, allFiles, recentFiles),
  }));

  return { scoredFiles: scored };
};
```

- [ ] **Step 8: Create the file_selector orchestrator**

```typescript
// packages/agent/src/context/file_selector/index.ts
import fs from 'node:fs';
import path from 'node:path';
import type { SelectedFile } from '@robocode-packages/shared';
import { fileSelectorGraph } from '../../main/subagents/fileSelector';

const MAX_FILES = 20;
const MAX_LINES = 300;

export async function runFileSelector(goal: string, cwd: string): Promise<SelectedFile[]> {
  const result = await fileSelectorGraph.invoke({
    goal,
    keywords: [],
    cwd,
    sessionId: '',
    grepResults: [],
    scoredFiles: [],
    selectedFiles: [],
  });

  const topFiles: SelectedFile[] = [];
  const sorted = [...(result.scoredFiles ?? [])].sort((a, b) => b.score - a.score);

  for (const { file, score } of sorted.slice(0, MAX_FILES)) {
    const absPath = path.isAbsolute(file) ? file : path.join(cwd, file);
    try {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const lines = raw.split('\n');
      const truncated = lines.length > MAX_LINES;
      const content = truncated ? lines.slice(0, MAX_LINES).join('\n') : raw;
      topFiles.push({ path: file, content, score, truncated });
    } catch { /* file disappeared — skip */ }
  }

  return topFiles;
}
```

- [ ] **Step 9: Run all file selector tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/fileSelector.test.ts
```
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/agent/src/nodes/sub/fileSelector/grep.ts \
        packages/agent/src/nodes/sub/fileSelector/keywords.ts \
        packages/agent/src/nodes/sub/fileSelector/scoring.ts \
        packages/agent/src/context/file_selector/score.ts \
        packages/agent/src/context/file_selector/index.ts \
        __tests__/agent/fileSelector.test.ts
git commit -m "feat: file selector — ripgrep + TF-IDF scoring + LLM keyword expansion"
```

---

## Task 5: System prompt assembly

**Files:**
- Create: `packages/agent/src/main/prompt.ts`
- Test: `__tests__/agent/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/prompt.test.ts
import { buildSystemPrompt } from '../../packages/agent/src/main/prompt.js';
import type { WorkspaceContext, SelectedFile } from '@robocode-packages/shared';

const ctx: WorkspaceContext = {
  cwd: '/project',
  gitStatus: 'M src/foo.ts',
  gitLog: 'abc feat: add thing',
  gitDiff: '',
  tsconfig: null,
  packageJson: '{"name":"app","scripts":{"test":"jest"}}',
  eslintConfig: null,
  envExample: null,
  roboMd: '# Project rules\nUse TypeScript.',
};

const files: SelectedFile[] = [
  { path: 'src/foo.ts', content: 'export const x = 1;', score: 1.0, truncated: false },
];

test('includes cwd in prompt', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('/project');
});

test('includes git status', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('M src/foo.ts');
});

test('includes .ROBO.md content', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('Use TypeScript.');
});

test('includes file content', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('export const x = 1;');
});

test('includes file path', () => {
  expect(buildSystemPrompt(ctx, files)).toContain('src/foo.ts');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/prompt.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement system prompt assembly**

```typescript
// packages/agent/src/main/prompt.ts
import type { WorkspaceContext, SelectedFile } from '@robocode-packages/shared';

export function buildSystemPrompt(ctx: WorkspaceContext, files: SelectedFile[]): string {
  const sections: string[] = [];

  sections.push(`You are an autonomous coding agent. You receive a task and complete it by calling tools.

Rules:
- Always inspect code before editing. Read the relevant files first.
- Use edit_file for targeted changes. Use write_file only for new files or full rewrites.
- Run run_tests after modifying code that has tests.
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
    } catch { /* skip malformed */ }
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/prompt.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/main/prompt.ts __tests__/agent/prompt.test.ts
git commit -m "feat: system prompt assembly — workspace context + pre-loaded files + .ROBO.md"
```

---

## Task 6: request_approval tool

**Files:**
- Create: `packages/tools/src/tools/control/requestApproval.ts`
- Modify: `packages/tools/src/index.ts` (add export)

- [ ] **Step 1: Implement request_approval tool**

```typescript
// packages/tools/src/tools/control/requestApproval.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import type { RunnableConfig } from '@langchain/core/runnables';

export const requestApprovalTool = tool(
  async ({ plan }: { plan: string }, config?: RunnableConfig) => {
    const sessionId = (config?.configurable?.sessionId as string) ?? '';
    EventBus.emit('agent:plan_pending', { sessionId, plan });
    const approved = interrupt<boolean>('plan_approval');
    if (!approved) return 'User rejected the plan. Reconsider the approach or stop.';
    return 'Plan approved. Proceed with execution.';
  },
  {
    name: 'request_approval',
    description: `Show the user a plan and wait for approval before executing.
Use for: multiple file modifications, deletions, renames, destructive bash commands.
Skip for: single-file edits, read-only tasks, simple fixes.
plan: plain text description of what you intend to do, typically a numbered list.`,
    schema: z.object({
      plan: z.string().describe('Description of the changes you plan to make'),
    }),
  }
);
```

- [ ] **Step 2: Add to tools exports**

Add to `packages/tools/src/index.ts`:
```typescript
export { requestApprovalTool } from './tools/control/requestApproval';
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/tools/tsconfig.json 2>&1 | head -20
```
Expected: no errors in `requestApproval.ts`

- [ ] **Step 4: Commit**

```bash
git add packages/tools/src/tools/control/requestApproval.ts packages/tools/src/index.ts
git commit -m "feat: request_approval tool — interrupt() + agent:plan_pending event"
```

---

## Task 7: analyze_code tool

**Files:**
- Create: `packages/agent/src/tools/analyzeCode.ts`

Note: `analyze_code` lives in `packages/agent`, NOT `packages/tools`. Moving it to `packages/tools` would create a circular dependency (tools → agent → tools). `agent_node.ts` imports it directly from the same package.

- [ ] **Step 1: Implement analyze_code tool**

```typescript
// packages/agent/src/tools/analyzeCode.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { readerGraph } from '../main/subagents/reader';
import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export const analyzeCodeTool = tool(
  async ({ task, files }: { task: string; files: string[] }, config?: RunnableConfig) => {
    const sessionId = (config?.configurable?.sessionId as string) ?? '';
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();

    const result = await readerGraph.invoke(
      {
        messages: [
          new SystemMessage(`Analyze the following code to answer: ${task}`),
          new HumanMessage(`Files to analyze: ${files.join(', ')}`),
        ],
        sessionId,
        cwd,
        files,
        turnCount: 0,
        editIntentInputPayload: null,
      },
      { configurable: { sessionId, cwd } }
    );

    const output = result.editIntentInputPayload;
    if (!output) return JSON.stringify({ status: 'blocked', summary: 'Reader returned no output' });
    return JSON.stringify(output);
  },
  {
    name: 'analyze_code',
    description: `Deep code analysis using AST parsing and import graph traversal.
Returns: functions, classes, imports, cross-file references, key findings, and a suggested edit strategy.
Use for: cross-file refactors, rename operations, understanding complex dependencies.
Do NOT use for simple single-file reads — use read_file instead.`,
    schema: z.object({
      task: z.string().describe('What to investigate — be specific about what you need to know'),
      files: z.array(z.string()).describe('File paths to analyze (relative to cwd)'),
    }),
  }
);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep analyzeCode
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/tools/analyzeCode.ts
git commit -m "feat: analyze_code tool — wraps reader subgraph, returns ReaderOutputSchema"
```

---

## Task 8: rename_symbol tool

**Files:**
- Create: `packages/tools/src/tools/symbol/renameSymbol.ts`
- Modify: `packages/tools/src/index.ts`
- Test: `__tests__/tools/renameSymbol.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/tools/renameSymbol.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renameSymbolTool } from '../../packages/tools/src/tools/symbol/renameSymbol.js';

test('renames all occurrences of a symbol in a file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-test-'));
  const file = path.join(dir, 'foo.ts');
  fs.writeFileSync(file, `export function myFunction() {}\nmyFunction();\n`);

  const result = await renameSymbolTool.invoke(
    { file: file, symbol: 'myFunction', newSymbol: 'renamedFunction' },
    { configurable: { cwd: dir, sessionId: '' } }
  );

  const updated = fs.readFileSync(file, 'utf-8');
  expect(updated).toContain('renamedFunction');
  expect(updated).not.toContain('myFunction');
  expect(result).toContain('renamed');

  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/tools/renameSymbol.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement rename_symbol tool**

```typescript
// packages/tools/src/tools/symbol/renameSymbol.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { RunnableConfig } from '@langchain/core/runnables';

function findAllOccurrences(cwd: string, symbol: string): Array<{ file: string; content: string }> {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const excludes = [
    '--glob=!node_modules/**',
    '--glob=!dist/**',
    '--glob=!.git/**',
  ].join(' ');

  try {
    const raw = execSync(`rg -l "${escaped}" ${excludes} .`, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return raw
      .split('\n')
      .filter(Boolean)
      .map((file) => ({
        file: path.resolve(cwd, file),
        content: fs.readFileSync(path.resolve(cwd, file), 'utf-8'),
      }));
  } catch {
    return [];
  }
}

export const renameSymbolTool = tool(
  async ({ file, symbol, newSymbol }: { file: string; symbol: string; newSymbol: string }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const absFile = path.isAbsolute(file) ? file : path.resolve(cwd, file);

    if (symbol === newSymbol) return `Error: newSymbol is identical to symbol`;

    const occurrences = findAllOccurrences(cwd, symbol);
    if (occurrences.length === 0) {
      return `Symbol "${symbol}" not found in any file under ${cwd}`;
    }

    let totalReplacements = 0;
    const modifiedFiles: string[] = [];

    for (const { file: targetFile, content } of occurrences) {
      const wordBoundary = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const matches = content.match(wordBoundary);
      if (!matches) continue;

      const updated = content.replace(wordBoundary, newSymbol);
      fs.writeFileSync(targetFile, updated, 'utf-8');
      totalReplacements += matches.length;
      modifiedFiles.push(path.relative(cwd, targetFile));
    }

    return `Renamed "${symbol}" → "${newSymbol}" in ${modifiedFiles.length} file(s), ${totalReplacements} replacement(s):\n${modifiedFiles.join('\n')}`;
  },
  {
    name: 'rename_symbol',
    description: `Rename a symbol (function, class, variable, type) across all files in the project.
Uses ripgrep to find all occurrences, then replaces with word-boundary matching.
file: the file where the symbol is defined (used as reference; all project files are searched).`,
    schema: z.object({
      file: z.string().describe('File where the symbol is defined'),
      symbol: z.string().describe('Current symbol name'),
      newSymbol: z.string().describe('New symbol name'),
    }),
  }
);
```

- [ ] **Step 4: Add to tools exports**

Add to `packages/tools/src/index.ts`:
```typescript
export { renameSymbolTool } from './tools/symbol/renameSymbol';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/tools/renameSymbol.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/tools/symbol/renameSymbol.ts packages/tools/src/index.ts __tests__/tools/renameSymbol.test.ts
git commit -m "feat: rename_symbol tool — ripgrep find + word-boundary replace across project"
```

---

## Task 9: edit_file post-check (tsc + eslint)

**Files:**
- Modify: `packages/tools/src/tools/editor/editFile.ts`
- Test: `__tests__/tools/editFilePostCheck.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/tools/editFilePostCheck.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editFileTool } from '../../packages/tools/src/tools/editor/editFile.js';

test('successful edit returns diff without error notes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'));
  const file = path.join(dir, 'foo.js');
  fs.writeFileSync(file, 'const x = 1;\n');

  const result = await editFileTool.invoke(
    { path: file, old_str: 'const x = 1;', new_str: 'const x = 2;' },
    { configurable: { cwd: dir, sessionId: '' } }
  );

  expect(result).toContain('Edited:');
  fs.rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it passes with existing tool**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/tools/editFilePostCheck.test.ts
```
Expected: PASS (existing tool already works)

- [ ] **Step 3: Add tsc/eslint post-check to editFile.ts**

Find the return line in `editFileTool` after `fs.writeFileSync(filePath, updated, 'utf-8')` and extend it:

In `packages/tools/src/tools/editor/editFile.ts`, after the writeFileSync call, before the return, add:

```typescript
      // post-check: tsc if TypeScript, eslint if config present
      const notes: string[] = [];
      const isTs = /\.(ts|tsx)$/.test(filePath);
      if (isTs) {
        try {
          execSync(`npx tsc --noEmit 2>&1 || true`, { cwd: path.dirname(filePath), stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (e: any) {
          const tscOut = e.stdout?.toString() ?? '';
          if (tscOut.trim()) notes.push(`TypeScript errors:\n${tscOut.slice(0, 1500)}`);
        }
      }

      const editResult = `Edited: ${filePath} (${summary})\n\n${diff}`;
      return notes.length ? `${editResult}\n\n${notes.join('\n')}` : editResult;
```

Also add `import { execSync } from 'node:child_process'` and `import path from 'node:path'` at the top if not present.

- [ ] **Step 4: Run test to verify it still passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/tools/editFilePostCheck.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/tools/editor/editFile.ts __tests__/tools/editFilePostCheck.test.ts
git commit -m "feat: edit_file post-check — append tsc errors to result for TypeScript files"
```

---

## Task 10: agent_node

**Files:**
- Create: `packages/agent/src/main/agent_node.ts`

- [ ] **Step 1: Implement agent_node**

```typescript
// packages/agent/src/main/agent_node.ts
import { SystemMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { createBaseModel } from '../utils/model';
import { buildSystemPrompt } from './prompt';
import type { RootStateType } from './root/state';
import {
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  findDefinitionsTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  bashTool,
  gitDiffTool,
  gitLogTool,
  requestApprovalTool,
  renameSymbolTool,
} from '@robocode-packages/tools';
import { analyzeCodeTool } from '../tools/analyzeCode';

export const ALL_TOOLS = [
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  findDefinitionsTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  bashTool,
  gitDiffTool,
  gitLogTool,
  requestApprovalTool,
  analyzeCodeTool,
  renameSymbolTool,
];

export async function agentNode(state: RootStateType) {
  const { sessionId, cwd, workspaceContext, selectedFiles, messages } = state;

  EventBus.emit('llm:start', { sessionId });

  const model = createBaseModel(true).bindTools(ALL_TOOLS);

  const systemPrompt = workspaceContext
    ? buildSystemPrompt(workspaceContext, selectedFiles ?? [])
    : '';

  const allMessages = systemPrompt
    ? [new SystemMessage(systemPrompt), ...messages]
    : messages;

  try {
    const response = await model.invoke(allMessages, {
      configurable: { sessionId, cwd },
    });
    EventBus.emit('llm:end', { sessionId });
    return { messages: [response] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    throw err;
  }
}
```

Note: Export names for existing tools (`listDirTool`, `gitDiffTool`, `gitLogTool`) must match what `packages/tools/src/index.ts` actually exports. Verify and adjust accordingly.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep agent_node
```
Expected: no errors in agent_node.ts

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/agent_node.ts
git commit -m "feat: agent_node — LLM with all tools bound, system prompt from WorkspaceContext"
```

---

## Task 11: tools_node with permission check

**Files:**
- Create: `packages/agent/src/main/tools_node.ts`

- [ ] **Step 1: Implement tools_node**

```typescript
// packages/agent/src/main/tools_node.ts
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { isAIMessage } from '@robocode-packages/shared';
import { TOOL_RISK } from '@robocode-packages/config';
import type { RootStateType } from './root/state';
import { ALL_TOOLS } from './agent_node';
import type { ToolCall } from '@langchain/core/messages/tool';

const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'glob', 'grep', 'find_symbol', 'git_diff', 'git_log', 'analyze_code',
]);

async function checkPermission(toolCall: ToolCall, sessionId: string): Promise<boolean> {
  const risk = TOOL_RISK[toolCall.name as keyof typeof TOOL_RISK] ?? 'low';
  if (risk !== 'destructive') return true;

  EventBus.emit('agent:tool_pending', {
    sessionId,
    toolCall: { name: toolCall.name, input: toolCall.args },
    source: 'root',
  });

  const decision = interrupt<'approve' | 'reject' | 'y' | 'n'>('tool_approval');
  const approved = decision === 'approve' || decision === 'y';

  EventBus.emit('agent:tool_decision', {
    sessionId,
    approved,
    toolCall: { name: toolCall.name, input: toolCall.args },
  });

  return approved;
}

const innerToolNode = new ToolNode(ALL_TOOLS);

export async function toolsNode(state: RootStateType) {
  const { sessionId } = state;
  const lastMsg = state.messages.at(-1);

  if (!lastMsg || !isAIMessage(lastMsg) || !lastMsg.tool_calls?.length) {
    return {};
  }

  const toolCalls = lastMsg.tool_calls;

  // partition: read-only run in parallel, mutations run sequentially
  const readOnly = toolCalls.filter((tc) => READ_ONLY_TOOLS.has(tc.name));
  const mutations = toolCalls.filter((tc) => !READ_ONLY_TOOLS.has(tc.name));

  // check permissions for mutations first
  for (const tc of mutations) {
    const allowed = await checkPermission(tc, sessionId);
    if (!allowed) {
      // replace the tool call with a rejection message
      tc.args = { ...tc.args, _rejected: true };
    }
  }

  // delegate to LangGraph's ToolNode which handles tool:start/end events
  return innerToolNode.invoke(state);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep tools_node
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/tools_node.ts
git commit -m "feat: tools_node — permission check for destructive tools, parallel dispatch for read-only"
```

---

## Task 12: Summarizer node

**Files:**
- Create: `packages/agent/src/main/summarizer.ts`

- [ ] **Step 1: Implement summarizer**

```typescript
// packages/agent/src/main/summarizer.ts
import { execSync } from 'node:child_process';
import { AIMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { createBaseModel } from '../utils/model';
import type { RootStateType } from './root/state';

function tryExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return '';
  }
}

export async function summarizerNode(state: RootStateType) {
  const { sessionId, cwd } = state;

  const gitDiff = tryExec('git diff HEAD --stat', cwd);
  const gitDiffFull = tryExec('git diff HEAD', cwd).slice(0, 6000);

  EventBus.emit('llm:start', { sessionId });
  const llm = createBaseModel(false);

  const prompt = `You are summarizing the results of an autonomous coding session.

Git changes:
${gitDiff || '(no changes)'}

Full diff (truncated):
${gitDiffFull || '(none)'}

Conversation history (last 5 messages):
${state.messages.slice(-5).map((m) => `${m._getType()}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300)}`).join('\n')}

Write a brief summary: what was accomplished, what files changed, any warnings or failures. Be concise.`;

  try {
    const response = await llm.invoke(prompt);
    EventBus.emit('llm:end', { sessionId });
    const summary = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return { messages: [new AIMessage(summary)] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    return { messages: [new AIMessage(`Session complete. Git diff:\n${gitDiff || '(no changes)'}`)] };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/src/main/summarizer.ts
git commit -m "feat: summarizer node — git diff stat + prose summary LLM call"
```

---

## Task 13: Root graph

**Files:**
- Create: `packages/agent/src/main/graph.ts`
- Modify: `packages/agent/src/main/index.ts` (re-export)

- [ ] **Step 1: Build the root graph**

```typescript
// packages/agent/src/main/graph.ts
import { StateGraph, END, START } from '@langchain/langgraph';
import { isAIMessage } from '@robocode-packages/shared';
import { Checkpointer } from '@robocode-packages/core';
import { RootState, type RootStateType } from './root/state';
import { agentNode } from './agent_node';
import { toolsNode } from './tools_node';
import { summarizerNode } from './summarizer';

function routeAfterAgent(state: RootStateType): 'tools' | 'summarizer' {
  const lastMsg = state.messages.at(-1);
  if (lastMsg && isAIMessage(lastMsg) && lastMsg.tool_calls?.length) {
    return 'tools';
  }
  return 'summarizer';
}

export function buildGraph() {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(RootState)
    .addNode('agent', agentNode)
    .addNode('tools', toolsNode)
    .addNode('summarizer', summarizerNode)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', routeAfterAgent)
    .addEdge('tools', 'agent')
    .addEdge('summarizer', END);

  return graph.compile({ checkpointer });
}

export const rootGraph = buildGraph();
```

Update `packages/agent/src/main/index.ts`:
```typescript
export { rootGraph, buildGraph } from './graph';
export { RootState } from './root/state';
export type { RootStateType } from './root/state';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/graph.ts packages/agent/src/main/index.ts
git commit -m "feat: root graph — simple agent → tools → agent loop with summarizer exit"
```

---

## Task 14: RoboAgent rewrite

**Files:**
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Rewrite RoboAgent**

Replace `packages/agent/src/index.ts` with:

```typescript
import { HumanMessage, type BaseMessage } from '@langchain/core/messages';
import { Command, END } from '@langchain/langgraph';
import { rootGraph } from './main';
import {
  MessageService,
  SessionService,
  Checkpointer,
  EventBus,
  AuditService,
} from '@robocode-packages/core';
import type { Session } from '@robocode-packages/shared';
import { debug, getGitDiffPreview, getGitDiffStat } from '@robocode-packages/shared';
import { runContextSelector } from './context/selector';
import { runFileSelector } from './context/file_selector';
import { extractNewMessages, saveNewMessages } from './utils';
import { compactConversation } from './context/compressor';

class RoboAgent {
  private static instance: RoboAgent;
  private session?: Session | null = SessionService.findActive();

  private getMainThreadId(sessionId?: string) {
    return `${sessionId ?? this.session?.id ?? ''}_main`;
  }

  private async publishGitDiff(sessionId: string, cwd: string) {
    const [gitDiffStat, gitDiffPreview] = await Promise.all([
      getGitDiffStat(cwd),
      getGitDiffPreview(cwd),
    ]);
    EventBus.emit('agent:git_diff', { sessionId, gitDiffStat, gitDiffPreview });
    return { gitDiffStat, gitDiffPreview };
  }

  constructor() {
    EventBus.on('agent:set-session', this.setSession.bind(this));
    EventBus.on('agent:resume', this.resume.bind(this));
    EventBus.on('agent:stop', this.stop.bind(this));
    EventBus.on('agent:run', this.run.bind(this));
    EventBus.on('agent:delete-checkpoint', this.deleteCheckpoint.bind(this));
    EventBus.on('agent:compact_request', this.compact.bind(this));

    EventBus.on('agent:plan_pending', ({ sessionId, plan }) => {
      AuditService.append(sessionId, 'agent:plan_pending', { plan });
    });
    EventBus.on('agent:plan_decision', ({ sessionId, approved, plan }) => {
      AuditService.append(sessionId, 'agent:plan_decision', { approved, plan });
    });
    EventBus.on('agent:tool_pending', ({ sessionId, toolCall }) => {
      AuditService.append(sessionId, 'agent:tool_pending', toolCall);
    });
    EventBus.on('agent:tool_decision', ({ sessionId, approved, toolCall }) => {
      AuditService.append(sessionId, 'agent:tool_decision', { approved, toolCall });
    });
    EventBus.on('llm:start', ({ sessionId }) => AuditService.append(sessionId, 'llm:start', {}));
    EventBus.on('llm:end', ({ sessionId }) => AuditService.append(sessionId, 'llm:end', {}));
    EventBus.on('llm:error', ({ sessionId, error }) => AuditService.append(sessionId, 'llm:error', { error }));
    EventBus.on('tool:start', ({ sessionId, name, input, callId }) => AuditService.append(sessionId, 'tool:start', { name, input, callId }));
    EventBus.on('tool:end', ({ sessionId, name, output, callId }) => AuditService.append(sessionId, 'tool:end', { name, output, callId }));
    EventBus.on('tool:error', ({ sessionId, name, error, callId }) => AuditService.append(sessionId, 'tool:error', { name, error, callId }));
  }

  setSession(session: Session | null) {
    this.session = session;
  }

  public static getInstance() {
    if (!RoboAgent.instance) RoboAgent.instance = new RoboAgent();
    return RoboAgent.instance;
  }

  public async run(userInput: string) {
    if (!this.session) throw new Error('Session not set');

    const { id: sessionId, cwd } = this.session;
    const config = {
      configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd },
      recursionLimit: 200,
    };

    // Pre-loop phase
    const [workspaceContext, selectedFiles] = await Promise.all([
      runContextSelector(cwd),
      runFileSelector(userInput, cwd),
    ]);

    const userMessage = new HumanMessage(userInput);
    MessageService.add(sessionId, userMessage);
    AuditService.append(sessionId, 'agent:run', { input: userInput });

    const result = await rootGraph.invoke(
      { messages: [userMessage], sessionId, cwd, workspaceContext, selectedFiles },
      config
    );

    const diffPromise = this.publishGitDiff(sessionId, cwd);
    try {
      saveNewMessages(sessionId, result.messages ?? []);
    } finally {
      await diffPromise;
    }

    return { ...result, ...(await diffPromise) };
  }

  async resume(params: { sessionId: string; decision: 'approve' | 'reject' | 'y' | 'n' }) {
    const { sessionId, decision } = params;
    const session = SessionService.load(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    AuditService.append(sessionId, 'agent:resume', { decision });

    const config = {
      configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd: session.cwd },
      recursionLimit: 200,
    };

    const approved = decision === 'approve' || decision === 'y';
    const historyBefore = MessageService.load(sessionId);
    const result = await rootGraph.invoke(new Command({ resume: approved }), config);

    const diffPromise = this.publishGitDiff(sessionId, session.cwd);
    try {
      const resultMessages: BaseMessage[] = result.messages ?? [];
      const newMessages = extractNewMessages(historyBefore, resultMessages);
      debug('NEW MESSAGES after resume:', newMessages.length);
      saveNewMessages(sessionId, result.messages ?? []);
    } finally {
      await diffPromise;
    }

    return { ...result, ...(await diffPromise) };
  }

  async stop({ sessionId }: { sessionId: string }) {
    const config = { configurable: { thread_id: this.getMainThreadId(sessionId) } };
    AuditService.append(sessionId, 'agent:stop', {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await rootGraph.invoke(new Command({ goto: END as any }), config);
    EventBus.emit('agent:stopped', { sessionId });
  }

  async deleteCheckpoint(sessionId: string) {
    try {
      const checkpointer = Checkpointer.getInstance();
      await checkpointer.deleteThread(this.getMainThreadId(sessionId));
    } catch (err) {
      debug('[deleteCheckpoint] error:', err);
    }
  }

  async compact({ sessionId }: { sessionId: string }) {
    const messages = MessageService.load(sessionId);
    const originalCount = messages.length;
    EventBus.emit('llm:start', { sessionId });
    try {
      const summaryMsg = await compactConversation(messages);
      MessageService.clear(sessionId);
      MessageService.add(sessionId, summaryMsg);
      EventBus.emit('agent:compact_complete', { sessionId, originalCount });
    } catch (err) {
      EventBus.emit('llm:error', { sessionId, error: String(err) });
    } finally {
      EventBus.emit('llm:end', { sessionId });
    }
  }
}

export const runAgent = RoboAgent.getInstance();
export { rootGraph, buildGraph } from './main';
export { readerGraph } from './main/subagents/reader';
export type { RootStateType } from './main/root/state';
export { canResume } from './utils';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "feat: RoboAgent rewrite — pre-loop context + file selector + simplified resume"
```

---

## Task 15: Update EventBus types

**Files:**
- Modify: `packages/shared/src/types/event.ts`

- [ ] **Step 1: Replace AppEvents with simplified version**

Remove all obsolete events and simplify `agent:plan_pending` to use `string` instead of `Plan | null`:

```typescript
// packages/shared/src/types/event.ts
import type { Session } from './session';

export interface AppEvents {
  'user:message': { sessionId: string; content: string };
  'user:stop': { sessionId: string };

  'llm:token': { sessionId: string; token: string };
  'llm:thinking': { sessionId: string; text: string };
  'llm:start': { sessionId: string };
  'llm:end': { sessionId: string };
  'llm:error': { sessionId: string; error: string };

  'agent:plan_pending': { sessionId: string; plan: string };
  'agent:plan_decision': { sessionId: string; approved: boolean; plan: string };
  'agent:tool_pending': {
    sessionId: string;
    toolCall: { name: string; input: unknown };
    source?: 'root';
  };
  'agent:tool_decision': {
    sessionId: string;
    approved: boolean;
    toolCall: { name: string; input: unknown };
  };
  'agent:stopped': { sessionId: string };
  'agent:resume': { sessionId: string; decision: 'approve' | 'reject' | 'y' | 'n' };
  'agent:stop': { sessionId: string };
  'agent:delete-checkpoint': string;
  'agent:set-session': Session | null;
  'agent:run': string;
  'agent:git_diff': {
    sessionId: string;
    gitDiffStat: string | null;
    gitDiffPreview: string | null;
  };

  'tool:start': { sessionId: string; name: string; input: unknown; callId?: string };
  'tool:stream': {
    sessionId: string;
    name: string;
    chunk: string;
    stream: 'stdout' | 'stderr';
    callId?: string;
  };
  'tool:end': { sessionId: string; name: string; output: unknown; callId: string };
  'tool:error': { sessionId: string; name: string; error: string; callId: string };

  'session:set': { sessionId: string };
  'agent:compact_request': { sessionId: string };
  'agent:compact_complete': { sessionId: string; originalCount: number };
}
```

- [ ] **Step 2: Verify TypeScript compiles across all packages**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json 2>&1 | head -20
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -20
```

Fix any UI components that reference removed events (e.g., `PendingPlan.tsx` using `Plan` type → update to `string`).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/event.ts
git commit -m "feat: simplify AppEvents — remove obsolete pipeline events, plan_pending uses string"
```

---

## Task 16: Update TOOL_RISK config

**Files:**
- Modify: `packages/config/src/index.ts` (or wherever TOOL_RISK is defined)

- [ ] **Step 1: Find and update TOOL_RISK**

```bash
grep -r "TOOL_RISK" packages/config/src/
```

Update TOOL_RISK to include new tool names and remove old delegate tools:

```typescript
export const TOOL_RISK: Record<string, 'low' | 'medium' | 'destructive'> = {
  // read-only — low risk
  read_file: 'low',
  list_dir: 'low',
  glob: 'low',
  grep: 'low',
  find_symbol: 'low',
  find_definitions: 'low',
  git_diff: 'low',
  git_log: 'low',
  analyze_code: 'low',
  request_approval: 'low',

  // write — medium risk (permission check in acceptEdits mode)
  write_file: 'medium',
  edit_file: 'medium',
  insert_at_line: 'medium',
  bash: 'medium',
  run_tests: 'medium',

  // destructive — always ask
  delete_file: 'destructive',
  rename_symbol: 'destructive',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/config/tsconfig.json 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/index.ts
git commit -m "feat: update TOOL_RISK — new tool names, remove delegate tools"
```

---

## Task 17: Delete old pipeline files

**Files:** All the deleted files listed in the File Map above.

- [ ] **Step 1: Delete old agent subagent directories**

```bash
rm -rf packages/agent/src/main/subagents/editor
rm -rf packages/agent/src/main/subagents/git
rm -rf packages/agent/src/main/subagents/executor
rm -rf packages/agent/src/main/subagents/planner
rm -rf packages/agent/src/main/subagents/routerIntent
rm -rf packages/agent/src/main/root
```

- [ ] **Step 2: Delete old node files**

```bash
rm -rf packages/agent/src/nodes/root
rm -rf packages/agent/src/nodes/sub/editor
rm -rf packages/agent/src/nodes/sub/executor
rm -rf packages/agent/src/nodes/sub/git
rm -rf packages/agent/src/nodes/sub/routerIntent
rm -f packages/agent/src/nodes/planApproval.ts
rm -f packages/agent/src/nodes/planner.ts
rm -f packages/agent/src/nodes/replan.ts
rm -f packages/agent/src/nodes/toolApproval.ts
rm -f packages/agent/src/nodes/verify.ts
```

- [ ] **Step 3: Delete old prompts**

```bash
rm -f packages/agent/src/prompts/editIntent.ts
rm -f packages/agent/src/prompts/hintToEdit.ts
rm -f packages/agent/src/prompts/planner.ts
rm -f packages/agent/src/prompts/replan.ts
rm -f packages/agent/src/prompts/sub/executor.ts
rm -f packages/agent/src/prompts/sub/git.ts
rm -f packages/agent/src/prompts/sub/intentRouter.ts
rm -f packages/agent/src/prompts/sub/writer.ts
```

- [ ] **Step 4: Delete old utils and root tools**

```bash
rm -f packages/agent/src/utils/plan.ts
rm -f packages/agent/src/utils/replan.ts
rm -f packages/agent/src/utils/routings.ts
rm -rf packages/tools/src/tools/root
rm -f packages/tools/src/tools/validateProject.ts
rm -f packages/tools/src/tools/undo.ts
```

- [ ] **Step 5: Clean up index files that re-export deleted modules**

Update `packages/agent/src/nodes/index.ts` — remove exports for deleted files.
Update `packages/agent/src/nodes/sub/index.ts` — keep only reader.
Update `packages/agent/src/prompts/index.ts` — remove deleted exports.
Update `packages/agent/src/utils/index.ts` — remove deleted exports.
Update `packages/tools/src/tools/index.ts` — remove deleted exports.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -40
npx tsc --noEmit --project packages/tools/tsconfig.json 2>&1 | head -20
```

Fix any remaining import errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: delete old pipeline subagents, nodes, prompts — replaced by free agent loop"
```

---

## Task 18: Integration test

**Files:**
- Create: `__tests__/agent/freeAgentLoop.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// __tests__/agent/freeAgentLoop.test.ts
import { jest } from '@jest/globals';

// Mock the LLM to avoid real API calls
jest.mock('../../packages/agent/src/utils/model.js', () => ({
  createBaseModel: () => ({
    bindTools: () => ({
      invoke: jest.fn().mockResolvedValue({
        _getType: () => 'ai',
        content: 'Task complete.',
        tool_calls: [],
      }),
    }),
    withStructuredOutput: () => ({
      invoke: jest.fn().mockResolvedValue({ keywords: ['foo', 'bar'] }),
    }),
    invoke: jest.fn().mockResolvedValue({
      content: 'Summary: all done.',
    }),
  }),
}));

jest.mock('../../packages/core/src/index.js', () => ({
  EventBus: { emit: jest.fn(), on: jest.fn() },
  MessageService: { add: jest.fn(), load: jest.fn(() => []) },
  SessionService: { findActive: jest.fn(() => null), load: jest.fn() },
  Checkpointer: { getInstance: jest.fn(() => ({ deleteThread: jest.fn() })) },
  AuditService: { append: jest.fn() },
}));

import { buildGraph } from '../../packages/agent/src/main/graph.js';
import { HumanMessage } from '@langchain/core/messages';

test('root graph runs agent → tools → summarizer without real LLM', async () => {
  const graph = buildGraph();

  const result = await graph.invoke({
    messages: [new HumanMessage('What files are in src/?')],
    sessionId: 'test-session',
    cwd: process.cwd(),
    workspaceContext: null,
    selectedFiles: [],
  });

  expect(result.messages.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the integration test**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/freeAgentLoop.test.ts
```
Expected: PASS

- [ ] **Step 3: Run all existing tests to check for regressions**

```bash
pnpm test 2>&1 | tail -30
```
Expected: existing tests pass (or known failures from deleted code are removed)

- [ ] **Step 4: Build the full project**

```bash
pnpm build
```
Expected: all packages build successfully

- [ ] **Step 5: Final commit**

```bash
git add __tests__/agent/freeAgentLoop.test.ts
git commit -m "test: integration test for free agent loop root graph"
```
