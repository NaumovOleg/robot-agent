# Production Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 production-grade issues found by code review: 3 crash-level bugs, 2 UI correctness bugs, 2 data-integrity bugs, 1 process-cleanup bug, and 2 code-duplication issues.

**Architecture:** Fixes grouped by file cluster and severity. Critical production crashes first (Tasks 1–2), UI correctness next (Task 3), data integrity (Task 4), graceful shutdown (Task 5), then shared-utility extraction (Task 6). Each task is independently committable.

**Tech Stack:** TypeScript, React 18, Ink 5, LangGraph, better-sqlite3, Node.js EventEmitter, Jest ESM

---

## File Map

| File | Action | Reason |
|------|--------|--------|
| `packages/agent/src/index.ts` | Modify | Wrap async EventBus handlers; add isRunning guard; store unsubs |
| `apps/cli/src/screens/chat/Chat.tsx` | Modify | Add canResume .catch(); WorkingLine guard; clearGeneration key |
| `packages/core/src/services/checkpointer.ts` | Modify | Add static close() method |
| `apps/cli/src/index.ts` | Modify | Register process.on('exit') cleanup |
| `apps/cli/src/utils/text.ts` | Modify | Add exported formatElapsed |
| `apps/cli/src/hooks/useSpinner.ts` | Create | Shared spinner hook (replaces 3 copies) |
| `apps/cli/src/hooks/index.ts` | Modify | Export useSpinner |
| `apps/cli/src/screens/chat/components/WorkingLine.tsx` | Modify | Use useSpinner + imported formatElapsed |
| `apps/cli/src/screens/chat/components/LiveZone.tsx` | Modify | Extract getLastChunkText; unify access style |

---

## Task 1: Fix async EventBus handlers (critical — unhandled rejections crash Node 15+)

**Files:**
- Modify: `packages/agent/src/index.ts` (constructor, lines 35–69)

`RoboAgent.run()`, `resume()`, `stop()`, `compact()`, `deleteCheckpoint()` are async, but `EventBus.on()` is a Node EventEmitter — it discards returned Promises. Any rejection inside these methods becomes an unhandled rejection, crashing Node 15+ or leaving the UI frozen in `isLoading=true` forever.

Fix: wrap each registration in an anonymous function that calls `.catch()`.

- [ ] **Step 1: Update the constructor in `packages/agent/src/index.ts`**

Replace lines 35–41 (the five `EventBus.on` calls for async methods):

```ts
constructor() {
  EventBus.on('agent:set-session', (session) => this.setSession(session));

  EventBus.on('agent:run', (userInput) => {
    this.run(userInput).catch(err => {
      const sid = this.session?.id ?? '';
      debug('[run] unhandled error:', err);
      if (sid) {
        EventBus.emit('llm:error', { sessionId: sid, error: String(err) });
        EventBus.emit('llm:end', { sessionId: sid });
      }
    });
  });

  EventBus.on('agent:resume', (params) => {
    this.resume(params).catch(err => {
      debug('[resume] error:', err);
      EventBus.emit('llm:error', { sessionId: params.sessionId, error: String(err) });
      EventBus.emit('llm:end', { sessionId: params.sessionId });
    });
  });

  EventBus.on('agent:stop', (params) => {
    this.stop(params).catch(err => debug('[stop] error:', err));
  });

  EventBus.on('agent:delete-checkpoint', (sessionId) => {
    this.deleteCheckpoint(sessionId).catch(err => debug('[deleteCheckpoint] error:', err));
  });

  EventBus.on('agent:compact_request', (params) => {
    this.compact(params).catch(err => debug('[compact] error:', err));
  });

  // Audit listeners (synchronous — no wrapping needed)
  EventBus.on('agent:plan_pending', ({ sessionId, plan }) => {
    AuditService.append(sessionId, 'agent:plan_pending', { plan });
  });
  EventBus.on('agent:plan_decision', ({ sessionId, approved, plan }) => {
    AuditService.append(sessionId, 'agent:plan_decision', { approved, plan });
  });
  EventBus.on('agent:tool_pending', ({ sessionId, toolCall }) => {
    AuditService.append(sessionId, 'agent:tool_pending', toolCall);
  });
  EventBus.on('agent:tool_decision', ({ sessionId, approved, toolCall }) => {
    AuditService.append(sessionId, 'agent:tool_decision', { approved, toolCall });
  });
  EventBus.on('llm:start', ({ sessionId }) => AuditService.append(sessionId, 'llm:start', {}));
  EventBus.on('llm:end', ({ sessionId }) => AuditService.append(sessionId, 'llm:end', {}));
  EventBus.on('llm:error', ({ sessionId, error }) =>
    AuditService.append(sessionId, 'llm:error', { error })
  );
  EventBus.on('tool:start', ({ sessionId, name, input, callId }) =>
    AuditService.append(sessionId, 'tool:start', { name, input, callId })
  );
  EventBus.on('tool:end', ({ sessionId, name, output, callId }) =>
    AuditService.append(sessionId, 'tool:end', { name, output, callId })
  );
  EventBus.on('tool:error', ({ sessionId, name, error, callId }) =>
    AuditService.append(sessionId, 'tool:error', { name, error, callId })
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "fix(agent): catch async EventBus handler rejections to prevent unhandled crashes"
```

---

## Task 2: Fix canResume unhandled rejection + WorkingLine guard + clearGeneration key

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

Three Chat.tsx issues in one task since they're in the same file and all small:
1. `canResume().then()` has no `.catch()` → unhandled rejection on corrupt/missing SQLite DB
2. `WorkingLine` renders whenever `isAgentBusy=true`, but `isAgentBusy` includes `!!pendingApproval` → spinner shown alongside `ApprovalCard`
3. `<Static>` has no key after staticKey removal → after `/clear`, Ink's append-only Static never resets its internal printed-item registry

- [ ] **Step 1: Fix canResume .catch() (~line 115)**

Find:
```ts
canResume(session.id).then(resumable => {
  if (resumable) EventBus.emit('agent:resume', { sessionId: session.id, decision: 'approve' });
});
```

Replace with:
```ts
canResume(session.id)
  .then(resumable => {
    if (resumable) EventBus.emit('agent:resume', { sessionId: session.id, decision: 'approve' });
  })
  .catch(err => {
    debug('[canResume] error:', err);
  });
```

`debug` is not currently imported in Chat.tsx. Add it to the import from `@robocode-packages/shared`:
```ts
import { messageType, debug } from '@robocode-packages/shared';
```

- [ ] **Step 2: Add clearGeneration state and restore <Static> key**

Add after existing state declarations (around line 87):
```ts
const [clearGeneration, setClearGeneration] = useState(0);
```

Update `<Static>` to use it as a key (line ~394):
```tsx
// Before:
<Static items={staticItems}>

// After:
<Static key={clearGeneration} items={staticItems}>
```

In the `/clear` command handler (around line 305), after `setStaticKey` was previously called, add:
```ts
setClearGeneration(g => g + 1);
```

The full `/clear` handler block should be:
```ts
if (command === 'clear') {
  const turnCount = staticItems.filter(i => i.kind === 'human').length;
  if (turnCount > 5 && !pendingClearRef.current) {
    pendingClearRef.current = true;
    appendNotice(`Session has ${turnCount} turns. Send /clear again to confirm.`);
    return;
  }
  pendingClearRef.current = false;
  deleteSession(session.id);
  create();
  resetTransientState();
  setStaticItems([]);
  setClearGeneration(g => g + 1);
  return;
}
```

- [ ] **Step 3: Guard WorkingLine against pendingApproval (~line 420)**

Find:
```tsx
<WorkingLine
  isActive={isAgentBusy}
  thinkingPhrase={thinkingPhrase}
  elapsed={isAgentBusy ? elapsed : null}
/>
```

Replace with:
```tsx
<WorkingLine
  isActive={isAgentBusy && !pendingApproval}
  thinkingPhrase={thinkingPhrase}
  elapsed={isAgentBusy && !pendingApproval ? elapsed : null}
/>
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Run test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "fix(ui): guard WorkingLine from approval state; restore Static key on clear; catch canResume errors"
```

---

## Task 3: Double-submit guard + EventBus listener cleanup in RoboAgent

**Files:**
- Modify: `packages/agent/src/index.ts`

> **Note:** This task rewrites the same constructor modified in Task 1. The code shown below is the **complete final version** of the constructor — it includes Task 1's async error handling AND adds the new `isRunning` flag and `unsubs` storage. Apply it as a full replacement.

Two issues:
1. `RoboAgent.run()` has no concurrency guard — two concurrent calls share the same LangGraph `thread_id` and race on the checkpoint
2. All 17 `EventBus.on()` calls in the constructor discard their unsubscribe functions — in test environments where the module cache resets between suites, listeners accumulate permanently

- [ ] **Step 1: Add isRunning guard to run()**

Add `private isRunning = false;` to the class after `private session`:

```ts
class RoboAgent {
  private static instance: RoboAgent;
  private session?: Session | null = SessionService.findActive();
  private isRunning = false;
```

Wrap the body of `run()` to set and clear the flag:

```ts
public async run(userInput: string) {
  if (this.isRunning) {
    debug('[run] already running, dropping duplicate call');
    return;
  }
  this.isRunning = true;
  try {
    if (!this.session) throw new Error('Session not set');

    const { id: sessionId, cwd } = this.session;
    const config = {
      configurable: { thread_id: this.getMainThreadId(sessionId), sessionId, cwd },
      recursionLimit: 200,
    };

    const [workspaceContext, selectedFiles] = await Promise.all([
      runContextSelector(cwd),
      runFileSelector(userInput, cwd),
    ]);

    const userMessage = new HumanMessage(userInput);
    MessageService.add(sessionId, userMessage);
    AuditService.append(sessionId, 'agent:run', { input: userInput });

    const result = await rootGraph.invoke(
      { messages: [userMessage], sessionId, cwd, workspaceContext, selectedFiles },
      config
    );

    const diffPromise = this.publishGitDiff(sessionId, cwd);
    try {
      saveNewMessages(sessionId, result.messages ?? []);
    } finally {
      await diffPromise;
    }

    return { ...result, ...(await diffPromise) };
  } finally {
    this.isRunning = false;
  }
}
```

- [ ] **Step 2: Store all unsubscribe functions**

Add `private readonly unsubs: (() => void)[] = [];` to the class:

```ts
class RoboAgent {
  private static instance: RoboAgent;
  private session?: Session | null = SessionService.findActive();
  private isRunning = false;
  private readonly unsubs: (() => void)[] = [];
```

In the constructor, change every `EventBus.on(...)` call to push the returned unsub:

```ts
constructor() {
  this.unsubs.push(EventBus.on('agent:set-session', (session) => this.setSession(session)));

  this.unsubs.push(EventBus.on('agent:run', (userInput) => {
    this.run(userInput).catch(err => {
      const sid = this.session?.id ?? '';
      debug('[run] unhandled error:', err);
      if (sid) {
        EventBus.emit('llm:error', { sessionId: sid, error: String(err) });
        EventBus.emit('llm:end', { sessionId: sid });
      }
    });
  }));

  this.unsubs.push(EventBus.on('agent:resume', (params) => {
    this.resume(params).catch(err => {
      debug('[resume] error:', err);
      EventBus.emit('llm:error', { sessionId: params.sessionId, error: String(err) });
      EventBus.emit('llm:end', { sessionId: params.sessionId });
    });
  }));

  this.unsubs.push(EventBus.on('agent:stop', (params) => {
    this.stop(params).catch(err => debug('[stop] error:', err));
  }));

  this.unsubs.push(EventBus.on('agent:delete-checkpoint', (sessionId) => {
    this.deleteCheckpoint(sessionId).catch(err => debug('[deleteCheckpoint] error:', err));
  }));

  this.unsubs.push(EventBus.on('agent:compact_request', (params) => {
    this.compact(params).catch(err => debug('[compact] error:', err));
  }));

  this.unsubs.push(EventBus.on('agent:plan_pending', ({ sessionId, plan }) => {
    AuditService.append(sessionId, 'agent:plan_pending', { plan });
  }));
  this.unsubs.push(EventBus.on('agent:plan_decision', ({ sessionId, approved, plan }) => {
    AuditService.append(sessionId, 'agent:plan_decision', { approved, plan });
  }));
  this.unsubs.push(EventBus.on('agent:tool_pending', ({ sessionId, toolCall }) => {
    AuditService.append(sessionId, 'agent:tool_pending', toolCall);
  }));
  this.unsubs.push(EventBus.on('agent:tool_decision', ({ sessionId, approved, toolCall }) => {
    AuditService.append(sessionId, 'agent:tool_decision', { approved, toolCall });
  }));
  this.unsubs.push(EventBus.on('llm:start', ({ sessionId }) =>
    AuditService.append(sessionId, 'llm:start', {})));
  this.unsubs.push(EventBus.on('llm:end', ({ sessionId }) =>
    AuditService.append(sessionId, 'llm:end', {})));
  this.unsubs.push(EventBus.on('llm:error', ({ sessionId, error }) =>
    AuditService.append(sessionId, 'llm:error', { error })));
  this.unsubs.push(EventBus.on('tool:start', ({ sessionId, name, input, callId }) =>
    AuditService.append(sessionId, 'tool:start', { name, input, callId })));
  this.unsubs.push(EventBus.on('tool:end', ({ sessionId, name, output, callId }) =>
    AuditService.append(sessionId, 'tool:end', { name, output, callId })));
  this.unsubs.push(EventBus.on('tool:error', ({ sessionId, name, error, callId }) =>
    AuditService.append(sessionId, 'tool:error', { name, error, callId })));
}
```

Add a `dispose()` method after `getInstance()`:

```ts
dispose(): void {
  this.unsubs.forEach(u => u());
  this.unsubs.length = 0;
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Run test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "fix(agent): add isRunning guard to prevent double-submit; store EventBus unsubs for cleanup"
```

---

## Task 4: Graceful process exit — close SQLite before exit

**Files:**
- Modify: `packages/core/src/services/checkpointer.ts`
- Modify: `apps/cli/src/index.ts`

`process.exit(0)` on double Ctrl+C bypasses all cleanup. The SQLite `better-sqlite3` connection is never closed. Although WAL mode is crash-safe, the WAL file is never checkpointed back. Adding a synchronous `process.on('exit')` handler runs just before the process terminates regardless of how exit is triggered.

`SqliteSaver` exposes `this.db` as a field (type: `better-sqlite3` `Database`). Access it via type assertion to call `.close()`.

- [ ] **Step 1: Add Checkpointer.close() to `packages/core/src/services/checkpointer.ts`**

Append after `getInstance()`:

```ts
static close(): void {
  try {
    if (Checkpointer.instance) {
      (Checkpointer.instance as unknown as { db?: { close(): void } }).db?.close();
      debug('[checkpointer] closed');
    }
  } catch (err) {
    debug('[checkpointer] error on close:', err);
  }
}
```

Full updated file:

```ts
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { debug } from '@robocode-packages/shared';
import { DB_PATH } from '@robocode-packages/config';

export class Checkpointer {
  private static instance: SqliteSaver;

  static getInstance(): SqliteSaver {
    if (!Checkpointer.instance) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      debug('[checkpointer] opening db:', DB_PATH);
      Checkpointer.instance = SqliteSaver.fromConnString(DB_PATH);
      debug('[checkpointer] ready');
    }
    return Checkpointer.instance;
  }

  static close(): void {
    try {
      if (Checkpointer.instance) {
        (Checkpointer.instance as unknown as { db?: { close(): void } }).db?.close();
        debug('[checkpointer] closed');
      }
    } catch (err) {
      debug('[checkpointer] error on close:', err);
    }
  }
}
```

- [ ] **Step 2: Register exit handler in `apps/cli/src/index.ts`**

Add after the existing `run()` function and before the final `run()` call. Import `Checkpointer` at the top:

```ts
import { APP } from './app';
import { render } from 'ink';
import { Checkpointer } from '@robocode-packages/core';
```

Add before the `run()` call at the bottom:

```ts
process.on('exit', () => {
  Checkpointer.close();
});

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
```

Full updated `apps/cli/src/index.ts`:

```ts
import { APP } from './app';
import { render } from 'ink';
import { Checkpointer } from '@robocode-packages/core';

const setRawMode = (enabled: boolean) => {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(enabled);
  }
};

const run = async () => {
  setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  try {
    const { waitUntilExit } = render(APP, {
      stdin: process.stdin,
      stdout: process.stdout,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    await waitUntilExit();
  } finally {
    setRawMode(false);
    process.stdin.pause();
  }
};

process.on('exit', () => {
  Checkpointer.close();
});

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
```

- [ ] **Step 3: Build core package to verify types**

```bash
npx tsc --noEmit --project packages/core/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Verify CLI TypeScript**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Run test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/checkpointer.ts apps/cli/src/index.ts
git commit -m "fix(core): add Checkpointer.close(); register process exit handler to flush SQLite WAL"
```

---

## Task 5: Extract shared utilities — useSpinner hook + formatElapsed + LiveZone helper

**Files:**
- Create: `apps/cli/src/hooks/useSpinner.ts`
- Modify: `apps/cli/src/hooks/index.ts`
- Modify: `apps/cli/src/utils/text.ts`
- Modify: `apps/cli/src/screens/chat/components/WorkingLine.tsx`
- Modify: `apps/cli/src/screens/chat/components/LiveZone.tsx`

Three duplication issues:
- `SPINNER_FRAMES` + spinner `useEffect` pattern exists in `Loading.tsx`, `WorkingLine.tsx` (and was in `StatusBar.tsx`)
- `formatElapsed` in `WorkingLine.tsx` is a near-duplicate of `formatDuration` in `TurnSummaryCard.tsx` (only differs: `formatDuration` returns `''` for `sec===0`, `formatElapsed` does not — keep both, but export `formatElapsed` from `@utils` so future consumers don't add a fourth copy)
- `LiveZone.tsx` uses two different access styles to get the last stream chunk: `tool.stream[tool.stream.length - 1].text` (single-tool) vs `withStream?.stream?.at(-1)?.text` (multi-tool)

- [ ] **Step 1: Create `apps/cli/src/hooks/useSpinner.ts`**

```ts
import { useEffect, useState } from 'react';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function useSpinner(isActive: boolean): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) { setFrame(0); return; }
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [isActive]);

  return SPINNER_FRAMES[frame];
}
```

- [ ] **Step 2: Export useSpinner from hooks index**

Add to `apps/cli/src/hooks/index.ts`:

```ts
export * from './useRouter';
export * from './useProfile';
export * from './useSession';
export * from './useSpinner';
```

- [ ] **Step 3: Add formatElapsed to `apps/cli/src/utils/text.ts`**

Append at the end of the file:

```ts
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
```

- [ ] **Step 4: Update `WorkingLine.tsx` to use the hook and imported util**

Replace the entire file:

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, formatElapsed } from '@utils';
import { useSpinner } from '@hooks';

interface Props {
  isActive: boolean;
  thinkingPhrase: string | null;
  elapsed: number | null;
}

export const WorkingLine: React.FC<Props> = ({ isActive, thinkingPhrase, elapsed }) => {
  const spinnerFrame = useSpinner(isActive);

  if (!isActive) return null;

  const sep = <Text color={PALETTE.faint}> · </Text>;

  return (
    <Box paddingX={1} gap={0}>
      <Text color={PALETTE.teal}>{spinnerFrame}</Text>
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

- [ ] **Step 5: Fix LiveZone inconsistent access style**

In `apps/cli/src/screens/chat/components/LiveZone.tsx`, add a module-level helper function after the imports:

```ts
function getLastChunkText(activity: ToolActivity): string | null {
  return activity.stream?.at(-1)?.text ?? null;
}
```

Update the single-tool block (line ~30) to use the helper instead of index access:

```tsx
{!streamingText && running.length === 1 && (() => {
  const tool = running[0];
  const lastChunk = tool.stream && tool.stream.length > 0 ? getLastChunkText(tool) : null;
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

- [ ] **Step 6: Verify TypeScript**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test --no-coverage 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/cli/src/hooks/useSpinner.ts apps/cli/src/hooks/index.ts apps/cli/src/utils/text.ts apps/cli/src/screens/chat/components/WorkingLine.tsx apps/cli/src/screens/chat/components/LiveZone.tsx
git commit -m "refactor(ui): extract useSpinner hook, formatElapsed util, and getLastChunkText helper"
```
