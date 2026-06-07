# RoboCode Frontend Rework — Design Spec

**Date:** 2026-05-31  
**Status:** Approved, ready for implementation  
**Stack:** React + Ink (no renderer change)

---

## Design Principles

1. **Quiet competence.** The UI should feel like an expert engineer working while keeping you informed — not a dashboard screaming status at you.
2. **High contrast reserved for decisions.** Approval and error states draw the eye. Routine operations (file reads, searches) fade into the background.
3. **Respect the Static boundary.** Ink's `<Static>` is the architectural foundation. Completed state goes into Static; live state stays outside it. Never cross this boundary ad hoc.
4. **Motion is purposeful.** The only animation is the block cursor `▋` during streaming. No spinners, no pulsing icons. Static signals are easier to scan.
5. **Every error includes what to do next.** No dead ends.

---

## 1. Terminal Layout — 5-Zone Model

The screen is divided into five vertical zones with strict rendering contracts.

```
┌─────────────────────────────────────────────────────────────┐
│  STATIC ZONE  (Ink <Static>, render-once)                   │
│                                                             │
│  ❯  Refactor auth middleware to JWT                         │
│                                                             │
│  The refactor involves three changes: updating the token    │
│  validation logic, replacing session auth with stateless    │
│  JWT, and updating the middleware chain order.              │
│                                                             │
│  ✓  Read 4 · Searched 2 · Patched 2 · 28s     [14:23]     │
│                                                             │
│  ❯  Add tests for the new auth logic                        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  LIVE ZONE  (current turn only, clears on completion)       │
│                                                             │
│  The test suite should cover: token expiry, invalid...▋    │
│                                                             │
│  ⏺  Reading    src/auth/middleware.ts                      │
│  ✓  Searching  src/**/*.test.ts          4 matches  2s     │
│  ⏺  Writing    src/auth/middleware.test.ts                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  model: claude-sonnet-4-6  ·  develop  ·  ctx: 45k  ·  8s │
├─────────────────────────────────────────────────────────────┤
│  ❯ ▌                                                        │
└─────────────────────────────────────────────────────────────┘
```

During approval, the live zone is replaced by the approval card:

```
├─────────────────────────────────────────────────────────────┤
│  APPROVAL ZONE                                              │
│                                                             │
│  ◈  Write file  ·  destructive                             │
│     src/auth/middleware.test.ts                             │
│                                                             │
│  + import { verifyJWT } from '../utils/jwt';               │
│  + describe('auth middleware', () => {                      │
│  + ...  (+48 lines)  ·  d to expand                        │
│                                                             │
│  ▶ approve     deny          y / n   ←/→   Enter           │
└─────────────────────────────────────────────────────────────┘
```

### Zone Contracts

| Zone | Ink primitive | Re-renders | Clears |
|---|---|---|---|
| Static | `<Static>` | Never | Only on `/clear` (via `key={staticKey}`) |
| Live | `<Box>` | Freely | On turn end |
| Approval | `<Box>` conditional | Freely | On approval resolution |
| Status bar | `<Box>` | On event | Never |
| Input | `<Box>` | On keystroke | On submit |

### Promotion Pattern

When a turn ends, `Chat.tsx` constructs a `TurnSummary` record from the completed `ToolActivity[]` and appends it to the messages array. The Static zone re-renders with the new item. The live zone clears. Clean slate for the next turn.

---

## 2. Component Architecture

```
ChatScreen
├── <Static key={staticKey}>
│   ├── HumanMessageCard
│   ├── AIMessageCard
│   ├── TurnSummaryCard          ← new
│   └── SystemNoticeCard
├── <LiveZone>                   ← new wrapper
│   ├── StreamingText            ← adds block cursor ▋
│   └── ToolGroup                ← new: all current-turn tools
│       └── ToolCard[]
├── <ApprovalZone>               ← conditional, replaces LiveZone
│   └── ApprovalCard             ← new: unifies PendingTool + PendingPlan
├── <StatusBar>                  ← new
└── <InputZone>
    ├── SlashPalette
    └── ChatInput
```

### Deleted Components

- `AgentStatus` — removed. Spinner responsibility moves into the active `ToolCard` (teal `⏺`). Thinking text moves into `LiveZone` as a static phrase.
- `PendingTool` — merged into `ApprovalCard`.
- `PendingPlan` — merged into `ApprovalCard`.
- `GitDiffPreview` — simplified. Full diff display moves into `ApprovalCard` for write approvals. The remaining component becomes a minimal stat line in `LiveZone` (`◉  git diff  2 files changed  +18  -7`).

---

## 3. Color System

All values are hex, using Ink's `color="#RRGGBB"` prop. Supported in all modern terminals (iTerm2, Warp, macOS Terminal ≥ Monterey, Alacritty, Kitty).

| Element | Hex | Role |
|---|---|---|
| User text | `#E2E2E2` | Primary — clear but not harsh white |
| AI text | `#C8C8C8` | Slightly dimmer than user — readable, subordinate |
| Muted labels | `#666666` | Tool verbs, metadata, separators |
| Faint structure | `#3A3A3A` | Borders, dividers |
| Teal — active tool | `#4A9B8E` | Running state. Calm, not aggressive cyan |
| Sage — success | `#5A8A5A` | Done state. Muted green |
| Amber — warning / approval | `#C4884A` | Approvals, auto-approve indicator, ctx warning |
| Rust — error | `#904040` | Errors. Visible but not panic-inducing |
| Slate blue — info | `#5B8DB8` | System notices, model name |
| File paths | `#7EB8DA` | Light slate, visually distinct from prose text |
| Diff addition | `#4A7A4A` | `+` lines |
| Diff deletion | `#7A3A3A` | `-` lines |
| Diff hunk `@@` | `#5B8DB8` | Hunk headers |
| Diff context | `#505050` | Unchanged surrounding lines |
| Status bar | `#505050` | Everything in the bar — dimmed by default |
| Cursor `▋` | `#E2E2E2` | Matches user text, cycles on/off at 500ms |

**Principle:** only approval and error states draw the eye. Tool execution, AI text, and history sit in the same tonal range. High contrast is reserved for moments requiring a decision.

---

## 4. Tool Cards

### Single-Line Format

```
  ⏺  Reading    src/auth/middleware.ts                        ← running
  ✓  Reading    src/auth/middleware.ts         312 lines  2s  ← done
  ✗  Reading    src/auth/missing.ts            not found  1s  ← error
```

Column layout: `icon(1) · verb(10) · label(flex) · result(20) · duration(6)`

| Field | Rule |
|---|---|
| Icon | `⏺` teal (running), `✓` sage (done), `✗` rust (error) |
| Verb | From `TOOL_VERB` map in `toolVerbs.ts` — unchanged |
| Label | File path (relative to project root) or bash command (60 char max) |
| Result | Dimmed. Counts for searches, line count for reads, exit summary for bash |
| Duration | Only shown if ≥ 2s. Dimmed. |

### Bash Streaming

Bash is the only tool that streams live output. Up to 3 lines of stdout shown below the header, updating as output arrives. Lines older than the visible window are discarded.

```
  ⏺  Running    pnpm test
     ✓ auth middleware › validates JWT token
     ✓ auth middleware › rejects expired token
     · 14 tests passed...
```

On completion, streaming lines disappear. Card collapses to summary line.

### Nested Tools (Subagent)

```
  ⏺  Reader     analyzing auth middleware
    ✓  Reading    src/auth/middleware.ts       312 lines
    ✓  Searching  src/**/*.ts                  8 matches
    ⏺  Reading    src/utils/jwt.ts
```

- Parent line tracks overall subagent status
- Children indented 2 spaces, same ToolCard format at reduced visual weight
- On subagent completion, parent collapses: `✓  Reader   3 files · 2 searches · 6s`
- Maximum nesting: 1 level deep (root → subagent → tools)

### Parallel Tools

```
  ⏺  Reading    src/auth/middleware.ts           │
  ⏺  Reading    src/utils/jwt.ts                 │
  ⏺  Searching  src/**/*.test.ts                 │
```

Right-border marks the parallel group. On completion: `✓  3 parallel reads · 1s`

### TurnSummary Card

Replaces all ToolCards when a turn ends. Promoted into the Static zone alongside the AI response.

```
  ✓  Read 4 · Searched 2 · Patched 2 · 41s                  [14:23]
```

Format rules:
- Group by verb category, show count
- Total wall-clock time for the full turn
- Timestamp right-aligned, dimmed `[HH:MM]`
- On any tool error: rust color, `✗` icon, error count appended

---

## 5. Agent Thinking Visibility

### Visible to User

- Tool name + target (always)
- Tool result summary (on completion)
- Streaming AI response text with `▋` cursor
- Turn summary in history
- Short status phrases during LLM processing

### Hidden from User

- Chain-of-thought / extended thinking tokens
- Internal prompt templates
- LLM call parameters
- Subagent system prompts

### Thinking Indicator

A static dimmed phrase in the live zone when the LLM is processing but no tool is running:

```
  · Thinking...
```

Fixed vocabulary — not freeform strings from the agent:

| Moment | Phrase |
|---|---|
| Turn starts | `Thinking...` |
| After first tool batch | `Reviewing results...` |
| Generating response | `Drafting response...` |
| After compaction | `Resuming context...` |
| Waiting on approval | *(nothing — approval card speaks for itself)* |

No spinner. No animation. The `▋` cursor in streaming text is the only motion signal.

---

## 6. Approval UX

### ApprovalCard Layout

**File write/edit:**
```
  ◈  Write file  ·  destructive
     src/auth/middleware.ts

  ─────────────────────────────────────────────────────────
  - import { verifySession } from './session-auth';
  + import { verifyJWT } from '../utils/jwt';
    ... 31 more lines  ·  d to expand
  ─────────────────────────────────────────────────────────

  ▶ approve     deny          y / n   ←/→   Enter
```

**Bash command:**
```
  ◈  Run command  ·  moderate
     pnpm test -- --coverage --watch=false

  ▶ approve     deny          y / n   ←/→   Enter
```

**Plan:**
```
  ◈  Proposed plan

  1. Add JWT utility in src/utils/jwt.ts
  2. Update auth middleware to use JWT
  3. Add test coverage for expiry and signature cases

  ▶ approve     deny          y / n   ←/→   Enter
```

### Risk Tiers

| Tier | Icon color | Examples |
|---|---|---|
| moderate | amber `#C4884A` | bash (read), validate |
| destructive | rust `#904040` | write_file, edit_file, bash (write ops) |

### Keyboard Contract

| Key | Action |
|---|---|
| `y` | Approve immediately |
| `n` / `Escape` | Deny immediately |
| `←` / `→` | Toggle selection |
| `Enter` / `Space` | Confirm current selection |
| `d` | Expand/collapse diff preview |

### Default Selection

- Moderate risk: default selection is `approve`
- Destructive risk: default selection is `deny`

### Auto-approve Granularity

- `/approve moderate` — auto-approve moderate only
- `/approve all` — auto-approve all risk levels
- `/approve` — toggle (existing behavior, kept for compatibility)

---

## 7. Error Presentation

### Class 1 — Tool error (inline, agent continues)

```
  ✗  Running    pnpm test                exit 1: 3 tests failed  4s
```

Single line, rust icon. Never wraps. Full error available via `/audit 1`.

### Class 2 — Session-level error (enters Static zone)

```
  ◆  LLM error: request timeout after 30s
     Try again, or /compact to reduce context before retrying.
```

Slate blue `◆`, max 2 lines. Always includes a suggested action.

```
  ◆  Context limit approaching (95% used)
     Run /compact to summarize history before continuing.
```

### Class 3 — Fatal / agent stopped

```
  ┌─ stopped ──────────────────────────────────────────────┐
  │  Agent stopped: context window exceeded.               │
  │  Run /compact to summarize history, then retry.        │
  └────────────────────────────────────────────────────────┘
```

Rust border (`#904040`), max 3 lines including recovery action.

---

## 8. Diff Presentation

Format: collapsible inline unified diff. No side-by-side (insufficient terminal width).

### Small diff (< 15 changed lines) — always expanded

```
  ─── src/auth/middleware.ts  +4  -3 ──────────────────────
    1 │  import express from 'express';
  - 2 │  import { verifySession } from './session-auth';
  + 2 │  import { verifyJWT } from '../utils/jwt';
    3 │  
  - 4 │  const session = await Session.find(req.cookies.sessionId);
  + 4 │  const token = req.headers.authorization?.split(' ')[1];
```

### Large diff (≥ 15 changed lines) — collapsed by default

```
  ─── src/auth/middleware.ts  +48  -31 ────────────────────
      48 additions · 31 deletions · d to expand
```

### Color Rules

| Element | Color |
|---|---|
| `+` lines | `#4A7A4A` (sage) |
| `-` lines | `#7A3A3A` (rust) |
| `@@` hunk headers | `#5B8DB8` (slate) |
| Context lines | `#505050` (muted) |
| Line numbers | `#3A3A3A` (faint) |
| File header | `#7EB8DA` (path blue) |

No per-line background highlighting. Foreground color + prefix character only.

### Git Diff at Turn End

Appears as a minimal stat line at the end of the live zone:

```
  ◉  git diff  2 files changed  +18  -7
```

Press `g` to expand full diff inline. Disappears when the turn ends (not promoted to TurnSummary).

---

## 9. Status Bar

Single line, always rendered. All text at `#505050`.

**Idle:**
```
  claude-sonnet-4-6  ·  develop  ·  ctx: 45k  ·  12 turns
```

**Active:**
```
  claude-sonnet-4-6  ·  develop  ·  ctx: 45k  ·  32s
```

**Auto-approve active:**
```
  claude-sonnet-4-6  ·  develop  ·  ⚡ auto  ·  ctx: 45k  ·  32s
```

**Context warning:**
```
  claude-sonnet-4-6  ·  develop  ·  ctx: 85k ⚠  ·  23 turns
```

| Field | Source | Rule |
|---|---|---|
| Model | Profile config | Slug form. Truncate if terminal < 100 cols. |
| Branch | `ContextService` git state | Shows `no git` if not in a repo |
| `⚡ auto` | `autoApprove` state | Amber `#C4884A`. Only colored element in bar. |
| `ctx` | `llm:end` event metadata | Token count if available, else `N msgs` |
| Elapsed / turns | Timer / turn counter | Elapsed shown while agent runs, turn count at rest |
| `⚠` | ctx threshold | Amber, appears at 85% of model limit |

---

## 10. Session Timeline

No dedicated timeline panel. The **TurnSummary cards in the Static zone are the timeline.** Each completed turn is a single dated line:

```
  ✓  Read 4 · Searched 2 · Patched 2 · 28s                      [14:23]
  ✓  Read 3 · Searched 4 · Wrote 2 · Ran 1 command · 41s        [14:31]
  ✓  Read 2 · Searched 1 · 12s                                   [14:38]
```

Timestamps are right-aligned and dimmed. `/inspect` navigates to `SessionInspector` for full audit detail.

---

## 11. Long Session Experience

### Compaction

At 85% context usage, the status bar shows `ctx: 85k ⚠`. No popup, no interruption.

After `/compact`, a system notice enters Static:
```
  ◆  Compacted · 48 messages → 1 summary  [15:12]
```

This notice acts as a visual chapter break in the session history.

### Screen Accumulation

No artificial truncation. Ink scrolls the terminal naturally. TurnSummary cards are single lines — history is dense but scannable. The live zone always appears at the bottom, anchoring the user to "now".

### Eye Strain

- No pure `#FFFFFF` white. User text is `#E2E2E2`.
- No saturated `cyan`/`green`. Replaced by muted teal `#4A9B8E` and sage `#5A8A5A`.
- High contrast only for approvals and fatal errors.
- Single animation: `▋` at 500ms.

### Interrupt

`Ctrl+C` during execution emits `agent:stop`, shows `◆ Interrupted.` notice, returns input to ready state. `Escape` navigates back to welcome screen. These are two separate keybindings — currently conflated.

---

## 12. Production-Grade Checklist

### Tool Execution
- [ ] Duration only shown if ≥ 2s
- [ ] File paths always relative to project root
- [ ] Bash label truncated at 60 chars
- [ ] Bash exit code shown on error (`exit 1: 3 tests failed`)
- [ ] Grep/search shows match count, not raw output
- [ ] Read shows line count
- [ ] Write shows `+N -N` line delta
- [ ] Subagent parent card title is semantic (not `delegate_to_reader`)
- [ ] Parallel tools collapse to single summary line
- [ ] Tool stream lines are trimmed (no blank gap lines)
- [ ] Tool labels never wrap (truncated with `…` at terminal width)

### Streaming & Animation
- [ ] Block cursor `▋` blinks at 500ms, stops on stream end
- [ ] No layout jump during streaming
- [ ] Thinking indicator is static text, not animated
- [ ] `⏺` icon is static (no spin)
- [ ] Tool card columns are fixed-width (no alignment shift during updates)
- [ ] 1-frame debounce on streaming → Static transition

### Input & Interaction
- [ ] Input border dims during agent execution
- [ ] `❯` prompt dims when `isLoading`
- [ ] Placeholder text in empty idle input
- [ ] `Shift+Enter` inserts newline (multiline support)
- [ ] Input history is per-session
- [ ] `/clear` prompts for confirmation when session has > 5 turns
- [ ] `Ctrl+C` interrupts agent; `Escape` navigates away (split keybindings)

### Approval & Safety
- [ ] Full file path shown in approval card, never truncated
- [ ] Risk level labeled in plain English (`destructive`, `moderate`)
- [ ] Default selection is `deny` for destructive, `approve` for moderate
- [ ] `/approve moderate` and `/approve all` granularity
- [ ] `Escape` in approval = deny (not navigate away)
- [ ] Brief "approved" visual confirmation (300ms) before live zone resumes
- [ ] Denied tool shows `◆ Tool denied: write_file · agent stopped.`

### Error & Recovery
- [ ] Inline errors never exceed 2 lines
- [ ] Every error includes a suggested action
- [ ] Network errors distinguished from model errors
- [ ] Retryable errors show retry hint
- [ ] Fatal errors preserve session history (no auto-clear)

### Information Hierarchy
- [ ] User text heavier than AI text (`#E2E2E2` vs `#C8C8C8`)
- [ ] System notices use slate blue, always dimmed
- [ ] TurnSummary is the quietest element in the feed
- [ ] TurnSummary timestamps right-aligned
- [ ] Status bar text never draws the eye (except `⚡` and `⚠`)
- [ ] AI response code blocks use left border `│` not full box

### Session Management
- [ ] `/compact` shows `· Compacting...` progress indicator
- [ ] Compaction notice acts as visual chapter break
- [ ] Session restore on startup is silent (no banner)
- [ ] `/inspect` shows session metadata at top before message list
- [ ] `/transcript` copies path to clipboard via OSC 52 if supported

### Visual Polish
- [ ] No emoji in system-generated text (except `⚡` and `⚠`)
- [ ] All borders use box-drawing characters (`─`, `│`) not ASCII (`-`, `|`)
- [ ] All paddings consistent: `paddingX={1}` zones, `paddingLeft={2}` content, `paddingLeft={4}` nested
- [ ] Welcome screen logo uses slate blue palette
- [ ] Loading fallback styled with muted teal
- [ ] All truncation and diff display respect `stdout.columns`

---

## Appendix: Files to Create / Modify

### New Components
- `apps/cli/src/screens/chat/components/ToolCard.tsx`
- `apps/cli/src/screens/chat/components/ToolGroup.tsx`
- `apps/cli/src/screens/chat/components/TurnSummaryCard.tsx`
- `apps/cli/src/screens/chat/components/ApprovalCard.tsx`
- `apps/cli/src/screens/chat/components/LiveZone.tsx`
- `apps/cli/src/screens/chat/components/StatusBar.tsx`
- `apps/cli/src/screens/chat/components/SystemNoticeCard.tsx`
- `apps/cli/src/utils/colors.ts`  ← hex color constants

### Modified Components
- `apps/cli/src/screens/chat/Chat.tsx` — zone orchestration, turn promotion logic, Ctrl+C interrupt
- `apps/cli/src/screens/chat/components/MessageCard.tsx` — new color palette, left-border code blocks
- `apps/cli/src/screens/chat/components/ActivityFeed.tsx` — replaced by `ToolGroup` + `ToolCard`
- `apps/cli/src/screens/chat/components/DiffView.tsx` — new palette, collapse threshold
- `apps/cli/src/screens/chat/components/GitDiffPreview.tsx` — simplified to stat line
- `apps/cli/src/elements/ChatInput.tsx` — placeholder text, Shift+Enter, dim state
- `apps/cli/src/screens/WelcomeScreen.tsx` — updated palette

### Deleted Components
- `apps/cli/src/screens/chat/components/AgentStatus.tsx`
- `apps/cli/src/screens/chat/components/PendingTool.tsx`
- `apps/cli/src/screens/chat/components/PendingPlan.tsx`
