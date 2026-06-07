# Chat UI Polish — Design Spec

## Goal

Elevate the chat screen to production quality: bordered input, action verb badges, inline tool result previews, and fix the broken `/clear` command.

## Changes

### 1. Input border (ChatInput.tsx)

Wrap the input row in a `<Box borderStyle="single">`. Border color is `white` when idle/active, `gray` when the agent is busy. The `❯` prompt stays inside the box. When busy, the entire input dims (`dimColor`) and the cursor is hidden.

```
idle:
┌──────────────────────────────────────────────┐
│ ❯ type a message...                          │
└──────────────────────────────────────────────┘

busy:
⠙ [Writing] src/nav.tsx · 4s
┌──────────────────────────────────────────────┐
│ ❯                                            │ ← dimmed
└──────────────────────────────────────────────┘
```

**Note:** The SlashPalette renders above the bordered box (unchanged position).

---

### 2. Tool verb + badge in AgentStatus (AgentStatus.tsx)

Current: `⠙ write_file (4s)` — raw tool name.

Proposed: `⠙ [Writing] src/nav.tsx · 4s`

- **Verb badge**: `bold + cyan` text, surrounded by `[` `]` brackets. No background color (terminal compatibility).
- **Path**: dimmed gray, extracted via `getToolLabel(name, input)` from `toolVerbs.ts`.
- **Elapsed**: dimmed, after a `·` separator.
- **thinkingText fallback** (no tool running): render as-is without a badge, e.g., `⠙ Drafting response...`

The AgentStatus receives `runningTool: string | null` and `runningToolInput: unknown` (new prop) alongside the existing `elapsed` and `thinkingText`. The `Chat.tsx` passes the running activity's input down.

---

### 3. Tool verb + result preview in ActivityFeed (ActivityFeed.tsx + toolVerbs.ts)

#### 3a. Verb mapping (new file: `apps/cli/src/utils/toolVerbs.ts`)

```ts
export const getToolLabel = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash') return String(args.command ?? '').slice(0, 60);
  const path = args.path ?? args.file ?? args.target;
  if (path) return String(path);
  return '';
};

export const TOOL_VERB: Record<string, string> = {
  read_file: 'Reading',
  write_file: 'Writing',
  str_replace_editor: 'Editing',
  edit_file: 'Editing',
  patch_file: 'Patching',
  bash: 'Running',
  grep: 'Searching',
  glob: 'Searching',
  list_dir: 'Browsing',
  search_files: 'Searching',
  find_definition: 'Finding',
  ast_get_symbol: 'Reading',
  ast_analyzer: 'Analyzing',
  ast_rename: 'Renaming',
  validate_project: 'Validating',
  undo: 'Undoing',
};

export const getToolVerb = (name: string): string =>
  TOOL_VERB[name] ?? name;
```

#### 3b. Result preview extraction (in `toolVerbs.ts`)

```ts
export const getResultPreview = (name: string, output: string | undefined, error: string | undefined): string | null
```

Rules per tool (truncate all to ≤60 chars):
- `bash`: first non-empty line of stdout
- `grep` / `search_files`: count lines → `"N matches"`
- `glob`: count lines → `"N files"`
- `list_dir`: count lines → `"N items"`
- `read_file` / `ast_get_symbol`: line count of output → `"N lines"`
- `write_file` / `edit_file` / `str_replace_editor` / `patch_file`: if output contains a number → `"+N lines"`, else first line
- error (any tool): `error.split('\n')[0]`, truncated
- all others: first non-empty line of output, truncated

#### 3c. Activity row layout

```
⏺  [Reading]  src/auth.ts  →  logout() at line 42        ← running
✓  Reading  src/auth.ts  →  312 lines                     ← done (no brackets)
✗  Running  bash  →  command not found: foo               ← error
```

- Running: verb in `[brackets]`, cyan. Path dimmed. `→` separator. Preview dimmed.
- Done: verb plain, dimmed. Path dimmed. `→` separator. Preview dimmed.
- Error: verb plain, dimmed. Error preview in red.
- Duration shown only when ≥1s, appended after the preview.

---

### 4. /clear fix (Chat.tsx)

The `<Static>` component in Ink permanently paints its items — `setMessages([])` doesn't erase already-rendered output. Increment `staticKey` to force Static to remount with an empty list.

Add `setStaticKey((k) => k + 1)` inside the `clear` branch of `executeCommand`:

```ts
if (command === 'clear') {
  deleteSession(session.id);
  create();
  resetTransientState();
  setMessages([]);
  setStaticKey((k) => k + 1);  // ← missing line
  return;
}
```

---

### 5. AgentStatus prop change (Chat.tsx wiring)

AgentStatus needs the running tool's `input` to extract the path label for the badge. Pass it from `activities`:

```ts
const runningActivity = activities.find((a) => a.status === 'running') ?? null;
const runningTool = runningActivity?.name ?? null;
const runningToolInput = runningActivity?.input ?? null;
```

Pass `runningToolInput` to `<AgentStatus>`.

---

## Files

| Action | File |
|--------|------|
| Create | `apps/cli/src/utils/toolVerbs.ts` |
| Modify | `apps/cli/src/elements/ChatInput.tsx` |
| Modify | `apps/cli/src/screens/chat/components/AgentStatus.tsx` |
| Modify | `apps/cli/src/screens/chat/components/ActivityFeed.tsx` |
| Modify | `apps/cli/src/screens/chat/Chat.tsx` |
| Modify | `apps/cli/src/utils/index.ts` (re-export toolVerbs) |

## Out of scope

- Animated badge transitions
- Multi-line tool output expansion
- Syntax highlighting in previews
- Any changes to approval components (PendingTool, PendingPlan, etc.)
