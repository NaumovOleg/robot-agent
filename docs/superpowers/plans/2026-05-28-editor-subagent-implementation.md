# Editor Subagent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the editor subagent so `IntentSchema` edits produced by `editIntentNode` are applied deterministically to the codebase, with tree-sitter AST resolution, risk-based diff-preview approval, LLM error recovery, and a `/approve` auto-approve toggle.

**Architecture:** `editIntentNode` → new `delegateWriterNode` (root graph) kicks off `writerAgent.run(editIntent)`. The editor subagent loops through `editIntent.edits[]` one at a time: each edit is translated to an `edit_file` / `patch_file` / `write_file` tool call, gated by a risk check (interrupt for destructive edits unless `autoApprove`), executed, and either advanced or sent to LLM recovery on failure. Frontend diff-preview and `/approve` toggle reuse existing `PendingTool` + `DiffView` components.

**Tech Stack:** TypeScript, Zod, LangGraph (`@langchain/langgraph`), tree-sitter (`web-tree-sitter`), Ink/React, pnpm monorepo, Jest

---

## File Map

### Created
- `packages/tools/src/utils/astEdit.ts` — `resolveAstEdit(edit, filePath, fileContent)` → `{oldStr, newStr}` via tree-sitter
- `packages/tools/src/tools/editor/deleteFile.ts` — `delete_file` tool
- `packages/tools/src/tools/editor/renameFile.ts` — `rename_file` tool
- `packages/agent/src/nodes/root/delegateWriter.ts` — root graph node that starts the editor
- `packages/agent/src/nodes/sub/editor/executeEdit.ts` — maps `edits[editIndex]` → synthetic AIMessage with tool call
- `packages/agent/src/nodes/sub/editor/checkResult.ts` — inspects tool result, sets `currentEditStatus`
- `packages/agent/src/nodes/sub/editor/advance.ts` — appends to `editResults`, increments `editIndex`, routes
- `packages/agent/src/nodes/sub/editor/llmRecovery.ts` — focused LLM prompt for one retry
- `__tests__/agent/editorExecution.test.ts` — unit tests for `resolveAstEdit`, edit-to-tool mapping, advance logic

### Modified
- `packages/tools/src/utils/index.ts` — export `astEdit`
- `packages/tools/src/tools/editor/index.ts` — export new tools, update `EDITOR_TOOLS_SET`
- `packages/shared/src/types/agent.ts` — add `delete_file`, `rename_file` to `TOOL_NAMES`
- `packages/config/src/agent.ts` — add `delete_file: 'destructive'`, `rename_file: 'moderate'` to `TOOL_RISK`
- `packages/shared/src/schemas/editor/request.ts` — replace old `WriterContext` fields with `editIntent`, `autoApprove`
- `packages/shared/src/types/event.ts` — add `agent:editor_complete`, add `source` to `agent:tool_pending`
- `packages/agent/src/main/subagents/editor/state.ts` — replace old fields; add `editIntent`, `editIndex`, `editResults`, `autoApprove`, `currentEditStatus`
- `packages/agent/src/main/subagents/editor/graph.ts` — new graph topology with execute loop
- `packages/agent/src/nodes/sub/editor/approval.ts` — respect pre-set `toolApproved`; add `source: 'editor'` to event; route to `advance` on rejection
- `packages/agent/src/nodes/sub/editor/initialize.ts` — read `editIntent` for system prompt
- `packages/agent/src/nodes/sub/editor/final.ts` — use `editResults` for structured summary; emit `agent:editor_complete`
- `packages/agent/src/nodes/sub/editor/index.ts` — export new nodes
- `packages/agent/src/main/root/state.ts` — add `autoApprove: boolean`
- `packages/agent/src/main/root/graph.ts` — add `delegate_writer` node, change `edit_intent → delegate_writer → END`
- `apps/cli/src/screens/chat/Chat.tsx` — `/approve` command, listen `agent:editor_complete`, fix `confirmTool` to emit `agent:resume:editor`
- `apps/cli/src/screens/chat/components/PendingTool.tsx` — add `delete_file` / `rename_file` display

---

## Task 1: `resolveAstEdit` — tree-sitter AST node → text

**Files:**
- Create: `packages/tools/src/utils/astEdit.ts`
- Modify: `packages/tools/src/utils/index.ts`
- Test: `__tests__/agent/editorExecution.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/agent/editorExecution.test.ts`:

```ts
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveAstEdit } from '../../packages/tools/src/utils/astEdit';

const ROUTER_TS = `export type Route = 'welcome' | 'profile';
export enum Routes {
  welcome = 'welcome',
  profile = 'profile',
}

export interface RouterState {
  route: Route;
  navigate: (route: Route) => void;
}
`;

describe('resolveAstEdit', () => {
  let tmpDir: string;
  let routerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robocode-ast-'));
    routerPath = path.join(tmpDir, 'router.ts');
    fs.writeFileSync(routerPath, ROUTER_TS, 'utf-8');
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true }));

  it('resolves ast/replace for enum_declaration', async () => {
    const edit = {
      mode: 'ast', action: 'replace',
      nodeType: 'enum_declaration', symbol: 'Routes',
      afterSnippet: "export enum Routes {\n  welcome = 'welcome',\n  profile = 'profile',\n  faq = 'faq',\n}",
      lines: null,
    };
    const result = await resolveAstEdit(edit, routerPath, ROUTER_TS);
    expect(result.oldStr).toContain("enum Routes {");
    expect(result.oldStr).toContain("welcome = 'welcome'");
    expect(result.newStr).toBe(edit.afterSnippet);
  });

  it('resolves ast/replace for type_alias_declaration', async () => {
    const edit = {
      mode: 'ast', action: 'replace',
      nodeType: 'type_alias_declaration', symbol: 'Route',
      afterSnippet: "export type Route = 'welcome' | 'profile' | 'faq';",
      lines: null,
    };
    const result = await resolveAstEdit(edit, routerPath, ROUTER_TS);
    expect(result.oldStr).toContain("type Route =");
    expect(result.newStr).toContain("'faq'");
  });

  it('resolves ast/remove for enum_declaration', async () => {
    const edit = {
      mode: 'ast', action: 'remove',
      nodeType: 'enum_declaration', symbol: 'Routes',
      afterSnippet: null, lines: null,
    };
    const result = await resolveAstEdit(edit, routerPath, ROUTER_TS);
    expect(result.oldStr).toContain("enum Routes {");
    expect(result.newStr).toBe('');
  });

  it('throws when symbol not found', async () => {
    const edit = {
      mode: 'ast', action: 'replace',
      nodeType: 'enum_declaration', symbol: 'NonExistent',
      afterSnippet: 'x', lines: null,
    };
    await expect(resolveAstEdit(edit, routerPath, ROUTER_TS)).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "resolveAstEdit" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/tools/src/utils/astEdit.ts`**

```ts
import { createAstParser } from '@robocode-packages/shared';
import type { SyntaxNode } from 'web-tree-sitter';

export interface AstEditResolution {
  oldStr: string;
  newStr: string;
}

const findNodeBySymbol = (
  root: SyntaxNode,
  nodeType: string,
  symbol: string
): SyntaxNode | null => {
  const walk = (node: SyntaxNode): SyntaxNode | null => {
    // Match: node type matches AND name field equals symbol
    if (node.type === nodeType) {
      const nameNode = node.childForFieldName('name');
      if (nameNode?.text === symbol) return node;
    }

    // For lexical_declaration (const/let) when nodeType is 'variable_declaration'
    if (
      nodeType === 'variable_declaration' &&
      (node.type === 'lexical_declaration' || node.type === 'variable_declaration')
    ) {
      for (const child of node.children) {
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          if (nameNode?.text === symbol) return node;
        }
      }
    }

    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };

  return walk(root);
};

export const resolveAstEdit = async (
  edit: {
    mode: string;
    action: string;
    nodeType: string | null;
    symbol: string | null;
    newSymbol?: string | null;
    afterSnippet?: string | null;
    insertSnippet?: string | null;
    lines?: string | null;
  },
  filePath: string,
  fileContent: string
): Promise<AstEditResolution> => {
  const { nodeType, symbol, action } = edit;
  if (!nodeType || !symbol) {
    throw new Error(`resolveAstEdit: nodeType and symbol are required`);
  }

  const { parser } = await createAstParser(filePath);
  const tree = parser.parse(fileContent);

  const node = findNodeBySymbol(tree.rootNode, nodeType, symbol);
  if (!node) {
    throw new Error(
      `resolveAstEdit: symbol "${symbol}" of type "${nodeType}" not found in ${filePath}`
    );
  }

  const oldStr = fileContent.slice(node.startIndex, node.endIndex);

  if (action === 'remove') {
    // Also strip a trailing newline so we don't leave a blank line
    const afterEnd = fileContent[node.endIndex] === '\n' ? node.endIndex + 1 : node.endIndex;
    return { oldStr: fileContent.slice(node.startIndex, afterEnd), newStr: '' };
  }

  if (action === 'replace') {
    const newStr = edit.afterSnippet ?? '';
    if (!newStr) throw new Error(`resolveAstEdit: afterSnippet required for ast/replace`);
    return { oldStr, newStr };
  }

  if (action === 'rename') {
    if (!edit.newSymbol) throw new Error(`resolveAstEdit: newSymbol required for ast/rename`);
    // Whole-word replace all occurrences of symbol in file
    const regex = new RegExp(`\\b${symbol}\\b`, 'g');
    const newStr = fileContent.replace(regex, edit.newSymbol);
    // Return the full file replacement — caller uses write_file
    return { oldStr: fileContent, newStr };
  }

  if (action === 'insert') {
    // Insert insertSnippet after the found node
    const insertSnippet = edit.insertSnippet ?? '';
    if (!insertSnippet) throw new Error(`resolveAstEdit: insertSnippet required for ast/insert`);
    const anchorLine = oldStr.split('\n')[0] ?? oldStr;
    return { oldStr: anchorLine, newStr: anchorLine + '\n' + insertSnippet };
  }

  throw new Error(`resolveAstEdit: unsupported action "${action}"`);
};
```

- [ ] **Step 4: Export from `packages/tools/src/utils/index.ts`**

Append to the existing exports:

```ts
export * from './astEdit';
```

- [ ] **Step 5: Run to verify pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "resolveAstEdit" --no-coverage
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/tools/src/utils/astEdit.ts packages/tools/src/utils/index.ts __tests__/agent/editorExecution.test.ts
git commit -m "feat: add resolveAstEdit — tree-sitter node lookup for ast edit resolution"
```

---

## Task 2: `delete_file` + `rename_file` tools

**Files:**
- Create: `packages/tools/src/tools/editor/deleteFile.ts`
- Create: `packages/tools/src/tools/editor/renameFile.ts`
- Modify: `packages/tools/src/tools/editor/index.ts`
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/config/src/agent.ts`

- [ ] **Step 1: Create `packages/tools/src/tools/editor/deleteFile.ts`**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ContextService } from '@robocode-packages/core';

export const deleteFileTool = tool(
  async ({ path: filePath }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const targetPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    try {
      fs.unlinkSync(targetPath);
      ContextService.invalidateAfterWrite(targetPath);
      return `Deleted: ${targetPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the filesystem.',
    schema: z.object({
      path: z.string().describe('Path to the file to delete'),
    }),
  }
);
```

- [ ] **Step 2: Create `packages/tools/src/tools/editor/renameFile.ts`**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunnableConfig } from '@langchain/core/runnables';
import { ContextService } from '@robocode-packages/core';

export const renameFileTool = tool(
  async ({ from, to }, config?: RunnableConfig) => {
    const cwd = (config?.configurable?.cwd as string) ?? process.cwd();
    const srcPath = path.isAbsolute(from) ? from : path.resolve(cwd, from);
    const dstPath = path.isAbsolute(to) ? to : path.resolve(cwd, to);
    try {
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.renameSync(srcPath, dstPath);
      ContextService.invalidateAfterWrite(srcPath);
      ContextService.invalidateAfterWrite(dstPath);
      return `Renamed: ${srcPath} → ${dstPath}`;
    } catch (err: unknown) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file.',
    schema: z.object({
      from: z.string().describe('Source file path'),
      to: z.string().describe('Destination file path'),
    }),
  }
);
```

- [ ] **Step 3: Update `packages/tools/src/tools/editor/index.ts`**

Replace the full file:

```ts
export * from './editFile';
export * from './patchFile';
export * from './writeFile';
export * from './deleteFile';
export * from './renameFile';
import { editFileTool } from './editFile';
import { patchFileTool } from './patchFile';
import { writeFileTool } from './writeFile';
import { deleteFileTool } from './deleteFile';
import { renameFileTool } from './renameFile';

export const EDITOR_TOOLS_SET = [editFileTool, patchFileTool, writeFileTool, deleteFileTool, renameFileTool];
export const EDIT_FILE_TOOLS = EDITOR_TOOLS_SET;
```

- [ ] **Step 4: Add to `TOOL_NAMES` enum in `packages/shared/src/types/agent.ts`**

Add two lines inside the `TOOL_NAMES` enum:

```ts
  delete_file = 'delete_file',
  rename_file = 'rename_file',
```

- [ ] **Step 5: Add to `TOOL_RISK` in `packages/config/src/agent.ts`**

Add two entries inside `TOOL_RISK`:

```ts
  delete_file: 'destructive',
  rename_file: 'moderate',
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit --project packages/tools/tsconfig.json 2>&1 | head -20
npx tsc --noEmit --project packages/shared/tsconfig.json 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/tools/src/tools/editor/deleteFile.ts packages/tools/src/tools/editor/renameFile.ts packages/tools/src/tools/editor/index.ts packages/shared/src/types/agent.ts packages/config/src/agent.ts
git commit -m "feat: add delete_file and rename_file tools; register in TOOL_NAMES and TOOL_RISK"
```

---

## Task 3: Update `EditorRequestSchema` + `EditorState` + `RootState.autoApprove`

**Files:**
- Modify: `packages/shared/src/schemas/editor/request.ts`
- Modify: `packages/agent/src/main/subagents/editor/state.ts`
- Modify: `packages/agent/src/main/root/state.ts`

- [ ] **Step 1: Replace `packages/shared/src/schemas/editor/request.ts`**

```ts
import { z } from 'zod';
import { IntentSchema } from './intent';

export const EditorRequestSchema = z.object({
  editIntent: IntentSchema.describe('Structured edit plan produced by editIntentNode.'),
  sessionId: z.string().describe('Active session ID.'),
  cwd: z.string().describe('Working directory for resolving relative file paths.'),
  autoApprove: z
    .boolean()
    .default(false)
    .describe('When true, skip approval interrupts for all edits including destructive ones.'),
});
```

- [ ] **Step 2: Replace `packages/agent/src/main/subagents/editor/state.ts`**

```ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { PendingToolCall, IntentSchemaType } from '@robocode-packages/shared';

export type EditStatus = 'applied' | 'recovered' | 'skipped' | 'failed';

export interface EditResult {
  editIndex: number;
  file: string;
  mode: string;
  action: string;
  status: EditStatus;
  diff?: string;
  error?: string;
}

export const EditorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  cwd: Annotation<string>({ reducer: (_, n) => n, default: () => '' }),
  editIntent: Annotation<IntentSchemaType | null>({ reducer: (_, n) => n, default: () => null }),
  editIndex: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  editResults: Annotation<EditResult[]>({
    reducer: (prev, next) => next,
    default: () => [],
  }),
  autoApprove: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  pendingToolCall: Annotation<PendingToolCall | null>({ reducer: (_, n) => n, default: () => null }),
  toolApproved: Annotation<boolean | null>({ reducer: (_, n) => n, default: () => null }),
  currentEditStatus: Annotation<EditStatus | null>({ reducer: (_, n) => n, default: () => null }),
  turnCount: Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  maxTurns: Annotation<number>({ reducer: (_, n) => n, default: () => 30 }),
  isRecoveryAttempt: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
});

export type EditorStateType = typeof EditorState.State;
```

- [ ] **Step 3: Add `autoApprove` to `packages/agent/src/main/root/state.ts`**

Add after the `editIntent` annotation:

```ts
  autoApprove: Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
```

- [ ] **Step 4: Type-check shared + agent**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json 2>&1 | head -10
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/editor/request.ts packages/agent/src/main/subagents/editor/state.ts packages/agent/src/main/root/state.ts
git commit -m "feat: update EditorRequestSchema and EditorState to consume IntentSchema; add autoApprove to RootState"
```

---

## Task 4: `executeEditNode` — deterministic edit → tool call

**Files:**
- Create: `packages/agent/src/nodes/sub/editor/executeEdit.ts`
- Test: `__tests__/agent/editorExecution.test.ts` (append)

- [ ] **Step 1: Add failing tests**

Append to `__tests__/agent/editorExecution.test.ts`:

```ts
import { buildEditToolCall } from '../../packages/agent/src/nodes/sub/editor/executeEdit';

describe('buildEditToolCall', () => {
  const cwd = '/project';

  it('text/replace → edit_file with before as old_str', () => {
    const edit = {
      mode: 'text', action: 'replace', file: 'src/a.ts', lines: null, id: null,
      anchor: { type: 'exact', value: 'export enum Routes {', match: 'unique', occurrence: 1 },
      before: "export enum Routes {\n  a = 'a',\n}",
      replaceWith: "export enum Routes {\n  a = 'a',\n  b = 'b',\n}",
      reasoning: 'add b',
    };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('edit_file');
    expect(args.old_str).toBe(edit.before);
    expect(args.new_str).toBe(edit.replaceWith);
    expect(args.path).toBe('/project/src/a.ts');
  });

  it('text/replace without before → old_str is anchor.value', () => {
    const edit = {
      mode: 'text', action: 'replace', file: 'src/a.ts', lines: null, id: null,
      anchor: { type: 'exact', value: 'const x = 1;', match: 'unique', occurrence: 1 },
      before: null,
      replaceWith: 'const x = 2;',
      reasoning: 'update x',
    };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('edit_file');
    expect(args.old_str).toBe('const x = 1;');
  });

  it('text/insert after → edit_file inserts after anchor', () => {
    const edit = {
      mode: 'text', action: 'insert', file: 'src/a.ts', lines: null, id: null,
      anchor: { type: 'exact', value: "export * from './chat';", match: 'unique', occurrence: 1 },
      insertMode: 'after',
      insertText: "export * from './faq';",
      reasoning: 'add faq export',
    };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('edit_file');
    expect(args.old_str).toBe("export * from './chat';");
    expect(args.new_str).toBe("export * from './chat';\nexport * from './faq';");
  });

  it('file/insert → write_file', () => {
    const edit = {
      mode: 'file', action: 'insert', file: 'src/Faq.tsx', lines: null, id: null,
      insertText: 'export const Faq = () => null;',
      reasoning: 'create faq',
    };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('write_file');
    expect(args.content).toBe(edit.insertText);
  });

  it('file/remove → delete_file', () => {
    const edit = { mode: 'file', action: 'remove', file: 'src/old.ts', lines: null, id: null, reasoning: 'remove' };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('delete_file');
    expect(args.path).toBe('/project/src/old.ts');
  });

  it('file/rename → rename_file', () => {
    const edit = { mode: 'file', action: 'rename', file: 'src/old.ts', target: 'src/new.ts', lines: null, id: null, reasoning: 'rename' };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('rename_file');
    expect(args.from).toBe('/project/src/old.ts');
    expect(args.to).toBe('/project/src/new.ts');
  });

  it('text/remove → edit_file old_str=target new_str=""', () => {
    const edit = {
      mode: 'text', action: 'remove', file: 'src/a.ts', lines: null, id: null,
      anchor: { type: 'exact', value: 'const x = 1;', match: 'unique', occurrence: 1 },
      target: 'const x = 1;',
      reasoning: 'remove x',
    };
    const { name, args } = buildEditToolCall(edit, cwd, new Map());
    expect(name).toBe('edit_file');
    expect(args.old_str).toBe('const x = 1;');
    expect(args.new_str).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "buildEditToolCall" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/agent/src/nodes/sub/editor/executeEdit.ts`**

```ts
import * as path from 'node:path';
import { AIMessage } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { TOOL_RISK, formatToolDescription, resolveAstEdit } from '@robocode-packages/tools';
import { debug } from '@robocode-packages/shared';
import type { PendingToolCall } from '@robocode-packages/shared';
import type { EditorStateType } from '../../../main/subagents/editor/state';

type ToolCallSpec = { name: string; args: Record<string, unknown> };

export const buildEditToolCall = (
  edit: Record<string, unknown>,
  cwd: string,
  fileContents: Map<string, string>
): ToolCallSpec => {
  const mode = edit.mode as string;
  const action = edit.action as string;
  const file = edit.file as string;
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);

  if (mode === 'text') {
    if (action === 'replace') {
      const anchor = (edit.anchor as { value: string } | null)?.value ?? '';
      const oldStr = (edit.before as string | null) ?? anchor;
      return { name: 'edit_file', args: { path: abs, old_str: oldStr, new_str: edit.replaceWith as string } };
    }
    if (action === 'insert') {
      const insertMode = edit.insertMode as string;
      const insertText = edit.insertText as string;
      const anchor = (edit.anchor as { value: string } | null)?.value ?? null;
      if (insertMode === 'after' && anchor) {
        return { name: 'edit_file', args: { path: abs, old_str: anchor, new_str: anchor + '\n' + insertText } };
      }
      if (insertMode === 'before' && anchor) {
        return { name: 'edit_file', args: { path: abs, old_str: anchor, new_str: insertText + '\n' + anchor } };
      }
      // start/end — patch_file appending/prepending
      const content = fileContents.get(file) ?? '';
      if (insertMode === 'start') {
        const firstLine = content.split('\n')[0] ?? '';
        return { name: 'edit_file', args: { path: abs, old_str: firstLine, new_str: insertText + '\n' + firstLine } };
      }
      // end
      return { name: 'patch_file', args: { path: abs, patches: [{ old_str: content.trimEnd(), new_str: content.trimEnd() + '\n' + insertText }] } };
    }
    if (action === 'remove') {
      const target = edit.target as string;
      return { name: 'edit_file', args: { path: abs, old_str: target, new_str: '' } };
    }
  }

  if (mode === 'file') {
    if (action === 'insert') {
      return { name: 'write_file', args: { path: abs, content: edit.insertText as string } };
    }
    if (action === 'remove') {
      return { name: 'delete_file', args: { path: abs } };
    }
    if (action === 'rename') {
      const target = edit.target as string;
      const dstAbs = path.isAbsolute(target) ? target : path.resolve(cwd, target);
      return { name: 'rename_file', args: { from: abs, to: dstAbs } };
    }
  }

  throw new Error(`buildEditToolCall: unsupported edit ${mode}/${action}`);
};

const editRisk = (edit: Record<string, unknown>): 'safe' | 'destructive' => {
  const { mode, action } = edit;
  if (mode === 'file' && action === 'insert') return 'safe';
  if (mode === 'text' && action === 'insert') return 'safe';
  if (mode === 'ast' && action === 'insert') return 'safe';
  return 'destructive';
};

export const executeEditNode = async (state: EditorStateType) => {
  const { editIntent, editIndex, sessionId, cwd, autoApprove, isRecoveryAttempt } = state;
  if (!editIntent) return { currentEditStatus: 'failed' as const };

  const edit = editIntent.edits[editIndex];
  if (!edit) return { currentEditStatus: 'failed' as const };

  debug('[executeEdit]', edit.mode, edit.action, edit.file, `[${editIndex + 1}/${editIntent.edits.length}]`);

  let toolCall: ToolCallSpec;

  // Read file contents for edits that need them (text/insert end, ast/*)
  const fileContents = new Map<string, string>();
  try {
    const fs = await import('node:fs');
    const abs = path.isAbsolute(edit.file) ? edit.file : path.resolve(cwd, edit.file);
    if (fs.existsSync(abs)) {
      fileContents.set(edit.file, fs.readFileSync(abs, 'utf-8'));
    }
  } catch { /* file may not exist yet for create ops */ }

  try {
    if (edit.mode === 'ast') {
      const e = edit as Record<string, unknown>;
      const fileContent = fileContents.get(edit.file) ?? '';
      const abs = path.isAbsolute(edit.file) ? edit.file : path.resolve(cwd, edit.file);
      const { oldStr, newStr } = await resolveAstEdit(e, abs, fileContent);
      const toolName = edit.action === 'rename' ? 'write_file' : 'edit_file';
      const args = edit.action === 'rename'
        ? { path: abs, content: newStr }
        : { path: abs, old_str: oldStr, new_str: newStr };
      toolCall = { name: toolName, args };
    } else {
      toolCall = buildEditToolCall(edit as Record<string, unknown>, cwd, fileContents);
    }
  } catch (err) {
    debug('[executeEdit] build failed:', String(err));
    return { currentEditStatus: 'failed' as const, messages: [] };
  }

  const risk = editRisk(edit as Record<string, unknown>);
  const toolApproved = risk === 'safe' || autoApprove || isRecoveryAttempt;

  const pendingToolCall: PendingToolCall = {
    id: crypto.randomUUID(),
    name: toolCall.name,
    args: toolCall.args,
    risk: TOOL_RISK[toolCall.name] ?? 'moderate',
    description: formatToolDescription(toolCall.name, toolCall.args),
  };

  if (!toolApproved) {
    EventBus.emit('agent:tool_pending', { sessionId, toolCall: pendingToolCall, source: 'editor' });
  }

  const aiMessage = new AIMessage({
    content: '',
    tool_calls: [{ id: pendingToolCall.id, name: toolCall.name, args: toolCall.args, type: 'tool_call' }],
  });

  return {
    messages: [aiMessage],
    pendingToolCall,
    toolApproved,
    currentEditStatus: null,
    isRecoveryAttempt: false,
  };
};
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "buildEditToolCall" --no-coverage
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/sub/editor/executeEdit.ts __tests__/agent/editorExecution.test.ts
git commit -m "feat: add executeEditNode and buildEditToolCall — deterministic IntentSchema → tool call mapping"
```

---

## Task 5: `checkResultNode` + `advanceNode`

**Files:**
- Create: `packages/agent/src/nodes/sub/editor/checkResult.ts`
- Create: `packages/agent/src/nodes/sub/editor/advance.ts`
- Test: `__tests__/agent/editorExecution.test.ts` (append)

- [ ] **Step 1: Add failing tests**

Append to `__tests__/agent/editorExecution.test.ts`:

```ts
import { checkResult } from '../../packages/agent/src/nodes/sub/editor/checkResult';
import { advanceEdit } from '../../packages/agent/src/nodes/sub/editor/advance';
import type { EditResult } from '../../packages/agent/src/main/subagents/editor/state';

describe('checkResult', () => {
  it('returns applied when tool message has no Error:', () => {
    expect(checkResult('Edited: src/a.ts (Modified existing lines)')).toBe('applied');
  });

  it('returns failed when tool message starts with Error:', () => {
    expect(checkResult('Error: old_str not found in src/a.ts')).toBe('failed');
  });

  it('returns applied for Written: prefix', () => {
    expect(checkResult('Written: /abs/path/Faq.tsx')).toBe('applied');
  });
});

describe('advanceEdit', () => {
  const base = {
    editIntent: {
      edits: [
        { file: 'src/a.ts', mode: 'text', action: 'replace' },
        { file: 'src/b.ts', mode: 'file', action: 'insert' },
      ],
      verification: [], confidence: 0.9,
    },
    editIndex: 0,
    editResults: [] as EditResult[],
  };

  it('increments editIndex and appends result', () => {
    const result = advanceEdit({ ...base, currentEditStatus: 'applied', toolApproved: true });
    expect(result.editIndex).toBe(1);
    expect(result.editResults).toHaveLength(1);
    expect(result.editResults[0].status).toBe('applied');
  });

  it('marks skipped when toolApproved is false', () => {
    const result = advanceEdit({ ...base, currentEditStatus: null, toolApproved: false });
    expect(result.editResults[0].status).toBe('skipped');
  });

  it('increments past total edits when all processed', () => {
    const result = advanceEdit({
      ...base,
      editIndex: 1,
      editResults: [{ editIndex: 0, file: 'src/a.ts', mode: 'text', action: 'replace', status: 'applied' }],
      currentEditStatus: 'applied',
      toolApproved: true,
    });
    // editIndex 2 >= total 2 → afterAdvance will route to 'final'
    expect(result.editIndex).toBe(2);
    expect(result.editResults).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "checkResult|advanceEdit" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/agent/src/nodes/sub/editor/checkResult.ts`**

```ts
import { ToolMessage } from '@langchain/core/messages';
import { debug } from '@robocode-packages/shared';
import type { EditorStateType, EditStatus } from '../../../main/subagents/editor/state';

export const checkResult = (toolOutput: string): EditStatus => {
  if (toolOutput.startsWith('Error:')) return 'failed';
  return 'applied';
};

export const checkResultNode = (state: EditorStateType): { currentEditStatus: EditStatus } => {
  const last = state.messages.findLast((m) => m instanceof ToolMessage) as ToolMessage | undefined;
  const output = typeof last?.content === 'string' ? last.content : '';
  debug('[checkResult]', output.slice(0, 80));
  return { currentEditStatus: checkResult(output) };
};

export const afterCheckResult = (state: EditorStateType): 'advance' | 'llm_recovery' => {
  if (state.currentEditStatus === 'failed' && !state.isRecoveryAttempt) return 'llm_recovery';
  return 'advance';
};
```

- [ ] **Step 4: Create `packages/agent/src/nodes/sub/editor/advance.ts`**

```ts
import { debug } from '@robocode-packages/shared';
import type { EditorStateType, EditResult } from '../../../main/subagents/editor/state';

interface AdvanceInput {
  editIntent: EditorStateType['editIntent'];
  editIndex: number;
  editResults: EditResult[];
  currentEditStatus: EditorStateType['currentEditStatus'];
  toolApproved: EditorStateType['toolApproved'];
}

export const advanceEdit = (
  state: AdvanceInput
): { editIndex: number; editResults: EditResult[]; currentEditStatus: null } => {
  const { editIntent, editIndex, editResults, currentEditStatus, toolApproved } = state;
  const edit = editIntent?.edits[editIndex];

  const status = toolApproved === false
    ? 'skipped'
    : (currentEditStatus ?? 'applied');

  const result: EditResult = {
    editIndex,
    file: edit?.file ?? '?',
    mode: edit?.mode ?? '?',
    action: edit?.action ?? '?',
    status,
  };

  const nextIndex = editIndex + 1;
  const totalEdits = editIntent?.edits.length ?? 0;
  const done = nextIndex >= totalEdits;

  debug('[advance] edit', editIndex + 1, '/', totalEdits, '—', status, done ? '(done)' : '');

  return {
    editIndex: nextIndex,
    editResults: [...editResults, result],
    currentEditStatus: null,
  };
};

export const advanceNode = (state: EditorStateType) => advanceEdit(state);

export const afterAdvance = (state: EditorStateType): 'execute_edit' | 'final' => {
  const totalEdits = state.editIntent?.edits.length ?? 0;
  return state.editIndex >= totalEdits ? 'final' : 'execute_edit';
};
```

- [ ] **Step 5: Run tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/editorExecution.test.ts -t "checkResult|advanceEdit" --no-coverage
```

Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/nodes/sub/editor/checkResult.ts packages/agent/src/nodes/sub/editor/advance.ts __tests__/agent/editorExecution.test.ts
git commit -m "feat: add checkResultNode and advanceNode — result inspection and edit cursor management"
```

---

## Task 6: `llmRecoveryNode`

**Files:**
- Create: `packages/agent/src/nodes/sub/editor/llmRecovery.ts`

- [ ] **Step 1: Create `packages/agent/src/nodes/sub/editor/llmRecovery.ts`**

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';
import { createBaseModel } from '../../../utils';
import { EDIT_FILE_TOOLS } from '@robocode-packages/tools';
import { debug } from '@robocode-packages/shared';
import type { EditorStateType } from '../../../main/subagents/editor/state';

export const llmRecoveryNode = async (state: EditorStateType) => {
  const { editIntent, editIndex, cwd, sessionId, autoApprove } = state;
  const edit = editIntent?.edits[editIndex];
  if (!edit) return { currentEditStatus: 'failed' as const };

  debug('[llmRecovery] attempting recovery for edit', editIndex, edit.file);

  const abs = path.isAbsolute(edit.file) ? edit.file : path.resolve(cwd, edit.file);
  let fileContent = '';
  try {
    fileContent = fs.readFileSync(abs, 'utf-8');
  } catch { /* file may not exist */ }

  const model = createBaseModel(false).bindTools(EDIT_FILE_TOOLS, { tool_choice: 'required' });

  const systemPrompt = `You are a code editor fixing a failed edit. Use edit_file or write_file to apply the requested change.
Only make the minimal change described. Do not modify unrelated code.`;

  const last = state.messages.findLast((m) => typeof m.content === 'string' && String(m.content).startsWith('Error:'));
  const errorMsg = typeof last?.content === 'string' ? last.content : 'unknown error';

  const userPrompt = `The following edit failed: ${errorMsg}

File: ${edit.file}
Goal: ${edit.reasoning}

Current file content:
\`\`\`
${fileContent.slice(0, 4000)}
\`\`\`

Apply the edit described in the goal using edit_file or write_file.`;

  try {
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    return {
      messages: [response as AIMessage],
      toolApproved: autoApprove,
      isRecoveryAttempt: true,
    };
  } catch (err) {
    debug('[llmRecovery] LLM call failed:', String(err));
    return { currentEditStatus: 'failed' as const };
  }
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/nodes/sub/editor/llmRecovery.ts
git commit -m "feat: add llmRecoveryNode — focused LLM retry for failed deterministic edits"
```

---

## Task 7: Update `initializeWriteNode`, `finalEditorNode`, `toolApprovalNode`; wire new editor graph

**Files:**
- Modify: `packages/agent/src/nodes/sub/editor/initialize.ts`
- Modify: `packages/agent/src/nodes/sub/editor/final.ts`
- Modify: `packages/agent/src/nodes/sub/editor/approval.ts`
- Modify: `packages/agent/src/nodes/sub/editor/index.ts`
- Modify: `packages/agent/src/main/subagents/editor/graph.ts`
- Modify: `packages/shared/src/types/event.ts`

- [ ] **Step 1: Add `source` and `agent:editor_complete` to `packages/shared/src/types/event.ts`**

Change the `agent:tool_pending` line:

```ts
  'agent:tool_pending': { sessionId: string; toolCall: PendingToolCall; source?: 'root' | 'editor' };
```

Add after `agent:tool_decision`:

```ts
  'agent:editor_complete': {
    sessionId: string;
    applied: number;
    failed: number;
    skipped: number;
    files: string[];
    errors: string[];
  };
```

- [ ] **Step 2: Replace `packages/agent/src/nodes/sub/editor/initialize.ts`**

```ts
import { ContextService, formatProjectContext } from '@robocode-packages/core';
import { SystemMessage } from '@langchain/core/messages';
import { debug } from '@robocode-packages/shared';
import type { EditorStateType } from '../../../main/subagents/editor/state';

export async function initializeWriteNode(state: EditorStateType) {
  debug('[editor:initialize] starting with', state.editIntent?.edits.length ?? 0, 'edits');
  const projectContext = await ContextService.get(state.cwd);
  const contextBlock = formatProjectContext(projectContext);

  const totalEdits = state.editIntent?.edits.length ?? 0;
  const files = [...new Set(state.editIntent?.edits.map((e) => e.file) ?? [])];

  const systemMsg = new SystemMessage(
    `You are a code editor executing a structured edit plan.\n\n` +
    `Goal: ${state.editIntent?.verification?.[0] ?? 'Apply all edits'}\n` +
    `Edits: ${totalEdits} operations across ${files.length} file(s): ${files.join(', ')}\n\n` +
    contextBlock
  );
  return { messages: [systemMsg], turnCount: 0 };
}
```

- [ ] **Step 3: Replace `packages/agent/src/nodes/sub/editor/final.ts`**

```ts
import { EventBus } from '@robocode-packages/core';
import { debug } from '@robocode-packages/shared';
import type { EditorStateType } from '../../../main/subagents/editor/state';

export function finalEditorNode(state: EditorStateType) {
  const { editResults, sessionId } = state;

  const applied = editResults.filter((r) => r.status === 'applied' || r.status === 'recovered');
  const failed = editResults.filter((r) => r.status === 'failed');
  const skipped = editResults.filter((r) => r.status === 'skipped');

  debug('[editor:final] applied:', applied.length, 'failed:', failed.length, 'skipped:', skipped.length);

  EventBus.emit('agent:editor_complete', {
    sessionId,
    applied: applied.length,
    failed: failed.length,
    skipped: skipped.length,
    files: applied.map((r) => r.file),
    errors: failed.map((r) => `${r.file}: ${r.error ?? 'unknown error'}`),
  });

  return {};
}
```

- [ ] **Step 4: Replace `packages/agent/src/nodes/sub/editor/approval.ts`**

```ts
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { interrupt } from '@langchain/langgraph';
import { EventBus } from '@robocode-packages/core';
import type { PendingToolCall } from '@robocode-packages/shared';
import { formatToolDescription } from '@robocode-packages/tools';
import type { EditorStateType } from '../../../main/subagents/editor/state';

export const toolApprovalNode = async (state: EditorStateType) => {
  const { sessionId, toolApproved: preApproved } = state;
  const last = state.messages.at(-1) as AIMessage;

  if (!AIMessage.isInstance(last) || !last.tool_calls?.length) {
    return { toolApproved: false, pendingToolCall: null };
  }

  const toolCall = last.tool_calls[0];
  const pendingToolCall: PendingToolCall = state.pendingToolCall ?? {
    id: toolCall.id ?? crypto.randomUUID(),
    name: toolCall.name,
    args: toolCall.args as Record<string, unknown>,
    risk: 'moderate',
    description: formatToolDescription(toolCall.name, toolCall.args as Record<string, unknown>),
  };

  // executeEditNode already evaluated risk + autoApprove
  if (preApproved) {
    return { toolApproved: true, pendingToolCall };
  }

  // Need user approval — emit event (executeEditNode already emitted it, but may not have for recovery)
  EventBus.emit('agent:tool_pending', { sessionId, toolCall: pendingToolCall, source: 'editor' });
  const decision = interrupt({ type: 'tool_approval', toolCall: pendingToolCall });
  const approved = decision === 'approve' || decision === 'y';
  EventBus.emit('agent:tool_decision', { sessionId, approved, toolCall: pendingToolCall });

  if (!approved) {
    const toolMessage = new ToolMessage({
      content: `User rejected "${pendingToolCall.name}".`,
      tool_call_id: pendingToolCall.id,
    });
    return { toolApproved: false, pendingToolCall: null, messages: [toolMessage] };
  }

  return { toolApproved: true, pendingToolCall };
};

export const shouldContinue = (state: EditorStateType): 'tool_approval' | 'final' => {
  const last = state.messages.at(-1) as AIMessage;
  if (last?.tool_calls?.length) return 'tool_approval';
  return 'final';
};

export const afterToolApproval = (state: EditorStateType): 'tools' | 'advance' => {
  return state.toolApproved ? 'tools' : 'advance';
};
```

- [ ] **Step 5: Update `packages/agent/src/nodes/sub/editor/index.ts`**

Replace with:

```ts
export * from './agent';
export * from './initialize';
export * from './final';
export * from './approval';
export * from './tools';
export * from './executeEdit';
export * from './checkResult';
export * from './advance';
export * from './llmRecovery';
```

- [ ] **Step 6: Replace `packages/agent/src/main/subagents/editor/graph.ts`**

```ts
import { StateGraph, START, END } from '@langchain/langgraph';
import { Checkpointer } from '@robocode-packages/core';
import {
  toolApprovalNode,
  afterToolApproval,
  toolsNode,
  initializeWriteNode,
  finalEditorNode,
  executeEditNode,
  checkResultNode,
  afterCheckResult,
  advanceNode,
  afterAdvance,
  llmRecoveryNode,
} from '../../../nodes/sub/editor';
import { EditorState } from './state';

export function createWriterGraph() {
  const checkpointer = Checkpointer.getInstance();
  const graph = new StateGraph(EditorState)
    .addNode('initialize', initializeWriteNode)
    .addNode('execute_edit', executeEditNode)
    .addNode('tool_approval', toolApprovalNode)
    .addNode('tools', toolsNode)
    .addNode('check_result', checkResultNode)
    .addNode('llm_recovery', llmRecoveryNode)
    .addNode('advance', advanceNode)
    .addNode('final', finalEditorNode)
    .addEdge(START, 'initialize')
    .addEdge('initialize', 'execute_edit')
    .addEdge('execute_edit', 'tool_approval')
    .addConditionalEdges('tool_approval', afterToolApproval, {
      tools: 'tools',
      advance: 'advance',
    })
    .addEdge('tools', 'check_result')
    .addConditionalEdges('check_result', afterCheckResult, {
      advance: 'advance',
      llm_recovery: 'llm_recovery',
    })
    .addEdge('llm_recovery', 'tool_approval')
    .addConditionalEdges('advance', afterAdvance, {
      execute_edit: 'execute_edit',
      final: 'final',
    })
    .addEdge('final', END);

  return graph.compile({ checkpointer });
}

export const writerGraph = createWriterGraph();
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final" | head -20
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -5
```

Expected: all pass (existing 56 + new tests).

- [ ] **Step 9: Commit**

```bash
git add packages/agent/src/nodes/sub/editor/ packages/agent/src/main/subagents/editor/graph.ts packages/shared/src/types/event.ts
git commit -m "feat: wire new editor subagent graph — deterministic execute loop with approval gate and LLM recovery"
```

---

## Task 8: `delegateWriterNode` + root graph wiring

**Files:**
- Create: `packages/agent/src/nodes/root/delegateWriter.ts`
- Modify: `packages/agent/src/main/root/graph.ts`

- [ ] **Step 1: Create `packages/agent/src/nodes/root/delegateWriter.ts`**

```ts
import { debug } from '@robocode-packages/shared';
import { writerAgent } from '../../main/subagents/editor';
import type { RootStateType } from '../../main/root';

export const delegateWriterNode = async (state: RootStateType) => {
  const { editIntent, sessionId, cwd, autoApprove } = state;

  if (!editIntent) {
    debug('[delegateWriter] no editIntent — skipping');
    return {};
  }

  debug('[delegateWriter] starting editor with', editIntent.edits.length, 'edits');

  try {
    await writerAgent.run({
      editIntent,
      sessionId,
      cwd,
      autoApprove: autoApprove ?? false,
    });
  } catch (err: unknown) {
    // GraphInterrupt means the editor paused for tool approval.
    // It will be resumed via agent:resume:editor EventBus event.
    const isInterrupt =
      err != null &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name: string }).name === 'GraphInterrupt';
    if (!isInterrupt) throw err;
    debug('[delegateWriter] editor interrupted — awaiting user approval');
  }

  return {};
};
```

- [ ] **Step 2: Update `packages/agent/src/main/root/graph.ts`**

Add the import at the top:

```ts
import { delegateWriterNode } from '../../nodes/root/delegateWriter';
```

Add the node and change the final edge (find `.addEdge('edit_intent', END)` and replace):

```ts
    .addNode('delegate_writer', delegateWriterNode)
    // ... existing nodes ...
    .addEdge('edit_intent', 'delegate_writer')
    .addEdge('delegate_writer', END);
```

Remove the old line `.addEdge('edit_intent', END)`.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -v "reader/final" | head -20
```

Expected: no errors.

- [ ] **Step 4: Run all tests**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -5
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/nodes/root/delegateWriter.ts packages/agent/src/main/root/graph.ts
git commit -m "feat: add delegateWriterNode — wire editIntent into editor subagent from root graph"
```

---

## Task 9: Frontend — `/approve` command, auto-approve badge, `agent:editor_complete`, PendingTool additions

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`
- Modify: `apps/cli/src/screens/chat/components/PendingTool.tsx`

- [ ] **Step 1: Fix `confirmTool` in `Chat.tsx` to emit `agent:resume:editor` for editor tool calls**

Find the `confirmTool` function and the `pendingApproval` state. The `agent:tool_pending` event now has `source?: 'root' | 'editor'`. Store source when setting `pendingApproval`.

Find where `agent:tool_pending` is handled (around line 222):

```ts
EventBus.on('agent:tool_pending', ({ sessionId, toolCall }) => {
```

Replace with:

```ts
EventBus.on('agent:tool_pending', ({ sessionId, toolCall, source }) => {
  if (session && session.id === sessionId) {
    setPendingApproval({ kind: 'tool', tool: toolCall, source: source ?? 'root' });
    setIsLoading(false);
  }
});
```

Update the `pendingApproval` state type. Find where `pendingApproval` is declared (look for `useState` with `kind: 'tool'`) and add `source` field:

```ts
// In the state type for pendingApproval, add source to the tool kind:
// { kind: 'tool'; tool: PendingToolCall; source: 'root' | 'editor' }
```

Replace `confirmTool`:

```ts
const confirmTool = (approved: boolean) => {
  if (previewTool) {
    setPreviewTool(null);
    return;
  }
  if (!session) return;
  const source = pendingApproval?.kind === 'tool' ? (pendingApproval as { source?: string }).source : 'root';
  if (source === 'editor') {
    EventBus.emit('agent:resume:editor', {
      sessionId: session.id,
      decision: approved ? 'approve' : 'reject',
    });
  } else {
    EventBus.emit('agent:resume', {
      sessionId: session.id,
      decision: approved ? 'approve' : 'reject',
    });
  }
  setPendingApproval(null);
};
```

- [ ] **Step 2: Add `/approve` command handler in `Chat.tsx`**

Find `executeCommand` function. Add a case for `/approve`:

```ts
if (command === '/approve') {
  const next = !autoApprove;
  setAutoApprove(next);
  EventBus.emit('agent:run', `__set_auto_approve__:${next}`);
  appendNotice(next ? '⚡ Auto-approve enabled — all edits will apply without confirmation.' : 'Auto-approve disabled.');
  return;
}
```

Add `autoApprove` state near the top of the Chat component:

```ts
const [autoApprove, setAutoApprove] = useState(false);
```

- [ ] **Step 3: Listen for `agent:editor_complete` in `Chat.tsx`**

Inside the `useEffect` with EventBus listeners, add:

```ts
EventBus.on('agent:editor_complete', ({ sessionId: sid, applied, failed, skipped, files, errors }) => {
  if (!session || session.id !== sid) return;
  setIsLoading(false);
  const lines = [
    applied > 0 ? `✓ Applied ${applied} edit${applied !== 1 ? 's' : ''}: ${files.join(', ')}` : null,
    skipped > 0 ? `◦ Skipped ${skipped}` : null,
    failed > 0 ? `✗ Failed ${failed}: ${errors.join('; ')}` : null,
  ].filter(Boolean).join('\n');
  appendNotice(lines || 'Editor finished with no changes.');
});
```

(Use whatever `appendNotice` or message-append helper already exists in Chat.tsx for system messages.)

- [ ] **Step 4: Add auto-approve badge in `Chat.tsx`**

Find the header/title area in the Chat JSX. Add the badge next to the session name:

```tsx
{autoApprove && (
  <Text color="#e2a712" bold> ⚡ auto</Text>
)}
```

- [ ] **Step 5: Add `delete_file` + `rename_file` display to `PendingTool.tsx`**

In `PendingTool.tsx`, find where `isEdit`, `isPatch`, `isWrite` are declared and add:

```ts
const isDelete = tool.name === 'delete_file';
const isRename = tool.name === 'rename_file';
```

Add display blocks after the `isWrite` block:

```tsx
{isDelete && (
  <Box flexDirection="column" marginBottom={1}>
    <Text color="#b05959">Deleting file:</Text>
    <Text color={COLORS.fileHeader}>{String(tool.args.path ?? '')}</Text>
  </Box>
)}
{isRename && (
  <Box flexDirection="column" marginBottom={1}>
    <Text color="#e2a712">Renaming:</Text>
    <Text color={COLORS.fileHeader}>{String(tool.args.from ?? '')} → {String(tool.args.to ?? '')}</Text>
  </Box>
)}
```

- [ ] **Step 6: Type-check CLI**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Run all tests**

```bash
pnpm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -5
```

Expected: all pass.

- [ ] **Step 8: Build**

```bash
pnpm build 2>&1 | tail -10
```

Expected: exits 0.

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx apps/cli/src/screens/chat/components/PendingTool.tsx
git commit -m "feat: frontend — /approve toggle, auto-approve badge, editor_complete handler, delete/rename display in PendingTool"
```
