# Approval & UI Rework Design

**Date:** 2026-06-01  
**Scope:** Fix broken approval flow + rework live/input chrome in chat screen

---

## Problems Being Solved

1. **Approval bug** — `resume()` converts decision to boolean before passing to `Command.resume`; interrupt handlers expect strings `'approve'`/`'y'`. Both plan and tool approvals always fail silently.
2. **Plan as plain text** — `ApprovalCard` renders plan string as raw `<Text>`. No visual structure.
3. **No tool streaming** — `tool:stream` chunks are stored in `ToolActivity.stream` but never shown in `LiveZone`.
4. **Screen blink** — `setStaticKey` bump on compact forces `<Static>` full remount. Approval toggle mounts/unmounts `LiveZone` / `ApprovalCard`.
5. **Working rectangle** — `ChatInput` swaps to a fake disabled box when loading, obscuring the input.
6. **Input hidden during work** — User cannot see the input while agent is running.

---

## Fix 1 — Approval Bug

**File:** `packages/agent/src/index.ts`, `RoboAgent.resume()`

Remove the boolean conversion. Pass the raw decision string directly to `Command.resume`:

```ts
// Before
const approved = decision === 'approve' || decision === 'y';
await rootGraph.invoke(new Command({ resume: approved }), config);

// After
await rootGraph.invoke(new Command({ resume: decision }), config);
```

Both `requestApprovalTool` (`packages/tools/src/tools/control/requestApproval.ts`) and `toolsNode` (`packages/agent/src/main/tools_node.ts`) already check `decision === 'approve' || decision === 'y'` — they will receive the expected strings.

The `canResume` auto-approve on session load (Chat.tsx line 116) retains existing behavior: if a session has a pending interrupt on mount, it emits `agent:resume` with `'approve'`. This is acceptable for now.

---

## Fix 2 — Plan Card Display

**File:** `apps/cli/src/screens/chat/components/ApprovalCard.tsx`

Parse plan text into lines and render inside a bordered box with a `Plan` header. Visual target:

```
╭─ Plan  ·  moderate ──────────────────
│
│  1. Create new component PlanCard.tsx
│  2. Update Chat.tsx
│  3. Remove old branch
│
╰─ approve  deny  ·  y/n  ←/→  Enter
```

- Split `approval.plan` on `\n`, render each line inside `│` prefix with `paddingLeft`
- Use Ink `borderStyle="round"` box or manual border chars — manual gives more control
- Header color: `PALETTE.amber` (moderate) or `PALETTE.rust` (destructive)
- Action row stays below plan content, same y/n/←/→/Enter controls
- Non-plan approval kinds (tool) are unaffected — only `approval.kind === 'plan'` changes

---

## Fix 3 — Tool Single-Line Streaming

**File:** `apps/cli/src/screens/chat/components/LiveZone.tsx`

When a running tool has stream chunks, show the last chunk as a second line below the tool name line. No accumulation — latest chunk only, truncated to ~80 chars.

```
⏺  Running bash  ./scripts/build.sh…
⎿  > Compiling packages/shared/src/types/event.ts
```

- `ToolActivity.stream` already populated via `tool:stream` events
- Read `activity.stream.at(-1)?.text` for last chunk
- Render as `<Text color={PALETTE.faint}>⎿  {truncate(lastChunk, 80)}</Text>`
- Only shown when `stream.length > 0` on a running activity
- Multi-tool case: show stream of first running tool with stream data

---

## Fix 4 — Remove Screen Blink

**File:** `apps/cli/src/screens/chat/Chat.tsx`

**Blink source 1:** `setStaticKey(k => k + 1)` in the `agent:compact_complete` handler forces `<Static key={staticKey}>` to remount, re-rendering all static items from scratch. Fix: remove `staticKey` state entirely; remove the `key={staticKey}` prop. Compact updates `staticItems` array which is sufficient — `<Static>` appends new items without needing a key change.

**Blink source 2:** `{!pendingApproval && <LiveZone .../>}` and `{pendingApproval && <ApprovalCard .../>}` conditionally mount/unmount components on approval toggle, causing layout reflow. Fix: render `<LiveZone>` regardless (it already returns `null` when no content); render `<ApprovalCard>` only when pending (acceptable — it's a deliberate content change, not a layout thrash).

---

## Fix 5 & 6 — Remove Working Rectangle + Status Line Above Input

### Layout change

Current bottom zone:
```
[StatusBar: spinner + thinking | model + branch]
[ChatInput: real box OR fake "working…" box]
```

New bottom zone:
```
[StatusBar: model · branch · msgs  (always)]
[WorkingLine: ⠙ Thinking…  ·  12s  (only when busy)]
[ChatInput: always real input, dimmed when busy]
```

### `ChatInput` changes (`apps/cli/src/elements/ChatInput.tsx`)

Remove the `isLoading` branch that renders a fake box. Always render the real `TextInput`. When `isActive=false`:
- Border color → `PALETTE.faint`
- Prompt char `❯` → dimmed
- `TextInput` has `focus={false}` (already controlled by `isActive`)

### New `WorkingLine` component (`apps/cli/src/screens/chat/components/WorkingLine.tsx`)

Small component (~20 lines). Props: `isActive: boolean`, `thinkingPhrase: string | null`, `elapsed: number | null`.

```
⠙ Thinking…  ·  12s
```

- Spinner: same `SPINNER_FRAMES` array, 80ms interval, only ticks when `isActive`
- Returns `null` when `!isActive`
- Renders between `StatusBar` and `ChatInput` in `Chat.tsx`

### `StatusBar` changes

Remove the `isActive` branch that shows spinner + thinking phrase — that responsibility moves to `WorkingLine`. `StatusBar` always shows the idle row (model · branch · auto · msgs). Remove `thinkingPhrase` prop.

The `elapsed` prop on `StatusBar` is no longer needed; it moves to `WorkingLine`.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/agent/src/index.ts` | Fix resume string passthrough |
| `apps/cli/src/screens/chat/components/ApprovalCard.tsx` | Structured plan rendering |
| `apps/cli/src/screens/chat/components/LiveZone.tsx` | Last stream chunk display |
| `apps/cli/src/screens/chat/Chat.tsx` | Remove staticKey, add WorkingLine, remove isLoading from ChatInput call |
| `apps/cli/src/elements/ChatInput.tsx` | Remove fake loading box |
| `apps/cli/src/screens/chat/components/WorkingLine.tsx` | New component (spinner + phrase + elapsed) |
| `apps/cli/src/screens/chat/components/StatusBar.tsx` | Remove active/spinner branch, simplify to idle-only |

---

## What Is Not Changed

- Event contracts (`AppEvents`) — no new events needed
- `toolsNode` interrupt logic — works correctly once resume passes strings
- `requestApprovalTool` — no change needed
- `canResume` auto-approve on session load — retained as-is
- Tool approval card (non-plan) visual — unchanged
