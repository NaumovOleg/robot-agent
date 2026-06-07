# Live Zone Redesign + Streaming Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the critical bug where AI responses never appear in the chat, eliminate input flicker between tool calls, and replace per-tool ToolCards with a Claude Code–style compact activity summary line.

**Architecture:** (1) Switch `agentNode` + `summarizerNode` from `model.invoke()` to `model.stream()`, emitting `llm:token` events so Chat.tsx can populate `streamingText` and surface the response. (2) Widen `isAgentBusy` to include running tool activities, and move `thinkingPhrase` from LiveZone into the StatusBar with a braille spinner. (3) Replace `ToolCard`/`ToolGroup` with a compact `buildActivitySummary` utility rendered directly in `LiveZone`.

**Tech Stack:** React/Ink (terminal UI), LangChain (`@langchain/core ^1.1.45`, `@langchain/anthropic ^1.3.29`), TypeScript, Jest.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `__tests__/cli/toolVerbs.test.ts` | Modify | Add tests for buildActivitySummary + buildActivityFileRef |
| `apps/cli/src/utils/toolVerbs.ts` | Modify | Add buildActivitySummary, buildActivityFileRef |
| `apps/cli/src/screens/chat/components/StatusBar.tsx` | Modify | Add braille spinner + thinkingPhrase prop |
| `apps/cli/src/screens/chat/components/LiveZone.tsx` | Modify | Replace ToolGroup with compact summary; drop thinkingPhrase/isStreaming |
| `apps/cli/src/screens/chat/Chat.tsx` | Modify | Widen isAgentBusy; wire new StatusBar/LiveZone props |
| `packages/agent/src/main/agent_node.ts` | Modify | model.invoke → model.stream + emit llm:token |
| `packages/agent/src/main/summarizer.ts` | Modify | model.invoke → model.stream + emit llm:token |
| `apps/cli/src/screens/chat/components/ToolCard.tsx` | **Delete** | Replaced by compact summary |
| `apps/cli/src/screens/chat/components/ToolGroup.tsx` | **Delete** | Replaced by compact summary |
| `apps/cli/src/screens/chat/components/index.ts` | Modify | Remove ToolCard + ToolGroup exports |

---

## Task 1: Activity summary utilities (TDD)

**Files:**
- Modify: `__tests__/cli/toolVerbs.test.ts`
- Modify: `apps/cli/src/utils/toolVerbs.ts`

- [ ] **Step 1: Add failing tests for `buildActivitySummary` to the test file**

Append to `__tests__/cli/toolVerbs.test.ts`:

```typescript
import { getToolLabel, getToolVerb, getResultPreview, buildActivitySummary, buildActivityFileRef } from '../../apps/cli/src/utils/toolVerbs';
import type { ToolActivity } from '../../apps/cli/src/types/chat';

const makeA = (
  name: string,
  status: ToolActivity['status'] = 'running',
  extra: Partial<ToolActivity> = {}
): ToolActivity => ({
  id: `${name}-${Math.random()}`,
  name,
  input: { path: `src/${name}.ts` },
  status,
  startedAt: Date.now(),
  ...extra,
});

describe('buildActivitySummary', () => {
  it('returns empty string when activities array is empty', () => {
    expect(buildActivitySummary([])).toBe('');
  });

  it('returns empty string when all activities are done (not running)', () => {
    expect(buildActivitySummary([makeA('read_file', 'done')])).toBe('');
  });

  it('returns empty string when all running tools are unknown', () => {
    expect(buildActivitySummary([makeA('totally_unknown')])).toBe('');
  });

  it('builds "Reading 1 file…" for a single read_file', () => {
    expect(buildActivitySummary([makeA('read_file')])).toBe('Reading 1 file…');
  });

  it('builds "Reading 2 files…" for two read-type tools', () => {
    expect(buildActivitySummary([makeA('read_file'), makeA('find_definition')])).toBe('Reading 2 files…');
  });

  it('builds "Searching for 2 patterns…" for grep + search_files', () => {
    expect(buildActivitySummary([makeA('grep'), makeA('search_files')])).toBe('Searching for 2 patterns…');
  });

  it('capitalises the first group verb and lowercases subsequent verbs', () => {
    const result = buildActivitySummary([makeA('grep'), makeA('read_file'), makeA('bash')]);
    expect(result).toBe('Searching for 1 pattern, reading 1 file, running 1 command…');
  });

  it('ignores done activities in the summary', () => {
    const result = buildActivitySummary([makeA('grep'), makeA('read_file', 'done')]);
    expect(result).toBe('Searching for 1 pattern…');
  });

  it('uses singular units when count is 1', () => {
    expect(buildActivitySummary([makeA('bash')])).toBe('Running 1 command…');
  });

  it('uses plural units when count is greater than 1', () => {
    const a1 = makeA('bash');
    const a2: ToolActivity = { ...a1, id: 'bash-2' };
    expect(buildActivitySummary([a1, a2])).toBe('Running 2 commands…');
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd /Users/oleg/Documents/projects/robocode-cli
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/toolVerbs.test.ts -t "buildActivitySummary" 2>&1 | tail -20
```

Expected: `Cannot find module` or `buildActivitySummary is not a function` — confirms tests are wired but function doesn't exist yet.

- [ ] **Step 3: Add `buildActivitySummary` to `apps/cli/src/utils/toolVerbs.ts`**

Add this import at the top of the file (after existing content, before the first `export`):

```typescript
import type { ToolActivity } from '../types/chat';
```

Then add the following after the existing exports:

```typescript
interface ActivityCategory {
  verb: string;
  preposition: string;
  unit: string;
  unitPlural: string;
}

const TOOL_CATEGORY: Record<string, ActivityCategory> = {
  grep:            { verb: 'Searching', preposition: 'for', unit: 'pattern',     unitPlural: 'patterns'    },
  search_files:    { verb: 'Searching', preposition: 'for', unit: 'pattern',     unitPlural: 'patterns'    },
  read_file:       { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  find_definition: { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  ast_analyzer:    { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  analyze_code:    { verb: 'Reading',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  bash:            { verb: 'Running',   preposition: '',    unit: 'command',      unitPlural: 'commands'    },
  edit_file:       { verb: 'Editing',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  write_file:      { verb: 'Editing',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  patch_file:      { verb: 'Editing',   preposition: '',    unit: 'file',         unitPlural: 'files'       },
  delete_file:     { verb: 'Deleting',  preposition: '',    unit: 'file',         unitPlural: 'files'       },
  list_dir:        { verb: 'Listing',   preposition: '',    unit: 'directory',    unitPlural: 'directories' },
  glob:            { verb: 'Listing',   preposition: '',    unit: 'directory',    unitPlural: 'directories' },
  git_diff:        { verb: 'Running',   preposition: '',    unit: 'git command',  unitPlural: 'git commands'},
  git_log:         { verb: 'Running',   preposition: '',    unit: 'git command',  unitPlural: 'git commands'},
  rename_symbol:   { verb: 'Renaming',  preposition: '',    unit: 'symbol',       unitPlural: 'symbols'     },
};

export function buildActivitySummary(activities: ToolActivity[]): string {
  const running = activities.filter(a => a.status === 'running');
  if (running.length === 0) return '';

  const order: string[] = [];
  const grouped = new Map<string, { cat: ActivityCategory; count: number }>();

  for (const activity of running) {
    const cat = TOOL_CATEGORY[activity.name];
    if (!cat) continue;
    const key = `${cat.verb}:${cat.preposition}`;
    if (!grouped.has(key)) {
      order.push(key);
      grouped.set(key, { cat, count: 0 });
    }
    grouped.get(key)!.count++;
  }

  if (order.length === 0) return '';

  const parts = order.map((key, i) => {
    const { cat, count } = grouped.get(key)!;
    const verb = i === 0 ? cat.verb : cat.verb.toLowerCase();
    const prep = cat.preposition ? `${cat.preposition} ` : '';
    const unit = count === 1 ? cat.unit : cat.unitPlural;
    return `${verb} ${prep}${count} ${unit}`;
  });

  return parts.join(', ') + '…';
}
```

- [ ] **Step 4: Run buildActivitySummary tests — expect pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/toolVerbs.test.ts -t "buildActivitySummary" 2>&1 | tail -10
```

Expected: all `buildActivitySummary` tests PASS.

- [ ] **Step 5: Add failing tests for `buildActivityFileRef`**

Append to `__tests__/cli/toolVerbs.test.ts`:

```typescript
describe('buildActivityFileRef', () => {
  it('returns null when activities array is empty', () => {
    expect(buildActivityFileRef([])).toBeNull();
  });

  it('returns null when all activities are done', () => {
    expect(buildActivityFileRef([makeA('read_file', 'done')])).toBeNull();
  });

  it('returns the label of the most recently started running activity', () => {
    const older = makeA('grep', 'running', { startedAt: 1000, input: { path: 'old.ts' } });
    const newer = makeA('read_file', 'running', { startedAt: 2000, input: { path: 'new.ts' } });
    expect(buildActivityFileRef([older, newer])).toBe('new.ts');
  });

  it('returns null when the most recent running activity has no label', () => {
    const a = makeA('ast_analyzer', 'running', { input: {} });
    expect(buildActivityFileRef([a])).toBeNull();
  });

  it('returns the bash command string as the label', () => {
    const a = makeA('bash', 'running', { input: { command: 'git status' } });
    expect(buildActivityFileRef([a])).toBe('git status');
  });
});
```

- [ ] **Step 6: Run buildActivityFileRef tests — expect fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/toolVerbs.test.ts -t "buildActivityFileRef" 2>&1 | tail -10
```

Expected: `buildActivityFileRef is not a function`.

- [ ] **Step 7: Add `buildActivityFileRef` to `apps/cli/src/utils/toolVerbs.ts`**

Append after `buildActivitySummary`:

```typescript
export function buildActivityFileRef(activities: ToolActivity[]): string | null {
  const running = activities
    .filter(a => a.status === 'running' && a.startedAt != null)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  if (running.length === 0) return null;
  return getToolLabel(running[0].name, running[0].input) || null;
}
```

- [ ] **Step 8: Run the full toolVerbs test suite — expect all pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/toolVerbs.test.ts 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add __tests__/cli/toolVerbs.test.ts apps/cli/src/utils/toolVerbs.ts
git commit -m "feat(ui): add buildActivitySummary + buildActivityFileRef utilities"
```

---

## Task 2: StatusBar — braille spinner + thinking phrase

**Files:**
- Modify: `apps/cli/src/screens/chat/components/StatusBar.tsx`

- [ ] **Step 1: Replace `StatusBar.tsx` with the new implementation**

Full file content:

```typescript
// apps/cli/src/screens/chat/components/StatusBar.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatCtx(msgCount: number): string {
  return `${msgCount} msg${msgCount !== 1 ? 's' : ''}`;
}

interface Props {
  model: string;
  branch: string | null;
  autoApprove: boolean;
  msgCount: number;
  elapsed: number | null;
  isActive: boolean;
  thinkingPhrase: string | null;
}

export const StatusBar: React.FC<Props> = ({
  model,
  branch,
  autoApprove,
  msgCount,
  elapsed,
  isActive,
  thinkingPhrase,
}) => {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (!isActive) { setSpinnerFrame(0); return; }
    const t = setInterval(() => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [isActive]);

  const sep = <Text color={PALETTE.faint}> · </Text>;

  if (isActive) {
    return (
      <Box paddingX={1} gap={0}>
        <Text color={PALETTE.teal}>{SPINNER_FRAMES[spinnerFrame]}</Text>
        <Text color={PALETTE.statusBar}> {thinkingPhrase ?? 'Working…'}</Text>
        {elapsed !== null && elapsed > 0 && (
          <>
            {sep}
            <Text color={PALETTE.statusBar}>{formatElapsed(elapsed)}</Text>
          </>
        )}
        {branch && (
          <>
            {sep}
            <Text color={PALETTE.statusBar}>{branch}</Text>
          </>
        )}
        {autoApprove && (
          <>
            {sep}
            <Text color={PALETTE.amber}>⚡ auto</Text>
          </>
        )}
      </Box>
    );
  }

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

- [ ] **Step 2: Type-check the UI package**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors from StatusBar.tsx.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/components/StatusBar.tsx
git commit -m "feat(ui): add spinner + thinking phrase to StatusBar"
```

---

## Task 3: LiveZone — compact activity summary

**Files:**
- Modify: `apps/cli/src/screens/chat/components/LiveZone.tsx`

- [ ] **Step 1: Replace `LiveZone.tsx` with the new implementation**

Full file content:

```typescript
// apps/cli/src/screens/chat/components/LiveZone.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, buildActivitySummary, buildActivityFileRef, getToolVerb, getToolLabel, truncate } from '@utils';
import type { ToolActivity } from '@types';

interface Props {
  streamingText: string;
  activities: ToolActivity[];
  gitDiffStat: string | null;
}

export const LiveZone: React.FC<Props> = ({ streamingText, activities, gitDiffStat }) => {
  const running = activities.filter(a => a.status === 'running');
  const fileRef = running.length > 0 ? buildActivityFileRef(activities) : null;

  const hasContent = streamingText || running.length > 0 || gitDiffStat;
  if (!hasContent) return null;

  return (
    <Box flexDirection="column">
      {streamingText && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text color={PALETTE.aiText}>{streamingText}</Text>
        </Box>
      )}

      {!streamingText && running.length === 1 && (
        <Box paddingLeft={2} marginBottom={fileRef ? 0 : 1}>
          <Text color={PALETTE.teal}>⏺ </Text>
          <Text color={PALETTE.muted}>
            {getToolVerb(running[0].name)} {truncate(getToolLabel(running[0].name, running[0].input), 60)}…
          </Text>
        </Box>
      )}

      {!streamingText && running.length > 1 && (
        <Box paddingLeft={2} marginBottom={fileRef ? 0 : 1}>
          <Text color={PALETTE.muted}>{buildActivitySummary(activities)}</Text>
        </Box>
      )}

      {!streamingText && fileRef && running.length > 0 && (
        <Box paddingLeft={4} marginBottom={1}>
          <Text color={PALETTE.faint}>⎿  </Text>
          <Text color={PALETTE.path}>{truncate(fileRef, 60)}</Text>
        </Box>
      )}

      {gitDiffStat && (
        <Box paddingLeft={2} marginBottom={1} gap={1}>
          <Text color={PALETTE.slate}>◉</Text>
          <Text color={PALETTE.muted}>git diff</Text>
          <Text color={PALETTE.muted} dimColor>{gitDiffStat}</Text>
        </Box>
      )}
    </Box>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors from LiveZone.tsx (TypeScript may warn about missing `thinkingPhrase`/`isStreaming` props at call site — that's expected and will be fixed in Task 4).

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/components/LiveZone.tsx
git commit -m "feat(ui): replace ToolGroup with compact activity summary in LiveZone"
```

---

## Task 4: Update Chat.tsx — fix `isAgentBusy` + wire new props

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

- [ ] **Step 1: Update `isAgentBusy` and the elapsed timer effect**

Find this block near line 232:

```typescript
useEffect(() => {
  const isBusy = isLoading || !!pendingApproval;
  if (!isBusy) { agentStartTimeRef.current = null; setElapsed(0); return; }
  if (!agentStartTimeRef.current) agentStartTimeRef.current = Date.now();
  const start = agentStartTimeRef.current;
  const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
  return () => clearInterval(t);
}, [isLoading, pendingApproval]);
```

And the line near 375:

```typescript
const isAgentBusy = isLoading || !!pendingApproval;
```

Replace the elapsed effect with:

```typescript
const isToolRunning = activities.some(a => a.status === 'running');
const isAgentBusy = isLoading || !!pendingApproval || isToolRunning;

useEffect(() => {
  if (!isAgentBusy) { agentStartTimeRef.current = null; setElapsed(0); return; }
  if (!agentStartTimeRef.current) agentStartTimeRef.current = Date.now();
  const start = agentStartTimeRef.current;
  const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
  return () => clearInterval(t);
}, [isAgentBusy]);
```

Remove the old standalone `const isAgentBusy = ...` line near 375 (now it's declared with `isToolRunning` above the effect).

- [ ] **Step 2: Update the StatusBar JSX to pass the two new props**

Find:

```typescript
<StatusBar
  model={modelName}
  branch={gitBranch}
  autoApprove={autoApprove}
  msgCount={humanCount}
  elapsed={isAgentBusy ? elapsed : null}
/>
```

Replace with:

```typescript
<StatusBar
  model={modelName}
  branch={gitBranch}
  autoApprove={autoApprove}
  msgCount={humanCount}
  elapsed={isAgentBusy ? elapsed : null}
  isActive={isAgentBusy}
  thinkingPhrase={thinkingPhrase}
/>
```

- [ ] **Step 3: Update the LiveZone JSX to remove dropped props**

Find:

```typescript
<LiveZone
  streamingText={streamingText}
  activities={activities}
  thinkingPhrase={thinkingPhrase}
  gitDiffStat={gitDiffStat}
  isStreaming={!!streamingText}
/>
```

Replace with:

```typescript
<LiveZone
  streamingText={streamingText}
  activities={activities}
  gitDiffStat={gitDiffStat}
/>
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 5: Run the full test suite**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "fix(ui): widen isAgentBusy to include running tools; wire StatusBar/LiveZone props"
```

---

## Task 5: Stream tokens in `agentNode`

**Files:**
- Modify: `packages/agent/src/main/agent_node.ts`

- [ ] **Step 1: Replace the file with the streaming implementation**

Full file content:

```typescript
import { SystemMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { createBaseModel } from '../utils/model';
import { buildSystemPrompt } from './prompt';
import type { RootStateType } from './root/state';
import { analyzeCodeTool } from '../tools/analyzeCode';
import {
  bashTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  globTool,
  grepTool,
  listDirTool,
  gitDiffTool,
  gitLogTool,
  requestApprovalTool,
  renameSymbolTool,
  findDefinitionTool,
  deleteFileTool,
} from '@robocode-packages/tools';

export const AGENT_TOOLS = [
  // read-only
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  findDefinitionTool,
  gitDiffTool,
  gitLogTool,
  analyzeCodeTool,
  // mutation
  writeFileTool,
  editFileTool,
  deleteFileTool,
  bashTool,
  renameSymbolTool,
  // control
  requestApprovalTool,
];

export async function agentNode(state: RootStateType) {
  const { sessionId, cwd, workspaceContext, selectedFiles, messages } = state;

  EventBus.emit('llm:start', { sessionId });

  const model = createBaseModel(true).bindTools(AGENT_TOOLS);

  const systemPrompt = workspaceContext
    ? buildSystemPrompt(workspaceContext, selectedFiles ?? [])
    : '';

  const allMessages = systemPrompt
    ? [new SystemMessage(systemPrompt), ...messages]
    : messages;

  try {
    const stream = await model.stream(allMessages, {
      configurable: { sessionId, cwd },
    });

    let response: AIMessageChunk | null = null;
    for await (const chunk of stream) {
      response = response === null ? chunk : response.concat(chunk);

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
    return { messages: [response!] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    throw err;
  }
}
```

- [ ] **Step 2: Type-check the agent package**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/agent_node.ts
git commit -m "fix(agent): stream tokens from agentNode so responses appear in chat"
```

---

## Task 6: Stream tokens in `summarizerNode`

**Files:**
- Modify: `packages/agent/src/main/summarizer.ts`

- [ ] **Step 1: Replace the file with the streaming implementation**

Full file content:

```typescript
import { execSync } from 'node:child_process';
import { AIMessage } from '@langchain/core/messages';
import type { AIMessageChunk } from '@langchain/core/messages';
import { EventBus } from '@robocode-packages/core';
import { createBaseModel } from '../utils/model';
import type { RootStateType } from './root/state';

function tryExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return '';
  }
}

export async function summarizerNode(state: RootStateType) {
  const { sessionId, cwd } = state;

  const gitDiffStat = tryExec('git diff HEAD --stat', cwd);
  const gitDiffFull = tryExec('git diff HEAD', cwd).slice(0, 6000);

  EventBus.emit('llm:start', { sessionId });
  const llm = createBaseModel(true);

  const recentMessages = state.messages.slice(-5);
  const messagesSummary = recentMessages
    .map((m) => `${m._getType()}: ${typeof m.content === 'string' ? m.content.slice(0, 300) : JSON.stringify(m.content).slice(0, 300)}`)
    .join('\n');

  const prompt = `You are summarizing the results of an autonomous coding session.

Git changes:
${gitDiffStat || '(no changes)'}

Full diff (truncated):
${gitDiffFull || '(none)'}

Conversation history (last 5 messages):
${messagesSummary}

Write a brief summary: what was accomplished, what files changed, any warnings or failures. Be concise (3-5 sentences).`;

  try {
    const stream = await llm.stream(prompt);

    let response: AIMessageChunk | null = null;
    for await (const chunk of stream) {
      response = response === null ? chunk : response.concat(chunk);

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

    const summary =
      typeof response?.content === 'string'
        ? response.content
        : JSON.stringify(response?.content ?? '');

    return { messages: [new AIMessage(summary)] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    return {
      messages: [new AIMessage(`Session complete. Git changes:\n${gitDiffStat || '(no changes)'}`)],
    };
  }
}
```

- [ ] **Step 2: Type-check the agent package**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/main/summarizer.ts
git commit -m "fix(agent): stream tokens from summarizerNode so final summary appears in chat"
```

---

## Task 7: Delete ToolCard + ToolGroup, clean up exports

**Files:**
- Modify: `apps/cli/src/screens/chat/components/index.ts`
- Delete: `apps/cli/src/screens/chat/components/ToolCard.tsx`
- Delete: `apps/cli/src/screens/chat/components/ToolGroup.tsx`

- [ ] **Step 1: Remove ToolCard and ToolGroup from `index.ts`**

Replace `apps/cli/src/screens/chat/components/index.ts` with:

```typescript
export * from './ApprovalCard';
export * from './DiffView';
export * from './GitDiffPreview';
export * from './LiveZone';
export * from './MessageCard';
export * from './PendingQuestion';
export * from './PendingReplan';
export * from './QuestionPrompt';
export * from './StatusBar';
export * from './SystemNoticeCard';
export * from './TurnSummaryCard';
```

- [ ] **Step 2: Delete the two files**

```bash
rm apps/cli/src/screens/chat/components/ToolCard.tsx apps/cli/src/screens/chat/components/ToolGroup.tsx
```

- [ ] **Step 3: Type-check to confirm nothing still imports them**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 4: Run full test suite**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A apps/cli/src/screens/chat/components/
git commit -m "chore(ui): delete ToolCard + ToolGroup; remove from component index"
```

---

## Self-Review Checklist

- [x] **Spec §1 (streaming agentNode)** → Task 5
- [x] **Spec §2 (streaming summarizerNode)** → Task 6
- [x] **Spec §3 (isAgentBusy fix)** → Task 4 step 1
- [x] **Spec §4 (elapsed timer stays running through tools)** → Task 4 step 1 (effect deps = `[isAgentBusy]`)
- [x] **Spec §5 (compact activity summary)** → Task 1 (utility) + Task 3 (LiveZone)
- [x] **Spec §6 (single tool: `⏺ Reading …`)** → Task 3 step 1 (`running.length === 1` branch)
- [x] **Spec §7 (file reference `⎿  path`)** → Task 3 step 1 (`fileRef` block)
- [x] **Spec §8 (done tools not shown in LiveZone)** → Task 3 (`running` filter)
- [x] **Spec §9 (StatusBar spinner + phrase)** → Task 2
- [x] **Spec §10 (thinkingPhrase moves out of LiveZone)** → Task 3 (removed) + Task 4 (wired to StatusBar)
- [x] **Spec §11 (delete ToolCard + ToolGroup)** → Task 7
- [x] **Type names consistent**: `ToolActivity`, `ActivityCategory`, `buildActivitySummary`, `buildActivityFileRef` used consistently across Tasks 1, 3, 4
