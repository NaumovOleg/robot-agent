# verify_edits Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `verify_edits` tool the agent explicitly calls after completing a group of related edits, replacing the broken inline tsc check in `editFile`.

**Architecture:** New `verifyEditsTool` in `packages/tools` runs an arbitrary shell command from project `cwd` and returns a clear pass/fail result. Add to `AGENT_TOOLS` and update the system prompt rule. Remove the broken `execSync` tsc check from `editFile` that runs from the wrong directory.

**Tech Stack:** Node.js `execSync`, LangChain tool, Zod, Jest

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `packages/tools/src/tools/verify.ts` | `verifyEditsTool` implementation |
| Create | `packages/tools/src/tools/__tests__/verify.test.ts` | Unit tests for the tool |
| Modify | `packages/tools/src/tools/index.ts` | Export `verifyEditsTool` |
| Modify | `packages/tools/src/tools/editor/editFile.ts` | Remove broken inline tsc check + unused imports |
| Modify | `packages/agent/src/main/agent_node.ts` | Add `verifyEditsTool` to `AGENT_TOOLS` |
| Modify | `packages/agent/src/main/prompt.ts` | Add verify rule |
| Modify | `packages/shared/src/types/agent.ts` | Add `verify_edits` to `TOOL_NAMES` enum |
| Modify | `packages/config/src/agent.ts` | Add `verify_edits: 'safe'` to `TOOL_RISK` |

---

### Task 1: Add `verify_edits` to shared constants

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/config/src/agent.ts`

- [ ] **Step 1: Add to TOOL_NAMES enum**

In `packages/shared/src/types/agent.ts`, find the `TOOL_NAMES` enum and add at the end (before the closing brace):

```ts
  verify_edits = 'verify_edits',
```

- [ ] **Step 2: Add to TOOL_RISK**

In `packages/config/src/agent.ts`, in the `TOOL_RISK` object, add after `request_approval: 'safe'`:

```ts
  verify_edits: 'safe',
```

- [ ] **Step 3: Build shared and config to verify no type errors**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json
npx tsc --noEmit --project packages/config/tsconfig.json
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/config/src/agent.ts
git commit -m "feat(config): add verify_edits to TOOL_NAMES and TOOL_RISK"
```

---

### Task 2: Create `verifyEditsTool` with tests

**Files:**
- Create: `packages/tools/src/tools/verify.ts`
- Create: `packages/tools/src/tools/__tests__/verify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/tools/src/tools/__tests__/verify.test.ts`:

```ts
import { verifyEditsTool } from '../verify';

describe('verifyEditsTool', () => {
  it('returns "Verification passed" when command exits 0', async () => {
    const result = await verifyEditsTool.invoke(
      { command: 'echo hello' },
      { configurable: { cwd: process.cwd() } },
    );
    expect(result).toMatch(/^Verification passed\./);
    expect(result).toContain('hello');
  });

  it('returns "Verification FAILED" when command exits non-zero', async () => {
    const result = await verifyEditsTool.invoke(
      { command: 'false' },
      { configurable: { cwd: process.cwd() } },
    );
    expect(result).toMatch(/^Verification FAILED \(exit \d+\)\./);
    expect(result).toContain('Fix all errors before proceeding.');
  });

  it('includes exit code in failure message', async () => {
    const result = await verifyEditsTool.invoke(
      { command: 'exit 42' },
      { configurable: { cwd: process.cwd() } },
    );
    expect(result).toContain('exit 42');
  });

  it('runs command from provided cwd', async () => {
    const cwd = require('node:os').tmpdir();
    const result = await verifyEditsTool.invoke(
      { command: 'pwd' },
      { configurable: { cwd } },
    );
    expect(result).toMatch(/^Verification passed\./);
    // resolve symlinks for macOS (/tmp -> /private/tmp)
    const resolvedCwd = require('node:fs').realpathSync(cwd);
    expect(result).toContain(resolvedCwd);
  });

  it('falls back to process.cwd() when no cwd in config', async () => {
    const result = await verifyEditsTool.invoke({ command: 'echo ok' });
    expect(result).toMatch(/^Verification passed\./);
  });

  it('tool name is verify_edits', () => {
    expect(verifyEditsTool.name).toBe('verify_edits');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js packages/tools/src/tools/__tests__/verify.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '../verify'`

- [ ] **Step 3: Implement verifyEditsTool**

Create `packages/tools/src/tools/verify.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import type { RunnableConfig } from '@langchain/core/runnables';
import { TOOL_NAMES } from '@robocode-packages/shared';

export const verifyEditsTool = tool(
  async ({ command }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    try {
      const output = execSync(command, {
        cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: 120_000,
      });
      return `Verification passed.\n${output.trim() || '(no output)'}`;
    } catch (err: unknown) {
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
      const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf-8') ?? '';
      const stderr = typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf-8') ?? '';
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      const code = e.status ?? 1;
      return `Verification FAILED (exit ${code}).\n${output || '(no output)'}\nFix all errors before proceeding.`;
    }
  },
  {
    name: TOOL_NAMES.verify_edits,
    description: `Run a verification command after completing a group of related edits.
Use when edits form a coherent unit and correctness needs checking (type errors, failing tests, build errors).
Skip when the change clearly needs no verification (docs-only edits, comments).
Examples: 'npx tsc --noEmit', 'npm test', 'pnpm test', 'cargo check', 'python -m pytest'`,
    schema: z.object({
      command: z.string().describe('Shell command to run (e.g. npx tsc --noEmit)'),
      description: z.string().optional().describe('What you are verifying (e.g. TypeScript types, unit tests)'),
    }),
  },
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js packages/tools/src/tools/__tests__/verify.test.ts --no-coverage
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/tools/verify.ts packages/tools/src/tools/__tests__/verify.test.ts
git commit -m "feat(tools): add verifyEditsTool for explicit post-edit verification"
```

---

### Task 3: Export `verifyEditsTool` from tools index

**Files:**
- Modify: `packages/tools/src/tools/index.ts`

- [ ] **Step 1: Add export**

In `packages/tools/src/tools/index.ts`, add after the last export line:

```ts
export * from './verify';
```

The file should now look like:

```ts
export * from './bash';
export * from './editor';
export * from './reader';
export * from './git';
export * from './gitDelegateTool';
export * from './toolSets';
export * from './control';
export * from './symbol';
export * from './verify';
```

- [ ] **Step 2: Build tools package to verify export resolves**

```bash
npx tsc --noEmit --project packages/tools/tsconfig.json
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/tools/src/tools/index.ts
git commit -m "feat(tools): export verifyEditsTool from tools index"
```

---

### Task 4: Remove broken tsc check from editFile

**Files:**
- Modify: `packages/tools/src/tools/editor/editFile.ts`

The existing check runs `npx tsc --noEmit` from `path.dirname(filePath)`. In a monorepo this finds no tsconfig and returns silence — a false all-clear. Remove it along with the now-unused `path` and `execSync` imports.

- [ ] **Step 1: Remove imports and tsc block**

In `packages/tools/src/tools/editor/editFile.ts`, replace the top of the file. Current lines 1-6:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildDiff } from '../../utils';
import { TOOL_NAMES } from '@robocode-packages/shared';
```

New lines 1-5 (remove `path` and `execSync`):

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs';
import { buildDiff } from '../../utils';
import { TOOL_NAMES } from '@robocode-packages/shared';
```

- [ ] **Step 2: Remove the tsc post-check block**

Find and remove lines 39–54 (the tsc block). The section to remove:

```ts
      // post-check: run tsc on TypeScript files to surface errors immediately
      const notes: string[] = [];
      const isTs = /\.(ts|tsx)$/.test(filePath);
      if (isTs) {
        try {
          const tscOut = execSync(`npx tsc --noEmit 2>&1 || true`, {
            cwd: path.dirname(filePath),
            stdio: ['pipe', 'pipe', 'pipe'],
          }).toString();
          if (tscOut.trim()) {
            notes.push(`TypeScript errors after edit:\n${tscOut.slice(0, 1500)}`);
          }
        } catch {
          // ignore unexpected execSync errors
        }
      }
```

- [ ] **Step 3: Remove notes usage from return statement**

Find and replace the return at the end of the success branch. Current:

```ts
      const editResult = `Edited: ${filePath} (${summary})\n\n${diff}`;
      return notes.length ? `${editResult}\n\n${notes.join('\n')}` : editResult;
```

New:

```ts
      return `Edited: ${filePath} (${summary})\n\n${diff}`;
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
npx tsc --noEmit --project packages/tools/tsconfig.json
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/tools/editor/editFile.ts
git commit -m "fix(tools): remove broken inline tsc check from editFile

Ran tsc from path.dirname(filePath) — wrong cwd in monorepo, silently
missed all errors. Agent now verifies explicitly via verify_edits tool."
```

---

### Task 5: Wire tool into agent and update system prompt

**Files:**
- Modify: `packages/agent/src/main/agent_node.ts`
- Modify: `packages/agent/src/main/prompt.ts`

- [ ] **Step 1: Import and add verifyEditsTool to AGENT_TOOLS**

In `packages/agent/src/main/agent_node.ts`, add `verifyEditsTool` to the import from `@robocode-packages/tools`:

```ts
import {
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  gitDiffTool,
  gitLogTool,
  requestApprovalTool,
  renameSymbolTool,
  findDefinitionTool,
  deleteFileTool,
  verifyEditsTool,
} from '@robocode-packages/tools';
```

Add `verifyEditsTool` to the `AGENT_TOOLS` array, between editor tools and the control tool:

```ts
export const AGENT_TOOLS = [
  // read-only
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  findDefinitionTool,
  gitDiffTool,
  gitLogTool,
  analyzeCodeTool,
  // mutation
  writeFileTool,
  editFileTool,
  deleteFileTool,
  bashTool,
  renameSymbolTool,
  // verification
  verifyEditsTool,
  // control
  requestApprovalTool,
];
```

- [ ] **Step 2: Add verify rule to system prompt**

In `packages/agent/src/main/prompt.ts`, find the rules block. Current rule on line 11:

```
- Run run_tests after modifying code that has tests.
```

Replace with:

```
- Run run_tests after modifying code that has tests.
- After completing a related group of edits, call verify_edits with the appropriate check command (e.g. \`npx tsc --noEmit\`, \`npm test\`, \`cargo check\`). Fix all errors before finishing. Skip only when the change clearly needs no verification (e.g. docs, comments).
```

- [ ] **Step 3: Build agent package to verify**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/main/agent_node.ts packages/agent/src/main/prompt.ts
git commit -m "feat(agent): add verify_edits to AGENT_TOOLS, update system prompt"
```

---

### Task 6: Full build and test

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

Expected: all packages build successfully with no errors

- [ ] **Step 2: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass including the new verify.test.ts

- [ ] **Step 3: Smoke test the tool manually**

Start the CLI and give a task that involves editing a TypeScript file. Verify the agent calls `verify_edits` with `npx tsc --noEmit` after edits and reports any errors.

```bash
pnpm dev
```

- [ ] **Step 4: Final commit if any fixes were needed**

If any issues were found and fixed in the smoke test:

```bash
git add -p
git commit -m "fix: address issues found during verify_edits smoke test"
```
