# UI Rework — Claude Code Style

**Date:** 2026-05-29
**Status:** Approved

---

## Goal

Rework the entire CLI UI to match Claude Code's console-style aesthetic: flat/borderless rendering, slash-command-driven navigation, inline streaming, no session selection screen, `/clear` for session reset, `/compact` for LLM-driven conversation summarization, and a `<Static>`-based rendering fix to eliminate terminal blinking.

---

## Approach

Systematic component-by-component rework top-down through the component tree. Each layer is independently verifiable. Backend compaction refactor is colocated with the `/compact` command wire-up.

---

## Section 1 — App Routing & Session Auto-Continuation

**Change:** Remove session selection from the startup flow. If an active profile exists, auto-navigate straight to chat on mount. The `WelcomeScreen` is only shown to first-time users with no profile (profile setup only).

- `app.tsx` `Screen` component: on mount, if `activeProfile && session` → immediately navigate to `'assistant'`
- If `activeProfile` but no session → create one via `SessionService.create()` then navigate to `'assistant'`
- `welcome` route is now profile-setup-only
- `<Navigation>` component is deleted entirely — no footer
- `history` (SessionInspector) route is kept but only reachable via `/inspect` command

**Files changed:**
- `apps/cli/src/app.tsx` — remove Navigation, update Screen routing logic
- `apps/cli/src/screens/WelcomeScreen.tsx` — remove SessionList, keep profile setup only
- `apps/cli/src/components/Navigation.tsx` — deleted
- `apps/cli/src/components/Session.tsx` — deleted (SessionList component)

---

## Section 2 — Slash Command Palette

**Input behavior:** When the user types `/`, a `SlashPalette` component renders between the message area and the input line. Arrow keys navigate the list; Tab or Enter selects and fills the input. Escape dismisses. Palette hidden when input doesn't start with `/`.

**Command registry** (replaces scattered `if (command === 'xxx')` in `Chat.tsx`):

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/clear` | Delete current session, start fresh |
| `/compact` | Summarize conversation with AI |
| `/approve` | Toggle auto-approve mode |
| `/audit [N]` | Show last N audit entries (default 10) |
| `/transcript` | Show transcript file path |
| `/inspect` | Open session inspector screen |
| `/replay` | Reload persisted messages |

Navigation commands (`/sessions`, `/new`, `/fork`, `/switch`, `/rename`) are removed — session management is `/clear` only.

**Palette visual:**
```
  /compact    Summarize conversation with AI
  /clear      Start a new session
❯ /help       Show available commands
  /approve    Toggle auto-approve mode
```
Selected row: `❯` prefix + bright white text. Others: dimmed. Palette filters to commands matching the current input prefix.

**Keyboard handling in `ChatInput`:**
- Up/Down arrow when palette is open → move selection (prevent history navigation)
- Tab or Enter with palette open + selection → fill input with command + close palette
- Escape → close palette, clear input

**New files:**
- `apps/cli/src/elements/SlashPalette.tsx` — filtered command list, selection highlight

**Modified files:**
- `apps/cli/src/elements/ChatInput.tsx` — palette keyboard integration, `SlashPalette` rendered inline above input

---

## Section 3 — Message & Streaming Rendering

### Message styles (Claude Code flat style)

**Human:**
```
> fix the auth bug in middleware
```
`> ` prefix in dim gray, message text in white.

**AI (completed and streaming):**
```
I'll start by reading the middleware file to understand the current structure.
```
Plain white text, no prefix, no container. Streaming renders identically — text grows inline with no box or "streaming" label.

**System/notice:**
```
◆ Auto-approve enabled
◆ Conversation compacted · 23 messages → 1 summary
```
Dim gray, `◆` prefix.

**Tool activity (ActivityFeed):**
```
⏺ read_file  src/middleware/auth.ts
✓ edit_file  src/middleware/auth.ts          3s
✗ bash       Run: pnpm test  — exit 1
```
Single line per tool. `⏺` cyan for running, `✓` green for done, `✗` red for error. No output preview unless error (first 3 lines of error output shown inline, dim).

### `<Static>` fix

Completed messages (`dedupedMessages`) are wrapped in Ink's `<Static items={dedupedMessages}>` so they render once and never trigger terminal repaints. Only these remain dynamic:
- Streaming text
- Tool activity feed
- Approval prompts
- Status line
- Input area

This eliminates the blinking caused by full-screen re-renders on every token.

**Files changed:**
- `apps/cli/src/screens/chat/components/MessageCard.tsx` — remove all `borderStyle`, new flat role styles
- `apps/cli/src/screens/chat/components/ActivityFeed.tsx` — single-line format, error-only preview
- `apps/cli/src/screens/chat/Chat.tsx` — wrap `dedupedMessages` in `<Static>`, remove streaming box

---

## Section 4 — Approval Components

All approval components are flat, inline, borderless. `ApproveFooter.tsx` is deleted — `y/n` key handling moves directly into each approval component.

**Plan approval:**
```
  Plan · fix auth bug in middleware              [medium]

  1. inspect  src/middleware/auth.ts
  2. edit     src/middleware/auth.ts
  3. bash     Run: pnpm test

  ❯ yes   no    y/n
```

**Tool approval:**
```
  ◦ edit_file · src/middleware/auth.ts

  - const token = req.headers['x-token']
  + const token = req.headers.authorization?.split(' ')[1]

  ❯ yes   no    y/n
```
Risk icons: `•` safe (green), `◦` moderate (yellow), `!` destructive (red). Diff view kept.

**Question / clarification:**
```
  ? clarification needed
  What test framework are you using?
```
Cursor drops into input. No separate prompt box.

**Step blocked:**
```
  ✗ step blocked · edit src/config/index.ts
  Cannot find symbol `defaultTimeout`

  type a hint to retry, or s to skip
```
Cursor in input.

**Files changed:**
- `apps/cli/src/elements/ApproveFooter.tsx` — deleted
- `apps/cli/src/screens/chat/components/PendingPlan.tsx` — remove border, inline y/n
- `apps/cli/src/screens/chat/components/PendingTool.tsx` — remove border, inline y/n
- `apps/cli/src/screens/chat/components/PendingReplan.tsx` — remove border, inline y/n
- `apps/cli/src/screens/chat/components/QuestionPrompt.tsx` — remove border, flat label
- `apps/cli/src/elements/index.ts` — remove ApproveFooter export

---

## Section 5 — `/clear`, `/compact`, and Backend Refactor

### `/clear`

1. Stop active agent: `EventBus.emit('agent:stop', { sessionId })`
2. Delete current session: `SessionService.delete(session.id)`
3. Create fresh session: `SessionService.create()`
4. Set as active: `SessionService.set(newSession.id)` + `EventBus.emit('agent:set-session', newSession)`
5. Clear all transient UI state (messages, streaming, activities, approvals)

No navigation — stays in chat screen with blank state.

### `/compact` — backend refactor

**New function** `compactConversation(messages, sessionId)` in `packages/agent/src/context/compressor.ts`:
1. Filters to human + AI messages only (skips system, tool messages)
2. LLM call with summarization prompt: *"Summarize this conversation into a concise context block preserving goals, decisions, key findings, and current state"*
3. Returns `SystemMessage` with summary text

`compressHistoryJson` in `agentNode` is unchanged — it remains a silent token-trim for internal LLM context management. These are independent concerns.

**New AppEvents** in `packages/shared/src/types/event.ts`:
```typescript
'agent:compact_request': { sessionId: string }
'agent:compact_complete': { sessionId: string; summary: string; originalCount: number }
```

**`RoboAgent`** gains a listener for `agent:compact_request`:
1. Calls `compactConversation(messages, sessionId)`
2. `MessageService.clear(sessionId)`
3. `MessageService.add(sessionId, summaryMsg)`
4. Emits `agent:compact_complete`

**UI side (`Chat.tsx`):**
- `/compact` command → emit `agent:compact_request` + set `isLoading = true` + `thinkingText = 'Compacting…'`
- On `agent:compact_complete` → replace `messages` state with `[summaryMsg]`, show notice:
  ```
  ◆ Conversation compacted · 23 messages → 1 summary
  ```

**Files changed:**
- `packages/agent/src/context/compressor.ts` — add `compactConversation`
- `packages/shared/src/types/event.ts` — add `agent:compact_request`, `agent:compact_complete`
- `packages/agent/src/main/index.ts` (RoboAgent) — add compact_request listener
- `apps/cli/src/screens/chat/Chat.tsx` — `/clear` handler, `/compact` command + event listener

---

## Section 6 — Input Area & Status Line

### AgentStatus (rewritten)

Single line, shown only when busy (hidden when idle):
```
⠹ edit_file · src/middleware/auth.ts  (12s)
```
- Spinner + label (current tool name or `thinkingText`)
- Elapsed time (dim, only when > 0)
- No suggestions row

### ChatInput (reworked)

No border. Prompt glyph only:
```
❯ _
```
- `❯` white when active, dim when busy
- No placeholder text
- `SlashPalette` rendered immediately above this line

### Full bottom area layout

```
⠹ edit_file · src/middleware/auth.ts  (4s)      ← AgentStatus (hidden when idle)
  /compact    Summarize conversation with AI     ← SlashPalette (hidden unless / typed)
  /clear      Start a new session
❯ /cl_                                           ← Input
```

**Files changed:**
- `apps/cli/src/screens/chat/components/AgentStatus.tsx` — rewrite, single-line, hidden when idle
- `apps/cli/src/elements/ChatInput.tsx` — remove border, add SlashPalette, update prompt glyph

---

## File Map

### New files

| File | Purpose |
|---|---|
| `apps/cli/src/elements/SlashPalette.tsx` | Filtered command list with keyboard navigation |

### Modified files

| File | Change |
|---|---|
| `apps/cli/src/app.tsx` | Remove Navigation, auto-navigate to chat on mount |
| `apps/cli/src/screens/WelcomeScreen.tsx` | Remove SessionList, profile-setup only |
| `apps/cli/src/screens/chat/Chat.tsx` | Static wrap, command handlers, compact events, streaming inline |
| `apps/cli/src/screens/chat/components/MessageCard.tsx` | Flat styles, no borders |
| `apps/cli/src/screens/chat/components/ActivityFeed.tsx` | Single-line format |
| `apps/cli/src/screens/chat/components/AgentStatus.tsx` | Single-line, hidden when idle |
| `apps/cli/src/screens/chat/components/PendingPlan.tsx` | Flat, inline y/n |
| `apps/cli/src/screens/chat/components/PendingTool.tsx` | Flat, inline y/n |
| `apps/cli/src/screens/chat/components/PendingReplan.tsx` | Flat, inline y/n |
| `apps/cli/src/screens/chat/components/QuestionPrompt.tsx` | Flat label |
| `apps/cli/src/elements/ChatInput.tsx` | No border, SlashPalette integration |
| `apps/cli/src/elements/index.ts` | Remove ApproveFooter export |
| `packages/agent/src/context/compressor.ts` | Add `compactConversation` |
| `packages/shared/src/types/event.ts` | Add compact request/complete events |
| `packages/agent/src/main/index.ts` | RoboAgent compact_request listener |

### Deleted files

| File | Reason |
|---|---|
| `apps/cli/src/components/Navigation.tsx` | Footer removed |
| `apps/cli/src/components/Session.tsx` | Session list removed |
| `apps/cli/src/elements/ApproveFooter.tsx` | Replaced by inline y/n in each approval component |

---

## What This Does Not Cover

- Persistent command history across sessions (up-arrow history is in-session only)
- Markdown rendering improvements (headers, bold, lists)
- Color theme customization
- Mouse support
