# Editor Subagent Design

**Date:** 2026-05-28
**Status:** Approved

---

## Goal

Wire the editor subagent into the end-to-end pipeline so that `IntentSchema` edits produced by `editIntentNode` are actually applied to the codebase. The editor executes edits deterministically (no LLM by default), uses tree-sitter for AST operations, shows a Claude Code–style diff preview for destructive changes, and falls back to a focused LLM call when deterministic execution fails.

---

## Architecture Overview

```
Root graph:
  editIntentNode → delegateWriterNode
                         ↓
                  EditorAgent.run(EditorRequest)
                         ↓
               Editor subagent graph:
               START
                 → initialize
                 → execute_edit   ← ─────────────────────────────────┐
                     ↓ safe                                           │
                     → tools (auto-apply)                             │
                     ↓ destructive + autoApprove=false                │
                     → tool_approval (interrupt → diff preview)       │
                     → tools (apply)                                  │
                     ↓ error                                          │
                     → llm_recovery → tool_approval → tools          │
                 → check_result                                       │
                 → advance ──────── more edits ──────────────────────┘
                     ↓ done
                 → final
               END
```

---

## Edit-to-Tool Translation

Each `IntentSchema` edit maps deterministically to an existing tool call. No new execution tools are needed for text and file operations. AST operations are resolved to text via tree-sitter before tool dispatch.

| Edit type | Tool | Mapping |
|---|---|---|
| `text/replace` | `edit_file` | `old_str = before ?? anchor block`, `new_str = replaceWith` |
| `text/insert after` | `edit_file` | `old_str = anchor line`, `new_str = anchor + '\n' + insertText` |
| `text/insert before` | `edit_file` | `old_str = anchor line`, `new_str = insertText + '\n' + anchor` |
| `text/insert end` | `edit_file` | append `insertText` at end of file (old_str = last line, new_str = last line + '\n' + insertText) |
| `text/insert start` | `edit_file` | prepend `insertText` (old_str = first line, new_str = insertText + '\n' + first line) |
| `text/remove` | `edit_file` | `old_str = target`, `new_str = ''` |
| `file/insert` | `write_file` | `content = insertText` |
| `file/remove` | `delete_file` (new) | `path` |
| `file/rename` | `rename_file` (new) | `from = file`, `to = target` |
| `ast/replace` | tree-sitter → `edit_file` | find node → `old_str = node text`, `new_str = afterSnippet` |
| `ast/remove` | tree-sitter → `edit_file` | find node → `old_str = node text`, `new_str = ''` |
| `ast/rename` | tree-sitter → `patch_file` | find declaration + all usages → rename each |
| `ast/insert` | tree-sitter → `edit_file` | find anchor node → insert after |

### Risk Classification

- **Safe** (auto-apply, no approval needed): `file/insert`, `text/insert`, `ast/insert`
- **Destructive** (approval required unless `autoApprove = true`): all replace, remove, rename operations

---

## AST Resolution

AST edits are resolved inside `executeEditNode` before tool dispatch. A new pure utility `resolveAstEdit(edit, fileContent, cwd)` in `packages/tools/src/utils/astEdit.ts` handles this:

```
1. Read file content from disk (or use fileContents cache)
2. Parse with createAstParser(file)
3. Walk tree using existing findFunctions / findClasses / findImports utilities
4. Match node by { nodeType, symbol } — find node with matching name
5. Extract old_str = source.slice(node.startIndex, node.endIndex)
6. Return { oldStr, newStr } ready for edit_file / patch_file dispatch
```

**`ast/rename` specifics:** uses `findReferences(tree, symbol)` to locate all occurrences (declaration + usages), produces a `patches[]` array for `patch_file`.

**Node not found** → throws, triggering LLM recovery.

---

## Auto-Approve Mode

Modelled on Claude Code CLI's auto-accept toggle.

**State:** `autoApprove: boolean` in `RootState` (default `false`). Passed through `EditorRequest` into `EditorState`.

**Toggle:** `/approve` typed in the chat input. Detected client-side before sending to the agent — dispatches `agent:set-auto-approve` event directly, no LLM call. The command handler patches `autoApprove` in root state and emits a status message.

**Visual indicator:** Small badge in the chat header when active — `⚡ auto` in amber. Rendered in the same row as the session name. Disappears when toggled off.

**Behaviour in `toolApprovalNode`:**
- `autoApprove = true` → skip interrupt, apply immediately regardless of risk
- `autoApprove = false` → safe ops proceed; destructive ops emit `agent:tool_pending` → diff preview → user approves/rejects

---

## LLM Error Recovery

Triggered when deterministic execution fails (old_str not found, AST node not located, write permission error).

**Recovery flow:**
1. `executeEditNode` fails on `edits[editIndex]`
2. `llm_recoveryNode` activates:
   - Reads current file content from disk
   - Sends a focused prompt: edit goal, error message, current file content
   - LLM calls `edit_file` with corrected `old_str` / `new_str`
3. Result routes through `tool_approval` (same risk gate, same diff preview)
4. On success → `advance` (mark as `recovered`, continue)
5. On second failure → mark edit as `failed`, continue with next edit

**One retry only.** Recovery is skipped when the user rejected the original edit in the approval gate — no point recovering a declined change.

---

## Editor Subagent Graph

### State — `EditorState` changes

**Fields added:**

| Field | Type | Default | Purpose |
|---|---|---|---|
| `editIntent` | `IntentSchema \| null` | `null` | full edit plan |
| `editIndex` | `number` | `0` | cursor through `edits[]` |
| `editResults` | `EditResult[]` | `[]` | per-edit outcome |
| `autoApprove` | `boolean` | `false` | skip approval gate |
| `currentToolCall` | `PendingToolCall \| null` | `null` | edit in-flight |

**Fields removed:** `context: WriterContext` (stale shape), `preserve_formatting`, `constraints` (replaced by editIntent), `task` (replaced by editIntent.verification + reasoning).

**`EditResult` type:**
```ts
interface EditResult {
  editIndex: number;
  file: string;
  mode: string;
  action: string;
  status: 'applied' | 'recovered' | 'skipped' | 'failed';
  diff?: string;
  error?: string;
}
```

### Graph nodes

**`initializeWriteNode`** — unchanged except it reads `state.editIntent` to build a richer system prompt (goal, files affected, verification steps).

**`executeEditNode`** — new primary node:
1. Gets `edit = state.editIntent.edits[state.editIndex]`
2. If AST op: calls `resolveAstEdit` to get `{ oldStr, newStr }`
3. Constructs the tool call (`edit_file` / `patch_file` / `write_file` / `delete_file` / `rename_file`)
4. Checks risk → sets `pendingToolCall` in state, sets `toolApproved = risk === 'safe' || autoApprove`

**`toolApprovalNode`** — existing node, no logic changes. Emits `agent:tool_pending` when `toolApproved = false`. Interrupt resumes with `'approve'` or `'reject'`.

**`toolsNode`** — existing `ToolNode(EDIT_FILE_TOOLS)` — add `delete_file` and `rename_file` to the set.

**`checkResultNode`** — inspects tool result:
- Contains `"Error:"` → route to `llm_recovery`
- Otherwise → route to `advance`

**`llmRecoveryNode`** — new node:
- Reads current file, builds focused prompt, invokes LLM with `edit_file` bound
- Routes back through `tool_approval` → `tools` → `check_result` (one attempt)

**`advanceNode`** — new node:
- Appends result to `editResults`
- Increments `editIndex`
- Routes back to `execute_edit` if more edits remain, else to `final`

**`finalEditorNode`** — updated to use `state.editResults`:
- Lists applied edits by file
- Lists failed edits with error messages
- Returns `EditorResponseSchema` result

### Graph edges

```
START → initialize → execute_edit
execute_edit → tool_approval
tool_approval → tools (approved) | advance (rejected — mark skipped)
tools → check_result
check_result → advance (success) | llm_recovery (error)
llm_recovery → tool_approval
advance → execute_edit (more) | final (done)
final → END
```

---

## Root Graph Wiring

### New node: `delegateWriterNode`

Added to root graph after `edit_intent`:

```ts
edit_intent → delegate_writer → END
```

Packages `state.editIntent + sessionId + cwd + autoApprove` into `EditorRequest` and calls `writerAgent.run()`. The writer manages its own interrupt/resume lifecycle via the existing EventBus pattern (`agent:tool_pending` → frontend → `agent:resume:editor`).

### New root state fields

```ts
autoApprove: Annotation<boolean>({ reducer: (_, n) => n, default: () => false })
```

### `/approve` command handling

Detected in `Chat.tsx` input handler before the message reaches the agent. When input is `/approve`:
- Dispatches `agent:set-auto-approve` EventBus event with toggled value
- Root graph updates `autoApprove` state
- Shows inline status message in chat feed: `⚡ Auto-approve enabled` / `Auto-approve disabled`
- Does not invoke the LLM

---

## Frontend Changes

### Auto-approve badge

In the chat screen header (same row as session name):

```
[session name]  ⚡ auto
```

- Rendered only when `autoApprove = true`
- Amber/yellow color (`#e2a712` — matches existing `moderate` risk color)
- Driven by a new `autoApprove` field in `SessionContext` or chat-level state

### `PendingTool` component — no changes needed

`edit_file`, `patch_file`, and `write_file` already render file path + colored diff via the existing `DiffView` component. The approval UI matches Claude Code CLI style out of the box.

### New tools in diff preview

`delete_file` and `rename_file` will need entries in `PendingTool` — show the target path, no diff (destructive/move operation). Simple text display.

### Editor result in chat feed

When the editor finishes, `finalEditorNode` emits a structured result. The chat feed renders it as a compact summary card:

```
✓ Applied 3 edits
  src/types/router.ts    ast/replace Routes
  src/components/Nav.tsx  text/replace NAV_ITEMS
  src/screens/Faq.tsx     file/insert (new file)

✗ Failed 1 edit
  src/screens/index.ts — old_str not found after recovery
```

---

## New Files

| Path | Purpose |
|---|---|
| `packages/tools/src/utils/astEdit.ts` | `resolveAstEdit` — tree-sitter node → `{ oldStr, newStr }` |
| `packages/tools/src/tools/editor/deleteFile.ts` | `delete_file` tool |
| `packages/tools/src/tools/editor/renameFile.ts` | `rename_file` tool |
| `packages/agent/src/nodes/root/delegateWriter.ts` | Root graph node that triggers editor subagent |
| `packages/agent/src/nodes/sub/editor/executeEdit.ts` | Deterministic edit executor |
| `packages/agent/src/nodes/sub/editor/checkResult.ts` | Success/error router after tool call |
| `packages/agent/src/nodes/sub/editor/llmRecovery.ts` | LLM fallback node |
| `packages/agent/src/nodes/sub/editor/advance.ts` | Increment editIndex, route to next or final |

## Modified Files

| Path | Change |
|---|---|
| `packages/agent/src/main/subagents/editor/state.ts` | Replace `WriterContext` fields with `editIntent`, `editIndex`, `editResults`, `autoApprove` |
| `packages/agent/src/main/subagents/editor/graph.ts` | New graph topology with execute loop |
| `packages/agent/src/nodes/sub/editor/initialize.ts` | Read `editIntent` for richer system prompt |
| `packages/agent/src/nodes/sub/editor/final.ts` | Use `editResults` for structured summary |
| `packages/agent/src/main/root/graph.ts` | Add `delegateWriterNode`, wire `edit_intent → delegate_writer` |
| `packages/agent/src/main/root/state.ts` | Add `autoApprove: boolean` |
| `packages/tools/src/tools/editor/index.ts` | Export `delete_file`, `rename_file` |
| `apps/cli/src/screens/chat/Chat.tsx` | Handle `/approve` command, pass `autoApprove` state |
| `apps/cli/src/screens/chat/components/PendingTool.tsx` | Add display for `delete_file`, `rename_file` |
| `apps/cli/src/screens/chat/index.ts` (or header component) | Render auto-approve badge |
