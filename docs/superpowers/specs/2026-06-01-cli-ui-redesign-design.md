# CLI UI/UX Redesign — Design Spec
**Date:** 2026-06-01  
**Status:** Approved  
**Approach:** Incremental component swap (B)

---

## Goal

Redesign the Robocode CLI interface to match Claude Code's visual style, component patterns, and UX behaviours. Add token/cost tracking and extended thinking display as new features alongside the visual overhaul.

---

## Scope

- `apps/cli/src/` — all UI components
- `packages/shared/src/utils/cost.ts` — new cost computation util
- `packages/shared/src/types/event.ts` — new `llm:usage` event
- `packages/agent/src/` — emit `llm:usage` after LLM calls
- `packages/config/src/` — add `MODEL_CONTEXT` window map

Out of scope: agent graph logic, tool definitions, session/checkpoint persistence.

---

## Decisions Summary

| Area | Decision |
|------|----------|
| Overall layout | CC style — minimal, no chrome |
| Tool activity | `⏺ Tool(arg)` + per-tool timing + status icons |
| Approval prompts | Prominent bordered modal (high-contrast) |
| Status bar | Two-row: info line + context fill bar |
| Input style | Separator line only, no box border |
| Message rendering | CC clean (❯ human, no AI label) + line numbers |
| Turn summary | CC compact footer: counts left, cost right |
| Thinking indicator | Contextual phrase cycling |
| Welcome screen | Text logo — spaced "ROBOCODE" letters |
| Color scheme | CC closer (VSCode Dark+ palette) |
| Slash palette | Two-panel: command list + description |
| New features | Token/cost tracking, extended thinking display |

---

## Architecture

### Component Replacement Order

Replace in this order so each step is independently shippable:

1. `utils/colors.ts` — new PALETTE
2. `components/StatusBar.tsx` — context fill bar
3. `components/WorkingLine.tsx` — contextual phrase cycling
4. `components/MessageCard.tsx` — CC clean + line numbers
5. `components/LiveZone.tsx` — `⏺ Tool(arg)` format + timing + status icons
6. `components/ApprovalCard.tsx` — prominent modal + "Always" allow-list
7. `elements/ChatInput.tsx` — separator line, multiline support
8. `components/TurnSummaryCard.tsx` — compact footer with cost
9. `screens/WelcomeScreen.tsx` — text logo
10. `elements/SlashPalette.tsx` — two-panel with descriptions
11. Token/cost tracking — agent emit + Chat state + StatusBar wiring
12. Extended thinking display — ThinkingBlock component + staticItems kind

### New EventBus Events

Added to `AppEvents` in `packages/shared/src/types/event.ts`:

```ts
'llm:usage': {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;  // USD
}
```

`llm:thinking` payload extended — already exists, no schema change needed.

### New StaticItem Kind

```ts
type StaticItem =
  | { kind: 'human';        id: string; content: string }
  | { kind: 'ai';           id: string; content: string }
  | { kind: 'system';       id: string; content: string }
  | { kind: 'turn-summary'; id: string; data: TurnSummaryData }
  | { kind: 'thinking';     id: string; text: string }  // NEW — no collapsed field here
```

Collapsed state lives outside `StaticItem` because Ink's `Static` component never re-renders items once committed. Chat.tsx maintains:

```ts
const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set())
```

`t` key toggles: `setCollapsedThinking(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })`. `ThinkingBlock` receives `collapsed={collapsedThinking.has(item.id)}`.

---

## Color System

Replace `apps/cli/src/utils/colors.ts` with VSCode Dark+ aligned palette:

```ts
export const PALETTE = {
  // Text hierarchy
  userText:    '#E8E8E8',
  aiText:      '#D4D4D4',
  muted:       '#6A6A6A',
  faint:       '#3A3A3A',

  // Semantic states
  teal:        '#4EC9B0',   // active / running  (was #4A9B8E)
  sage:        '#4A9B4A',   // success / done
  amber:       '#CE9178',   // warning / approval (was #C4884A)
  rust:        '#F44747',   // error
  slate:       '#569CD6',   // info / system notices
  path:        '#9CDCFE',   // file paths

  // Diff-specific (unchanged)
  diffAdd:     '#4A7A4A',
  diffDel:     '#7A3A3A',
  diffHunk:    '#569CD6',
  diffContext: '#505050',
  diffFaint:   '#3A3A3A',

  // Status bar
  statusBar:   '#4A4A4A',

  // Context bar fill thresholds
  ctxNormal:   '#4EC9B0',   // <75% usage
  ctxWarn:     '#CE9178',   // 75–90%
  ctxCrit:     '#F44747',   // >90%
} as const;
```

---

## Component Specifications

### StatusBar

Two-row layout. Always rendered at bottom of chat.

```
Row 1: claude-sonnet-4-6 · main · 12 msgs · 4,218 tok · ~$0.04 · ⚡ auto
Row 2: [████░░░░░░░░░░░░░░░░]   (thin 1-char-height fill bar)
```

- Fill bar width = terminal width − 2 (paddingX). Fill color based on context % thresholds.
- Context %: `totalTokens / MODEL_CONTEXT[model]`. `MODEL_CONTEXT` map in `packages/config`.
- Props: `{ model, branch, autoApprove, msgCount, totalTokens, totalCost }`.
- Cost formatted: `~$0.04` (2 decimal places, `~` prefix).

### WorkingLine

Phrase cycles based on last event received:

| Trigger | Phrase |
|---------|--------|
| `llm:start` | `"Thinking…"` |
| `tool:start` with read-category tool | `"Reading files…"` |
| `tool:start` with edit-category tool | `"Writing…"` |
| `tool:start` with bash tool | `"Running command…"` |
| `tool:end` | `"Reviewing results…"` |
| `agent:plan_pending` | `"Planning…"` |

Elapsed counter shown after 2s. Format: `4s` / `1m 4s`.

### MessageCard

Human messages:
```
❯ fix the auth bug
```
- `❯` in `PALETTE.muted`, text in `PALETTE.userText`. `paddingLeft={0}` (no extra indent).

AI messages:
- No prefix label. Text in `PALETTE.aiText`.
- Paragraphs separated by blank line.
- Inline code: backtick spans in `PALETTE.teal`.
- Code blocks: keep existing `│` left-border + line numbers. Header: `│ code · typescript`.

### LiveZone

Tool activity format:

```
⏺ Read(src/auth/middleware.ts)          0.3s
✓ Edit(src/auth/middleware.ts)          0.1s
✗ Bash(pnpm test)                       error
⠸ Bash(pnpm test auth)                 2.1s…
  ⎿  Running test suite…
```

- Icon by status: `⠸` (spinner, teal) = running, `✓` (sage) = done, `✗` (rust) = error.
- Tool label: `activity.name(primaryArg)` — `primaryArg` = first non-null of `activity.input.path | .file | .command | .input`, truncated to 50 chars.
- Timing right-aligned. `0.3s` under 60s, `1m 4s` over.
- Last-chunk line shown indented below running tool only.
- Streaming text continues to show above tool lines when present.

### ApprovalCard

High-contrast bordered modal. Border color: amber (moderate) or rust (destructive).

```
┌────────────────────────────────────────┐
│ ⚠  TOOL APPROVAL REQUIRED              │
│ edit_file · destructive                │
│                                        │
│ src/auth/middleware.ts                 │
│ ────────────────────────────────────── │
│ - if (token.exp < now) {               │
│ + if (token.exp <= now) {              │
│                                        │
│  [Y] Approve   [N] Deny   [A] Always  │
└────────────────────────────────────────┘
```

- Keys: `y` approve, `n` deny, `a` always-allow. Arrow keys cycle. Enter confirms selection.
- "Always" appends tool name to `~/.robocode/allowed-tools.json`. Loaded at startup in `RoboAgent`; tools in this list skip `interrupt()`.
- WorkingLine hidden while approval shown.

### ChatInput

- Remove `borderStyle="single"`. Add `borderTop` (1px, `PALETTE.faint`) to separate from chat.
- Placeholder: `"Message robocode…"`.
- Multiline: Shift+Enter inserts `\n`. Input grows vertically, max 6 lines. `TextInput` replaced with custom multiline handler or `ink-text-input` multiline mode if available; fallback to newline-in-value approach.
- Inactive: `❯` fades to `PALETTE.faint`.

### TurnSummaryCard

Single dim line appended below AI reply after turn completes:

```
⏺ read 3 · edit 1 · bash 1   ·   12s · 4,218 tok · ~$0.04   [14:32]
```

- Left: `⏺ ` + verb groups (grouped by tool category).
- Right: duration + tokens + cost + timestamp.
- Color: `PALETTE.statusBar` (dim). Icon `⏺` in `PALETTE.teal`.
- Props: `{ data: TurnSummaryData }` — `TurnSummaryData` extended with `tokens` and `cost` fields.

### WelcomeScreen

```
  R O B O C O D E
  AI CODE ASSISTANT · v0.1.0

  No profile configured.

  [ Y ] Set up profile    [ N ] Skip
```

- "ROBOCODE" rendered with spaces between letters. Color: `PALETTE.teal`.
- Subtitle: `PALETTE.muted`. Version sourced from `package.json` via import.
- No ASCII box-drawing art.

### SlashPalette

Two-panel layout rendered above input:

```
┌──────────────────┬──────────────────────────────────┐
│ /clear           │ /clear                            │
│ /compact         │                                   │
│ /approve         │ Start a new session. Deletes      │
│ /audit [N]       │ current conversation history.     │
│ /help            │ Prompts confirmation if session   │
│                  │ has more than 5 turns.             │
└──────────────────┴──────────────────────────────────┘
```

- Left panel: 18 chars wide. Filtered by current input. Active item: teal bg highlight.
- Right panel: fills remaining width. Shows description of highlighted command.
- Each entry in `SLASH_COMMANDS` array gains a `description: string` field.
- Keys: `↑↓` navigate, `Tab` complete to full command, `Esc` dismiss.

### ThinkingBlock (new component)

Triggered by `llm:thinking` events with non-null text. Stored as `kind: 'thinking'` in staticItems.

```
╎ thinking  [t to toggle]
╎ The user wants me to fix the token expiry check. I should
╎ start by reading the middleware to understand the bug…
```

- Collapsed by default after turn ends. Expanded during active thinking.
- `t` key toggles collapse when chat input is active.
- Border char `╎` in `PALETTE.faint`. Text in `PALETTE.faint` dimColor.
- Header line shows `thinking` label + toggle hint.

---

## Token/Cost Tracking

### Backend (agent layer)

After each LLM call in root `agentNode` and subagent nodes, emit:

```ts
EventBus.emit('llm:usage', {
  sessionId,
  inputTokens: response.usage.input_tokens,
  outputTokens: response.usage.output_tokens,
  cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  cost: computeCost(model, response.usage),
})
```

### Cost Computation

New file `packages/shared/src/utils/cost.ts`:

```ts
// Prices in USD per 1M tokens (as of 2026-06)
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cacheRead: 0.30 },
  'claude-opus-4-8':   { input: 15.00, output: 75.00, cacheRead: 1.50 },
  'claude-haiku-4-5':  { input: 0.80, output: 4.00,  cacheRead: 0.08 },
}

// UsageMetadata = Anthropic SDK APIUsage: { input_tokens, output_tokens, cache_read_input_tokens? }
export function computeCost(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }): number {
  const prices = PRICES[model] ?? PRICES['claude-sonnet-4-6']
  return (
    (usage.input_tokens * prices.input +
     usage.output_tokens * prices.output +
     (usage.cache_read_input_tokens ?? 0) * prices.cacheRead) / 1_000_000
  )
}
```

### Model Context Windows

New export in `packages/config/src/index.ts`:

```ts
export const MODEL_CONTEXT: Record<string, number> = {
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-8':   200_000,
  'claude-haiku-4-5':  200_000,
}
```

### UI State

`Chat.tsx` adds:
```ts
const [totalTokens, setTotalTokens] = useState(0)
const [totalCost, setTotalCost] = useState(0)
```

Subscribes to `llm:usage`: accumulates `inputTokens + outputTokens + cacheReadTokens` into `totalTokens`, accumulates `cost` into `totalCost`. Resets on `/clear`.

`TurnSummaryData` type extended:
```ts
interface TurnSummaryData {
  groups: { verb: string; count: number }[]
  durationSec: number
  hasError: boolean
  timestamp: number
  tokens: number   // NEW — turn-level token count
  cost: number     // NEW — turn-level cost USD
}
```

---

## Error Handling

- `computeCost` falls back to sonnet pricing if model not in table. No throw.
- If `llm:usage` missing from event stream (older provider), `totalTokens`/`totalCost` stay 0 — status bar omits those fields gracefully.
- `allowed-tools.json` read failure: log to debug, treat as empty list. Write failure: log, don't crash.
- Multiline input: if `ink-text-input` doesn't support multiline, fall back to single-line with a `[multiline not supported]` hint removed from scope.

---

## Testing

- Unit test `computeCost` with known token counts and expected dollar values.
- Unit test `MODEL_CONTEXT` lookup — missing model returns defined fallback.
- Unit test `buildTurnSummary` extended with tokens/cost fields.
- Manual smoke test: full chat turn with tool calls — verify LiveZone icons cycle correctly, TurnSummaryCard shows cost, StatusBar fill bar updates.
