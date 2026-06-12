# Executor Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-grade edit loop: the approved plan executes step by step — fresh read, LLM-generated hints with `newContent`, mechanical apply, two-tier verification, retry with rollback, user escalation.

**Architecture:** Executor is a compiled LangGraph subgraph added to the root graph via `addNode('executor', executorGraph)` (LangGraph ^1.3.0 propagates `interrupt()` from subgraphs; checkpointer inherited). Inspect steps call the existing reader subagent; edit/create/delete steps run mini-reader (LLM, structured output) → mechanical apply → verify → LLM review. Spec: `docs/superpowers/specs/2026-06-12-executor-loop-design.md`.

**Tech Stack:** TypeScript ESM monorepo (pnpm), LangGraph ^1.3.0, Zod, web-tree-sitter, Jest (`node --experimental-vm-modules node_modules/jest/bin/jest.js <file>`).

**Conventions used below:**
- All paths relative to repo root.
- Tests live in `__tests__/agent/executor/`. Jest maps `@robocode-packages/*` → `packages/*/src`, so tests run against source.
- Run a single test: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/<file>.test.ts`
- Type-check after code tasks: `npx tsc --noEmit --project packages/shared/tsconfig.json && npx tsc --noEmit --project packages/agent/tsconfig.json`
- Existing primitives reused (do NOT reimplement): `applyTextReplace/Insert/Delete` (`packages/shared/src/utils/editor/textOps.ts`), `applyAstReplace/Rename/Remove/Insert`, `findNode` (`astOps.ts`), `applyFileInsert/Remove/Rename` (`fileOps.ts`), `createAstParser` (`packages/shared/src/ast/parser.ts`), `readerGraph` (`packages/agent/src/subagents/reader/graph.ts` — invocation pattern in `packages/agent/src/tools/analyzeCode.ts`), `getModel` (`packages/agent/src/utils/model.ts`), `EventBus` (`@robocode-packages/core`).

---

### Task 1: Shared executor types, schema extensions, `runCommand`, `checkSyntax`

**Files:**
- Modify: `packages/shared/src/schemas/executor/types.ts`
- Modify: `packages/shared/src/utils/shell.ts`
- Create: `packages/shared/src/utils/editor/syntax.ts`
- Modify: `packages/shared/src/utils/editor/index.ts`
- Test: `__tests__/agent/executor/foundations.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/executor/foundations.test.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ExecutorHintSchema,
  runCommand,
  checkSyntax,
} from '@robocode-packages/shared';

describe('ExecutorHintSchema extensions', () => {
  it('accepts rename_file with target', () => {
    const hint = ExecutorHintSchema.parse({
      op: 'rename_file',
      file: 'src/a.ts',
      target: 'src/b.ts',
    });
    expect(hint.target).toBe('src/b.ts');
  });

  it('accepts insert_text with insertMode', () => {
    const hint = ExecutorHintSchema.parse({
      op: 'insert_text',
      file: 'src/a.ts',
      anchor: 'const x = 1;',
      insertMode: 'after',
      newContent: '\nconst y = 2;',
    });
    expect(hint.insertMode).toBe('after');
  });
});

describe('runCommand', () => {
  it('returns ok=true with output for a passing command', async () => {
    const res = await runCommand('node -e "console.log(42)"', process.cwd());
    expect(res.ok).toBe(true);
    expect(res.output).toContain('42');
  });

  it('returns ok=false with captured output for a failing command', async () => {
    const res = await runCommand(
      'node -e "console.error(\'boom\'); process.exit(1)"',
      process.cwd()
    );
    expect(res.ok).toBe(false);
    expect(res.output).toContain('boom');
  });
});

describe('checkSyntax', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-syntax-'));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('passes valid typescript', async () => {
    const file = path.join(dir, 'ok.ts');
    const res = await checkSyntax(file, 'export const a = 1;\n');
    expect(res.ok).toBe(true);
  });

  it('fails broken typescript with a line hint', async () => {
    const file = path.join(dir, 'bad.ts');
    const res = await checkSyntax(file, 'export const a = {;\n');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/line \d+/i);
  });

  it('skips unsupported extensions', async () => {
    const file = path.join(dir, 'data.xyz');
    const res = await checkSyntax(file, '{{{{ totally not code');
    expect(res.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/foundations.test.ts`
Expected: FAIL — `runCommand`/`checkSyntax` are not exported; `target`/`insertMode` stripped or rejected by schema.

- [ ] **Step 3: Extend `ExecutorHintSchema` and add executor runtime types**

In `packages/shared/src/schemas/executor/types.ts`, add `target` and `insertMode` to `ExecutorHintSchema` (after `newContent`):

```typescript
export const ExecutorHintSchema = z.object({
  op: z.enum([
    'replace_node', 'insert_node', 'remove_node', 'rename_symbol',
    'replace_text', 'insert_text', 'remove_text',
    'create_file', 'delete_file', 'rename_file',
  ]),
  file: z.string(),
  nodeType: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  newSymbol: z.string().nullable().optional(),
  anchor: z.string().nullable().optional(),
  newContent: z.string().nullable().optional(),
  // rename_file destination, repo-relative
  target: z.string().nullable().optional(),
  // insert_text placement relative to anchor; defaults to 'after'
  insertMode: z.enum(['before', 'after', 'start', 'end']).nullable().optional(),
});
```

Append to the same file (internal runtime types — plain interfaces, no LLM validation needed):

```typescript
// ─── Executor runtime types ───────────────────────────────────────────────────

export interface ReaderDigest {
  stepId: string;
  summary: string;
  keyFindings: { file: string; lines: string; content: string; comment: string }[];
  operationHints: unknown[];
}

export type EscalationDecision = 'skip' | 'retry' | 'abort';

export interface VerifyCommands {
  typeCheck: string | null;
  testRunner: string | null;
  lint: string | null;
}
```

- [ ] **Step 4: Add `runCommand` to `packages/shared/src/utils/shell.ts`**

```typescript
import { execAsync } from './async';

export const runShell = async (cmd: string, cwd: string): Promise<string> => {
  try {
    const { stdout } = await execAsync(cmd, { cwd, timeout: 8000 });
    return stdout.trim();
  } catch {
    return '';
  }
};

export interface CommandResult {
  ok: boolean;
  output: string;
}

// Unlike runShell: long timeout, captures stderr and failure output.
// Used by the executor verification tier.
export const runCommand = async (
  cmd: string,
  cwd: string,
  timeout = 120_000
): Promise<CommandResult> => {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}\n${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output =
      `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim() || String(e.message ?? err);
    return { ok: false, output };
  }
};
```

- [ ] **Step 5: Create `packages/shared/src/utils/editor/syntax.ts`**

```typescript
import type { Node } from 'web-tree-sitter';
import { createAstParser } from '../../ast/parser';

export interface SyntaxCheckResult {
  ok: boolean;
  error?: string;
}

const findFirstError = (node: Node): Node | null => {
  if (node.type === 'ERROR' || node.isMissing) return node;
  for (const child of node.children) {
    const found = findFirstError(child);
    if (found) return found;
  }
  return null;
};

// Cheap post-edit verification tier: parse with tree-sitter.
// Unsupported language/extension → ok (the step-level tier still runs).
export const checkSyntax = async (
  filePath: string,
  content: string
): Promise<SyntaxCheckResult> => {
  let parser;
  try {
    ({ parser } = await createAstParser(filePath));
  } catch {
    return { ok: true };
  }

  const tree = parser.parse(content);
  if (!tree || !tree.rootNode.hasError) return { ok: true };

  const errNode = findFirstError(tree.rootNode);
  const line = (errNode?.startPosition.row ?? 0) + 1;
  return { ok: false, error: `Syntax error near line ${line} in ${filePath}` };
};
```

- [ ] **Step 6: Export from editor barrel**

In `packages/shared/src/utils/editor/index.ts` add:

```typescript
export * from './syntax';
```

Verify `packages/shared/src/schemas/executor/index.ts` re-exports `./types` and that `packages/shared/src/schemas/index.ts` re-exports `./executor` (add `export * from './executor';` if missing). Same for `utils/shell` via `packages/shared/src/utils/index.ts` (runShell already exported — runCommand rides along).

- [ ] **Step 7: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/foundations.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 8: Type-check and commit**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json
git add packages/shared/src __tests__/agent/executor/foundations.test.ts
git commit -m "feat(shared): executor hint extensions, runCommand, checkSyntax"
```

---

### Task 2: Root state, context testRunner, executor events

**Files:**
- Modify: `packages/shared/src/state/root.ts`
- Modify: `packages/shared/src/types/root/context.ts:111-118` (`WorkspaceContext.language`)
- Modify: `packages/shared/src/helpers/context/utils.ts:297-310` (`cleanContext`)
- Modify: `packages/shared/src/types/event.ts`

No unit test (type/plumbing changes) — verified by `tsc` and by tests in later tasks.

- [ ] **Step 1: Add `plan`, `stepResults`, `planApproved` to `RootState`**

In `packages/shared/src/state/root.ts`:

```typescript
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
  WorkspaceContext,
  RouterIntentOutput,
  ClarificationSource,
  PlannerOutput,
} from '../types';
import type { StepResult } from '../schemas/executor/types';

export const RootState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer, default: () => [] }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => process.cwd() }),
  context: Annotation<WorkspaceContext | null>({ reducer: (_, n) => n, default: () => null }),
  router: Annotation<{
    intent?: RouterIntentOutput;
    userRequests: string[];
  }>({
    reducer: (_, n) => n,
    default: () => ({ userRequests: [] }),
  }),
  clarificationSource: Annotation<ClarificationSource | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  answer: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  question: Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
  userRequest: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  selectedFiles: Annotation<string[]>({ reducer: (_, n) => n, default: () => [] }),

  // plan produced by plannerNode (was silently dropped before — no annotation existed)
  plan: Annotation<PlannerOutput | null>({ reducer: (_, n) => n, default: () => null }),
  planApproved: Annotation<boolean | null>({ reducer: (_, n) => n, default: () => null }),
  // written back by the executor subgraph at finalize
  stepResults: Annotation<StepResult[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),
});
```

Check that `PlannerOutput` is reachable from `../types` (it is exported from `types/schemas/planner.ts`); if the import fails, import from `'../schemas/planner'` instead.

- [ ] **Step 2: Add `testRunner` to `WorkspaceContext.language`**

In `packages/shared/src/types/root/context.ts`, inside `WorkspaceContext.language`:

```typescript
  language: {
    primary: SupportedLanguage;
    linter?: string;
    typeCheck?: string | null;
    testRunner?: string | null;
    build?: string;
    packageManager?: string;
    aliases?: { name: string; path: string }[];
  };
```

In `packages/shared/src/helpers/context/utils.ts` (`cleanContext`, language block):

```typescript
  language: {
    primary: ctx.language.primary,
    linter: ctx.language.linter?.runCommand,
    typeCheck: ctx.language.buildTool?.typeCheckCommand,
    testRunner: ctx.language.testRunner?.runCommand,
    build: ctx.language.buildTool?.buildCommand,
    // ... rest unchanged
```

- [ ] **Step 3: Add executor events to `AppEvents`**

In `packages/shared/src/types/event.ts`, append inside the interface:

```typescript
  'executor:step:start': {
    sessionId: string;
    stepId: string;
    title: string;
    index: number;
    total: number;
  };
  'executor:step:done': {
    sessionId: string;
    stepId: string;
    status: 'done' | 'failed' | 'skipped';
    retries: number;
  };
  'executor:edit:applied': {
    sessionId: string;
    stepId: string;
    file: string;
    op: string;
    diff: string;
  };
  'executor:verify': {
    sessionId: string;
    stepId: string;
    command: string;
    ok: boolean;
  };
```

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json
git add packages/shared/src
git commit -m "feat(shared): root plan state, executor events, testRunner in context"
```

---

### Task 3: ExecutorState + snapshot helpers

**Files:**
- Create: `packages/agent/src/subagents/executor/state.ts`
- Create: `packages/agent/src/nodes/sub/executor/snapshots.ts`
- Test: `__tests__/agent/executor/snapshots.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/executor/snapshots.test.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  takeSnapshot,
  restoreSnapshot,
} from '@robocode-packages/agent/src/nodes/sub/executor/snapshots';

describe('snapshots', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-snap-'));
    await fs.writeFile(path.join(dir, 'a.ts'), 'original A');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('captures existing files and marks missing files as null', async () => {
    const snap = await takeSnapshot(dir, ['a.ts', 'missing.ts']);
    expect(snap['a.ts']).toBe('original A');
    expect(snap['missing.ts']).toBeNull();
  });

  it('restore rewrites modified files and deletes created ones', async () => {
    const snap = await takeSnapshot(dir, ['a.ts', 'new.ts']);
    await fs.writeFile(path.join(dir, 'a.ts'), 'mutated');
    await fs.writeFile(path.join(dir, 'new.ts'), 'created later');

    await restoreSnapshot(dir, snap);

    expect(await fs.readFile(path.join(dir, 'a.ts'), 'utf-8')).toBe('original A');
    await expect(fs.access(path.join(dir, 'new.ts'))).rejects.toThrow();
  });
});
```

Note: if the `@robocode-packages/agent/src/...` deep import does not resolve under jest's moduleNameMapper (`^@robocode-packages/(.*)$` → `packages/$1/src` — it maps to `packages/agent/src/src/...`), import with a relative path instead:
`import { takeSnapshot, restoreSnapshot } from '../../../packages/agent/src/nodes/sub/executor/snapshots';`
Use the same relative-import style in all later tests that import node files directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/snapshots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `snapshots.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/snapshots.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type StepSnapshot = Record<string, string | null>;

// Captures current content of repo-relative files. null = file did not exist.
export const takeSnapshot = async (
  cwd: string,
  files: string[]
): Promise<StepSnapshot> => {
  const snapshot: StepSnapshot = {};
  for (const file of [...new Set(files)]) {
    snapshot[file] = await fs
      .readFile(path.resolve(cwd, file), 'utf-8')
      .catch(() => null);
  }
  return snapshot;
};

// Restores files to snapshot state: null → delete, string → rewrite.
export const restoreSnapshot = async (
  cwd: string,
  snapshot: StepSnapshot
): Promise<void> => {
  for (const [file, content] of Object.entries(snapshot)) {
    const abs = path.resolve(cwd, file);
    if (content === null) {
      await fs.unlink(abs).catch(() => undefined);
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
    }
  }
};
```

- [ ] **Step 4: Create `state.ts`**

```typescript
// packages/agent/src/subagents/executor/state.ts
import { Annotation } from '@langchain/langgraph';
import type {
  PlannerOutput,
  WorkspaceContext,
  ExecutorHint,
  ReaderDigest,
  StepStatus,
  StepResult,
  VerifyCommands,
  EscalationDecision,
} from '@robocode-packages/shared';

const replace = <T>(fallback: () => T) => ({
  reducer: (_: T, next: T) => next,
  default: fallback,
});

const mergeRecord = <V>() => ({
  reducer: (prev: Record<string, V>, next: Record<string, V>) => ({ ...prev, ...next }),
  default: () => ({}) as Record<string, V>,
});

export const ExecutorState = Annotation.Root({
  // ── shared with root (input) ────────────────────────────────────────────────
  plan: Annotation<PlannerOutput | null>(replace(() => null)),
  context: Annotation<WorkspaceContext | null>(replace(() => null)),
  cwd: Annotation<string>(replace(() => process.cwd())),
  sessionId: Annotation<string>(replace(() => '')),

  // ── shared with root (output) ───────────────────────────────────────────────
  stepResults: Annotation<StepResult[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => [],
  }),

  // ── private loop state ──────────────────────────────────────────────────────
  stepStates: Annotation<Record<string, StepStatus>>(mergeRecord<StepStatus>()),
  currentStepId: Annotation<string | null>(replace(() => null)),
  currentHints: Annotation<ExecutorHint[]>(replace(() => [] as ExecutorHint[])),
  readerFindings: Annotation<Record<string, ReaderDigest>>(mergeRecord<ReaderDigest>()),
  fileSnapshots: Annotation<Record<string, Record<string, string | null>>>(
    mergeRecord<Record<string, string | null>>()
  ),
  retryCounts: Annotation<Record<string, number>>(mergeRecord<number>()),
  appliedOps: Annotation<Record<string, string[]>>(mergeRecord<string[]>()),
  lastError: Annotation<string | null>(replace(() => null)),
  userGuidance: Annotation<string | null>(replace(() => null)),
  verifyCommands: Annotation<VerifyCommands>(
    replace(() => ({ typeCheck: null, testRunner: null, lint: null }))
  ),
  verifyOutput: Annotation<string | null>(replace(() => null)),
  escalationDecision: Annotation<EscalationDecision | null>(replace(() => null)),
});

export type ExecutorStateType = typeof ExecutorState.State;
export const MAX_STEP_RETRIES = 2;
```

Confirm `ExecutorHint`, `ReaderDigest`, `StepStatus`, `StepResult`, `VerifyCommands`, `EscalationDecision` are exported from `@robocode-packages/shared` root (Task 1 made them; add missing re-exports in `packages/shared/src/schemas/executor/index.ts` / `packages/shared/src/index.ts` if `tsc` complains).

- [ ] **Step 5: Run test, type-check, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/snapshots.test.ts`
Expected: PASS

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
git add packages/agent/src __tests__/agent/executor/snapshots.test.ts
git commit -m "feat(agent): executor state and step snapshots"
```

---

### Task 4: `dispatchHint` — mechanical application of one hint

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/dispatch.ts`
- Test: `__tests__/agent/executor/dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/executor/dispatch.test.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExecutorHint } from '@robocode-packages/shared';
import { dispatchHint } from '../../../packages/agent/src/nodes/sub/executor/dispatch';

const hint = (partial: Partial<ExecutorHint> & Pick<ExecutorHint, 'op' | 'file'>): ExecutorHint =>
  ({ nodeType: null, symbol: null, newSymbol: null, anchor: null, newContent: null,
     target: null, insertMode: null, ...partial }) as ExecutorHint;

describe('dispatchHint', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-dispatch-'));
    await fs.writeFile(
      path.join(dir, 'a.ts'),
      'export const greet = () => {\n  return "hi";\n};\n'
    );
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const read = (f: string) => fs.readFile(path.join(dir, f), 'utf-8');

  it('replace_text replaces a unique anchor', async () => {
    await dispatchHint(
      hint({ op: 'replace_text', file: 'a.ts', anchor: 'return "hi";', newContent: 'return "hello";' }),
      dir
    );
    expect(await read('a.ts')).toContain('return "hello";');
  });

  it('replace_text fails on missing anchor with exact error', async () => {
    await expect(
      dispatchHint(
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'nope', newContent: 'x' }),
        dir
      )
    ).rejects.toThrow(/Target not found/);
  });

  it('insert_text inserts after anchor', async () => {
    await dispatchHint(
      hint({
        op: 'insert_text', file: 'a.ts', anchor: 'export const greet = () => {',
        insertMode: 'after', newContent: '\n  // inserted',
      }),
      dir
    );
    expect(await read('a.ts')).toContain('{\n  // inserted');
  });

  it('remove_text removes the anchor', async () => {
    await dispatchHint(
      hint({ op: 'remove_text', file: 'a.ts', anchor: '  return "hi";\n' }),
      dir
    );
    expect(await read('a.ts')).not.toContain('return "hi"');
  });

  it('rename_symbol renames via AST', async () => {
    await dispatchHint(
      hint({
        op: 'rename_symbol', file: 'a.ts',
        nodeType: 'variable_declarator', symbol: 'greet', newSymbol: 'salute',
      }),
      dir
    );
    expect(await read('a.ts')).toContain('export const salute');
  });

  it('create_file creates with content and parent dirs', async () => {
    await dispatchHint(
      hint({ op: 'create_file', file: 'src/new.ts', newContent: 'export const n = 1;\n' }),
      dir
    );
    expect(await read('src/new.ts')).toBe('export const n = 1;\n');
  });

  it('delete_file removes the file', async () => {
    await dispatchHint(hint({ op: 'delete_file', file: 'a.ts' }), dir);
    await expect(read('a.ts')).rejects.toThrow();
  });

  it('rename_file moves the file', async () => {
    await dispatchHint(hint({ op: 'rename_file', file: 'a.ts', target: 'b.ts' }), dir);
    expect(await read('b.ts')).toContain('greet');
  });

  it('rejects path traversal', async () => {
    await expect(
      dispatchHint(hint({ op: 'create_file', file: '../escape.ts', newContent: 'x' }), dir)
    ).rejects.toThrow(/escapes repository root|traverse/i);
  });

  it('fails when an edit produces broken syntax', async () => {
    await expect(
      dispatchHint(
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'return "hi";', newContent: 'return {{{;' }),
        dir
      )
    ).rejects.toThrow(/Syntax error/);
    // file must be left written — rollback is the caller's job via snapshots
  });

  it('fails on missing required fields with a clear message', async () => {
    await expect(
      dispatchHint(hint({ op: 'replace_text', file: 'a.ts', anchor: null, newContent: 'x' }), dir)
    ).rejects.toThrow(/anchor.*required/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/dispatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `dispatch.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/dispatch.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExecutorHint, AstEdit } from '@robocode-packages/shared';
import {
  applyTextReplace,
  applyTextInsert,
  applyTextDelete,
  applyAstReplace,
  applyAstRename,
  applyAstRemove,
  applyAstInsert,
  applyFileInsert,
  applyFileRemove,
  applyFileRename,
  checkSyntax,
  createAstParser,
} from '@robocode-packages/shared';

export interface DispatchResult {
  file: string;
  summary: string;
}

const resolveInside = (cwd: string, file: string): string => {
  const root = path.resolve(cwd);
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`File path escapes repository root: ${file}`);
  }
  return abs;
};

const require_ = <T>(value: T | null | undefined, field: string, op: string): T => {
  if (value == null || value === '') {
    throw new Error(`[executor/dispatch] ${field} is required for op "${op}"`);
  }
  return value;
};

const astEditFromHint = (hint: ExecutorHint, action: AstEdit['action']): AstEdit => ({
  mode: 'ast',
  action,
  nodeType: require_(hint.nodeType, 'nodeType', hint.op),
  symbol: hint.symbol ?? null,
  newSymbol: hint.newSymbol ?? null,
  parentNodeType: null,
  afterSnippet: hint.newContent ?? null,
  insertSnippet: hint.newContent ?? null,
  beforeSnippet: null,
  reasoning: '',
  file: hint.file,
  lines: null,
});

const writeAndCheck = async (abs: string, file: string, content: string): Promise<void> => {
  await fs.writeFile(abs, content, 'utf-8');
  const syntax = await checkSyntax(abs, content);
  if (!syntax.ok) throw new Error(syntax.error);
};

// Applies one hint mechanically. Reads the file fresh from disk (previous hints
// in the same step may have shifted content). Throws with an exact, actionable
// message on any failure — the caller routes failures into the retry path.
export const dispatchHint = async (
  hint: ExecutorHint,
  cwd: string
): Promise<DispatchResult> => {
  const op = hint.op;

  // ── file-level ops (no content read) ────────────────────────────────────────
  if (op === 'create_file') {
    resolveInside(cwd, hint.file);
    const content = require_(hint.newContent, 'newContent', op);
    const { absPath } = await applyFileInsert(cwd, {
      mode: 'file', action: 'insert', file: hint.file, insertText: content, reasoning: '',
    });
    const syntax = await checkSyntax(absPath, content);
    if (!syntax.ok) throw new Error(syntax.error);
    return { file: hint.file, summary: `create_file ${hint.file}` };
  }

  if (op === 'delete_file') {
    resolveInside(cwd, hint.file);
    await applyFileRemove(cwd, { mode: 'file', action: 'remove', file: hint.file, reasoning: '' });
    return { file: hint.file, summary: `delete_file ${hint.file}` };
  }

  if (op === 'rename_file') {
    resolveInside(cwd, hint.file);
    const target = require_(hint.target, 'target', op);
    resolveInside(cwd, target);
    await applyFileRename(cwd, {
      mode: 'file', action: 'rename', file: hint.file, target, reasoning: '',
    });
    return { file: target, summary: `rename_file ${hint.file} → ${target}` };
  }

  // ── content ops: fresh read ─────────────────────────────────────────────────
  const abs = resolveInside(cwd, hint.file);
  const content = await fs.readFile(abs, 'utf-8').catch(() => {
    throw new Error(`[executor/dispatch] File not found: ${hint.file}`);
  });

  let next: string;

  if (op === 'replace_text') {
    const anchor = require_(hint.anchor, 'anchor', op);
    next = applyTextReplace(content, {
      mode: 'text', action: 'replace', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      replaceWith: require_(hint.newContent, 'newContent', op),
      reasoning: '',
    });
  } else if (op === 'insert_text') {
    const insertMode = hint.insertMode ?? 'after';
    const anchor =
      insertMode === 'start' || insertMode === 'end'
        ? (hint.anchor ?? '')
        : require_(hint.anchor, 'anchor', op);
    next = applyTextInsert(content, {
      mode: 'text', action: 'insert', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      insertMode,
      insertText: require_(hint.newContent, 'newContent', op),
      reasoning: '',
    });
  } else if (op === 'remove_text') {
    const anchor = require_(hint.anchor, 'anchor', op);
    next = applyTextDelete(content, {
      mode: 'text', action: 'remove', file: hint.file,
      anchor: { type: 'exact', value: anchor },
      target: anchor,
      reasoning: '',
    });
  } else if (op === 'insert_node') {
    require_(hint.newContent, 'newContent', op);
    next = applyAstInsert(content, astEditFromHint(hint, 'insert'));
  } else {
    // replace_node | remove_node | rename_symbol — need a parsed tree
    const { parser } = await createAstParser(abs);
    const tree = parser.parse(content);
    if (!tree) throw new Error(`[executor/dispatch] Cannot parse ${hint.file}`);

    if (op === 'replace_node') {
      require_(hint.newContent, 'newContent', op);
      next = applyAstReplace(content, astEditFromHint(hint, 'replace'), tree);
    } else if (op === 'remove_node') {
      next = applyAstRemove(content, astEditFromHint(hint, 'remove'), tree);
    } else if (op === 'rename_symbol') {
      require_(hint.symbol, 'symbol', op);
      require_(hint.newSymbol, 'newSymbol', op);
      next = applyAstRename(content, astEditFromHint(hint, 'rename'), tree);
    } else {
      throw new Error(`[executor/dispatch] Unknown op: ${op}`);
    }
  }

  await writeAndCheck(abs, hint.file, next);
  return { file: hint.file, summary: `${op} ${hint.file}` };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/dispatch.test.ts`
Expected: PASS (11 tests). If the `rename_symbol` test fails on node lookup, check the tree-sitter node type with a quick scratch script — for `export const greet = () => {}` the declarator node type is `variable_declarator`; adjust the test only if the grammar differs.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/executor/dispatch.ts __tests__/agent/executor/dispatch.test.ts
git commit -m "feat(agent): executor hint dispatch with syntax tier"
```

---

### Task 5: `init` node + related-test-file heuristic

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/init.ts`
- Create: `packages/agent/src/nodes/sub/executor/relatedTest.ts`
- Test: `__tests__/agent/executor/init.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/executor/init.test.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { initNode } from '../../../packages/agent/src/nodes/sub/executor/init';
import { findRelatedTestFile } from '../../../packages/agent/src/nodes/sub/executor/relatedTest';
import type { ExecutorStateType } from '../../../packages/agent/src/subagents/executor/state';

const basePlan = {
  goal: 'g', clarifying_questions: [], risk: 'low' as const,
  assumptions: [], constraints: [], files_affected: ['src/a.ts'], gitStep: null,
  steps: [
    { id: 'inspect-a', kind: 'inspect' as const, title: 't', files: ['src/a.ts'], depends_on: [], expected_output: 'e' },
    { id: 'edit-a', kind: 'edit' as const, title: 't', files: ['src/a.ts'], depends_on: ['inspect-a'], expected_output: 'e' },
  ],
};

const state = (overrides: Partial<ExecutorStateType>): ExecutorStateType =>
  ({ plan: basePlan, context: null, cwd: '/tmp', sessionId: 's',
     stepResults: [], stepStates: {}, currentStepId: null, currentHints: [],
     readerFindings: {}, fileSnapshots: {}, retryCounts: {}, appliedOps: {},
     lastError: null, userGuidance: null, verifyOutput: null, escalationDecision: null,
     verifyCommands: { typeCheck: null, testRunner: null, lint: null },
     ...overrides }) as ExecutorStateType;

describe('initNode', () => {
  it('marks all steps pending and derives verify commands from context', async () => {
    const res = await initNode(
      state({
        context: {
          cwd: '/tmp', git: {}, project: { name: 'p', frameworks: [] },
          structure: [], entryPoints: [],
          language: { primary: 'typescript', typeCheck: 'tsc --noEmit', testRunner: 'jest' },
        },
      })
    );
    expect(res.stepStates).toEqual({ 'inspect-a': 'pending', 'edit-a': 'pending' });
    expect(res.verifyCommands).toEqual({ typeCheck: 'tsc --noEmit', testRunner: 'jest', lint: null });
  });

  it('fails fast on a dependency cycle', async () => {
    const cyclic = {
      ...basePlan,
      steps: [
        { id: 'edit-a', kind: 'edit' as const, title: 't', files: ['src/a.ts'], depends_on: ['edit-b'], expected_output: 'e' },
        { id: 'edit-b', kind: 'edit' as const, title: 't', files: ['src/a.ts'], depends_on: ['edit-a'], expected_output: 'e' },
      ],
    };
    const res = await initNode(state({ plan: cyclic }));
    expect(res.lastError).toMatch(/cycle/i);
  });

  it('fails when plan is missing', async () => {
    const res = await initNode(state({ plan: null }));
    expect(res.lastError).toMatch(/no plan/i);
  });
});

describe('findRelatedTestFile', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-rt-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/foo.ts'), 'x');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('finds sibling test file', async () => {
    await fs.writeFile(path.join(dir, 'src/foo.test.ts'), 'x');
    expect(await findRelatedTestFile('src/foo.ts', dir)).toBe('src/foo.test.ts');
  });

  it('finds __tests__ sibling', async () => {
    await fs.mkdir(path.join(dir, 'src/__tests__'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/__tests__/foo.test.ts'), 'x');
    expect(await findRelatedTestFile('src/foo.ts', dir)).toBe('src/__tests__/foo.test.ts');
  });

  it('returns null when nothing matches', async () => {
    expect(await findRelatedTestFile('src/foo.ts', dir)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/init.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `relatedTest.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/relatedTest.ts
import * as path from 'node:path';
import { fileExists } from '@robocode-packages/shared';

// Cheap heuristic: sibling foo.test.ts / foo.spec.ts, or __tests__/ next to the file.
export const findRelatedTestFile = async (
  relativeFile: string,
  cwd: string
): Promise<string | null> => {
  const dir = path.dirname(relativeFile);
  const ext = path.extname(relativeFile);
  const base = path.basename(relativeFile, ext);

  const candidates = [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, '__tests__', `${base}.test${ext}`),
  ];

  for (const candidate of candidates) {
    if (await fileExists(path.resolve(cwd, candidate))) return candidate;
  }
  return null;
};
```

- [ ] **Step 4: Create `init.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/init.ts
import { debug } from '@robocode-packages/shared';
import type { StepStatus } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

const hasCycle = (steps: { id: string; depends_on: string[] }[]): boolean => {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const byId = new Map(steps.map((s) => [s.id, s]));

  const visit = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.depends_on ?? []) {
      if (visit(dep)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };

  return steps.some((s) => visit(s.id));
};

export const initNode = async (state: ExecutorStateType) => {
  const { plan, context } = state;

  if (!plan || plan.steps.length === 0) {
    return { lastError: 'Executor started with no plan.' };
  }

  if (hasCycle(plan.steps)) {
    return { lastError: 'Plan dependency cycle detected — cannot execute.' };
  }

  const stepStates: Record<string, StepStatus> = {};
  for (const step of plan.steps) stepStates[step.id] = 'pending';

  const verifyCommands = {
    typeCheck: context?.language?.typeCheck ?? null,
    testRunner: context?.language?.testRunner ?? null,
    lint: context?.language?.linter ?? null,
  };

  debug('[executor/init]', plan.steps.length, 'steps; verify:', verifyCommands);
  return { stepStates, verifyCommands, lastError: null };
};
```

- [ ] **Step 5: Run test, type-check, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/init.test.ts`
Expected: PASS

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
git add packages/agent/src/nodes/sub/executor __tests__/agent/executor/init.test.ts
git commit -m "feat(agent): executor init node and related-test heuristic"
```

---

### Task 6: `step_selector` node

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/stepSelector.ts`
- Test: `__tests__/agent/executor/stepSelector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/executor/stepSelector.test.ts
import {
  pickNextStep,
  stepSelectorNode,
} from '../../../packages/agent/src/nodes/sub/executor/stepSelector';
import type { PlanStep, StepStatus } from '@robocode-packages/shared';

const step = (id: string, depends_on: string[] = [], kind: PlanStep['kind'] = 'edit'): PlanStep =>
  ({ id, kind, title: id, files: ['src/a.ts'], depends_on, expected_output: 'e' });

describe('pickNextStep', () => {
  it('respects depends_on order', () => {
    const steps = [step('b', ['a']), step('a', [], 'inspect')];
    const states: Record<string, StepStatus> = { a: 'pending', b: 'pending' };
    expect(pickNextStep(steps, states)?.id).toBe('a');
    states.a = 'done';
    expect(pickNextStep(steps, states)?.id).toBe('b');
  });

  it('returns null when everything is done', () => {
    expect(pickNextStep([step('a', [], 'inspect')], { a: 'done' })).toBeNull();
  });

  it('does not pick steps blocked by failed/skipped deps', () => {
    const steps = [step('a', [], 'inspect'), step('b', ['a'])];
    expect(pickNextStep(steps, { a: 'failed', b: 'pending' })).toBeNull();
    expect(pickNextStep(steps, { a: 'skipped', b: 'pending' })).toBeNull();
  });
});

describe('stepSelectorNode', () => {
  it('marks unreachable pending steps skipped and records results', async () => {
    const plan = {
      goal: 'g', clarifying_questions: [], risk: 'low' as const, assumptions: [],
      constraints: [], files_affected: [], gitStep: null,
      steps: [step('a', [], 'inspect'), step('b', ['a'])],
    };
    const res = await stepSelectorNode({
      plan, sessionId: 's', stepStates: { a: 'failed', b: 'pending' },
      retryCounts: {}, stepResults: [],
    } as never);
    expect(res.currentStepId).toBeNull();
    expect(res.stepStates).toMatchObject({ b: 'skipped' });
    expect(res.stepResults?.[0]).toMatchObject({ stepId: 'b', status: 'skipped' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/stepSelector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `stepSelector.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/stepSelector.ts
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { PlanStep, StepStatus, StepResult } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export const pickNextStep = (
  steps: PlanStep[],
  stepStates: Record<string, StepStatus>
): PlanStep | null =>
  steps.find(
    (step) =>
      stepStates[step.id] === 'pending' &&
      step.depends_on.every((dep) => stepStates[dep] === 'done')
  ) ?? null;

export const stepSelectorNode = async (state: ExecutorStateType) => {
  const { plan, sessionId, stepStates } = state;
  if (!plan) return { currentStepId: null };

  const next = pickNextStep(plan.steps, stepStates);

  if (next) {
    const total = plan.steps.length;
    const index = plan.steps.findIndex((s) => s.id === next.id) + 1;
    EventBus.emit('executor:step:start', {
      sessionId, stepId: next.id, title: next.title, index, total,
    });
    debug('[executor/select]', next.id, `(${index}/${total})`);
    return {
      currentStepId: next.id,
      stepStates: { [next.id]: 'running' as StepStatus },
      lastError: null,
      verifyOutput: null,
      currentHints: [],
    };
  }

  // No eligible step. Any still-pending steps are unreachable (failed/skipped deps).
  const unreachable = plan.steps.filter((s) => stepStates[s.id] === 'pending');
  if (unreachable.length === 0) return { currentStepId: null };

  const skippedStates: Record<string, StepStatus> = {};
  const skippedResults: StepResult[] = [];
  for (const step of unreachable) {
    skippedStates[step.id] = 'skipped';
    skippedResults.push({
      stepId: step.id,
      status: 'skipped',
      output: 'Unreachable: a dependency failed or was skipped.',
      retries: state.retryCounts[step.id] ?? 0,
    });
    EventBus.emit('executor:step:done', {
      sessionId, stepId: step.id, status: 'skipped',
      retries: state.retryCounts[step.id] ?? 0,
    });
  }
  return { currentStepId: null, stepStates: skippedStates, stepResults: skippedResults };
};
```

- [ ] **Step 4: Run test, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/stepSelector.test.ts`
Expected: PASS

```bash
git add packages/agent/src/nodes/sub/executor/stepSelector.ts __tests__/agent/executor/stepSelector.test.ts
git commit -m "feat(agent): executor step selector with unreachable-step skip"
```

---

### Task 7: mini-reader prompt + node

**Files:**
- Create: `packages/agent/src/prompts/sub/executor/miniReader.ts`
- Create: `packages/agent/src/nodes/sub/executor/miniReader.ts`
- Test: `__tests__/agent/executor/miniReaderPrompt.test.ts`

- [ ] **Step 1: Write the failing test (prompt assembly only — no live LLM)**

```typescript
// __tests__/agent/executor/miniReaderPrompt.test.ts
import { buildMiniReaderPrompt } from '../../../packages/agent/src/prompts/sub/executor/miniReader';

const step = {
  id: 'edit-a', kind: 'edit' as const, title: 'Add salute()', files: ['src/a.ts'],
  depends_on: ['inspect-a'], expected_output: 'salute exported; tsc clean',
};

describe('buildMiniReaderPrompt', () => {
  it('includes step, goal, constraints, file contents with line numbers, findings', () => {
    const prompt = buildMiniReaderPrompt({
      step,
      goal: 'Add greeting feature',
      constraints: ['do not change public API'],
      files: [{ file: 'src/a.ts', content: 'line one\nline two' }],
      findings: [{ stepId: 'inspect-a', summary: 'a.ts exports greet()', keyFindings: [], operationHints: [] }],
      lastError: null,
      userGuidance: null,
      appliedOps: [],
    });
    expect(prompt).toContain('Add salute()');
    expect(prompt).toContain('Add greeting feature');
    expect(prompt).toContain('do not change public API');
    expect(prompt).toContain('1 | line one');
    expect(prompt).toContain('a.ts exports greet()');
    expect(prompt).not.toContain('PREVIOUS ATTEMPT FAILED');
  });

  it('includes retry context when lastError is present', () => {
    const prompt = buildMiniReaderPrompt({
      step, goal: 'g', constraints: [], files: [], findings: [],
      lastError: 'Type check failed: error TS2304',
      userGuidance: 'use the existing helper',
      appliedOps: ['replace_text src/a.ts'],
    });
    expect(prompt).toContain('PREVIOUS ATTEMPT FAILED');
    expect(prompt).toContain('error TS2304');
    expect(prompt).toContain('use the existing helper');
    expect(prompt).toContain('replace_text src/a.ts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/miniReaderPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the prompt builder**

```typescript
// packages/agent/src/prompts/sub/executor/miniReader.ts
import type { PlanStep, ReaderDigest } from '@robocode-packages/shared';

export interface MiniReaderPromptInput {
  step: PlanStep;
  goal: string;
  constraints: string[];
  files: { file: string; content: string }[];
  findings: ReaderDigest[];
  lastError: string | null;
  userGuidance: string | null;
  appliedOps: string[];
}

const MAX_FILE_CHARS = 30_000;

export const withLineNumbers = (content: string): string =>
  content
    .split('\n')
    .map((line, i) => `${i + 1} | ${line}`)
    .join('\n');

export const buildMiniReaderPrompt = (input: MiniReaderPromptInput): string => {
  const { step, goal, constraints, files, findings, lastError, userGuidance, appliedOps } = input;

  const fileBlocks = files
    .map(({ file, content }) => {
      const clipped =
        content.length > MAX_FILE_CHARS
          ? content.slice(0, MAX_FILE_CHARS) + '\n…[truncated]'
          : content;
      return `### ${file}\n\`\`\`\n${withLineNumbers(clipped)}\n\`\`\``;
    })
    .join('\n\n');

  const findingBlocks = findings
    .map((digest) => {
      const keyFindings = digest.keyFindings
        .map((f) => `- ${f.file}:${f.lines} — ${f.comment}\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n');
      return `### From step "${digest.stepId}"\n${digest.summary}\n${keyFindings}`;
    })
    .join('\n\n');

  const retryBlock = lastError
    ? `
## PREVIOUS ATTEMPT FAILED
The files have been ROLLED BACK to their pre-attempt state. Produce a corrected set of hints.

Error:
${lastError}

Operations the failed attempt applied (now reverted):
${appliedOps.map((op) => `- ${op}`).join('\n') || '- none'}
${userGuidance ? `\nUser guidance:\n${userGuidance}` : ''}`
    : '';

  return `You are the edit generator inside a code-editing loop. Produce a minimal ordered list of atomic edit hints that implement ONE plan step. The hints are applied MECHANICALLY in order — no human or model fixes them afterwards.

## Plan goal
${goal}

## Current step
id: ${step.id}
kind: ${step.kind}
title: ${step.title}
expected output: ${step.expected_output}
files: ${step.files.join(', ') || '(none listed)'}

## Hard constraints
${constraints.map((c) => `- ${c}`).join('\n') || '- none'}

## Investigation findings (from inspect steps)
${findingBlocks || '(none)'}

## Current file contents (fresh from disk, line-numbered)
${fileBlocks || '(no existing files — this step creates new ones)'}
${retryBlock}

## Output rules
- "anchor" must be a VERBATIM substring copied from the file content above (without the "N | " line-number prefix) and must occur exactly once in the file.
- "newContent" is the complete replacement/insertion text — real code, correct indentation, no placeholders.
- For create_file, "newContent" is the entire file content.
- For insert_text, set "insertMode" (before|after|start|end); the default is "after".
- For rename_file, set "target" to the new repo-relative path.
- Prefer replace_text with a tight unique anchor over AST ops unless renaming a symbol.
- Do not touch files outside the step's scope unless strictly required by the expected output.`;
};
```

- [ ] **Step 4: Create the node**

```typescript
// packages/agent/src/nodes/sub/executor/miniReader.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { debug, MiniReaderOutputSchema } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildMiniReaderPrompt } from '../../../prompts/sub/executor/miniReader';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export const miniReaderNode = async (state: ExecutorStateType) => {
  const { plan, cwd, currentStepId } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!plan || !step) return { currentHints: [], lastError: 'mini_reader: no current step' };

  const files = (
    await Promise.all(
      step.files.map(async (file) => {
        const content = await fs.readFile(path.resolve(cwd, file), 'utf-8').catch(() => null);
        return content === null ? null : { file, content };
      })
    )
  ).filter((f): f is { file: string; content: string } => f !== null);

  const findings = step.depends_on
    .map((depId) => state.readerFindings[depId])
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const prompt = buildMiniReaderPrompt({
    step,
    goal: plan.goal,
    constraints: plan.constraints,
    files,
    findings,
    lastError: state.lastError,
    userGuidance: state.userGuidance,
    appliedOps: state.appliedOps[step.id] ?? [],
  });

  const model = getModel(false).withStructuredOutput(MiniReaderOutputSchema, {
    name: 'mini_reader',
  });

  try {
    const output = await model.invoke([
      new SystemMessage(prompt),
      new HumanMessage(`Generate the edit hints for step "${step.id}".`),
    ]);
    debug('[executor/mini_reader]', step.id, output.hints.length, 'hints');
    if (output.hints.length === 0) {
      return { currentHints: [], lastError: 'mini_reader produced zero hints' };
    }
    return { currentHints: output.hints, lastError: null, userGuidance: null };
  } catch (err) {
    debug('[executor/mini_reader] LLM failed', err);
    return { currentHints: [], lastError: `mini_reader LLM error: ${String(err).slice(0, 500)}` };
  }
};
```

- [ ] **Step 5: Run test, type-check, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/miniReaderPrompt.test.ts`
Expected: PASS

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
git add packages/agent/src __tests__/agent/executor/miniReaderPrompt.test.ts
git commit -m "feat(agent): executor mini-reader prompt and node"
```

---

### Task 8: `approval_gate` and `apply` nodes

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/approvalGate.ts`
- Create: `packages/agent/src/nodes/sub/executor/apply.ts`
- Test: `__tests__/agent/executor/apply.test.ts`

- [ ] **Step 1: Write the failing test (apply node only — approval gate is covered by the graph test in Task 12)**

```typescript
// __tests__/agent/executor/apply.test.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyNode } from '../../../packages/agent/src/nodes/sub/executor/apply';
import type { ExecutorHint } from '@robocode-packages/shared';

const mkState = (cwd: string, hints: ExecutorHint[], extra: Record<string, unknown> = {}) =>
  ({
    plan: null, context: null, cwd, sessionId: 's', stepResults: [],
    stepStates: {}, currentStepId: 'edit-a', currentHints: hints,
    readerFindings: {}, fileSnapshots: {}, retryCounts: {}, appliedOps: {},
    lastError: null, userGuidance: null, verifyOutput: null, escalationDecision: null,
    verifyCommands: { typeCheck: null, testRunner: null, lint: null },
    ...extra,
  }) as never;

const hint = (partial: Partial<ExecutorHint> & Pick<ExecutorHint, 'op' | 'file'>): ExecutorHint =>
  ({ nodeType: null, symbol: null, newSymbol: null, anchor: null, newContent: null,
     target: null, insertMode: null, ...partial }) as ExecutorHint;

describe('applyNode', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-apply-'));
    await fs.writeFile(path.join(dir, 'a.ts'), 'const a = 1;\n');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('snapshots target files, applies all hints in order, records appliedOps', async () => {
    const res = await applyNode(
      mkState(dir, [
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'const a = 1;', newContent: 'const a = 2;' }),
        hint({ op: 'insert_text', file: 'a.ts', anchor: 'const a = 2;', insertMode: 'after', newContent: '\nconst b = 3;' }),
      ])
    );
    expect(res.lastError).toBeNull();
    expect(res.fileSnapshots?.['edit-a']?.['a.ts']).toBe('const a = 1;\n');
    expect(res.appliedOps?.['edit-a']).toHaveLength(2);
    const content = await fs.readFile(path.join(dir, 'a.ts'), 'utf-8');
    expect(content).toContain('const a = 2;\nconst b = 3;');
  });

  it('keeps existing snapshot on retry (does not overwrite with mutated content)', async () => {
    const res = await applyNode(
      mkState(
        dir,
        [hint({ op: 'replace_text', file: 'a.ts', anchor: 'const a = 1;', newContent: 'const a = 5;' })],
        { fileSnapshots: { 'edit-a': { 'a.ts': 'PRISTINE' } } }
      )
    );
    expect(res.fileSnapshots?.['edit-a']?.['a.ts']).toBe('PRISTINE');
  });

  it('stops at the first failing hint and reports which one', async () => {
    const res = await applyNode(
      mkState(dir, [
        hint({ op: 'replace_text', file: 'a.ts', anchor: 'NOPE', newContent: 'x' }),
        hint({ op: 'create_file', file: 'never.ts', newContent: 'x' }),
      ])
    );
    expect(res.lastError).toMatch(/hint 1\/2/);
    expect(res.lastError).toMatch(/Target not found/);
    await expect(fs.access(path.join(dir, 'never.ts'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/apply.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `approvalGate.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/approvalGate.ts
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export const hasDestructiveHints = (state: ExecutorStateType): boolean =>
  state.currentHints.some((hint) => hint.op === 'delete_file');

// interrupt() propagates through the subgraph to the root thread; the CLI's
// existing tool-approval UI resumes it via agent:resume → Command({ resume }).
export const approvalGateNode = (state: ExecutorStateType) => {
  const { sessionId, currentHints } = state;
  const targets = currentHints.filter((h) => h.op === 'delete_file').map((h) => h.file);

  EventBus.emit('agent:tool_pending', {
    sessionId,
    toolCall: { name: 'delete_file', input: { files: targets } },
  });

  const decision: string = interrupt(
    `Executor wants to delete: ${targets.join(', ')}. Approve?`
  );
  const approved = decision === 'approve' || decision === 'y';

  EventBus.emit('agent:tool_decision', {
    sessionId,
    approved,
    toolCall: { name: 'delete_file', input: { files: targets } },
  });
  debug('[executor/approval_gate]', approved ? 'approved' : 'rejected');

  if (!approved) {
    return { lastError: `User rejected deletion of: ${targets.join(', ')}` };
  }
  return { lastError: null };
};
```

- [ ] **Step 4: Create `apply.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/apply.ts
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { dispatchHint } from './dispatch';
import { takeSnapshot } from './snapshots';

const hintDiff = (op: string, anchor: string | null | undefined, newContent: string | null | undefined): string => {
  const removed = anchor ? `- ${anchor.slice(0, 200)}` : '';
  const added = newContent ? `+ ${newContent.slice(0, 400)}` : '';
  return [removed, added].filter(Boolean).join('\n') || op;
};

export const applyNode = async (state: ExecutorStateType) => {
  const { cwd, sessionId, currentStepId, currentHints } = state;
  if (!currentStepId || currentHints.length === 0) {
    return { lastError: state.lastError ?? 'apply: nothing to apply' };
  }

  // Snapshot all files this step touches — once per step. On retry the snapshot
  // already holds the pristine pre-step content; never overwrite it.
  let fileSnapshots = {};
  if (!state.fileSnapshots[currentStepId]) {
    const files = currentHints.flatMap((h) => (h.target ? [h.file, h.target] : [h.file]));
    fileSnapshots = { [currentStepId]: await takeSnapshot(cwd, files) };
  }

  const applied: string[] = [];
  for (let i = 0; i < currentHints.length; i++) {
    const hint = currentHints[i];
    try {
      const result = await dispatchHint(hint, cwd);
      applied.push(result.summary);
      EventBus.emit('executor:edit:applied', {
        sessionId,
        stepId: currentStepId,
        file: result.file,
        op: hint.op,
        diff: hintDiff(hint.op, hint.anchor, hint.newContent),
      });
    } catch (err) {
      const message = `hint ${i + 1}/${currentHints.length} (${hint.op} ${hint.file}): ${String(
        (err as Error).message ?? err
      )}`;
      debug('[executor/apply] failed:', message);
      return {
        ...({} as object),
        fileSnapshots,
        appliedOps: { [currentStepId]: applied },
        lastError: message,
      };
    }
  }

  debug('[executor/apply]', currentStepId, applied.length, 'ops applied');
  return { fileSnapshots, appliedOps: { [currentStepId]: applied }, lastError: null };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/apply.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/nodes/sub/executor __tests__/agent/executor/apply.test.ts
git commit -m "feat(agent): executor approval gate and apply nodes"
```

---

### Task 9: `verify_step` node

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/verifyStep.ts`
- Test: `__tests__/agent/executor/verifyStep.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/agent/executor/verifyStep.test.ts
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyStepNode } from '../../../packages/agent/src/nodes/sub/executor/verifyStep';

const mkState = (cwd: string, verifyCommands: Record<string, string | null>, files = ['src/a.ts']) =>
  ({
    plan: {
      goal: 'g', clarifying_questions: [], risk: 'low', assumptions: [], constraints: [],
      files_affected: files, gitStep: null,
      steps: [{ id: 'edit-a', kind: 'edit', title: 't', files, depends_on: [], expected_output: 'e' }],
    },
    context: null, cwd, sessionId: 's', stepResults: [], stepStates: {},
    currentStepId: 'edit-a', currentHints: [], readerFindings: {}, fileSnapshots: {},
    retryCounts: {}, appliedOps: {}, lastError: null, userGuidance: null,
    verifyOutput: null, escalationDecision: null,
    verifyCommands: { typeCheck: null, testRunner: null, lint: null, ...verifyCommands },
  }) as never;

describe('verifyStepNode', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-verify-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/a.ts'), 'x');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('passes when typeCheck command succeeds', async () => {
    const res = await verifyStepNode(mkState(dir, { typeCheck: 'node -e "process.exit(0)"' }));
    expect(res.lastError).toBeNull();
  });

  it('fails with output tail when typeCheck fails', async () => {
    const res = await verifyStepNode(
      mkState(dir, { typeCheck: 'node -e "console.error(\'error TS2304: boom\'); process.exit(1)"' })
    );
    expect(res.lastError).toMatch(/Type check failed/);
    expect(res.verifyOutput).toContain('TS2304');
  });

  it('runs related test file when testRunner configured and test exists', async () => {
    await fs.writeFile(path.join(dir, 'src/a.test.ts'), 'x');
    // echo back the args so we can assert the test file was targeted
    const res = await verifyStepNode(
      mkState(dir, { testRunner: 'node -e "console.log(process.argv.slice(1).join(\' \'))" --' })
    );
    expect(res.lastError).toBeNull();
    expect(res.verifyOutput).toContain('src/a.test.ts');
  });

  it('skips silently when no commands configured', async () => {
    const res = await verifyStepNode(mkState(dir, {}));
    expect(res.lastError).toBeNull();
    expect(res.verifyOutput).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/verifyStep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `verifyStep.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/verifyStep.ts
import { EventBus } from '@robocode-packages/core';
import { debug, runCommand } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';
import { findRelatedTestFile } from './relatedTest';

const TAIL = 1200;
const tail = (s: string): string => (s.length > TAIL ? '…' + s.slice(-TAIL) : s);

export const verifyStepNode = async (state: ExecutorStateType) => {
  const { cwd, sessionId, currentStepId, verifyCommands, plan } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!currentStepId || !step) return { lastError: 'verify: no current step' };

  // Tier 2a: type check
  if (verifyCommands.typeCheck) {
    const result = await runCommand(verifyCommands.typeCheck, cwd);
    const failed = !result.ok || /error TS\d+|error\[|error:/.test(result.output);
    EventBus.emit('executor:verify', {
      sessionId, stepId: currentStepId, command: verifyCommands.typeCheck, ok: !failed,
    });
    if (failed) {
      debug('[executor/verify] typeCheck failed');
      return {
        lastError: `Type check failed:\n${tail(result.output)}`,
        verifyOutput: tail(result.output),
      };
    }
  }

  // Tier 2b: related test file only — never the whole suite
  if (verifyCommands.testRunner) {
    for (const file of step.files) {
      const testFile = await findRelatedTestFile(file, cwd);
      if (!testFile) continue;
      const cmd = `${verifyCommands.testRunner} ${testFile}`;
      const result = await runCommand(cmd, cwd);
      EventBus.emit('executor:verify', {
        sessionId, stepId: currentStepId, command: cmd, ok: result.ok,
      });
      if (!result.ok) {
        debug('[executor/verify] tests failed for', testFile);
        return {
          lastError: `Tests failed (${testFile}):\n${tail(result.output)}`,
          verifyOutput: tail(result.output),
        };
      }
      return { lastError: null, verifyOutput: tail(result.output) };
    }
  }

  return { lastError: null, verifyOutput: state.verifyOutput ?? null };
};
```

- [ ] **Step 4: Run test, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/verifyStep.test.ts`
Expected: PASS (4 tests)

```bash
git add packages/agent/src/nodes/sub/executor/verifyStep.ts __tests__/agent/executor/verifyStep.test.ts
git commit -m "feat(agent): executor step verification node"
```

---

### Task 10: `step_review` node (LLM judge + transition logic + rollback)

**Files:**
- Create: `packages/agent/src/prompts/sub/executor/stepReview.ts`
- Create: `packages/agent/src/nodes/sub/executor/stepReview.ts`
- Test: `__tests__/agent/executor/stepReview.test.ts`

- [ ] **Step 1: Write the failing test (pure transition logic)**

```typescript
// __tests__/agent/executor/stepReview.test.ts
import { decideStepOutcome } from '../../../packages/agent/src/nodes/sub/executor/stepReview';

describe('decideStepOutcome', () => {
  it('sufficient → done', () => {
    expect(decideStepOutcome('sufficient', 0)).toBe('done');
  });

  it('insufficient under the retry cap → retry', () => {
    expect(decideStepOutcome('insufficient', 0)).toBe('retry');
    expect(decideStepOutcome('insufficient', 1)).toBe('retry');
  });

  it('insufficient at the cap → failed', () => {
    expect(decideStepOutcome('insufficient', 2)).toBe('failed');
  });

  it('blocked → failed immediately regardless of retries', () => {
    expect(decideStepOutcome('blocked', 0)).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/stepReview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the review prompt**

```typescript
// packages/agent/src/prompts/sub/executor/stepReview.ts
export interface StepReviewPromptInput {
  stepTitle: string;
  expectedOutput: string;
  appliedOps: string[];
  verifyOutput: string | null;
}

export const buildStepReviewPrompt = (input: StepReviewPromptInput): string => `You are the reviewer inside a code-editing loop. One plan step was just executed and verified. Decide if its result satisfies the expected output.

## Step
${input.stepTitle}

## Expected output (success criteria)
${input.expectedOutput}

## Operations applied
${input.appliedOps.map((op) => `- ${op}`).join('\n') || '- none'}

## Verification output (type check / tests)
${input.verifyOutput ?? '(no verification was configured — judge from the applied operations alone)'}

## Verdict rules
- "sufficient": the applied operations plausibly satisfy the expected output and verification did not fail.
- "insufficient": something is missing or wrong but a corrected attempt could fix it. Explain exactly what to change.
- "blocked": the step cannot succeed without human input (wrong plan assumption, missing file, contradictory constraints).
Keep "reason" short, concrete, and actionable — it is fed back into the next attempt.`;
```

- [ ] **Step 4: Create the node**

```typescript
// packages/agent/src/nodes/sub/executor/stepReview.ts
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { debug, StepReviewOutputSchema } from '@robocode-packages/shared';
import type { StepResult, StepReviewStatus } from '@robocode-packages/shared';
import { getModel } from '../../../utils';
import { buildStepReviewPrompt } from '../../../prompts/sub/executor/stepReview';
import { restoreSnapshot } from './snapshots';
import { MAX_STEP_RETRIES } from '../../../subagents/executor/state';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export type StepOutcome = 'done' | 'retry' | 'failed';

export const decideStepOutcome = (
  status: StepReviewStatus,
  retries: number
): StepOutcome => {
  if (status === 'sufficient') return 'done';
  if (status === 'blocked') return 'failed';
  return retries < MAX_STEP_RETRIES ? 'retry' : 'failed';
};

export const stepReviewNode = async (state: ExecutorStateType) => {
  const { plan, cwd, sessionId, currentStepId } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!currentStepId || !step) return { currentStepId: null };

  const retries = state.retryCounts[currentStepId] ?? 0;
  const applied = state.appliedOps[currentStepId] ?? [];

  let status: StepReviewStatus;
  let reason: string;

  if (state.lastError) {
    // Mechanical/verification failure — the LLM judge adds nothing here.
    status = 'insufficient';
    reason = state.lastError;
  } else {
    const prompt = buildStepReviewPrompt({
      stepTitle: step.title,
      expectedOutput: step.expected_output,
      appliedOps: applied,
      verifyOutput: state.verifyOutput,
    });
    try {
      const model = getModel(false).withStructuredOutput(StepReviewOutputSchema, {
        name: 'step_review',
      });
      const review = await model.invoke([
        new SystemMessage(prompt),
        new HumanMessage('Review the step result.'),
      ]);
      status = review.status;
      reason = review.reason;
    } catch (err) {
      // Judge failed → fall back to verification verdict: no lastError means
      // the cheap tiers passed; accept rather than loop on infra errors.
      debug('[executor/step_review] judge LLM failed, accepting on verification', err);
      status = 'sufficient';
      reason = 'Verification passed; review LLM unavailable.';
    }
  }

  const outcome = decideStepOutcome(status, retries);
  debug('[executor/step_review]', currentStepId, status, '→', outcome, `(retries=${retries})`);

  if (outcome === 'done') {
    const result: StepResult = {
      stepId: currentStepId,
      status: 'done',
      output: reason.slice(0, 800),
      retries,
    };
    EventBus.emit('executor:step:done', { sessionId, stepId: currentStepId, status: 'done', retries });
    return {
      stepStates: { [currentStepId]: 'done' as const },
      stepResults: [result],
      currentStepId: null,
      currentHints: [],
      lastError: null,
      verifyOutput: null,
    };
  }

  // retry and failed both roll the step's files back to pristine state
  const snapshot = state.fileSnapshots[currentStepId];
  if (snapshot) await restoreSnapshot(cwd, snapshot);

  if (outcome === 'retry') {
    return {
      retryCounts: { [currentStepId]: retries + 1 },
      lastError: reason,
      currentHints: [],
    };
  }

  const result: StepResult = {
    stepId: currentStepId,
    status: 'failed',
    output: reason.slice(0, 800),
    retries,
  };
  EventBus.emit('executor:step:done', { sessionId, stepId: currentStepId, status: 'failed', retries });
  return {
    stepStates: { [currentStepId]: 'failed' as const },
    stepResults: [result],
    lastError: reason,
    currentHints: [],
  };
};
```

- [ ] **Step 5: Run test, type-check, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/stepReview.test.ts`
Expected: PASS (4 tests)

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
git add packages/agent/src __tests__/agent/executor/stepReview.test.ts
git commit -m "feat(agent): executor step review with retry rollback"
```

---

### Task 11: `reader_step`, `escalate`, `finalize` nodes

**Files:**
- Create: `packages/agent/src/nodes/sub/executor/readerStep.ts`
- Create: `packages/agent/src/nodes/sub/executor/escalate.ts`
- Create: `packages/agent/src/nodes/sub/executor/finalize.ts`
- Create: `packages/agent/src/nodes/sub/executor/index.ts`
- Test: `__tests__/agent/executor/escalate.test.ts`

- [ ] **Step 1: Write the failing test (pure helpers)**

```typescript
// __tests__/agent/executor/escalate.test.ts
import {
  parseEscalationAnswer,
  collectDependents,
} from '../../../packages/agent/src/nodes/sub/executor/escalate';
import { digestReaderOutput } from '../../../packages/agent/src/nodes/sub/executor/readerStep';

describe('parseEscalationAnswer', () => {
  it('recognizes skip and abort keywords', () => {
    expect(parseEscalationAnswer('skip')).toEqual({ decision: 'skip', guidance: null });
    expect(parseEscalationAnswer(' Abort ')).toEqual({ decision: 'abort', guidance: null });
  });

  it('treats anything else as retry with guidance', () => {
    expect(parseEscalationAnswer('use the helper in utils.ts')).toEqual({
      decision: 'retry',
      guidance: 'use the helper in utils.ts',
    });
    expect(parseEscalationAnswer('retry')).toEqual({ decision: 'retry', guidance: null });
  });
});

describe('collectDependents', () => {
  const steps = [
    { id: 'a', depends_on: [] },
    { id: 'b', depends_on: ['a'] },
    { id: 'c', depends_on: ['b'] },
    { id: 'd', depends_on: [] },
  ];
  it('collects transitive dependents', () => {
    expect(collectDependents(steps as never, 'a').sort()).toEqual(['b', 'c']);
  });
  it('returns empty for a leaf', () => {
    expect(collectDependents(steps as never, 'd')).toEqual([]);
  });
});

describe('digestReaderOutput', () => {
  it('clips findings and extracts hints', () => {
    const digest = digestReaderOutput('inspect-a', {
      schemaVersion: 'reader.output.v2', status: 'sufficient',
      summary: 'S', language: 'typescript', filesAnalyzed: ['src/a.ts'],
      functions: [], classes: [], imports: [], references: [], unresolvedQuestions: [],
      key_findings: Array.from({ length: 30 }, (_, i) => ({
        file: 'src/a.ts', lines: String(i), content: 'x'.repeat(2000), comment: `c${i}`,
      })),
      potential_edit_strategy: {
        goal: 'g', files_to_modify: ['src/a.ts'], change_type: 'modify',
        instructions: 'i', constraints: [],
        operation_hints: [{ op: 'replace_text', file: 'src/a.ts', anchor: 'x', details: 'd', lines: '', nodeType: null, symbol: null, newSymbol: null }],
      },
    } as never);
    expect(digest.stepId).toBe('inspect-a');
    expect(digest.keyFindings.length).toBeLessThanOrEqual(15);
    expect(digest.keyFindings[0].content.length).toBeLessThanOrEqual(800);
    expect(digest.operationHints).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/escalate.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `readerStep.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/readerStep.ts
import { HumanMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { ReaderDigest, ReaderOutput, StepResult } from '@robocode-packages/shared';
import { readerGraph } from '../../../subagents/reader';
import type { ExecutorStateType } from '../../../subagents/executor/state';

const MAX_FINDINGS = 15;
const MAX_FINDING_CHARS = 800;

export const digestReaderOutput = (stepId: string, output: ReaderOutput): ReaderDigest => ({
  stepId,
  summary: output.summary,
  keyFindings: (output.key_findings ?? []).slice(0, MAX_FINDINGS).map((f) => ({
    file: f.file,
    lines: f.lines,
    content: f.content.slice(0, MAX_FINDING_CHARS),
    comment: f.comment,
  })),
  operationHints: output.potential_edit_strategy?.operation_hints ?? [],
});

export const readerStepNode = async (state: ExecutorStateType) => {
  const { plan, cwd, sessionId, currentStepId } = state;
  const step = plan?.steps.find((s) => s.id === currentStepId);
  if (!plan || !step || !currentStepId) return { currentStepId: null };

  const task = `${step.title}\nExpected output: ${step.expected_output}\nOverall goal: ${plan.goal}`;

  let output: ReaderOutput | null = null;
  try {
    const result = await readerGraph.invoke(
      {
        messages: [new HumanMessage(task)],
        sessionId,
        cwd,
        task,
        focus: step.files,
        turnCount: 0,
        editIntentInputPayload: null,
      },
      { configurable: { sessionId, cwd }, recursionLimit: 150 }
    );
    output = result.editIntentInputPayload ?? null;
  } catch (err) {
    debug('[executor/reader_step] reader failed', err);
  }

  const retries = state.retryCounts[currentStepId] ?? 0;

  if (!output || output.status === 'blocked') {
    const reason = output
      ? `Reader blocked: ${output.unresolvedQuestions.join('; ') || output.summary}`
      : 'Reader subagent returned no output.';
    EventBus.emit('executor:step:done', { sessionId, stepId: currentStepId, status: 'failed', retries });
    const result: StepResult = { stepId: currentStepId, status: 'failed', output: reason.slice(0, 800), retries };
    return {
      stepStates: { [currentStepId]: 'failed' as const },
      stepResults: [result],
      lastError: reason,
    };
  }

  // 'sufficient' and 'insufficient' both produce usable findings; unresolved
  // questions surface to the mini-reader through the digest summary.
  const digest = digestReaderOutput(currentStepId, output);
  EventBus.emit('executor:step:done', { sessionId, stepId: currentStepId, status: 'done', retries });
  const result: StepResult = {
    stepId: currentStepId,
    status: 'done',
    output: output.summary.slice(0, 800),
    retries,
  };
  return {
    readerFindings: { [currentStepId]: digest },
    stepStates: { [currentStepId]: 'done' as const },
    stepResults: [result],
    currentStepId: null,
    lastError: null,
  };
};
```

Check the import path for `readerGraph`: it is exported from `packages/agent/src/subagents/reader/index.ts`. Note `packages/agent/src/tools/analyzeCode.ts` imports it from `../main/subagents/reader` — use whichever path resolves; prefer `../../../subagents/reader`.

- [ ] **Step 4: Create `escalate.ts`**

```typescript
// packages/agent/src/nodes/sub/executor/escalate.ts
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { EscalationDecision, StepResult, StepStatus } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

export interface ParsedEscalation {
  decision: EscalationDecision;
  guidance: string | null;
}

export const parseEscalationAnswer = (answer: string): ParsedEscalation => {
  const normalized = answer.trim().toLowerCase();
  if (normalized === 'skip') return { decision: 'skip', guidance: null };
  if (normalized === 'abort' || normalized === 'stop') return { decision: 'abort', guidance: null };
  if (normalized === 'retry') return { decision: 'retry', guidance: null };
  return { decision: 'retry', guidance: answer.trim() };
};

export const collectDependents = (
  steps: { id: string; depends_on: string[] }[],
  stepId: string
): string[] => {
  const dependents = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const step of steps) {
      if (dependents.has(step.id)) continue;
      if (step.depends_on.some((dep) => dep === stepId || dependents.has(dep))) {
        dependents.add(step.id);
        grew = true;
      }
    }
  }
  return [...dependents];
};

export const escalateNode = (state: ExecutorStateType) => {
  const { plan, sessionId, currentStepId, lastError } = state;
  const stepId = currentStepId ?? 'unknown';
  const step = plan?.steps.find((s) => s.id === stepId);

  const question =
    `Executor step "${step?.title ?? stepId}" failed:\n${lastError ?? 'unknown error'}\n\n` +
    `Reply "skip" to skip this step (dependent steps will be skipped too), ` +
    `"abort" to stop the executor, or type guidance to retry with your hint.`;

  EventBus.emit('agent:question', { sessionId, question, source: 'executor' });
  const answer: string = interrupt(question);
  const parsed = parseEscalationAnswer(answer);
  EventBus.emit('agent:answer', { sessionId, answer, source: 'executor' });
  debug('[executor/escalate]', stepId, '→', parsed.decision);

  if (parsed.decision === 'retry' && step) {
    return {
      escalationDecision: 'retry' as const,
      userGuidance: parsed.guidance,
      retryCounts: { [stepId]: 0 },
      stepStates: { [stepId]: 'running' as StepStatus },
      lastError: state.lastError, // keep error context for the retry prompt
    };
  }

  if (parsed.decision === 'skip' && plan && step) {
    const cascade = collectDependents(plan.steps, stepId).filter(
      (id) => state.stepStates[id] === 'pending'
    );
    const stepStates: Record<string, StepStatus> = { [stepId]: 'skipped' };
    const stepResults: StepResult[] = [];
    // the failed step already has a StepResult from step_review/reader_step — only cascade gets new ones
    for (const id of cascade) {
      stepStates[id] = 'skipped';
      stepResults.push({
        stepId: id, status: 'skipped',
        output: `Skipped: dependency "${stepId}" was skipped by the user.`,
        retries: 0,
      });
      EventBus.emit('executor:step:done', { sessionId, stepId: id, status: 'skipped', retries: 0 });
    }
    return {
      escalationDecision: 'skip' as const,
      stepStates,
      stepResults,
      currentStepId: null,
      lastError: null,
      userGuidance: null,
    };
  }

  return { escalationDecision: 'abort' as const, currentStepId: null };
};
```

- [ ] **Step 5: Create `finalize.ts` and the barrel**

```typescript
// packages/agent/src/nodes/sub/executor/finalize.ts
import { debug } from '@robocode-packages/shared';
import type { StepResult } from '@robocode-packages/shared';
import type { ExecutorStateType } from '../../../subagents/executor/state';

// Safety net: every plan step must end with a StepResult, even on abort.
export const finalizeNode = (state: ExecutorStateType) => {
  const { plan, stepResults } = state;
  if (!plan) return {};

  const covered = new Set(stepResults.map((r) => r.stepId));
  const missing: StepResult[] = plan.steps
    .filter((s) => !covered.has(s.id))
    .map((s) => ({
      stepId: s.id,
      status: 'skipped' as const,
      output:
        state.escalationDecision === 'abort'
          ? 'Skipped: executor aborted by the user.'
          : (state.lastError ?? 'Skipped: executor ended before this step.'),
      retries: state.retryCounts[s.id] ?? 0,
    }));

  debug('[executor/finalize]', stepResults.length + missing.length, 'step results');
  return missing.length > 0 ? { stepResults: missing } : {};
};
```

```typescript
// packages/agent/src/nodes/sub/executor/index.ts
export * from './init';
export * from './stepSelector';
export * from './readerStep';
export * from './miniReader';
export * from './approvalGate';
export * from './apply';
export * from './verifyStep';
export * from './stepReview';
export * from './escalate';
export * from './finalize';
export * from './dispatch';
export * from './snapshots';
export * from './relatedTest';
```

Also add `export * from './executor';` to `packages/agent/src/nodes/sub/index.ts`.

- [ ] **Step 6: Run test, type-check, commit**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/escalate.test.ts`
Expected: PASS

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
git add packages/agent/src __tests__/agent/executor/escalate.test.ts
git commit -m "feat(agent): executor reader step, escalation, finalize nodes"
```

---

### Task 12: Executor graph assembly + integration test

**Files:**
- Create: `packages/agent/src/subagents/executor/graph.ts`
- Create: `packages/agent/src/subagents/executor/index.ts`
- Modify: `packages/agent/src/subagents/index.ts`
- Test: `__tests__/agent/executor/graph.test.ts`

- [ ] **Step 1: Create `graph.ts`**

```typescript
// packages/agent/src/subagents/executor/graph.ts
import { StateGraph, END, START } from '@langchain/langgraph';
import {
  initNode,
  stepSelectorNode,
  readerStepNode,
  miniReaderNode,
  approvalGateNode,
  applyNode,
  verifyStepNode,
  stepReviewNode,
  escalateNode,
  finalizeNode,
  hasDestructiveHints,
} from '../../nodes/sub/executor';
import { ExecutorState } from './state';
import type { ExecutorStateType } from './state';

const afterInit = (state: ExecutorStateType): string =>
  state.lastError ? 'finalize' : 'step_selector';

const afterSelector = (state: ExecutorStateType): string => {
  if (!state.currentStepId) return 'finalize';
  const step = state.plan?.steps.find((s) => s.id === state.currentStepId);
  return step?.kind === 'inspect' ? 'reader_step' : 'mini_reader';
};

const afterReaderStep = (state: ExecutorStateType): string =>
  state.currentStepId && state.stepStates[state.currentStepId] === 'failed'
    ? 'escalate'
    : 'step_selector';

const afterMiniReader = (state: ExecutorStateType): string => {
  if (state.currentHints.length === 0) return 'step_review'; // failure path
  return hasDestructiveHints(state) ? 'approval_gate' : 'apply';
};

const afterApprovalGate = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'apply';

const afterApply = (state: ExecutorStateType): string =>
  state.lastError ? 'step_review' : 'verify_step';

const afterReview = (state: ExecutorStateType): string => {
  if (!state.currentStepId) return 'step_selector'; // done
  if (state.stepStates[state.currentStepId] === 'failed') return 'escalate';
  return 'mini_reader'; // retry
};

const afterEscalate = (state: ExecutorStateType): string => {
  if (state.escalationDecision === 'abort') return 'finalize';
  if (state.escalationDecision === 'skip') return 'step_selector';
  const step = state.plan?.steps.find((s) => s.id === state.currentStepId);
  return step?.kind === 'inspect' ? 'reader_step' : 'mini_reader';
};

export function createExecutorGraph() {
  const graph = new StateGraph(ExecutorState)
    .addNode('init', initNode)
    .addNode('step_selector', stepSelectorNode)
    .addNode('reader_step', readerStepNode)
    .addNode('mini_reader', miniReaderNode)
    .addNode('approval_gate', approvalGateNode)
    .addNode('apply', applyNode)
    .addNode('verify_step', verifyStepNode)
    .addNode('step_review', stepReviewNode)
    .addNode('escalate', escalateNode)
    .addNode('finalize', finalizeNode)

    .addEdge(START, 'init')
    .addConditionalEdges('init', afterInit, {
      step_selector: 'step_selector', finalize: 'finalize',
    })
    .addConditionalEdges('step_selector', afterSelector, {
      reader_step: 'reader_step', mini_reader: 'mini_reader', finalize: 'finalize',
    })
    .addConditionalEdges('reader_step', afterReaderStep, {
      escalate: 'escalate', step_selector: 'step_selector',
    })
    .addConditionalEdges('mini_reader', afterMiniReader, {
      approval_gate: 'approval_gate', apply: 'apply', step_review: 'step_review',
    })
    .addConditionalEdges('approval_gate', afterApprovalGate, {
      step_review: 'step_review', apply: 'apply',
    })
    .addConditionalEdges('apply', afterApply, {
      step_review: 'step_review', verify_step: 'verify_step',
    })
    .addEdge('verify_step', 'step_review')
    .addConditionalEdges('step_review', afterReview, {
      step_selector: 'step_selector', escalate: 'escalate', mini_reader: 'mini_reader',
    })
    .addConditionalEdges('escalate', afterEscalate, {
      finalize: 'finalize', step_selector: 'step_selector',
      reader_step: 'reader_step', mini_reader: 'mini_reader',
    })
    .addEdge('finalize', END);

  // No checkpointer here: as a subgraph-node the parent's checkpointer is inherited,
  // which is what makes interrupt()/resume work through the root thread.
  return graph.compile();
}

export const executorGraph = createExecutorGraph();
```

```typescript
// packages/agent/src/subagents/executor/index.ts
export * from './graph';
export * from './state';
```

Add `export * from './executor';` to `packages/agent/src/subagents/index.ts`.

- [ ] **Step 2: Write the integration test (mocked model, real temp project)**

The mini-reader and step-review nodes call `getModel` from `packages/agent/src/utils`. Mock that module with `jest.unstable_mockModule` BEFORE importing the graph (ESM mocking — see jest docs; dynamic `await import` after the mock is registered is mandatory).

```typescript
// __tests__/agent/executor/graph.test.ts
import { jest } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// queue of structured outputs returned by mocked withStructuredOutput().invoke()
const llmQueue: unknown[] = [];

jest.unstable_mockModule('../../../packages/agent/src/utils/model', () => ({
  createBaseModel: jest.fn(),
  getModel: jest.fn(() => ({
    withStructuredOutput: () => ({
      invoke: async () => {
        if (llmQueue.length === 0) throw new Error('llmQueue empty');
        return llmQueue.shift();
      },
    }),
  })),
}));

const { createExecutorGraph } = await import(
  '../../../packages/agent/src/subagents/executor/graph'
);

const plan = (steps: unknown[]) => ({
  goal: 'test goal', clarifying_questions: [], risk: 'low', assumptions: [],
  constraints: [], files_affected: ['src/a.ts'], gitStep: null, steps,
});

describe('executor graph (mocked LLM)', () => {
  let dir: string;
  beforeEach(async () => {
    llmQueue.length = 0;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-graph-'));
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  });
  afterEach(async () => fs.rm(dir, { recursive: true, force: true }));

  it('happy path: edit step applies hints, reviews sufficient, finishes done', async () => {
    llmQueue.push(
      // mini_reader output
      { hints: [{ op: 'replace_text', file: 'src/a.ts', anchor: 'export const a = 1;', newContent: 'export const a = 2;' }] },
      // step_review output
      { status: 'sufficient', reason: 'value updated' }
    );

    const graph = createExecutorGraph();
    const result = await graph.invoke({
      plan: plan([
        { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'a === 2' },
      ]),
      context: null, cwd: dir, sessionId: 's',
    });

    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]).toMatchObject({ stepId: 'edit-a', status: 'done' });
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toContain('a = 2');
  });

  it('retry path: bad anchor rolls back, second attempt succeeds', async () => {
    llmQueue.push(
      { hints: [{ op: 'replace_text', file: 'src/a.ts', anchor: 'WRONG ANCHOR', newContent: 'x' }] }, // attempt 1 → apply fails
      { hints: [{ op: 'replace_text', file: 'src/a.ts', anchor: 'export const a = 1;', newContent: 'export const a = 3;' }] }, // attempt 2
      { status: 'sufficient', reason: 'ok' } // review of attempt 2
    );

    const graph = createExecutorGraph();
    const result = await graph.invoke({
      plan: plan([
        { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'a === 3' },
      ]),
      context: null, cwd: dir, sessionId: 's',
    });

    expect(result.stepResults[0]).toMatchObject({ stepId: 'edit-a', status: 'done', retries: 1 });
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toContain('a = 3');
  });

  it('exhausted retries roll files back and escalate via interrupt', async () => {
    // 3 failing attempts (initial + 2 retries), each consumes one mini_reader output
    for (let i = 0; i < 3; i++) {
      llmQueue.push({ hints: [{ op: 'replace_text', file: 'src/a.ts', anchor: 'WRONG', newContent: 'x' }] });
    }

    // Without a checkpointer, interrupt() in the escalate node throws GraphInterrupt
    // to the caller — assert it escapes, then assert rollback happened.
    await expect(
      createExecutorGraph().invoke({
        plan: plan([
          { id: 'edit-a', kind: 'edit', title: 'bump a', files: ['src/a.ts'], depends_on: [], expected_output: 'x' },
        ]),
        context: null, cwd: dir, sessionId: 's',
      })
    ).rejects.toThrow();

    // every failed attempt was rolled back — file is pristine
    expect(await fs.readFile(path.join(dir, 'src/a.ts'), 'utf-8')).toBe('export const a = 1;\n');
  });
});
```

Note for the implementer: this test asserts only that (a) the escalation interrupt escapes when no checkpointer is attached and (b) rollback happened. Full interrupt/resume (`new Command({ resume: 'skip' })` → skipped `StepResult`) is exercised through the root graph, which compiles with the SQLite checkpointer (Task 13 / manual check in Task 15). If LangGraph 1.3 returns `__interrupt__` in the result instead of throwing, change the assertion to `expect(result.__interrupt__).toBeDefined()`.

- [ ] **Step 3: Run the integration test**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/graph.test.ts`
Expected: PASS (3 tests). Likely friction points:
- `EventBus` import side effects — fine, events fire into the void in tests.
- If `GraphInterrupt` does not reject but returns `__interrupt__` in v1.3, change the third test's assertion to `expect(result.__interrupt__).toBeDefined()`.

- [ ] **Step 4: Type-check, commit**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
git add packages/agent/src/subagents __tests__/agent/executor/graph.test.ts
git commit -m "feat(agent): executor subgraph assembly with integration tests"
```

---

### Task 13: Root graph wiring — plan approval, executor node, report node

**Files:**
- Create: `packages/agent/src/nodes/root/planApproval.ts`
- Create: `packages/agent/src/nodes/root/executorReport.ts`
- Modify: `packages/agent/src/nodes/root/index.ts`
- Modify: `packages/agent/src/graphs/root.ts`
- Test: `__tests__/agent/executor/rootWiring.test.ts`

- [ ] **Step 1: Write the failing test (routing functions)**

```typescript
// __tests__/agent/executor/rootWiring.test.ts
import { afterPlanner, afterPlanApproval } from '../../../packages/agent/src/graphs/root';

const plan = {
  goal: 'g', clarifying_questions: [], risk: 'low', assumptions: [], constraints: [],
  files_affected: [], gitStep: null,
  steps: [{ id: 'edit-a', kind: 'edit', title: 't', files: [], depends_on: [], expected_output: 'e' }],
};

describe('afterPlanner', () => {
  it('routes to question_node on planner clarification', () => {
    expect(afterPlanner({ clarificationSource: 'planner', plan } as never)).toBe('question_node');
  });
  it('routes to plan_approval when a plan with steps exists', () => {
    expect(afterPlanner({ clarificationSource: null, plan } as never)).toBe('plan_approval');
  });
  it('falls back to agent without a plan', () => {
    expect(afterPlanner({ clarificationSource: null, plan: null } as never)).toBe('agent');
  });
});

describe('afterPlanApproval', () => {
  it('routes approved plans to executor', () => {
    expect(afterPlanApproval({ planApproved: true } as never)).toBe('executor');
  });
  it('routes rejected plans to agent', () => {
    expect(afterPlanApproval({ planApproved: false } as never)).toBe('agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/rootWiring.test.ts`
Expected: FAIL — `afterPlanner`/`afterPlanApproval` not exported.

- [ ] **Step 3: Create `planApproval.ts`**

```typescript
// packages/agent/src/nodes/root/planApproval.ts
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { RootStateType, PlannerOutput } from '@robocode-packages/shared';

const formatPlan = (plan: PlannerOutput): string => {
  const steps = plan.steps
    .map((s, i) => `${i + 1}. [${s.kind}] ${s.title} (${s.files.join(', ') || 'no files'})`)
    .join('\n');
  return `${plan.goal}\n\nRisk: ${plan.risk}\nSteps:\n${steps}`;
};

// The CLI already renders agent:plan_pending as an approve/reject prompt and
// answers via agent:resume → Command({ resume: decision }). This node closes
// that loop with an actual interrupt.
export const planApprovalNode = (state: RootStateType) => {
  const { sessionId, plan } = state;
  if (!plan) return { planApproved: false };

  const formatted = formatPlan(plan);
  EventBus.emit('agent:plan_pending', { sessionId, plan: formatted });

  const decision: string = interrupt(formatted);
  const approved = decision === 'approve' || decision === 'y';

  EventBus.emit('agent:plan_decision', { sessionId, approved, plan: formatted });
  debug('[planApprovalNode]', approved ? 'approved' : 'rejected');
  return { planApproved: approved };
};
```

- [ ] **Step 4: Create `executorReport.ts`**

```typescript
// packages/agent/src/nodes/root/executorReport.ts
import { HumanMessage } from '@langchain/core/messages';
import type { RootStateType } from '@robocode-packages/shared';

// Converts executor results into a message so the final agent node can compose
// the user-facing answer without knowing executor internals.
export const executorReportNode = (state: RootStateType) => {
  const { stepResults, plan } = state;
  if (!plan || stepResults.length === 0) return {};

  const lines = stepResults.map((r) => {
    const step = plan.steps.find((s) => s.id === r.stepId);
    return `- [${r.status}] ${step?.title ?? r.stepId}${r.retries ? ` (retries: ${r.retries})` : ''}: ${r.output}`;
  });

  const report =
    `[executor report — internal]\nPlan: ${plan.goal}\nStep results:\n${lines.join('\n')}\n\n` +
    `Summarize what was done for the user. Mention failed or skipped steps explicitly. Do not re-apply any edits.`;

  return { messages: [new HumanMessage(report)] };
};
```

- [ ] **Step 5: Wire the root graph**

Replace `packages/agent/src/graphs/root.ts` with:

```typescript
import { StateGraph, END, START } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
import type { RootStateType } from '@robocode-packages/shared';
import { RootState } from '@robocode-packages/shared';
import {
  contextNode,
  rootAgentNode,
  askUserNode,
  routerIntentNode,
  preRoute,
  afterRouterIntent,
  plannerNode,
  fileSelectorNode,
  afterAsk,
} from '../nodes';
import { planApprovalNode } from '../nodes/root/planApproval';
import { executorReportNode } from '../nodes/root/executorReport';
import { executorGraph } from '../subagents/executor';

export const afterPlanner = (state: RootStateType): string => {
  if (state.clarificationSource === 'planner') return 'question_node';
  if (state.plan && state.plan.steps.length > 0) return 'plan_approval';
  return 'agent';
};

export const afterPlanApproval = (state: RootStateType): string =>
  state.planApproved ? 'executor' : 'agent';

export function buildGraph() {
  const checkpointer = Checkpointer.getInstance();

  const graph = new StateGraph(RootState)
    .addNode('context_node', contextNode)
    .addNode('pre_route', preRoute)
    .addNode('router_intent', routerIntentNode)
    .addNode('file_selector', fileSelectorNode)
    .addNode('planner', plannerNode)
    .addNode('question_node', askUserNode)
    .addNode('plan_approval', planApprovalNode)
    .addNode('executor', executorGraph)
    .addNode('executor_report', executorReportNode)
    .addNode('agent', rootAgentNode)
    .addEdge(START, 'context_node')
    .addEdge('context_node', 'pre_route')
    .addEdge('pre_route', 'router_intent')

    .addConditionalEdges('router_intent', afterRouterIntent, {
      question_node: 'question_node',
      file_selector: 'file_selector',
      planner: 'planner',
      agent: 'agent',
    })

    .addEdge('file_selector', 'planner')

    .addConditionalEdges('planner', afterPlanner, {
      question_node: 'question_node',
      plan_approval: 'plan_approval',
      agent: 'agent',
    })

    .addConditionalEdges('plan_approval', afterPlanApproval, {
      executor: 'executor',
      agent: 'agent',
    })

    .addEdge('executor', 'executor_report')
    .addEdge('executor_report', 'agent')

    .addConditionalEdges('question_node', afterAsk, {
      pre_route: 'pre_route',
      planner: 'planner',
      agent: 'agent',
    })

    .addEdge('agent', END);

  return graph.compile({ checkpointer });
}

export const rootGraph = buildGraph();
```

If `addNode('executor', executorGraph)` raises a type error about state mismatch (subgraph has private channels), cast as documented for LangGraph JS subgraphs: `.addNode('executor', executorGraph as never)` — runtime behavior is correct because all shared keys (`plan`, `context`, `cwd`, `sessionId`, `stepResults`) exist in both schemas and private executor channels stay internal.

Also export the new nodes from `packages/agent/src/nodes/root/index.ts`:

```typescript
export * from './planApproval';
export * from './executorReport';
```

- [ ] **Step 6: Run the wiring test + full test suite + type-check**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/executor/rootWiring.test.ts`
Expected: PASS

Run: `pnpm test`
Expected: PASS — pre-existing tests must not regress. Pay attention to `approvalResume.test.ts` and `freeAgentLoop.test.ts` (they exercise the root graph; the new `plan_approval` node only activates when `state.plan` is set, which old tests don't do — if they fail because plannerNode now persists `plan` into state, update those tests' expectations accordingly and note it in the commit message).

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
```

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src __tests__/agent/executor/rootWiring.test.ts
git commit -m "feat(agent): wire executor subgraph into root with plan approval"
```

---

### Task 14: CLI rendering of executor progress events

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx` (subscriptions block around line 150-270)

No unit test (Ink UI; covered by manual run). Keep changes additive.

- [ ] **Step 1: Add subscriptions**

Inside the same `useEffect` that registers `EventBus.on('llm:token', …)` etc. (see `Chat.tsx:154`), append four subscriptions to the subscription array, following the existing style exactly:

```typescript
      EventBus.on('executor:step:start', ({ sessionId, title, index, total }) => {
        if (sessionId !== id) return;
        setThinkingPhrase(`Step ${index}/${total}: ${title}`);
      }),
      EventBus.on('executor:step:done', ({ sessionId, stepId, status, retries }) => {
        if (sessionId !== id) return;
        const icon = status === 'done' ? '✔' : status === 'failed' ? '✖' : '↷';
        const suffix = retries > 0 ? ` (retries: ${retries})` : '';
        setStaticItems(prev => [
          ...prev,
          { kind: 'system', id: makeId(), content: `${icon} ${stepId} — ${status}${suffix}` },
        ]);
      }),
      EventBus.on('executor:edit:applied', ({ sessionId, file, op }) => {
        if (sessionId !== id) return;
        setStaticItems(prev => [
          ...prev,
          { kind: 'system', id: makeId(), content: `✎ ${file} (${op})` },
        ]);
      }),
      EventBus.on('executor:verify', ({ sessionId, command, ok }) => {
        if (sessionId !== id) return;
        setThinkingPhrase(ok ? 'Verifying… ok' : 'Verifying… failed');
        void command;
      }),
```

If the `StaticItem` union in the CLI types does not have a `'system'` kind with `content`, reuse whatever kind the `agent:compact_complete` handler uses (`Chat.tsx:208-218` pushes `{ kind: 'system', id, content }` — same shape).

- [ ] **Step 2: Build + manual smoke**

```bash
pnpm build
```
Expected: clean build. Manual verification happens in Task 15's end-to-end check.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat(cli): render executor progress events"
```

---

### Task 15: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 2: Type-check every touched package**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json
npx tsc --noEmit --project packages/agent/tsconfig.json
pnpm build
```
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean (fix any new-code violations).

- [ ] **Step 4: Manual end-to-end (recommended)**

Run `pnpm dev` in a scratch project, ask for a small edit (e.g. "rename function X to Y in src/foo.ts"), and observe: plan approval prompt → step progress lines → edits applied → final summary. Watch `pnpm debug` (tails `~/.robocode/debug.log`) for `[executor/…]` lines.

- [ ] **Step 5: Final commit if anything was fixed**

```bash
git add -A
git commit -m "chore: executor loop verification fixes"
```

---

## Self-review notes (already applied)

- **Spec coverage:** init/selector/reader_step/mini_reader/approval_gate/apply/verify_step/step_review/escalate/finalize — Tasks 5-12; root wiring + plan approval + report — Task 13; events — Tasks 2/6/8/9/10/11; CLI — Task 14; snapshots/rollback — Tasks 3/8/10; two-tier verification — Tasks 4 (syntax) / 9 (commands); `RootState.plan` bug fix — Task 2.
- **Deviation from spec:** the spec's "DAG deadlock → escalate" became "unreachable steps → cascade skip in step_selector" (Task 6) — failures already escalate at the moment they happen, so a selector-level deadlock can only mean dependents of an already-escalated step; skipping them with recorded results matches the cascade-skip semantics the user approved.
- **Type consistency check:** `ExecutorHint.target/insertMode` (Task 1) used by dispatch (Task 4) and mini-reader prompt rules (Task 7); `ReaderDigest` (Task 1) produced in Task 11, consumed in Task 7; `MAX_STEP_RETRIES` defined once in state (Task 3), used in Task 10; `StepResult` from existing schema everywhere.
