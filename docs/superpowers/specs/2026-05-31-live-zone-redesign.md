# Live Zone Redesign + Streaming Fix

**Date:** 2026-05-31  
**Status:** Approved  

## Problem

Four related issues in the chat UI:

1. **AI response never appears** — `agentNode` and `summarizerNode` use `model.invoke()`. No `llm:token` events fire. `streamingRef.current` in Chat.tsx stays empty, so `llm:end` never adds the response to `staticItems`.
2. **Input blinks between tool calls** — `isAgentBusy = isLoading || !!pendingApproval` doesn't include running tools. When `llm:end` fires between tool batches, input briefly activates.
3. **Status bar shows no active phrase** — thinking phrase ("Thinking…", "Reviewing results…") lives in LiveZone as a dimmed text line; status bar is always the same.
4. **Individual ToolCards are noisy** — one card per tool call, no compact summary; no Claude Code style `Searching for 2 patterns, reading 3 files…` line.

## Goals

- Stream AI response tokens to the chat in real time
- Eliminate input flicker between tool calls
- Replace ToolCards with a single compact activity line while tools run
- Move thinking phrase + spinner into the status bar
- Done tools vanish from LiveZone; promoted to TurnSummaryCard on next submit

## Non-goals

- Changing TurnSummaryCard or turn promotion logic
- Changing ApprovalCard or the interrupt/resume pattern
- Supporting concurrent tool-call display beyond the compact summary

---

## Section 1: Streaming the AI response

### What changes

`agentNode` (`packages/agent/src/main/agent_node.ts`) and `summarizerNode` (`packages/agent/src/main/summarizer.ts`) switch from `model.invoke()` to `model.stream()`.

### Implementation

```typescript
// pattern for both nodes
const stream = await model.stream(allMessages, { configurable: { sessionId, cwd } });

let response: AIMessageChunk | null = null;
for await (const chunk of stream) {
  response = response ? concat(response, chunk) : chunk;

  // extract text — Anthropic returns ContentBlock[] when tool calls are mixed in
  const text =
    typeof chunk.content === 'string'
      ? chunk.content
      : (chunk.content as Array<{ type: string; text?: string }>)
          .filter(c => c.type === 'text')
          .map(c => c.text ?? '')
          .join('');

  if (text) EventBus.emit('llm:token', { sessionId, token: text });
}

EventBus.emit('llm:end', { sessionId });
return { messages: [response] };
```

Import: `import { concat } from '@langchain/core/utils/stream';` and `import type { AIMessageChunk } from '@langchain/core/messages';`

### Behavior

Every `agentNode` call streams — including intermediate calls before tool use. Text like "Let me look at the files…" streams briefly, gets pushed to `staticItems` via `llm:end`, then the tool activity line takes over. Final `agentNode` call (no tool_calls) and `summarizerNode` stream the full response. This matches Claude Code's visible streaming behavior.

---

## Section 2: Fix `isAgentBusy`

### What changes

In `Chat.tsx`, widen the busy condition:

```typescript
// before
const isAgentBusy = isLoading || !!pendingApproval;

// after
const isAgentBusy = isLoading || !!pendingApproval || activities.some(a => a.status === 'running');
```

The `elapsed` timer effect already depends on `isAgentBusy` so the counter runs continuously through the whole turn — no reset between tool calls.

### Behavior

Input stays disabled and elapsed counter stays running while any tool is in `running` state, even if `isLoading` is momentarily false between LLM calls.

---

## Section 3: Compact activity summary (replaces ToolCards)

### Deleted

- `ToolCard.tsx`
- `ToolGroup.tsx`

### New utility: `buildActivitySummary`

Added to `apps/cli/src/utils/toolVerbs.ts`.

```typescript
type ActivityGroup = { verb: string; preposition: string; unit: string; count: number };

const TOOL_CATEGORY: Record<string, ActivityGroup> = {
  grep:           { verb: 'Searching', preposition: 'for', unit: 'pattern', count: 0 },
  search_files:   { verb: 'Searching', preposition: 'for', unit: 'pattern', count: 0 },
  read_file:      { verb: 'Reading',   preposition: '',    unit: 'file',    count: 0 },
  find_definition:{ verb: 'Reading',   preposition: '',    unit: 'file',    count: 0 },
  ast_analyzer:   { verb: 'Reading',   preposition: '',    unit: 'file',    count: 0 },
  analyze_code:   { verb: 'Reading',   preposition: '',    unit: 'file',    count: 0 },
  bash:           { verb: 'Running',   preposition: '',    unit: 'command', count: 0 },
  edit_file:      { verb: 'Editing',   preposition: '',    unit: 'file',    count: 0 },
  write_file:     { verb: 'Editing',   preposition: '',    unit: 'file',    count: 0 },
  patch_file:     { verb: 'Editing',   preposition: '',    unit: 'file',    count: 0 },
  delete_file:    { verb: 'Deleting',  preposition: '',    unit: 'file',    count: 0 },
  list_dir:       { verb: 'Listing',   preposition: '',    unit: 'directory', count: 0 },
  glob:           { verb: 'Listing',   preposition: '',    unit: 'directory', count: 0 },
  git_diff:       { verb: 'Running',   preposition: '',    unit: 'git command', count: 0 },
  git_log:        { verb: 'Running',   preposition: '',    unit: 'git command', count: 0 },
  rename_symbol:  { verb: 'Renaming',  preposition: '',    unit: 'symbol',  count: 0 },
};
```

Output format: `"Searching for 2 patterns, reading 3 files, running 1 command…"`  
Rules: first group capitalized, rest lowercase; preposition included when non-empty; plural unit when count > 1.

### File reference

`buildActivityFileRef(activities: ToolActivity[]): string | null` — returns the `label` of the most recently started running activity (using `startedAt`). Shown below the summary as `⎿  path/to/file`.

### LiveZone rendering (running tools)

Multiple running tools:
```
  Searching for 2 patterns, reading 3 files, running 1 command…
  ⎿  apps/cli/src/screens/chat/Chat.tsx
```

Single running tool:
```
  ⏺ Reading apps/cli/src/screens/chat/Chat.tsx…
```

Done tools: not rendered in LiveZone. Held in `activities` state, promoted to `TurnSummaryCard` on next `handleSubmit` (unchanged).

---

## Section 4: Status bar — spinner + thinking phrase

### Props change

`StatusBar` gains two new props:
- `isActive: boolean` — drives the spinner
- `thinkingPhrase: string | null` — current phrase to display

### Spinner

Uses the same braille frames from `Loading.tsx` (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), cycling at 80ms via `setInterval` inside StatusBar when `isActive`.

### Layout

**Idle:**
```
claude-3-5-sonnet · main · 5 msgs
```

**Active:**
```
⠼ Reviewing results… · 3m 28s · main
```

Thinking phrase falls back to `"Working…"` when null but active. Model name is hidden when active (replaced by phrase) to keep the line short.

### LiveZone cleanup

- Remove `thinkingPhrase` prop from LiveZone — it moves to StatusBar
- Remove `showCursor` / `setInterval` cursor blink (`▋`) — the status bar spinner is the sole activity indicator
- `isStreaming` prop removed (no longer needed without cursor)

---

## File change summary

| File | Change |
|------|--------|
| `packages/agent/src/main/agent_node.ts` | `invoke` → `stream`, emit `llm:token` |
| `packages/agent/src/main/summarizer.ts` | `invoke` → `stream`, emit `llm:token` |
| `apps/cli/src/screens/chat/Chat.tsx` | widen `isAgentBusy`; pass `thinkingPhrase`/`isActive` to StatusBar; remove `thinkingPhrase` from LiveZone |
| `apps/cli/src/screens/chat/components/StatusBar.tsx` | add spinner + thinking phrase |
| `apps/cli/src/screens/chat/components/LiveZone.tsx` | compact summary; remove cursor; remove thinking phrase |
| `apps/cli/src/utils/toolVerbs.ts` | add `buildActivitySummary`, `buildActivityFileRef` |
| `apps/cli/src/screens/chat/components/ToolCard.tsx` | **deleted** |
| `apps/cli/src/screens/chat/components/ToolGroup.tsx` | **deleted** |
| `apps/cli/src/screens/chat/components/index.ts` | remove ToolCard/ToolGroup exports |
