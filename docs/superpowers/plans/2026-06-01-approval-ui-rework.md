# Approval & UI Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken approval flow and rework the chat screen's live/input chrome to match Claude Code CLI patterns.

**Architecture:** Six targeted fixes applied in dependency order — critical bug first (approval passthrough), then visual improvements (plan card, tool streaming, blink, input chrome). No new events or schema changes needed.

**Tech Stack:** TypeScript, React, Ink 5, LangGraph, Jest (ESM + `@jest/globals`), EventBus (typed EventEmitter)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/agent/src/index.ts` | Modify | Fix resume string passthrough |
| `__tests__/agent/approvalResume.test.ts` | Create | Unit test for fix |
| `apps/cli/src/screens/chat/components/ApprovalCard.tsx` | Modify | Structured plan box |
| `apps/cli/src/screens/chat/components/LiveZone.tsx` | Modify | Last stream chunk line |
| `apps/cli/src/screens/chat/components/WorkingLine.tsx` | Create | Spinner + phrase + elapsed |
| `apps/cli/src/screens/chat/components/StatusBar.tsx` | Modify | Remove active/spinner branch |
| `apps/cli/src/elements/ChatInput.tsx` | Modify | Remove fake loading box |
| `apps/cli/src/screens/chat/Chat.tsx` | Modify | Wire WorkingLine, remove staticKey |
| `apps/cli/src/screens/chat/components/index.ts` | Modify | Export WorkingLine |

---

## Task 1: Fix approval bug — resume passes string not boolean

**Files:**
- Modify: `packages/agent/src/index.ts` (lines 125–128)
- Create: `__tests__/agent/approvalResume.test.ts`

The bug: `resume()` converts `decision` to boolean before passing to `Command.resume`. Both `requestApprovalTool` and `toolsNode` check `decision === 'approve' || decision === 'y'` — they receive a boolean `true` and both checks fail, so every approval is treated as a rejection.

- [ ] **Step 1: Write the failing test**

Create `__tests__/agent/approvalResume.test.ts`:

```ts
import { jest } from '@jest/globals';
import { Command } from '@langchain/langgraph';

// Capture the value passed to rootGraph.invoke
const mockInvoke = jest.fn().mockResolvedValue({ messages: [] });

jest.mock('../../packages/agent/src/main/graph', () => ({
  rootGraph: { invoke: mockInvoke },
  buildGraph: jest.fn(),
}));

jest.mock('../../packages/core/src/index', () => ({
  EventBus: { emit: jest.fn(), on: jest.fn(), off: jest.fn(), once: jest.fn(), onPattern: jest.fn(), emitDynamic: jest.fn() },
  MessageService: { add: jest.fn(), load: jest.fn(() => []), clear: jest.fn() },
  SessionService: { findActive: jest.fn(() => null), load: jest.fn(() => ({ id: 'test-session', cwd: '/tmp' })) },
  Checkpointer: { getInstance: jest.fn(() => ({ get: jest.fn(), put: jest.fn() })) },
  AuditService: { append: jest.fn() },
}));

jest.mock('../../packages/shared/src/index', () => ({
  debug: jest.fn(),
  getGitDiffStat: jest.fn().mockResolvedValue(null),
  getGitDiffPreview: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../packages/agent/src/context/selector', () => ({
  runContextSelector: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../packages/agent/src/context/file_selector', () => ({
  runFileSelector: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../packages/agent/src/utils', () => ({
  extractNewMessages: jest.fn(() => []),
  saveNewMessages: jest.fn(),
}));

import { runAgent } from '../../packages/agent/src/index';

beforeEach(() => { mockInvoke.mockClear(); });

test('resume passes decision string to Command.resume, not boolean', async () => {
  await runAgent.resume({ sessionId: 'test-session', decision: 'approve' });

  expect(mockInvoke).toHaveBeenCalledTimes(1);
  const [command] = mockInvoke.mock.calls[0] as [Command, unknown];
  // Command.resume should be the string 'approve', not boolean true
  expect((command as unknown as { resume: unknown }).resume).toBe('approve');
});

test('resume passes reject string correctly', async () => {
  await runAgent.resume({ sessionId: 'test-session', decision: 'reject' });

  const [command] = mockInvoke.mock.calls[0] as [Command, unknown];
  expect((command as unknown as { resume: unknown }).resume).toBe('reject');
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/approvalResume.test.ts --no-coverage
```

Expected: FAIL — `resume` is `true`, not `'approve'`.

- [ ] **Step 3: Apply the fix**

In `packages/agent/src/index.ts`, `resume()` method, replace lines 125–128:

```ts
// Remove these two lines:
const approved = decision === 'approve' || decision === 'y';
const historyBefore = MessageService.load(sessionId);
const result = await rootGraph.invoke(new Command({ resume: approved }), config);

// Replace with:
const historyBefore = MessageService.load(sessionId);
const result = await rootGraph.invoke(new Command({ resume: decision }), config);
```

Full updated method for reference:

```ts
async resume(params: { sessionId: string; decision: 'approve' | 'reject' | 'y' | 'n' }) {
  const { sessionId, decision } = params;
  const session = SessionService.load(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  AuditService.append(sessionId, 'agent:resume', { decision });

  const config = {
    configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd: session.cwd },
    recursionLimit: 200,
  };

  const historyBefore = MessageService.load(sessionId);
  const result = await rootGraph.invoke(new Command({ resume: decision }), config);

  const diffPromise = this.publishGitDiff(sessionId, session.cwd);
  try {
    const resultMessages: BaseMessage[] = result.messages ?? [];
    const newMessages = extractNewMessages(historyBefore, resultMessages);
    debug('NEW MESSAGES after resume:', newMessages.length);
    saveNewMessages(sessionId, result.messages ?? []);
  } finally {
    await diffPromise;
  }

  return { ...result, ...(await diffPromise) };
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/agent/approvalResume.test.ts --no-coverage
```

Expected: PASS — both tests green.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/index.ts __tests__/agent/approvalResume.test.ts
git commit -m "fix(agent): pass decision string to Command.resume, not boolean"
```

---

## Task 2: Structured plan card

**Files:**
- Modify: `apps/cli/src/screens/chat/components/ApprovalCard.tsx`

The plan text is currently rendered as a flat `<Text>` block. This task renders it in a bordered box with a header and indented lines.

- [ ] **Step 1: Replace the plan section in `ApprovalCard.tsx`**

Replace the plan rendering block (currently lines 106–110 in `ApprovalCard.tsx`):

```tsx
{/* Plan text */}
{approval.kind === 'plan' && (
  <Box marginBottom={1} paddingLeft={3}>
    <Text color={PALETTE.aiText}>{approval.plan}</Text>
  </Box>
)}
```

With a structured box:

```tsx
{/* Plan box */}
{approval.kind === 'plan' && (
  <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
    <Box gap={1} marginBottom={1}>
      <Text color={riskColor}>╭─ Plan</Text>
    </Box>
    {approval.plan.split('\n').filter(l => l.trim()).map((line, i) => (
      <Box key={i} paddingLeft={1}>
        <Text color={PALETTE.faint}>│ </Text>
        <Text color={PALETTE.aiText}>{line}</Text>
      </Box>
    ))}
    <Box marginTop={1} paddingLeft={1}>
      <Text color={riskColor}>╰─</Text>
    </Box>
  </Box>
)}
```

- [ ] **Step 2: Remove the duplicate header Box** (currently at lines 86–89)

The header `◈  {title}` block shows "Proposed plan" redundantly when the plan box has `╭─ Plan`. Remove it for the plan kind only by adding a guard:

```tsx
{/* Header — skip for plan kind, plan box has its own header */}
{approval.kind !== 'plan' && (
  <Box gap={1} marginBottom={1}>
    <Text color={riskColor} bold>◈  {title}</Text>
    <Text color={PALETTE.muted} dimColor>·  {risk}</Text>
  </Box>
)}
```

- [ ] **Step 3: Manual verification**

Build and run:

```bash
pnpm build && pnpm dev
```

Ask the agent something that triggers `request_approval` (e.g. "rename all instances of X across 3 files"). The plan card should appear as:

```
╭─ Plan
│  1. Read file A to find all instances
│  2. Edit file B replacing X with Y
│  3. Edit file C replacing X with Y
╰─
 approve  deny  ·  y/n  ←/→  Enter
```

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/screens/chat/components/ApprovalCard.tsx
git commit -m "feat(ui): render plan approval as structured box with border"
```

---

## Task 3: Tool single-line streaming

**Files:**
- Modify: `apps/cli/src/screens/chat/components/LiveZone.tsx`

When a running tool has stream data, show the last chunk as a second `⎿` line below the tool name line.

- [ ] **Step 1: Update `LiveZone.tsx`**

Replace the single-tool running block (lines 28–35 in `LiveZone.tsx`):

```tsx
{!streamingText && running.length === 1 && (
  <Box paddingLeft={2} marginBottom={fileRef ? 0 : 1}>
    <Text color={PALETTE.teal}>⏺ </Text>
    <Text color={PALETTE.muted}>
      {getToolVerb(running[0].name)} {truncate(getToolLabel(running[0].name, running[0].input), 60)}…
    </Text>
  </Box>
)}
```

With:

```tsx
{!streamingText && running.length === 1 && (() => {
  const tool = running[0];
  const lastChunk = tool.stream && tool.stream.length > 0 ? tool.stream[tool.stream.length - 1].text : null;
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={fileRef ? 0 : 1}>
      <Box>
        <Text color={PALETTE.teal}>⏺ </Text>
        <Text color={PALETTE.muted}>
          {getToolVerb(tool.name)} {truncate(getToolLabel(tool.name, tool.input), 60)}…
        </Text>
      </Box>
      {lastChunk && (
        <Box paddingLeft={2}>
          <Text color={PALETTE.faint}>⎿  {truncate(lastChunk.replace(/\n/g, ' '), 80)}</Text>
        </Box>
      )}
    </Box>
  );
})()}
```

Also update the multi-tool block (lines 37–41) to show stream of first tool with data:

```tsx
{!streamingText && running.length > 1 && (() => {
  const withStream = running.find(a => a.stream && a.stream.length > 0);
  const lastChunk = withStream ? withStream.stream![withStream.stream!.length - 1].text : null;
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={fileRef ? 0 : 1}>
      <Box>
        <Text color={PALETTE.muted}>{buildActivitySummary(activities)}</Text>
      </Box>
      {lastChunk && (
        <Box paddingLeft={2}>
          <Text color={PALETTE.faint}>⎿  {truncate(lastChunk.replace(/\n/g, ' '), 80)}</Text>
        </Box>
      )}
    </Box>
  );
})()}
```

- [ ] **Step 2: Manual verification**

```bash
pnpm build && pnpm dev
```

Run a bash command via the agent (e.g. "run `ls -la` in the current dir"). The live zone should show:

```
⏺  Running bash  ls -la…
⎿  total 48
```

The `⎿` line updates as new stdout chunks arrive.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/components/LiveZone.tsx
git commit -m "feat(ui): show last tool stream chunk as single line in LiveZone"
```

---

## Task 4: Remove screen blink

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

Two blink sources:
1. `staticKey` bump forces `<Static>` full remount
2. `{!pendingApproval && <LiveZone>}` unmounts/remounts on approval toggle

- [ ] **Step 1: Remove `staticKey` state and its usages**

In `Chat.tsx`:

Remove from state declarations (around line 87):
```tsx
const [staticKey, setStaticKey] = useState(0);
```

Remove `key={staticKey}` from the `<Static>` element (around line 396):
```tsx
// Before
<Static key={staticKey} items={staticItems}>

// After
<Static items={staticItems}>
```

Remove the `setStaticKey(k => k + 1)` call in the `agent:compact_complete` handler (around line 179):
```tsx
// Remove this line:
setStaticKey(k => k + 1);
```

- [ ] **Step 2: Remove the `{!pendingApproval &&}` guard from LiveZone**

Currently (around lines 400–414):
```tsx
{!pendingApproval && (
  <LiveZone
    streamingText={streamingText}
    activities={activities}
    gitDiffStat={gitDiffStat}
  />
)}

{pendingApproval && (
  <ApprovalCard
    approval={pendingApproval}
    isActive={true}
    onConfirm={confirmApproval}
  />
)}
```

Replace with (LiveZone always renders — it returns null when no content):
```tsx
<LiveZone
  streamingText={streamingText}
  activities={activities}
  gitDiffStat={gitDiffStat}
/>

{pendingApproval && (
  <ApprovalCard
    approval={pendingApproval}
    isActive={true}
    onConfirm={confirmApproval}
  />
)}
```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "fix(ui): remove staticKey bump and LiveZone guard to eliminate screen blink"
```

---

## Task 5: WorkingLine component

**Files:**
- Create: `apps/cli/src/screens/chat/components/WorkingLine.tsx`
- Modify: `apps/cli/src/screens/chat/components/index.ts`

New small component: shows spinner + thinking phrase + elapsed when agent is busy, renders nothing when idle.

- [ ] **Step 1: Create `WorkingLine.tsx`**

Create `apps/cli/src/screens/chat/components/WorkingLine.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

interface Props {
  isActive: boolean;
  thinkingPhrase: string | null;
  elapsed: number | null;
}

export const WorkingLine: React.FC<Props> = ({ isActive, thinkingPhrase, elapsed }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) { setFrame(0); return; }
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [isActive]);

  if (!isActive) return null;

  const sep = <Text color={PALETTE.faint}> · </Text>;

  return (
    <Box paddingX={1} gap={0}>
      <Text color={PALETTE.teal}>{SPINNER_FRAMES[frame]}</Text>
      <Text color={PALETTE.statusBar}> {thinkingPhrase ?? 'Working…'}</Text>
      {elapsed !== null && elapsed > 0 && (
        <>
          {sep}
          <Text color={PALETTE.statusBar}>{formatElapsed(elapsed)}</Text>
        </>
      )}
    </Box>
  );
};
```

- [ ] **Step 2: Export from component index**

Add to `apps/cli/src/screens/chat/components/index.ts`:

```ts
export * from './WorkingLine';
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/screens/chat/components/WorkingLine.tsx apps/cli/src/screens/chat/components/index.ts
git commit -m "feat(ui): add WorkingLine component for spinner+phrase above input"
```

---

## Task 6: ChatInput — always visible, dimmed when busy

**Files:**
- Modify: `apps/cli/src/elements/ChatInput.tsx`

Remove the fake "working…" box. Always render the real `TextInput`, dimmed when `isActive=false`.

- [ ] **Step 1: Replace the loading branch in `ChatInput.tsx`**

Remove lines 80–89:
```tsx
if (isLoading) {
  return (
    <Box paddingX={1}>
      <Box borderStyle="single" borderColor={PALETTE.faint} paddingX={1} gap={1}>
        <Text color={PALETTE.faint} dimColor>❯</Text>
        <Text color={PALETTE.faint} dimColor>working…</Text>
      </Box>
    </Box>
  );
}
```

Then update the return statement to apply dimmed styles when not active:

```tsx
return (
  <Box flexDirection="column" paddingX={1}>
    {showPalette && paletteCommands.length > 0 && (
      <SlashPalette input={value} selectedIndex={paletteIndex} />
    )}
    <Box
      borderStyle="single"
      borderColor={isActive ? PALETTE.userText : PALETTE.faint}
      paddingX={1}
      gap={1}
    >
      <Text color={isActive ? PALETTE.muted : PALETTE.faint} dimColor={!isActive}>❯</Text>
      <TextInput
        focus={!!isActive}
        value={value}
        placeholder="Ask anything, or / for commands"
        onChange={(nextValue) => {
          setValue(nextValue);
          setDraft(nextValue);
          setPaletteIndex(0);
          if (historyIndex !== -1) setHistoryIndex(-1);
        }}
        onSubmit={handleSubmit}
      />
    </Box>
  </Box>
);
```

Keep `isLoading` as an optional unused prop for now — `Chat.tsx` still passes it until Task 7. Removing it now would cause a TypeScript error before Task 7 is complete:

```tsx
interface Props {
  onSubmit: (value: string) => void;
  isActive?: boolean;
  isLoading?: boolean; // kept until Chat.tsx is updated in Task 7
}
```

- [ ] **Step 2: Build to verify no TypeScript errors**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors. (Chat.tsx passes `isActive` and `isLoading` — `isLoading` will show as unused prop warning, fixed in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/elements/ChatInput.tsx
git commit -m "feat(ui): always show input box, dimmed when agent is busy"
```

---

## Task 7: Wire WorkingLine into Chat + simplify StatusBar

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`
- Modify: `apps/cli/src/screens/chat/components/StatusBar.tsx`

Move spinner/thinking responsibility from `StatusBar` to `WorkingLine`. Update `Chat.tsx` to render `WorkingLine` between `StatusBar` and `ChatInput`. Remove `isLoading` from `ChatInput` call.

- [ ] **Step 1: Simplify `StatusBar.tsx`**

Remove the `isActive` branch entirely. `StatusBar` now always renders the idle row.

Remove from `Props` interface:
- `elapsed: number | null`
- `isActive: boolean`
- `thinkingPhrase: string | null`

Remove the spinner `useEffect` and `spinnerFrame` state.

Full replacement of `StatusBar.tsx`:

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

function formatCtx(msgCount: number): string {
  return `${msgCount} msg${msgCount !== 1 ? 's' : ''}`;
}

interface Props {
  model: string;
  branch: string | null;
  autoApprove: boolean;
  msgCount: number;
}

export const StatusBar: React.FC<Props> = ({ model, branch, autoApprove, msgCount }) => {
  const sep = <Text color={PALETTE.faint}> · </Text>;

  return (
    <Box paddingX={1} gap={0}>
      <Text color={PALETTE.statusBar}>{model}</Text>
      {sep}
      <Text color={PALETTE.statusBar}>{branch ?? 'no git'}</Text>
      {autoApprove && (
        <>
          {sep}
          <Text color={PALETTE.amber}>⚡ auto</Text>
        </>
      )}
      {sep}
      <Text color={PALETTE.statusBar}>{formatCtx(msgCount)}</Text>
    </Box>
  );
};
```

- [ ] **Step 2: Update `Chat.tsx` render block**

Import `WorkingLine` (already exported from components index after Task 5).

Update the bottom zone in the `Chat.tsx` return (currently lines 416–433):

```tsx
return (
  <Box flexDirection="column" height="100%">
    <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
      <Static items={staticItems}>
        {(item) => renderStaticItem(item)}
      </Static>

      <LiveZone
        streamingText={streamingText}
        activities={activities}
        gitDiffStat={gitDiffStat}
      />

      {pendingApproval && (
        <ApprovalCard
          approval={pendingApproval}
          isActive={true}
          onConfirm={confirmApproval}
        />
      )}
    </Box>

    <StatusBar
      model={modelName}
      branch={gitBranch}
      autoApprove={autoApprove}
      msgCount={humanCount}
    />

    <WorkingLine
      isActive={isAgentBusy}
      thinkingPhrase={thinkingPhrase}
      elapsed={isAgentBusy ? elapsed : null}
    />

    <ChatInput
      isActive={!isAgentBusy}
      onSubmit={handleSubmit}
    />
  </Box>
);
```

Also remove `isLoading` from the `ChatInput` Props interface in `ChatInput.tsx` (it was kept as a placeholder in Task 6):

```tsx
// In apps/cli/src/elements/ChatInput.tsx — update Props:
interface Props {
  onSubmit: (value: string) => void;
  isActive?: boolean;
}
```

The state variables `elapsed`, `thinkingPhrase`, `isAgentBusy` stay in Chat.tsx since `WorkingLine` uses them.

- [ ] **Step 3: Build clean**

```bash
pnpm build 2>&1 | tail -30
```

Expected: all packages build without errors.

- [ ] **Step 4: Type-check CLI**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Manual smoke test**

```bash
pnpm dev
```

Verify:
- Input box always visible, dimmed with faint border while agent runs
- Spinner line appears above input when agent is busy (e.g. `⠙ Thinking…  ·  3s`)
- StatusBar shows `model · branch · N msgs` at all times (not replaced by spinner)
- Plan approval shows `╭─ Plan` box with structured lines
- Tool stream line (`⎿  ...`) appears when bash runs
- Compact (`/compact`) does not cause screen flash
- Approving (`y`) or rejecting (`n`) a plan/tool actually works (agent resumes correctly)

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx apps/cli/src/screens/chat/components/StatusBar.tsx
git commit -m "feat(ui): wire WorkingLine above input, simplify StatusBar to idle-only"
```
