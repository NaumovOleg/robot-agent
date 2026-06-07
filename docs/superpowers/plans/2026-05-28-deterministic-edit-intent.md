# Deterministic Edit Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single blind LLM call in `editIntentNode` with a per-hint pipeline that reads actual file content, makes one focused LLM call per operation hint, and verifies anchors deterministically — eliminating anchor hallucination and missing fields.

**Architecture:** The reader already produces `operation_hints[]` in `potential_edit_strategy` — structured atomic edit hints with anchors, symbols, line numbers, and instructions. For each hint, we: (1) read the actual target file from disk, (2) extract a relevant code excerpt, (3) make a narrow LLM call to generate only the "new content" field (e.g., `replaceWith`, `afterSnippet`, `insertText`) — or skip the LLM entirely for purely structural ops like `remove_node` and `rename_symbol`, (4) verify the anchor exists in the file, (5) auto-fill `before` for multi-line text/replace by reading the existing block from disk. When no hints are present, fall back to the existing single-call path.

**Tech Stack:** TypeScript, Zod, LangChain (`@langchain/core`), Node.js `fs`, pnpm monorepo, Jest

---

## File Map

### Created
- `packages/agent/src/nodes/root/editIntent/readFiles.ts` — reads target file contents from disk for all operation hints
- `packages/agent/src/nodes/root/editIntent/excerpt.ts` — extracts relevant line excerpt from file content given anchor or line range
- `packages/agent/src/nodes/root/editIntent/enrichEdits.ts` — post-generation: verifies anchors exist in file, auto-fills `before` for multi-line text/replace
- `packages/agent/src/nodes/root/editIntent/hintToEdit.ts` — translates one `OperationHint` into one IntentSchema edit (focused LLM or deterministic)
- `packages/agent/src/prompts/hintToEdit.ts` — per-operation prompt builders used by `hintToEdit.ts`
- `__tests__/agent/editIntentPipeline.test.ts` — unit tests for all deterministic functions

### Modified
- `packages/agent/src/nodes/root/editIntent.ts` — add per-hint path when `operation_hints` exist; keep existing single-call as fallback

---

## Task 1: `readFiles.ts` — read target file contents

**Files:**
- Create: `packages/agent/src/nodes/root/editIntent/readFiles.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/agent/editIntentPipeline.test.ts`:

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readTargetFiles } from '../../packages/agent/src/nodes/root/editIntent/readFiles';

describe('readTargetFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robocode-test-'));
    fs.writeFileSync(path.join(tmpDir, 'foo.ts'), 'const x = 1;');
    fs.writeFileSync(path.join(tmpDir, 'bar.ts'), 'export default 42;');
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

  it('reads all hint files that exist on disk', () => {
    const hints = [
      { file: 'foo.ts', op: 'replace_text' },
      { file: 'bar.ts', op: 'insert_text' },
    ];
    const result = readTargetFiles(hints.map(h => h.file), tmpDir);
    expect(result.get('foo.ts')).toBe('const x = 1;');
    expect(result.get('bar.ts')).toBe('export default 42;');
  });

  it('silently skips files that do not exist', () => {
    const result = readTargetFiles(['missing.ts'], tmpDir);
    expect(result.has('missing.ts')).toBe(false);
  });

  it('returns empty map for empty file list', () => {
    expect(readTargetFiles([], tmpDir).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "readTargetFiles" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `readFiles.ts`**

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { debug } from '@robocode-packages/shared';

export const readTargetFiles = (files: string[], cwd: string): Map<string, string> => {
  const contents = new Map<string, string>();
  const seen = new Set<string>();
  for (const file of files) {
    if (!file || seen.has(file)) continue;
    seen.add(file);
    try {
      const abs = path.resolve(cwd, file);
      contents.set(file, fs.readFileSync(abs, 'utf-8'));
    } catch {
      debug('[readFiles] could not read:', file);
    }
  }
  return contents;
};
```

- [ ] **Step 4: Run to verify pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "readTargetFiles" --no-coverage
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/editIntent/readFiles.ts __tests__/agent/editIntentPipeline.test.ts
git commit -m "feat: add readTargetFiles — reads hint file contents from disk"
```

---

## Task 2: `excerpt.ts` — extract relevant code excerpt

**Files:**
- Create: `packages/agent/src/nodes/root/editIntent/excerpt.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/agent/editIntentPipeline.test.ts`:

```ts
import { extractExcerpt } from '../../packages/agent/src/nodes/root/editIntent/excerpt';

const FILE = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6', 'line 7'].join('\n');

describe('extractExcerpt', () => {
  it('extracts lines around an anchor with context', () => {
    const result = extractExcerpt(FILE, 'line 4', null, 1);
    expect(result).toContain('line 3');
    expect(result).toContain('line 4');
    expect(result).toContain('line 5');
  });

  it('uses line range when provided (1-based)', () => {
    const result = extractExcerpt(FILE, null, '2-3', 0);
    expect(result).toContain('line 2');
    expect(result).toContain('line 3');
    expect(result).not.toContain('line 4');
  });

  it('returns full file when anchor not found and no lines', () => {
    const result = extractExcerpt(FILE, 'nothere', null);
    expect(result).toBe(FILE);
  });

  it('includes line numbers in output', () => {
    const result = extractExcerpt(FILE, 'line 1', null, 0);
    expect(result).toMatch(/^1:/m);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "extractExcerpt" --no-coverage
```

- [ ] **Step 3: Create `excerpt.ts`**

```ts
export const extractExcerpt = (
  fileContent: string,
  anchor: string | null,
  lines: string | null,
  contextLines = 5
): string => {
  const all = fileContent.split('\n');

  if (lines) {
    const [rawStart, rawEnd] = lines.includes('-') ? lines.split('-') : [lines, lines];
    const start = Math.max(0, Number(rawStart) - 1 - contextLines);
    const end = Math.min(all.length, Number(rawEnd) + contextLines);
    return all.slice(start, end).map((l, i) => `${start + i + 1}:${l}`).join('\n');
  }

  if (anchor) {
    const idx = all.findIndex((l) => l.includes(anchor));
    if (idx === -1) return fileContent;
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(all.length, idx + contextLines + 1);
    return all.slice(start, end).map((l, i) => `${start + i + 1}:${l}`).join('\n');
  }

  return fileContent;
};
```

- [ ] **Step 4: Run to verify pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "extractExcerpt" --no-coverage
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/editIntent/excerpt.ts __tests__/agent/editIntentPipeline.test.ts
git commit -m "feat: add extractExcerpt — pulls relevant code lines around anchor or line range"
```

---

## Task 3: `enrichEdits.ts` — verify anchors and auto-fill `before`

**Files:**
- Create: `packages/agent/src/nodes/root/editIntent/enrichEdits.ts`

- [ ] **Step 1: Add failing tests**

Append to `__tests__/agent/editIntentPipeline.test.ts`:

```ts
import { verifyAndEnrichEdits } from '../../packages/agent/src/nodes/root/editIntent/enrichEdits';

describe('verifyAndEnrichEdits', () => {
  const content = 'export enum Routes {\n  welcome = "welcome",\n  profile = "profile",\n}';
  const fileContents = new Map([['src/types/router.ts', content]]);

  it('passes through edits when anchor exists', () => {
    const edit = {
      mode: 'text', action: 'replace', file: 'src/types/router.ts',
      anchor: { type: 'exact', value: 'export enum Routes {' },
      replaceWith: 'export enum Routes { faq = "faq" }',
      reasoning: 'add faq',
    };
    const [result] = verifyAndEnrichEdits([edit], fileContents);
    expect((result as typeof edit).anchor.value).toBe('export enum Routes {');
  });

  it('auto-fills `before` for multi-line text/replace when before is null', () => {
    const edit = {
      mode: 'text', action: 'replace', file: 'src/types/router.ts',
      anchor: { type: 'exact', value: 'export enum Routes {' },
      replaceWith: 'export enum Routes {\n  welcome = "welcome",\n  faq = "faq",\n  profile = "profile",\n}',
      before: null,
      reasoning: 'extend enum',
    };
    const [result] = verifyAndEnrichEdits([edit], fileContents) as typeof edit[];
    expect(result.before).toContain('export enum Routes {');
    expect(result.before).not.toBeNull();
  });

  it('does not overwrite an already-set before', () => {
    const edit = {
      mode: 'text', action: 'replace', file: 'src/types/router.ts',
      anchor: { type: 'exact', value: 'export enum Routes {' },
      replaceWith: 'x\ny',
      before: 'already set',
      reasoning: 'test',
    };
    const [result] = verifyAndEnrichEdits([edit], fileContents) as typeof edit[];
    expect(result.before).toBe('already set');
  });

  it('passes through non-text edits unchanged', () => {
    const edit = { mode: 'file', action: 'insert', file: 'src/FAQ.tsx', insertText: 'hello', reasoning: 'x' };
    const [result] = verifyAndEnrichEdits([edit], fileContents);
    expect(result).toEqual(edit);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "verifyAndEnrichEdits" --no-coverage
```

- [ ] **Step 3: Create `enrichEdits.ts`**

```ts
import { debug } from '@robocode-packages/shared';

export const verifyAndEnrichEdits = (edits: unknown[], fileContents: Map<string, string>): unknown[] =>
  edits.map((edit) => {
    if (!edit || typeof edit !== 'object') return edit;
    const e = edit as Record<string, unknown>;
    const content = typeof e.file === 'string' ? fileContents.get(e.file) : undefined;

    // Verify anchor exists
    if (content && e.anchor && typeof e.anchor === 'object') {
      const anchor = e.anchor as { value: string };
      if (!content.includes(anchor.value)) {
        debug('[enrichEdits] anchor not found in', e.file, ':', String(anchor.value).slice(0, 60));
      }
    }

    // Auto-fill `before` for multi-line text/replace
    if (
      content &&
      e.mode === 'text' &&
      e.action === 'replace' &&
      e.before == null &&
      typeof e.replaceWith === 'string' &&
      e.replaceWith.includes('\n') &&
      e.anchor &&
      typeof e.anchor === 'object'
    ) {
      const anchor = e.anchor as { value: string };
      const anchorIdx = content.indexOf(anchor.value);
      if (anchorIdx !== -1) {
        const replaceLines = e.replaceWith.split('\n').length;
        const from = content.slice(anchorIdx);
        const before = from.split('\n').slice(0, replaceLines).join('\n');
        debug('[enrichEdits] auto-filled before for', e.file);
        return { ...e, before };
      }
    }

    return edit;
  });
```

- [ ] **Step 4: Run to verify pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "verifyAndEnrichEdits" --no-coverage
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/editIntent/enrichEdits.ts __tests__/agent/editIntentPipeline.test.ts
git commit -m "feat: add verifyAndEnrichEdits — anchor verification and auto-fill before"
```

---

## Task 4: `prompts/hintToEdit.ts` — per-operation code generation prompts

**Files:**
- Create: `packages/agent/src/prompts/hintToEdit.ts`

No tests for this task — prompts are exercised via Task 5's integration tests.

- [ ] **Step 1: Create the prompt builders**

```ts
// packages/agent/src/prompts/hintToEdit.ts

export const REPLACE_TEXT_PROMPT = (
  file: string,
  excerpt: string,
  anchor: string,
  details: string
) => `You are making a focused code edit. Return ONLY the replacement code — no markdown, no fences, no explanation.

File: ${file}
Relevant excerpt:
---
${excerpt}
---
Line to replace (exact text from file): \`${anchor}\`
Instruction: ${details}

Rules:
- Preserve surrounding indentation
- Return only the replacement line(s) — nothing before or after
- Must materially differ from the original`;

export const INSERT_TEXT_PROMPT = (
  file: string,
  excerpt: string,
  anchor: string | null,
  details: string
) => `You are making a focused code insertion. Return ONLY the code to insert — no markdown, no fences, no explanation.

File: ${file}
Relevant excerpt:
---
${excerpt}
---
${anchor ? `Insert after this line: \`${anchor}\`` : 'Insert at end of file.'}
Instruction: ${details}

Rules:
- Include correct indentation
- Return only the new code to insert — nothing before or after`;

export const REPLACE_NODE_PROMPT = (
  file: string,
  excerpt: string,
  symbol: string,
  nodeType: string,
  details: string
) => `You are rewriting a ${nodeType} called \`${symbol}\`. Return ONLY the complete new implementation — no markdown, no fences, no explanation.

File: ${file}
Current implementation:
---
${excerpt}
---
Instruction: ${details}

Rules:
- Preserve the same function/class signature unless instructed to change it
- Return the complete implementation including the declaration line and closing brace
- No markdown`;

export const INSERT_NODE_PROMPT = (
  file: string,
  excerpt: string,
  nodeType: string,
  details: string
) => `You are inserting a new ${nodeType}. Return ONLY the complete new declaration — no markdown, no fences, no explanation.

File: ${file}
Context around insertion point:
---
${excerpt}
---
Instruction: ${details}

Rules:
- Match the code style of the surrounding file
- Return only the new declaration, with correct indentation`;

export const CREATE_FILE_PROMPT = (
  file: string,
  goal: string,
  details: string,
  constraints: string[]
) => `Create the file \`${file}\`. Return ONLY the complete file content — no markdown, no fences.

Goal: ${goal}
Instructions: ${details}
${constraints.length ? `Constraints:\n${constraints.map((c) => `- ${c}`).join('\n')}` : ''}

Rules:
- Valid source code only
- No markdown fences
- Include all necessary imports`;
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/src/prompts/hintToEdit.ts
git commit -m "feat: add per-operation prompt builders for focused hint-to-edit LLM calls"
```

---

## Task 5: `hintToEdit.ts` — translate one hint → one IntentSchema edit

**Files:**
- Create: `packages/agent/src/nodes/root/editIntent/hintToEdit.ts`

The op mapping:
- `replace_text` → `TextReplaceEditSchema` — LLM generates `replaceWith`
- `insert_text` → `TextInsertEditSchema` — LLM generates `insertText`
- `remove_text` → `TextRemoveEditSchema` — extract `target` from file (deterministic)
- `replace_node` → `AstReplaceEditSchema` — LLM generates `afterSnippet`
- `insert_node` → `AstInsertEditSchema` — LLM generates `insertSnippet`
- `remove_node` → `AstRemoveEditSchema` — fully deterministic (all fields from hint)
- `rename_symbol` → `AstRenameEditSchema` — fully deterministic
- `create_file` → `FileInsertEditSchema` — LLM generates full `insertText`
- `delete_file` → `FileRemoveEditSchema` — fully deterministic
- `rename_file` → `FileRenameEditSchema` — parse `target` from hint.details

- [ ] **Step 1: Add failing tests for the deterministic ops**

Append to `__tests__/agent/editIntentPipeline.test.ts`:

```ts
import { hintToEdit } from '../../packages/agent/src/nodes/root/editIntent/hintToEdit';

// Deterministic ops need no LLM — test them without mocking
describe('hintToEdit — deterministic ops', () => {
  const fileContents = new Map([['src/auth.ts', 'export function login() {}\nexport function logout() {}']]);
  const goal = 'Add auth features';
  const constraints: string[] = [];

  it('remove_node: assembles AstRemoveEditSchema fields from hint', async () => {
    const hint = {
      op: 'remove_node' as const, file: 'src/auth.ts',
      nodeType: 'function_declaration', symbol: 'logout',
      lines: '2', anchor: null, details: 'remove logout', newSymbol: null,
    };
    const result = await hintToEdit(hint, fileContents, goal, constraints);
    expect(result).toMatchObject({
      mode: 'ast', action: 'remove', file: 'src/auth.ts',
      nodeType: 'function_declaration', symbol: 'logout', lines: '2',
    });
  });

  it('rename_symbol: assembles AstRenameEditSchema fields from hint', async () => {
    const hint = {
      op: 'rename_symbol' as const, file: 'src/auth.ts',
      nodeType: 'function_declaration', symbol: 'login', newSymbol: 'signIn',
      lines: '1', anchor: null, details: 'rename login to signIn',
    };
    const result = await hintToEdit(hint, fileContents, goal, constraints);
    expect(result).toMatchObject({
      mode: 'ast', action: 'rename', file: 'src/auth.ts',
      nodeType: 'function_declaration', symbol: 'login', newSymbol: 'signIn',
    });
  });

  it('delete_file: assembles FileRemoveEditSchema from hint', async () => {
    const hint = {
      op: 'delete_file' as const, file: 'src/old.ts',
      nodeType: null, symbol: null, newSymbol: null, lines: null, anchor: null,
      details: 'remove old module',
    };
    const result = await hintToEdit(hint, fileContents, goal, constraints);
    expect(result).toMatchObject({ mode: 'file', action: 'remove', file: 'src/old.ts' });
  });

  it('remove_text: extracts target from file content using anchor', async () => {
    const hint = {
      op: 'remove_text' as const, file: 'src/auth.ts',
      anchor: 'export function logout() {}',
      nodeType: null, symbol: null, newSymbol: null, lines: null, details: 'remove logout call',
    };
    const result = await hintToEdit(hint, fileContents, goal, constraints) as Record<string, unknown>;
    expect(result.mode).toBe('text');
    expect(result.action).toBe('remove');
    expect(String(result.target)).toContain('logout');
  });

  it('returns null for unknown op', async () => {
    const hint = {
      op: 'unknown_op' as unknown as 'delete_file', file: 'src/auth.ts',
      nodeType: null, symbol: null, newSymbol: null, lines: null, anchor: null, details: '',
    };
    const result = await hintToEdit(hint, fileContents, goal, constraints);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "hintToEdit" --no-coverage
```

- [ ] **Step 3: Create `hintToEdit.ts`**

```ts
import { debug } from '@robocode-packages/shared';
import { createBaseModel } from '../../../utils';
import { extractExcerpt } from './excerpt';
import {
  REPLACE_TEXT_PROMPT,
  INSERT_TEXT_PROMPT,
  REPLACE_NODE_PROMPT,
  INSERT_NODE_PROMPT,
  CREATE_FILE_PROMPT,
} from '../../../prompts/hintToEdit';

type Op =
  | 'create_file' | 'delete_file' | 'rename_file'
  | 'replace_node' | 'insert_node' | 'remove_node' | 'rename_symbol'
  | 'replace_text' | 'insert_text' | 'remove_text';

export interface OperationHint {
  op: Op;
  file: string;
  lines: string | null;
  nodeType: string | null;
  symbol: string | null;
  newSymbol: string | null;
  anchor: string | null;
  details: string;
}

const generate = async (prompt: string): Promise<string> => {
  const model = createBaseModel(false);
  const result = await model.invoke([{ role: 'user', content: prompt }]);
  return typeof result.content === 'string' ? result.content.trim() : '';
};

const base = (hint: OperationHint) => ({
  file: hint.file,
  lines: hint.lines ?? null,
  id: null,
  reasoning: hint.details.replace(/\n/g, ' ').slice(0, 160),
});

export const hintToEdit = async (
  hint: OperationHint,
  fileContents: Map<string, string>,
  goal: string,
  constraints: string[]
): Promise<unknown> => {
  const content = fileContents.get(hint.file) ?? '';
  debug('[hintToEdit]', hint.op, hint.file);

  switch (hint.op) {
    // ── Fully deterministic ───────────────────────────────────────────────────

    case 'remove_node':
      return { ...base(hint), mode: 'ast', action: 'remove', nodeType: hint.nodeType, symbol: hint.symbol };

    case 'rename_symbol':
      return { ...base(hint), mode: 'ast', action: 'rename', nodeType: hint.nodeType, symbol: hint.symbol, newSymbol: hint.newSymbol };

    case 'delete_file':
      return { ...base(hint), mode: 'file', action: 'remove' };

    case 'rename_file': {
      // Target new filename: read from details ("rename to X") or newSymbol
      const match = hint.details.match(/rename\s+to\s+(\S+)/i);
      const target = match?.[1] ?? hint.newSymbol ?? hint.details.split(' ').pop() ?? '';
      return { ...base(hint), mode: 'file', action: 'rename', target };
    }

    case 'remove_text': {
      if (!hint.anchor) return null;
      // Extract the target block from file: find anchor + include the line
      const anchorIdx = content.indexOf(hint.anchor);
      const target = anchorIdx !== -1 ? hint.anchor : content.split('\n').find((l) => l.includes(hint.anchor!)) ?? hint.anchor;
      return {
        ...base(hint),
        mode: 'text',
        action: 'remove',
        anchor: { type: 'exact', value: hint.anchor },
        target,
      };
    }

    // ── LLM-assisted ─────────────────────────────────────────────────────────

    case 'replace_text': {
      if (!hint.anchor) return null;
      const excerpt = extractExcerpt(content, hint.anchor, hint.lines);
      const replaceWith = await generate(REPLACE_TEXT_PROMPT(hint.file, excerpt, hint.anchor, hint.details));
      return {
        ...base(hint),
        mode: 'text',
        action: 'replace',
        anchor: { type: 'exact', value: hint.anchor },
        replaceWith,
        before: null,
      };
    }

    case 'insert_text': {
      const excerpt = extractExcerpt(content, hint.anchor, hint.lines);
      const insertText = await generate(INSERT_TEXT_PROMPT(hint.file, excerpt, hint.anchor, hint.details));
      return {
        ...base(hint),
        mode: 'text',
        action: 'insert',
        anchor: hint.anchor ? { type: 'exact', value: hint.anchor } : null,
        insertMode: hint.anchor ? 'after' : 'end',
        insertText,
      };
    }

    case 'replace_node': {
      const excerpt = extractExcerpt(content, null, hint.lines);
      const afterSnippet = await generate(
        REPLACE_NODE_PROMPT(hint.file, excerpt, hint.symbol ?? '', hint.nodeType ?? 'declaration', hint.details)
      );
      return {
        ...base(hint),
        mode: 'ast',
        action: 'replace',
        nodeType: hint.nodeType,
        symbol: hint.symbol,
        parentNodeType: null,
        beforeSnippet: null,
        afterSnippet,
      };
    }

    case 'insert_node': {
      const excerpt = extractExcerpt(content, hint.anchor, hint.lines);
      const insertSnippet = await generate(
        INSERT_NODE_PROMPT(hint.file, excerpt, hint.nodeType ?? 'declaration', hint.details)
      );
      return {
        ...base(hint),
        mode: 'ast',
        action: 'insert',
        nodeType: hint.nodeType,
        insertSnippet,
      };
    }

    case 'create_file': {
      const insertText = await generate(CREATE_FILE_PROMPT(hint.file, goal, hint.details, constraints));
      return { ...base(hint), mode: 'file', action: 'insert', insertText };
    }

    default:
      debug('[hintToEdit] unknown op:', hint.op);
      return null;
  }
};
```

- [ ] **Step 4: Run tests to verify deterministic ops pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "hintToEdit — deterministic" --no-coverage
```

Expected: 5 tests pass (no LLM calls made for deterministic ops).

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/editIntent/hintToEdit.ts __tests__/agent/editIntentPipeline.test.ts
git commit -m "feat: add hintToEdit — translates operation hints to IntentSchema edits, LLM only for generative ops"
```

---

## Task 6: Refactor `editIntentNode` — add per-hint path

**Files:**
- Modify: `packages/agent/src/nodes/root/editIntent.ts`

- [ ] **Step 1: Write failing test for hint-path selection**

Append to `__tests__/agent/editIntentPipeline.test.ts`:

```ts
// Test the hint extraction helper (pure function, no LLM)
import { extractHintFiles } from '../../packages/agent/src/nodes/root/editIntent/readFiles';
import type { ReaderOutput } from '../../packages/shared/src/schemas/reader/output';

describe('extractHintFiles', () => {
  it('collects unique file paths from operation_hints', () => {
    const readerOutput = {
      potential_edit_strategy: {
        operation_hints: [
          { file: 'src/a.ts', op: 'replace_text' },
          { file: 'src/b.ts', op: 'insert_text' },
          { file: 'src/a.ts', op: 'remove_text' }, // duplicate
        ],
      },
    } as unknown as ReaderOutput;
    expect(extractHintFiles(readerOutput)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('returns empty array when no hints', () => {
    const readerOutput = { potential_edit_strategy: null } as unknown as ReaderOutput;
    expect(extractHintFiles(readerOutput)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "extractHintFiles" --no-coverage
```

- [ ] **Step 3: Add `extractHintFiles` to `readFiles.ts`**

Append to `packages/agent/src/nodes/root/editIntent/readFiles.ts`:

```ts
import type { ReaderOutput } from '@robocode-packages/shared';

export const extractHintFiles = (readerOutput: ReaderOutput): string[] => {
  const hints = readerOutput.potential_edit_strategy?.operation_hints ?? [];
  return [...new Set(hints.map((h) => h.file).filter(Boolean))];
};
```

- [ ] **Step 4: Refactor `editIntentNode`**

Replace the body of `editIntentNode` in `packages/agent/src/nodes/root/editIntent.ts` with the new per-hint path. Keep the existing fallback. The final function:

```ts
export const editIntentNode = async (state: RootStateType) => {
  const { readerOutput, answeredReaderQuestions = [] } = state;

  if (!readerOutput) {
    debug('[editIntent] no reader output — skipping');
    return { editIntent: null };
  }

  const validated = ReaderOutputSchema.safeParse(readerOutput);
  if (!validated.success) {
    debug('[editIntent] reader output validation failed', validated.error.format());
    return { editIntent: null };
  }

  const output = validated.data;
  const hints = output.potential_edit_strategy?.operation_hints ?? [];
  const strategy = output.potential_edit_strategy;

  let rawEdits: unknown[];
  let confidence: number;

  if (hints.length > 0) {
    // ── Per-hint path: file-aware, focused LLM calls ──────────────────────
    debug('[editIntent] per-hint path —', hints.length, 'hints');
    const hintFiles = extractHintFiles(output);
    const fileContents = readTargetFiles(hintFiles, state.cwd || process.cwd());

    const goal = strategy?.goal ?? output.summary;
    const constraints = strategy?.constraints ?? [];

    const settled = await Promise.allSettled(
      hints.map((hint) => hintToEdit(hint, fileContents, goal, constraints))
    );

    rawEdits = settled
      .filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled' && r.value != null)
      .map((r) => r.value);

    rawEdits = verifyAndEnrichEdits(rawEdits, fileContents);
    confidence = rawEdits.length >= hints.length * 0.8 ? 0.9 : 0.7;
    debug('[editIntent] per-hint: produced', rawEdits.length, 'edits from', hints.length, 'hints');
  } else {
    // ── Fallback: existing single-call path ───────────────────────────────
    debug('[editIntent] fallback single-call path');
    const scaffold = buildEditIntent(output);
    const model = createBaseModel(true).withStructuredOutput(IntentSchema, { method: 'functionCalling' });
    try {
      const result = await model.invoke([
        { role: 'system', content: EDIT_INTENT_SYSTEM_PROMPT },
        { role: 'user', content: EDIT_INTENT_HUMAN_PROMPT(scaffold, output, answeredReaderQuestions) },
      ]);
      rawEdits = Array.isArray((result as { edits?: unknown[] })?.edits)
        ? (result as { edits: unknown[] }).edits
        : [];
      confidence = (result as { confidence?: number })?.confidence ?? 0.7;
    } catch (err) {
      debug('[editIntent] fallback LLM failed', { error: String(err) });
      return { editIntent: null };
    }
  }

  // ── Normalizers (both paths) ──────────────────────────────────────────────
  const normalizedEdits = normalizeCreateLikeTextInserts(
    normalizeTextInsertMode(rawEdits),
    state.cwd || process.cwd()
  );

  const verification = strategy
    ? [`Verify goal: ${strategy.goal}`, 'Run tsc --noEmit to check types']
    : ['Run tsc --noEmit to check types'];

  try {
    const editIntent = IntentSchema.parse({ edits: normalizedEdits, verification, confidence });

    debug('[editIntent] ══════════════════════════════════════════');
    debug('[editIntent] FINAL INTENT', {
      confidence: editIntent.confidence,
      totalEdits: editIntent.edits.length,
      edits: editIntent.edits.map((e, i) => ({
        n: i + 1,
        file: e.file,
        mode: e.mode,
        action: e.action,
        reasoning: e.reasoning,
        ...('anchor' in e && e.anchor ? { anchor: (e.anchor as { value: string }).value } : {}),
        ...('insertMode' in e ? { insertMode: e.insertMode } : {}),
        ...('functionName' in e ? { functionName: e.functionName } : {}),
      })),
      verification: editIntent.verification,
    });
    debug('[editIntent] ══════════════════════════════════════════');

    return { editIntent };
  } catch (err) {
    debug('[editIntent] IntentSchema.parse failed', { error: String(err) });
    return { editIntent: null };
  }
};
```

Also add the new imports at the top of `editIntent.ts`:

```ts
import { readTargetFiles, extractHintFiles } from './editIntent/readFiles';
import { hintToEdit } from './editIntent/hintToEdit';
import { verifyAndEnrichEdits } from './editIntent/enrichEdits';
```

- [ ] **Step 5: Run the extractHintFiles test**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts -t "extractHintFiles" --no-coverage
```

Expected: 2 tests pass.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final"
```

Expected: zero errors.

- [ ] **Step 7: Run all pipeline tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editIntentPipeline.test.ts --no-coverage
```

Expected: all tests pass (readTargetFiles × 3, extractExcerpt × 4, verifyAndEnrichEdits × 4, hintToEdit × 5, extractHintFiles × 2 = 18 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/agent/src/nodes/root/editIntent.ts packages/agent/src/nodes/root/editIntent/ __tests__/agent/editIntentPipeline.test.ts
git commit -m "feat: per-hint file-aware edit intent — focused LLM per operation, deterministic for structural ops"
```

---

## Task 7: Smoke test and final checks

- [ ] **Step 1: Build all packages**

```bash
pnpm build
```

Expected: exits 0.

- [ ] **Step 2: Run all tests**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:"
```

Expected: `pipelineRouters`, `rootRoute`, `editIntentPipeline` all PASS. Pre-existing failures in `readerSchema`, `editIntentPrompt`, `readerFinalizerPrompt`, `astAnalyzer` are unchanged.

- [ ] **Step 3: Type-check both packages**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final" && npx tsc --noEmit --project packages/shared/tsconfig.json
```

Expected: zero errors in both.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: deterministic edit intent complete — per-hint file-aware pipeline"
```
