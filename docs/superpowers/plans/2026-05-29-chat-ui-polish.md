# Chat UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bordered input, action verb badges, inline tool result previews, and fix the broken `/clear` command.

**Architecture:** New `toolVerbs.ts` utility provides shared verb/label/preview logic used by both `ActivityFeed` and `AgentStatus`. All other changes are isolated to their own components. `/clear` fix is a one-liner in `Chat.tsx`.

**Tech Stack:** React/Ink (terminal UI), TypeScript, pnpm monorepo.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/cli/src/utils/toolVerbs.ts` | Verb map, label extractor, result preview |
| Modify | `apps/cli/src/utils/index.ts` | Re-export toolVerbs |
| Modify | `apps/cli/src/screens/chat/Chat.tsx` | /clear fix + pass runningToolInput |
| Modify | `apps/cli/src/screens/chat/components/AgentStatus.tsx` | Badge verb style |
| Modify | `apps/cli/src/screens/chat/components/ActivityFeed.tsx` | Verb + result preview rows |
| Modify | `apps/cli/src/elements/ChatInput.tsx` | Bordered input box |
| Create | `__tests__/cli/toolVerbs.test.ts` | Unit tests for pure utility functions |

---

## Task 1: toolVerbs.ts utility + tests

**Files:**
- Create: `apps/cli/src/utils/toolVerbs.ts`
- Create: `__tests__/cli/toolVerbs.test.ts`
- Modify: `apps/cli/src/utils/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/cli/toolVerbs.test.ts`:

```ts
import { getToolLabel, getToolVerb, getResultPreview } from '../../apps/cli/src/utils/toolVerbs';

describe('getToolLabel', () => {
  it('returns command for bash', () => {
    expect(getToolLabel('bash', { command: 'git status' })).toBe('git status');
  });
  it('returns path for read_file', () => {
    expect(getToolLabel('read_file', { path: 'src/foo.ts' })).toBe('src/foo.ts');
  });
  it('returns empty string when no path', () => {
    expect(getToolLabel('ast_analyzer', {})).toBe('');
  });
  it('truncates bash command at 60 chars', () => {
    const long = 'a'.repeat(80);
    expect(getToolLabel('bash', { command: long })).toHaveLength(60);
  });
});

describe('getToolVerb', () => {
  it('maps known tools to verbs', () => {
    expect(getToolVerb('read_file')).toBe('Reading');
    expect(getToolVerb('bash')).toBe('Running');
    expect(getToolVerb('str_replace_editor')).toBe('Editing');
    expect(getToolVerb('write_file')).toBe('Writing');
    expect(getToolVerb('grep')).toBe('Searching');
  });
  it('returns the raw name for unknown tools', () => {
    expect(getToolVerb('some_unknown_tool')).toBe('some_unknown_tool');
  });
});

describe('getResultPreview', () => {
  it('returns error first line when error is present', () => {
    expect(getResultPreview('bash', 'output', 'Error: something\ndetails')).toBe('Error: something');
  });
  it('returns null when no output and no error', () => {
    expect(getResultPreview('read_file', undefined, undefined)).toBeNull();
  });
  it('returns null for empty output', () => {
    expect(getResultPreview('bash', '', undefined)).toBeNull();
  });
  it('counts grep matches', () => {
    expect(getResultPreview('grep', 'line1\nline2\nline3', undefined)).toBe('3 matches');
  });
  it('uses singular for 1 grep match', () => {
    expect(getResultPreview('grep', 'line1', undefined)).toBe('1 match');
  });
  it('returns "no matches" for empty grep output', () => {
    expect(getResultPreview('grep', '   \n  ', undefined)).toBe('no matches');
  });
  it('counts glob files', () => {
    expect(getResultPreview('glob', 'a.ts\nb.ts', undefined)).toBe('2 files');
  });
  it('counts list_dir items', () => {
    expect(getResultPreview('list_dir', 'a\nb\nc', undefined)).toBe('3 items');
  });
  it('returns line count for read_file', () => {
    expect(getResultPreview('read_file', 'line1\nline2', undefined)).toBe('2 lines');
  });
  it('returns first line of bash output', () => {
    expect(getResultPreview('bash', 'success\nmore output', undefined)).toBe('success');
  });
  it('truncates long previews to 60 chars', () => {
    const long = 'a'.repeat(80);
    const result = getResultPreview('bash', long, undefined);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/toolVerbs.test.ts --no-coverage
```

Expected: `Cannot find module '../../apps/cli/src/utils/toolVerbs'`

- [ ] **Step 3: Create toolVerbs.ts**

Create `apps/cli/src/utils/toolVerbs.ts`:

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

export const getToolVerb = (name: string): string => TOOL_VERB[name] ?? name;

const truncate = (s: string, max = 60): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const firstNonEmptyLine = (s: string): string =>
  s.split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';

const countNonEmpty = (s: string): number =>
  s.split('\n').filter((l) => l.trim().length > 0).length;

export const getResultPreview = (
  name: string,
  output: string | undefined,
  error: string | undefined
): string | null => {
  if (error) return truncate(error.split('\n')[0].trim());
  if (!output) return null;

  if (name === 'bash') {
    const first = firstNonEmptyLine(output);
    return first ? truncate(first) : null;
  }
  if (name === 'grep' || name === 'search_files') {
    const n = countNonEmpty(output);
    return n > 0 ? `${n} match${n !== 1 ? 'es' : ''}` : 'no matches';
  }
  if (name === 'glob') {
    const n = countNonEmpty(output);
    return n > 0 ? `${n} file${n !== 1 ? 's' : ''}` : 'no files';
  }
  if (name === 'list_dir') {
    const n = countNonEmpty(output);
    return n > 0 ? `${n} item${n !== 1 ? 's' : ''}` : 'empty';
  }
  if (name === 'read_file' || name === 'ast_get_symbol') {
    const n = output.split('\n').length;
    return `${n} line${n !== 1 ? 's' : ''}`;
  }
  if (['write_file', 'edit_file', 'str_replace_editor', 'patch_file'].includes(name)) {
    const first = firstNonEmptyLine(output);
    return first ? truncate(first) : null;
  }
  const first = firstNonEmptyLine(output);
  return first ? truncate(first) : null;
};
```

- [ ] **Step 4: Re-export from utils/index.ts**

In `apps/cli/src/utils/index.ts`, add:

```ts
export * from './text';
export * from './constants';
export * from './toolVerbs';
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/toolVerbs.test.ts --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/utils/toolVerbs.ts apps/cli/src/utils/index.ts __tests__/cli/toolVerbs.test.ts
git commit -m "feat: add toolVerbs utility — verb map, label extractor, result preview"
```

---

## Task 2: Fix /clear command

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx:340-347`

The bug: `<Static>` in Ink permanently paints rendered items. Calling `setMessages([])` clears React state but does not erase already-painted terminal output. Incrementing `staticKey` forces `<Static>` to remount with an empty list, which clears the screen properly.

- [ ] **Step 1: Open Chat.tsx and locate the clear branch**

Find the block around line 340:

```ts
if (command === 'clear') {
  deleteSession(session.id);
  create();
  resetTransientState();
  setMessages([]);
  return;
}
```

- [ ] **Step 2: Add the missing setStaticKey call**

Replace that block with:

```ts
if (command === 'clear') {
  deleteSession(session.id);
  create();
  resetTransientState();
  setMessages([]);
  setStaticKey((k) => k + 1);
  return;
}
```

- [ ] **Step 3: Verify manually**

Run `pnpm dev`, type a few messages, then `/clear`. The terminal should clear all previous messages. Run again to confirm a second `/clear` on a fresh session also works cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "fix: /clear now resets Static key to erase painted messages"
```

---

## Task 3: AgentStatus — badge verb style

**Files:**
- Modify: `apps/cli/src/screens/chat/components/AgentStatus.tsx`

Current: `⠙ write_file (4s)` — raw tool name, no context.  
New: `⠙ [Writing] src/nav.tsx · 4s` — bold cyan verb badge + dimmed path + elapsed.

When only `thinkingText` is set (no running tool), display it as plain dimmed text without a badge.

- [ ] **Step 1: Replace AgentStatus.tsx entirely**

```tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { getToolLabel, getToolVerb } from '@utils';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

interface Props {
  runningTool?: string | null;
  runningToolInput?: unknown;
  elapsed: number;
  thinkingText?: string | null;
}

export const AgentStatus: React.FC<Props> = React.memo(
  ({ runningTool, runningToolInput, elapsed, thinkingText }) => {
    const [frame, setFrame] = useState(0);
    const isBusy = !!runningTool || !!thinkingText;

    useEffect(() => {
      if (!isBusy) {
        setFrame(0);
        return;
      }
      const interval = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 200);
      return () => clearInterval(interval);
    }, [isBusy]);

    if (!isBusy) return null;

    const label = runningTool ? getToolLabel(runningTool, runningToolInput) : null;

    return (
      <Box paddingX={1} gap={1}>
        <Text color="cyan">{SPINNER[frame]}</Text>
        {runningTool ? (
          <>
            <Text color="cyan" bold>[{getToolVerb(runningTool)}]</Text>
            {label ? (
              <Text color="gray" dimColor>
                {label}
              </Text>
            ) : null}
          </>
        ) : (
          <Text color="gray" dimColor>
            {thinkingText ?? ''}
          </Text>
        )}
        {elapsed > 0 && (
          <>
            <Text color="gray" dimColor>·</Text>
            <Text color="gray" dimColor>
              {formatElapsed(elapsed)}
            </Text>
          </>
        )}
      </Box>
    );
  }
);

AgentStatus.displayName = 'AgentStatus';
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/AgentStatus.tsx
git commit -m "feat: AgentStatus badge verb style — [Writing] path · elapsed"
```

---

## Task 4: ActivityFeed — verb + result preview

**Files:**
- Modify: `apps/cli/src/screens/chat/components/ActivityFeed.tsx`

Replaces the local `getLabel` function with shared `getToolLabel`/`getToolVerb`/`getResultPreview` from `@utils`. Each activity row becomes one line: `icon [Verb] path → preview duration`.

Running tools show the verb in `[brackets]` (cyan bold). Done/error tools show verb dimmed (no brackets).

- [ ] **Step 1: Replace ActivityFeed.tsx entirely**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { getToolLabel, getToolVerb, getResultPreview } from '@utils';

export interface ToolStreamChunk {
  kind: 'stdout' | 'stderr';
  text: string;
}

export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'done' | 'error';
  output?: string;
  error?: string;
  stream?: ToolStreamChunk[];
  startedAt?: number;
  finishedAt?: number;
}

const durationLabel = (startedAt?: number, finishedAt?: number): string | null => {
  if (!startedAt) return null;
  const end = finishedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (seconds < 1) return null;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const STATUS_ICON: Record<ToolActivity['status'], string> = {
  running: '⏺',
  done: '✓',
  error: '✗',
};

const STATUS_COLOR: Record<ToolActivity['status'], string> = {
  running: 'cyan',
  done: 'green',
  error: 'red',
};

interface Props {
  activities: ToolActivity[];
}

export const ActivityFeed: React.FC<Props> = ({ activities }) => {
  if (activities.length === 0) return null;

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {activities.map((activity) => {
        const isRunning = activity.status === 'running';
        const icon = STATUS_ICON[activity.status];
        const color = STATUS_COLOR[activity.status];
        const verb = getToolVerb(activity.name);
        const label = getToolLabel(activity.name, activity.input);
        const preview = getResultPreview(activity.name, activity.output, activity.error);
        const duration = durationLabel(activity.startedAt, activity.finishedAt);

        return (
          <Box key={activity.id} gap={1}>
            <Text color={color}>{icon}</Text>
            {isRunning ? (
              <Text color="cyan" bold>[{verb}]</Text>
            ) : (
              <Text color="gray" dimColor>{verb}</Text>
            )}
            {label ? (
              <Text color="gray" dimColor>{label}</Text>
            ) : null}
            {preview ? (
              <>
                <Text color="gray" dimColor>→</Text>
                <Text color={activity.status === 'error' ? 'red' : 'gray'} dimColor>
                  {preview}
                </Text>
              </>
            ) : null}
            {duration ? (
              <Text color="gray" dimColor>{duration}</Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/ActivityFeed.tsx
git commit -m "feat: ActivityFeed verb badges and inline result previews"
```

---

## Task 5: Wire runningToolInput into Chat.tsx → AgentStatus

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx:478,529`

AgentStatus now accepts `runningToolInput` to extract the path label for the badge. The existing `runningTool` derivation already does `activities.find(...)` — consolidate it into a single `runningActivity` variable and pass the input down.

- [ ] **Step 1: Replace the runningTool derivation (around line 478)**

Find:

```ts
const runningTool = activities.find((a) => a.status === 'running')?.name ?? null;
```

Replace with:

```ts
const runningActivity = activities.find((a) => a.status === 'running') ?? null;
const runningTool = runningActivity?.name ?? null;
```

- [ ] **Step 2: Pass runningToolInput to AgentStatus (around line 529)**

Find:

```tsx
<AgentStatus
  runningTool={runningTool}
  elapsed={elapsed}
  thinkingText={previewTool ? 'previewing edit_file' : thinkingText}
/>
```

Replace with:

```tsx
<AgentStatus
  runningTool={runningTool}
  runningToolInput={runningActivity?.input ?? null}
  elapsed={elapsed}
  thinkingText={previewTool ? 'previewing edit_file' : thinkingText}
/>
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat: pass runningToolInput to AgentStatus for path label in badge"
```

---

## Task 6: ChatInput — bordered box

**Files:**
- Modify: `apps/cli/src/elements/ChatInput.tsx`

Wrap the input row in a `<Box borderStyle="single">`. Border is `white` when idle, `gray` when busy. Pass `focus={!isLoading}` to TextInput to hide the cursor when the agent is running.

- [ ] **Step 1: Replace the return block in ChatInput.tsx**

Find the current return (from `return (` to closing `);`):

```tsx
return (
  <Box flexDirection="column">
    {showPalette && paletteCommands.length > 0 && (
      <SlashPalette input={value} selectedIndex={paletteIndex} />
    )}
    <Box paddingX={1} gap={1}>
      <Text color={isLoading ? 'gray' : 'white'} dimColor={isLoading}>
        ❯
      </Text>
      <TextInput
        value={value}
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

Replace with:

```tsx
return (
  <Box flexDirection="column" paddingX={1}>
    {showPalette && paletteCommands.length > 0 && (
      <SlashPalette input={value} selectedIndex={paletteIndex} />
    )}
    <Box
      borderStyle="single"
      borderColor={isLoading ? 'gray' : 'white'}
      paddingX={1}
      gap={1}
    >
      <Text color={isLoading ? 'gray' : 'white'} dimColor={isLoading}>
        ❯
      </Text>
      <TextInput
        focus={!isLoading}
        value={value}
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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

```bash
pnpm dev
```

Verify:
- Input has a visible single-line border at rest
- When agent is processing, border turns gray and cursor disappears
- `/clear` still works (tested in Task 2)
- Slash palette appears above the border when typing `/`
- Arrow key history navigation still works when idle

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/elements/ChatInput.tsx
git commit -m "feat: ChatInput single-line border, dims when agent is busy"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✓ Input border — Task 6
- ✓ /clear fix — Task 2
- ✓ Tool verbs (Reading/Writing/Running etc.) — Tasks 1, 3, 4
- ✓ Inline result preview — Tasks 1, 4
- ✓ Status badge above input — Task 3 (AgentStatus already renders above ChatInput in Chat.tsx layout)
- ✓ runningToolInput wiring — Task 5

**Type consistency:**
- `getToolLabel(name: string, input: unknown): string` — defined Task 1, used Tasks 3, 4
- `getToolVerb(name: string): string` — defined Task 1, used Tasks 3, 4
- `getResultPreview(name, output, error): string | null` — defined Task 1, used Task 4
- `runningToolInput?: unknown` on AgentStatus — added Task 3, wired Task 5
- `runningActivity` variable — added Task 5 only, no Task 3 reference conflict
