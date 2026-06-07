# CLI UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Robocode CLI to match Claude Code's visual style — new palette, CC-style components, token/cost tracking, and extended thinking display.

**Architecture:** Incremental component swap in dependency order so each task is independently shippable. Foundation types land first (Tasks 1–3), then visual components (Tasks 4–14), then new features (Tasks 15–17). Each task commits independently; the UI remains functional throughout.

**Tech Stack:** React/Ink (terminal UI), TypeScript, pnpm monorepo, Jest, `@langchain/anthropic` for usage metadata, `ink-text-input` for chat input.

---

## File Map

| File | Action | Task |
|------|--------|------|
| `apps/cli/src/utils/colors.ts` | Modify | 1 |
| `packages/config/src/constants.ts` | Modify | 2 |
| `packages/shared/src/types/event.ts` | Modify | 3 |
| `apps/cli/src/types/chat.ts` | Modify | 3 |
| `packages/shared/src/utils/cost.ts` | Create | 4 |
| `packages/shared/src/utils/index.ts` | Modify | 4 |
| `__tests__/shared/cost.test.ts` | Create | 4 |
| `packages/agent/src/main/agent_node.ts` | Modify | 5 |
| `apps/cli/src/utils/turnSummary.ts` | Modify | 6 |
| `__tests__/shared/turnSummary.test.ts` | Create | 6 |
| `apps/cli/src/screens/chat/components/StatusBar.tsx` | Modify | 7 |
| `apps/cli/src/screens/chat/components/WorkingLine.tsx` | Modify | 8 |
| `apps/cli/src/screens/chat/Chat.tsx` | Modify | 8, 13, 15, 17 |
| `apps/cli/src/screens/chat/components/MessageCard.tsx` | Modify | 9 |
| `apps/cli/src/screens/chat/components/LiveZone.tsx` | Modify | 10 |
| `apps/cli/src/screens/chat/components/ApprovalCard.tsx` | Modify | 11 |
| `packages/config/src/constants.ts` | Modify | 11 |
| `packages/agent/src/main/tools_node.ts` | Modify | 11 |
| `apps/cli/src/elements/ChatInput.tsx` | Modify | 12 |
| `apps/cli/src/screens/chat/components/TurnSummaryCard.tsx` | Modify | 13 |
| `apps/cli/src/screens/WelcomeScreen.tsx` | Modify | 14 |
| `apps/cli/src/elements/SlashPalette.tsx` | Modify | 15 |
| `apps/cli/src/screens/chat/components/ThinkingBlock.tsx` | Create | 16 |
| `apps/cli/src/screens/chat/components/index.ts` | Modify | 16 |

---

## Task 1: Update PALETTE to VSCode Dark+

**Files:**
- Modify: `apps/cli/src/utils/colors.ts`

- [ ] **Replace colors.ts entirely:**

```ts
export const PALETTE = {
  // Text hierarchy
  userText:    '#E8E8E8',
  aiText:      '#D4D4D4',
  muted:       '#6A6A6A',
  faint:       '#3A3A3A',

  // Semantic states
  teal:        '#4EC9B0',   // active / running
  sage:        '#4A9B4A',   // success / done
  amber:       '#CE9178',   // warning / approval
  rust:        '#F44747',   // error
  slate:       '#569CD6',   // info / system notices
  path:        '#9CDCFE',   // file paths

  // Diff-specific
  diffAdd:     '#4A7A4A',
  diffDel:     '#7A3A3A',
  diffHunk:    '#569CD6',
  diffContext: '#505050',
  diffFaint:   '#3A3A3A',

  // Status bar
  statusBar:   '#4A4A4A',

  // Context bar fill (for StatusBar progress)
  ctxNormal:   '#4EC9B0',   // <75% context used
  ctxWarn:     '#CE9178',   // 75–90%
  ctxCrit:     '#F44747',   // >90%
} as const;
```

- [ ] **Type-check to confirm no missing keys break existing consumers:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors (all existing PALETTE keys are present; `ctxNormal/ctxWarn/ctxCrit` are new additions).

- [ ] **Commit:**

```bash
git add apps/cli/src/utils/colors.ts
git commit -m "refactor(ui): update PALETTE to VSCode Dark+ aligned colors"
```

---

## Task 2: Add MODEL_CONTEXT map to config

**Files:**
- Modify: `packages/config/src/constants.ts`

- [ ] **Add MODEL_CONTEXT export at the bottom of `packages/config/src/constants.ts`:**

```ts
export const MODEL_CONTEXT: Record<string, number> = {
  'claude-sonnet-4-6':         200_000,
  'claude-opus-4-8':           200_000,
  'claude-haiku-4-5-20251001': 200_000,
};

export const ALLOWED_TOOLS_PATH = path.join(ROOT_DIR, 'allowed-tools.json');
```

- [ ] **Type-check config package:**

```bash
npx tsc --noEmit --project packages/config/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add packages/config/src/constants.ts
git commit -m "feat(config): add MODEL_CONTEXT window map and ALLOWED_TOOLS_PATH"
```

---

## Task 3: Extend shared types — llm:usage event + StaticItem thinking kind

**Files:**
- Modify: `packages/shared/src/types/event.ts`
- Modify: `apps/cli/src/types/chat.ts`

- [ ] **Add `llm:usage` to AppEvents in `packages/shared/src/types/event.ts` after `llm:error`:**

```ts
'llm:usage': {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
};
```

- [ ] **Update `apps/cli/src/types/chat.ts` — add `tokens`/`cost` to `TurnSummaryData` and add `'thinking'` StaticItem kind:**

```ts
export interface TurnSummaryData {
  groups: Array<{ verb: string; count: number }>;
  durationSec: number;
  timestamp: number;
  hasError: boolean;
  tokens: number;   // turn-level token count (0 if not tracked)
  cost: number;     // turn-level cost USD (0 if not tracked)
}

export type StaticItem =
  | { kind: 'human';        id: string; content: string }
  | { kind: 'ai';           id: string; content: string }
  | { kind: 'system';       id: string; content: string }
  | { kind: 'turn-summary'; id: string; data: TurnSummaryData }
  | { kind: 'thinking';     id: string; text: string };
```

- [ ] **Type-check both packages:**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json 2>&1 | head -20
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: errors only for downstream consumers of `TurnSummaryData` (fixed in Task 6) and `StaticItem` (fixed in Task 16). Note these for now.

- [ ] **Commit:**

```bash
git add packages/shared/src/types/event.ts apps/cli/src/types/chat.ts
git commit -m "feat(types): add llm:usage event, thinking StaticItem kind, tokens/cost to TurnSummaryData"
```

---

## Task 4: Add computeCost utility + tests

**Files:**
- Create: `packages/shared/src/utils/cost.ts`
- Modify: `packages/shared/src/utils/index.ts`
- Create: `__tests__/shared/cost.test.ts`

- [ ] **Write the failing test first at `__tests__/shared/cost.test.ts`:**

```ts
import { computeCost } from '@robocode-packages/shared';

describe('computeCost', () => {
  it('computes cost for sonnet', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(18.0); // $3 input + $15 output per 1M
  });

  it('computes cache read discount', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.30);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const cost = computeCost('unknown-model', {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBeCloseTo(3.0);
  });

  it('returns 0 for zero tokens', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
    });
    expect(cost).toBe(0);
  });
});
```

- [ ] **Run test to confirm it fails:**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/cost.test.ts
```

Expected: FAIL — `computeCost is not a function` or import error.

- [ ] **Create `packages/shared/src/utils/cost.ts`:**

```ts
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, cacheRead: 0.30 },
  'claude-opus-4-8':           { input: 15.00, output: 75.00, cacheRead: 1.50 },
  'claude-haiku-4-5-20251001': { input: 0.80,  output: 4.00,  cacheRead: 0.08 },
};

export function computeCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
): number {
  const prices = PRICES[model] ?? PRICES['claude-sonnet-4-6'];
  return (
    usage.input_tokens * prices.input +
    usage.output_tokens * prices.output +
    (usage.cache_read_input_tokens ?? 0) * prices.cacheRead
  ) / 1_000_000;
}
```

- [ ] **Export from `packages/shared/src/utils/index.ts` — add line:**

```ts
export * from './cost';
```

- [ ] **Run tests to confirm they pass:**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/cost.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Commit:**

```bash
git add packages/shared/src/utils/cost.ts packages/shared/src/utils/index.ts __tests__/shared/cost.test.ts
git commit -m "feat(shared): add computeCost utility with per-model pricing"
```

---

## Task 5: Emit llm:usage from agentNode

**Files:**
- Modify: `packages/agent/src/main/agent_node.ts`

- [ ] **Update `packages/agent/src/main/agent_node.ts` — add usage emit after `llm:end`, and emit thinking tokens. Replace the `try` block's content (lines 60–86):**

```ts
import { computeCost } from '@robocode-packages/shared';
```

Add the import at the top of the file with the other shared imports.

Then replace the `try` block inside `agentNode` (from `const stream = ...` to `return { messages: [response!] }`):

```ts
  try {
    const model = createBaseModel(true).bindTools(AGENT_TOOLS);
    const stream = await model.stream(allMessages, {
      configurable: { sessionId, cwd },
    });

    let response: AIMessageChunk | null = null;
    for await (const chunk of stream) {
      response = response === null ? chunk : response.concat(chunk);

      const contentBlocks = Array.isArray(chunk.content)
        ? (chunk.content as { type: string; text?: string; thinking?: string }[])
        : [];

      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text) {
          EventBus.emit('llm:token', { sessionId, token: block.text });
        }
        if (block.type === 'thinking' && block.thinking) {
          EventBus.emit('llm:thinking', { sessionId, text: block.thinking });
        }
      }

      if (typeof chunk.content === 'string' && chunk.content) {
        EventBus.emit('llm:token', { sessionId, token: chunk.content });
      }
    }

    const usage = response?.usage_metadata;
    if (usage) {
      const responseMeta = (response as { response_metadata?: { usage?: { cache_read_input_tokens?: number } } })
        ?.response_metadata;
      const cacheReadTokens = responseMeta?.usage?.cache_read_input_tokens ?? 0;
      EventBus.emit('llm:usage', {
        sessionId,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens,
        cost: computeCost(profile.model, {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          cache_read_input_tokens: cacheReadTokens,
        }),
      });
    }

    EventBus.emit('llm:end', { sessionId });
    return { messages: [response!] };
  } catch (err) {
    EventBus.emit('llm:error', { sessionId, error: String(err) });
    throw err;
  }
```

Add `ProfileConfig` to the existing import from `@robocode-packages/core` at the top of the file:

```ts
import { EventBus, ProfileConfig } from '@robocode-packages/core';
```

Add `profile` access at the top of `agentNode` (before the existing `EventBus.emit('llm:start', ...)`):

```ts
const profile = ProfileConfig.active();
if (!profile) throw new Error('No active profile');
```

This makes `profile.model` available for `computeCost` inside the try block.

- [ ] **Type-check agent package:**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add packages/agent/src/main/agent_node.ts
git commit -m "feat(agent): emit llm:usage with token counts and cost after each LLM call"
```

---

## Task 6: Update buildTurnSummary to carry tokens/cost

**Files:**
- Modify: `apps/cli/src/utils/turnSummary.ts`
- Create: `__tests__/shared/turnSummary.test.ts`

- [ ] **Write failing test at `__tests__/shared/turnSummary.test.ts`:**

```ts
import { buildTurnSummary } from '../../apps/cli/src/utils/turnSummary';
import type { ToolActivity } from '../../apps/cli/src/types/chat';

const makeActivity = (name: string, status: 'done' | 'error' = 'done'): ToolActivity => ({
  id: `${name}-1`,
  name,
  input: { path: 'src/foo.ts' },
  status,
  startedAt: 1000,
  finishedAt: 3000,
});

describe('buildTurnSummary', () => {
  it('groups tool verbs and computes duration', () => {
    const result = buildTurnSummary(
      [makeActivity('read_file'), makeActivity('edit_file')],
      { tokens: 0, cost: 0 }
    );
    expect(result.groups).toContainEqual({ verb: 'Read', count: 1 });
    expect(result.groups).toContainEqual({ verb: 'Patched', count: 1 });
    expect(result.durationSec).toBe(2);
    expect(result.hasError).toBe(false);
  });

  it('includes tokens and cost', () => {
    const result = buildTurnSummary(
      [makeActivity('bash')],
      { tokens: 4218, cost: 0.04 }
    );
    expect(result.tokens).toBe(4218);
    expect(result.cost).toBeCloseTo(0.04);
  });

  it('sets hasError true when any activity errored', () => {
    const result = buildTurnSummary(
      [makeActivity('bash', 'error')],
      { tokens: 0, cost: 0 }
    );
    expect(result.hasError).toBe(true);
  });
});
```

- [ ] **Run test to confirm it fails:**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/turnSummary.test.ts
```

Expected: FAIL — `buildTurnSummary` accepts wrong number of args or tokens/cost missing.

- [ ] **Update `apps/cli/src/utils/turnSummary.ts` — add second parameter:**

```ts
export function buildTurnSummary(
  activities: ToolActivity[],
  usage: { tokens: number; cost: number } = { tokens: 0, cost: 0 }
): TurnSummaryData {
  const flat = collectActivities(activities);
  const counts = new Map<string, number>();
  let minStart = Infinity;
  let maxEnd = 0;
  let hasError = false;

  for (const a of flat) {
    const verb = groupVerb(a.name);
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
    if (a.startedAt !== undefined && a.startedAt < minStart) minStart = a.startedAt;
    if (a.finishedAt !== undefined && a.finishedAt > maxEnd) maxEnd = a.finishedAt;
    if (a.status === 'error') hasError = true;
  }

  const groups = [...counts.entries()].map(([verb, count]) => ({ verb, count }));
  const durationSec =
    minStart < Infinity && maxEnd > 0
      ? Math.round((maxEnd - minStart) / 1000)
      : 0;

  return {
    groups,
    durationSec,
    timestamp: Date.now(),
    hasError,
    tokens: usage.tokens,
    cost: usage.cost,
  };
}
```

- [ ] **Run tests to confirm they pass:**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/shared/turnSummary.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Commit:**

```bash
git add apps/cli/src/utils/turnSummary.ts __tests__/shared/turnSummary.test.ts
git commit -m "feat(ui): extend buildTurnSummary to carry tokens and cost"
```

---

## Task 7: Redesign StatusBar — two-row with context fill bar

**Files:**
- Modify: `apps/cli/src/screens/chat/components/StatusBar.tsx`

- [ ] **Replace `apps/cli/src/screens/chat/components/StatusBar.tsx` entirely:**

```tsx
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '@utils';
import { MODEL_CONTEXT } from '@robocode-packages/config';

function formatCost(cost: number): string {
  if (cost === 0) return '';
  return `~$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${n} tok`;
}

interface Props {
  model: string;
  branch: string | null;
  autoApprove: boolean;
  msgCount: number;
  totalTokens: number;
  totalCost: number;
}

export const StatusBar: React.FC<Props> = ({
  model, branch, autoApprove, msgCount, totalTokens, totalCost,
}) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const barWidth = Math.max(10, termWidth - 2);

  const contextMax = MODEL_CONTEXT[model] ?? 200_000;
  const contextPct = totalTokens > 0 ? totalTokens / contextMax : 0;
  const fillCount = Math.round(contextPct * barWidth);
  const fillColor =
    contextPct > 0.9 ? PALETTE.ctxCrit :
    contextPct > 0.75 ? PALETTE.ctxWarn :
    PALETTE.ctxNormal;

  const sep = <Text color={PALETTE.faint}> · </Text>;
  const tokStr = formatTokens(totalTokens);
  const costStr = formatCost(totalCost);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={0}>
        <Text color={PALETTE.statusBar}>{model}</Text>
        {sep}
        <Text color={PALETTE.statusBar}>{branch ?? 'no git'}</Text>
        {sep}
        <Text color={PALETTE.statusBar}>{msgCount} msg{msgCount !== 1 ? 's' : ''}</Text>
        {tokStr ? <>{sep}<Text color={PALETTE.statusBar}>{tokStr}</Text></> : null}
        {costStr ? <>{sep}<Text color={PALETTE.statusBar}>{costStr}</Text></> : null}
        {autoApprove && <>{sep}<Text color={PALETTE.teal}>⚡ auto</Text></>}
      </Box>
      {totalTokens > 0 && (
        <Box>
          <Text color={fillColor}>{'█'.repeat(fillCount)}</Text>
          <Text color={PALETTE.faint}>{'░'.repeat(barWidth - fillCount)}</Text>
        </Box>
      )}
    </Box>
  );
};
```

- [ ] **Update `Chat.tsx` — add `totalTokens` and `totalCost` state and pass to StatusBar.** Find the StatusBar render in `Chat.tsx` (around line 419) and update:

```tsx
// Add state near other useState declarations (around line 79):
const [totalTokens, setTotalTokens] = useState(0);
const [totalCost, setTotalCost] = useState(0);

// In the StatusBar render (replace existing StatusBar element):
<StatusBar
  model={modelName}
  branch={gitBranch}
  autoApprove={autoApprove}
  msgCount={humanCount}
  totalTokens={totalTokens}
  totalCost={totalCost}
/>
```

Also add `totalTokens` and `totalCost` to `resetTransientState`:
```ts
setTotalTokens(0);
setTotalCost(0);
```

- [ ] **Type-check CLI:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors from StatusBar.

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/StatusBar.tsx apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat(ui): redesign StatusBar with two-row layout and context fill bar"
```

---

## Task 8: Update WorkingLine — contextual phrase cycling

**Files:**
- Modify: `apps/cli/src/screens/chat/components/WorkingLine.tsx`
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

The phrase displayed in WorkingLine already comes from `thinkingPhrase` state in Chat.tsx. This task wires the correct phrases for each event and updates WorkingLine's visual style.

- [ ] **Replace `apps/cli/src/screens/chat/components/WorkingLine.tsx`:**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, formatElapsed } from '@utils';
import { useSpinner } from '@hooks';

interface Props {
  isActive: boolean;
  phrase: string | null;
  elapsed: number | null;
}

export const WorkingLine: React.FC<Props> = ({ isActive, phrase, elapsed }) => {
  const spinnerFrame = useSpinner(isActive);

  if (!isActive) return null;

  return (
    <Box paddingX={1} gap={1}>
      <Text color={PALETTE.teal}>{spinnerFrame}</Text>
      <Text color={PALETTE.muted}>{phrase ?? 'Working…'}</Text>
      {elapsed !== null && elapsed >= 2 && (
        <Text color={PALETTE.faint}>{formatElapsed(elapsed)}</Text>
      )}
    </Box>
  );
};
```

- [ ] **Update Chat.tsx — rename `thinkingPhrase` prop to `phrase` in WorkingLine call, and add the remaining phrase triggers.** Find all `setThinkingPhrase` calls in `Chat.tsx` and update the event handlers to set contextual phrases:

In the `tool:start` event handler (around line 190), update to set contextual phrase:
```ts
EventBus.on('tool:start', ({ sessionId, name, input, callId }) => {
  if (sessionId !== id) return;
  const activityId = callId ?? makeToolId(name);
  // Contextual phrase
  const READ_TOOLS = new Set(['read_file','list_dir','glob','grep','search_files','find_definition','ast_analyzer','git_diff','git_log']);
  const EDIT_TOOLS = new Set(['write_file','edit_file','patch_file','str_replace_editor','delete_file','rename_symbol']);
  const phrase =
    READ_TOOLS.has(name) ? 'Reading files…' :
    EDIT_TOOLS.has(name) ? 'Writing…' :
    name === 'bash' ? 'Running command…' :
    'Working…';
  setThinkingPhrase(phrase);
  setActivities(prev => { /* existing code unchanged */ });
}),
```

In `tool:end` handler update to: `setThinkingPhrase('Reviewing results…');`

In `agent:plan_pending` handler add: `setThinkingPhrase('Planning…');`

Update WorkingLine render in Chat.tsx JSX (prop name changed):
```tsx
<WorkingLine
  isActive={isAgentBusy && !pendingApproval}
  phrase={thinkingPhrase}
  elapsed={isAgentBusy && !pendingApproval ? elapsed : null}
/>
```

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -i "WorkingLine\|phrase" | head -10
```

Expected: no errors related to WorkingLine.

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/WorkingLine.tsx apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat(ui): WorkingLine contextual phrase cycling per tool category"
```

---

## Task 9: Redesign MessageCard — CC clean style

**Files:**
- Modify: `apps/cli/src/screens/chat/components/MessageCard.tsx`

- [ ] **Update the human and system render blocks in `MessageCard.tsx`.** The AI rendering (`renderContent`) stays the same — only the wrapper boxes change. Replace the two non-AI render blocks and the AI wrapper (lines 141–168):

```tsx
export const MessageCard: React.FC<{ msg: BaseMessage }> = ({ msg }) => {
  const role = messageType(msg) as Role;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);

  if (role === 'human') {
    return (
      <Box marginBottom={1}>
        <Text color={PALETTE.muted}>❯ </Text>
        <Text color={PALETTE.userText}>{content}</Text>
      </Box>
    );
  }

  if (role === 'system') {
    return (
      <Box marginBottom={1}>
        <Text color={PALETTE.slate} dimColor>◆ {content}</Text>
      </Box>
    );
  }

  // ai
  return (
    <Box flexDirection="column" marginBottom={1}>
      {renderContent(content)}
    </Box>
  );
};
```

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/MessageCard.tsx
git commit -m "refactor(ui): MessageCard CC-clean style — remove padding indent, tighten margins"
```

---

## Task 10: Redesign LiveZone — Tool(arg) format with timing and status icons

**Files:**
- Modify: `apps/cli/src/screens/chat/components/LiveZone.tsx`

- [ ] **Replace `LiveZone.tsx` entirely:**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, truncate } from '@utils';
import { useSpinner } from '@hooks';
import type { ToolActivity } from '@types';

function getPrimaryArg(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const val = args.path ?? args.file ?? args.command ?? args.input ?? args.pattern ?? args.target;
  return val ? truncate(String(val), 50) : '';
}

function formatToolLabel(name: string, input: unknown): string {
  const arg = getPrimaryArg(name, input);
  return arg ? `${name}(${arg})` : name;
}

function formatElapsedMs(startedAt: number | undefined, finishedAt: number | undefined): string {
  if (!startedAt) return '';
  const ms = (finishedAt ?? Date.now()) - startedAt;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

interface Props {
  streamingText: string;
  activities: ToolActivity[];
  gitDiffStat: string | null;
}

export const LiveZone: React.FC<Props> = ({ streamingText, activities, gitDiffStat }) => {
  const spinnerFrame = useSpinner(activities.some(a => a.status === 'running'));

  const hasContent = streamingText || activities.length > 0 || gitDiffStat;
  if (!hasContent) return null;

  return (
    <Box flexDirection="column">
      {streamingText && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text color={PALETTE.aiText}>{streamingText}</Text>
        </Box>
      )}

      {activities.map(activity => {
        const label = formatToolLabel(activity.name, activity.input);
        const timing = formatElapsedMs(activity.startedAt, activity.finishedAt);
        const lastChunk = activity.stream?.at(-1)?.text ?? null;

        let icon: string;
        let iconColor: string;
        if (activity.status === 'running') {
          icon = spinnerFrame;
          iconColor = PALETTE.teal;
        } else if (activity.status === 'done') {
          icon = '✓';
          iconColor = PALETTE.sage;
        } else {
          icon = '✗';
          iconColor = PALETTE.rust;
        }

        return (
          <Box key={activity.id} flexDirection="column" paddingLeft={2}>
            <Box gap={1}>
              <Text color={iconColor}>{icon}</Text>
              <Text color={PALETTE.muted}>{label}</Text>
              {timing && <Text color={PALETTE.faint}>{timing}{activity.status === 'running' ? '…' : ''}</Text>}
            </Box>
            {activity.status === 'running' && lastChunk && (
              <Box paddingLeft={2}>
                <Text color={PALETTE.faint}>⎿  {truncate(lastChunk.replace(/\n/g, ' '), 80)}</Text>
              </Box>
            )}
          </Box>
        );
      })}

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

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -i "LiveZone" | head -10
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/LiveZone.tsx
git commit -m "feat(ui): LiveZone redesign — Tool(arg) format, per-tool timing, status icons"
```

---

## Task 11: Redesign ApprovalCard — prominent modal with Always-allow

**Files:**
- Modify: `apps/cli/src/screens/chat/components/ApprovalCard.tsx`
- Modify: `packages/agent/src/main/tools_node.ts`

- [ ] **Replace `ApprovalCard.tsx` entirely:**

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@utils';
import { DiffView } from './DiffView';

type ApprovalKind =
  | { kind: 'tool'; tool: { name: string; input: unknown } }
  | { kind: 'plan'; plan: string };

type Selection = 'approve' | 'deny' | 'always';

const DESTRUCTIVE_TOOLS = new Set(['write_file', 'edit_file', 'patch_file', 'str_replace_editor', 'undo', 'delete_file']);
const DIFF_TOOLS = new Set(['write_file', 'edit_file', 'patch_file', 'str_replace_editor']);

interface Props {
  approval: ApprovalKind;
  isActive: boolean;
  onConfirm: (result: 'approve' | 'deny' | 'always') => void;
}

export const ApprovalCard: React.FC<Props> = ({ approval, isActive, onConfirm }) => {
  const isDestructive = approval.kind === 'tool' && DESTRUCTIVE_TOOLS.has(approval.tool.name);
  const borderColor = isDestructive ? PALETTE.rust : PALETTE.amber;
  const [selected, setSelected] = useState<Selection>(isDestructive ? 'deny' : 'approve');
  const [diffExpanded, setDiffExpanded] = useState(true);

  const selections: Selection[] = ['approve', 'deny', 'always'];

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') { onConfirm('approve'); return; }
    if (input === 'n' || input === 'N' || key.escape) { onConfirm('deny'); return; }
    if (input === 'a' || input === 'A') { onConfirm('always'); return; }
    if (input === 'd' || input === 'D') { setDiffExpanded(p => !p); return; }
    if (key.leftArrow) {
      setSelected(p => { const i = selections.indexOf(p); return selections[Math.max(0, i - 1)]; });
    }
    if (key.rightArrow) {
      setSelected(p => { const i = selections.indexOf(p); return selections[Math.min(selections.length - 1, i + 1)]; });
    }
    if (key.return || input === ' ') onConfirm(selected);
  }, { isActive });

  const args = approval.kind === 'tool' ? ((approval.tool.input ?? {}) as Record<string, unknown>) : {};
  const targetPath = typeof args.path === 'string' ? args.path : typeof args.file === 'string' ? args.file : '';
  const command = typeof args.command === 'string' ? args.command : '';
  const hasDiff = approval.kind === 'tool' && DIFF_TOOLS.has(approval.tool.name);
  const oldStr = typeof args.oldStr === 'string' ? args.oldStr : '';
  const newStr = typeof args.newStr === 'string' ? args.newStr : '';
  const fileContent = typeof args.content === 'string' ? args.content : '';
  const diffProps = hasDiff ? (oldStr || newStr ? { oldStr, newStr } : { fullFileContent: fileContent }) : null;

  const toolName = approval.kind === 'tool' ? approval.tool.name : 'plan';
  const riskLabel = isDestructive ? 'destructive' : 'moderate';

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2} borderStyle="single" borderColor={borderColor}>
      <Box gap={2} marginBottom={1}>
        <Text color={borderColor} bold>⚠  TOOL APPROVAL REQUIRED</Text>
      </Box>
      <Box marginBottom={1}>
        <Text color={PALETTE.muted}>{toolName}</Text>
        <Text color={PALETTE.faint}> · {riskLabel}</Text>
      </Box>

      {targetPath && (
        <Box marginBottom={1}>
          <Text color={PALETTE.path}>{targetPath}</Text>
        </Box>
      )}
      {command && (
        <Box marginBottom={1}>
          <Text color={PALETTE.aiText}>{command}</Text>
        </Box>
      )}

      {approval.kind === 'plan' && (
        <Box flexDirection="column" marginBottom={1}>
          {approval.plan.split('\n').filter(l => l.trim()).map((line, i) => (
            <Text key={i} color={PALETTE.aiText}>{line}</Text>
          ))}
        </Box>
      )}

      {hasDiff && diffProps && (
        <Box flexDirection="column" marginBottom={1}>
          {diffExpanded ? (
            <>
              <DiffView {...diffProps} maxLines={40} />
              <Text color={PALETTE.faint} dimColor>d to hide diff</Text>
            </>
          ) : (
            <Text color={PALETTE.muted} dimColor>diff hidden · d to show</Text>
          )}
        </Box>
      )}

      <Box gap={3} marginTop={1} borderStyle="single" borderColor={PALETTE.faint} paddingX={1}>
        {(['approve', 'deny', 'always'] as Selection[]).map(opt => (
          <Text key={opt}
            color={selected === opt ? (opt === 'deny' ? PALETTE.rust : opt === 'always' ? PALETTE.teal : PALETTE.sage) : PALETTE.muted}
            bold={selected === opt}
          >
            [{opt === 'approve' ? 'Y' : opt === 'deny' ? 'N' : 'A'}] {opt.charAt(0).toUpperCase() + opt.slice(1)}
          </Text>
        ))}
        <Text color={PALETTE.faint} dimColor>←/→  Enter</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Update `Chat.tsx` — change `confirmApproval(approved: boolean)` to handle 'always' result:**

Find `confirmApproval` function (around line 374) and replace:

```ts
const confirmApproval = (result: 'approve' | 'deny' | 'always') => {
  if (!session) return;
  const approved = result === 'approve' || result === 'always';
  EventBus.emit('agent:resume', { sessionId: session.id, decision: approved ? 'approve' : 'reject' });
  if (result === 'always' && pendingApproval?.kind === 'tool') {
    EventBus.emit('agent:allow_tool', { toolName: pendingApproval.tool.name });
  }
  setPendingApproval(null);
  if (approved) setIsLoading(true);
};
```

Add `'agent:allow_tool': { toolName: string }` to `AppEvents` in `packages/shared/src/types/event.ts`.

Update `ApprovalCard` prop in JSX: `onConfirm={confirmApproval}`.

- [ ] **Add `agent:allow_tool` to AppEvents in `packages/shared/src/types/event.ts` — add after `agent:stop`:**

```ts
'agent:allow_tool': { toolName: string };
```

- [ ] **Update `packages/agent/src/main/tools_node.ts` to load and respect allowed tools.** Add at the top of the file:

```ts
import fs from 'node:fs';
import { ALLOWED_TOOLS_PATH } from '@robocode-packages/config';

function loadAllowedTools(): Set<string> {
  try {
    const raw = fs.readFileSync(ALLOWED_TOOLS_PATH, 'utf8');
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveAllowedTool(toolName: string): void {
  try {
    const existing = loadAllowedTools();
    existing.add(toolName);
    fs.mkdirSync(require('node:path').dirname(ALLOWED_TOOLS_PATH), { recursive: true });
    fs.writeFileSync(ALLOWED_TOOLS_PATH, JSON.stringify([...existing], null, 2));
  } catch (err) {
    debug('[allowedTools] write failed:', err);
  }
}
```

Then in `toolsNode`, before checking `destructiveCalls`, skip tools already allowed:

```ts
const allowedTools = loadAllowedTools();
const destructiveCalls = lastMsg.tool_calls.filter(
  (tc) => (TOOL_RISK[tc.name] ?? 'safe') === 'destructive' && !allowedTools.has(tc.name),
);
```

Also subscribe to `agent:allow_tool` event to save:
```ts
EventBus.on('agent:allow_tool', ({ toolName }) => {
  saveAllowedTool(toolName);
});
```
Add this subscription at module level (outside the function), so it registers once.

Add `debug` import from `@robocode-packages/shared`.

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/ApprovalCard.tsx apps/cli/src/screens/chat/Chat.tsx packages/agent/src/main/tools_node.ts packages/shared/src/types/event.ts
git commit -m "feat(ui): ApprovalCard prominent modal with Always-allow persistent list"
```

---

## Task 12: Redesign ChatInput — separator line + multiline

**Files:**
- Modify: `apps/cli/src/elements/ChatInput.tsx`

- [ ] **Replace `ChatInput.tsx` entirely:**

```tsx
import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { SlashPalette, SLASH_COMMANDS } from './SlashPalette';
import { PALETTE } from '@utils';

interface Props {
  onSubmit: (value: string) => void;
  isActive?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSubmit, isActive }) => {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  const showPalette = value.startsWith('/') && !!isActive;
  const paletteCommands = showPalette
    ? SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(value))
    : [];

  useInput(
    (input, key) => {
      if (showPalette && paletteCommands.length > 0) {
        if (key.upArrow) { setPaletteIndex(p => Math.max(0, p - 1)); return; }
        if (key.downArrow) { setPaletteIndex(p => Math.min(paletteCommands.length - 1, p + 1)); return; }
        if (key.tab) {
          const sel = paletteCommands[paletteIndex];
          if (sel) { setValue(sel.command); setPaletteIndex(0); }
          return;
        }
        if (key.escape) { setValue(''); setPaletteIndex(0); return; }
        return;
      }

      if (key.upArrow && history.length > 0 && (historyIndex >= 0 || value.trim().length === 0)) {
        if (historyIndex === -1) setDraft(value);
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next] ?? '');
        return;
      }
      if (key.downArrow && historyIndex >= 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setValue(next < 0 ? draft : (history[next] ?? ''));
      }

      // Shift+Enter → insert newline
      if (key.return && key.shift) {
        setValue(v => v + '\n');
        return;
      }
    },
    { isActive }
  );

  const handleSubmit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed || !isActive) return;
    setHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setValue('');
    setDraft('');
    setPaletteIndex(0);
    onSubmit(trimmed);
  };

  const promptColor = isActive ? PALETTE.muted : PALETTE.faint;

  return (
    <Box flexDirection="column" paddingX={1}>
      {showPalette && paletteCommands.length > 0 && (
        <SlashPalette input={value} selectedIndex={paletteIndex} />
      )}
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}
           borderColor={PALETTE.faint} paddingTop={1} gap={1}>
        <Text color={promptColor}>❯</Text>
        <TextInput
          focus={!!isActive}
          value={value}
          placeholder="Message robocode…"
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
};
```

**Note:** Ink's `Box` `borderStyle="single"` applies to all sides. To get only a top border, use a thin `Text` separator instead:

```tsx
      <Box flexDirection="column" paddingTop={0}>
        <Text color={PALETTE.faint}>{'─'.repeat(80)}</Text>
        <Box gap={1} paddingTop={0}>
          <Text color={promptColor}>❯</Text>
          <TextInput ... />
        </Box>
      </Box>
```

Use `useStdout` to get actual terminal width for the separator line width.

Full corrected version:

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { SlashPalette, SLASH_COMMANDS } from './SlashPalette';
import { PALETTE } from '@utils';

interface Props {
  onSubmit: (value: string) => void;
  isActive?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSubmit, isActive }) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  const showPalette = value.startsWith('/') && !!isActive;
  const paletteCommands = showPalette
    ? SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(value))
    : [];

  useInput(
    (input, key) => {
      if (showPalette && paletteCommands.length > 0) {
        if (key.upArrow) { setPaletteIndex(p => Math.max(0, p - 1)); return; }
        if (key.downArrow) { setPaletteIndex(p => Math.min(paletteCommands.length - 1, p + 1)); return; }
        if (key.tab) {
          const sel = paletteCommands[paletteIndex];
          if (sel) { setValue(sel.command); setPaletteIndex(0); }
          return;
        }
        if (key.escape) { setValue(''); setPaletteIndex(0); return; }
        return;
      }
      if (key.upArrow && history.length > 0 && (historyIndex >= 0 || value.trim().length === 0)) {
        if (historyIndex === -1) setDraft(value);
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next] ?? '');
        return;
      }
      if (key.downArrow && historyIndex >= 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setValue(next < 0 ? draft : (history[next] ?? ''));
      }
    },
    { isActive }
  );

  const handleSubmit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed || !isActive) return;
    setHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setValue('');
    setDraft('');
    setPaletteIndex(0);
    onSubmit(trimmed);
  };

  const promptColor = isActive ? PALETTE.muted : PALETTE.faint;

  return (
    <Box flexDirection="column">
      {showPalette && paletteCommands.length > 0 && (
        <SlashPalette input={value} selectedIndex={paletteIndex} />
      )}
      <Text color={PALETTE.faint}>{'─'.repeat(Math.max(0, termWidth))}</Text>
      <Box paddingX={1} gap={1}>
        <Text color={promptColor}>❯</Text>
        <TextInput
          focus={!!isActive}
          value={value}
          placeholder="Message robocode…"
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
};
```

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -i "ChatInput" | head -10
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add apps/cli/src/elements/ChatInput.tsx
git commit -m "feat(ui): ChatInput separator line style, remove box border, update placeholder"
```

---

## Task 13: Redesign TurnSummaryCard — compact footer with cost

**Files:**
- Modify: `apps/cli/src/screens/chat/components/TurnSummaryCard.tsx`
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

- [ ] **Replace `TurnSummaryCard.tsx`:**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';
import { formatElapsed } from '@utils';
import type { TurnSummaryData } from '@types';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
}

function formatCost(cost: number): string {
  return cost > 0 ? ` · ~$${cost.toFixed(2)}` : '';
}

function formatTokens(n: number): string {
  if (n <= 0) return '';
  if (n >= 1000) return ` · ${(n / 1000).toFixed(1)}k tok`;
  return ` · ${n} tok`;
}

export const TurnSummaryCard: React.FC<{ data: TurnSummaryData }> = ({ data }) => {
  const icon = data.hasError ? '✗' : '⏺';
  const iconColor = data.hasError ? PALETTE.rust : PALETTE.teal;

  const groupText = data.groups.map(g => `${g.verb.toLowerCase()} ${g.count}`).join(' · ');
  const durText = data.durationSec > 0 ? formatElapsed(data.durationSec) : '';
  const timeText = formatTime(data.timestamp);
  const tokText = formatTokens(data.tokens);
  const costText = formatCost(data.cost);

  const rightPart = [durText, tokText.slice(3), costText.slice(3)].filter(Boolean).join(' · ');

  return (
    <Box marginBottom={1} gap={1}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={PALETTE.statusBar}>{groupText}</Text>
      {rightPart ? <><Text color={PALETTE.faint}> · </Text><Text color={PALETTE.statusBar}>{rightPart}</Text></> : null}
      <Box flexGrow={1} />
      <Text color={PALETTE.faint}>{timeText}</Text>
    </Box>
  );
};
```

- [ ] **Update `Chat.tsx` — wire turn-level tokens/cost into `promoteTurnSummary`.** Find `promoteTurnSummary` (around line 285) and update:

```ts
const turnTokensRef = useRef(0);
const turnCostRef = useRef(0);

// In the llm:usage event handler (add to the useEffect block):
EventBus.on('llm:usage', ({ sessionId, inputTokens, outputTokens, cacheReadTokens, cost }) => {
  if (sessionId !== id) return;
  setTotalTokens(prev => prev + inputTokens + outputTokens + cacheReadTokens);
  setTotalCost(prev => prev + cost);
  turnTokensRef.current += inputTokens + outputTokens + cacheReadTokens;
  turnCostRef.current += cost;
}),

// promoteTurnSummary:
const promoteTurnSummary = () => {
  const completed = activities.filter(a => a.status !== 'running');
  if (completed.length === 0) return;
  const data = buildTurnSummary(completed, { tokens: turnTokensRef.current, cost: turnCostRef.current });
  setStaticItems(prev => [...prev, { kind: 'turn-summary', id: makeId(), data }]);
  turnTokensRef.current = 0;
  turnCostRef.current = 0;
};
```

Also add reset in `resetTransientState`:
```ts
turnTokensRef.current = 0;
turnCostRef.current = 0;
```

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/TurnSummaryCard.tsx apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat(ui): TurnSummaryCard CC compact footer with token count and cost"
```

---

## Task 14: Redesign WelcomeScreen — text logo

**Files:**
- Modify: `apps/cli/src/screens/WelcomeScreen.tsx`

- [ ] **Replace `WelcomeScreen.tsx`:**

```tsx
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';
import { PALETTE } from '@utils';

const VERSION = '0.1.0';
const LOGO_TEXT = 'R O B O C O D E';

export const WelcomeScreen: React.FC = () => {
  const { navigate } = useRouter();
  const { list, active } = useProfile();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  useInput((input, key) => {
    if (activeProfile) return;
    if (input === 'y' || input === 'Y') navigate('profile');
    if (input === 'n' || input === 'N' || key.escape) navigate('assistant');
  });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Box flexDirection="column">
        <Text color={PALETTE.teal} bold>{LOGO_TEXT}</Text>
        <Text color={PALETTE.muted}>AI CODE ASSISTANT · v{VERSION}</Text>
      </Box>

      {!activeProfile && (
        <Box flexDirection="column" gap={1} marginTop={1}>
          <Text color={PALETTE.muted}>No profile configured.</Text>
          <Box gap={3}>
            <Text color={PALETTE.sage}>[ Y ] Set up profile</Text>
            <Text color={PALETTE.muted}>[ N ] Skip</Text>
          </Box>
          <Text color={PALETTE.faint} dimColor>y / n</Text>
        </Box>
      )}
    </Box>
  );
};
```

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/WelcomeScreen.tsx
git commit -m "feat(ui): WelcomeScreen text logo, remove ASCII art"
```

---

## Task 15: Redesign SlashPalette — two-panel with descriptions

**Files:**
- Modify: `apps/cli/src/elements/SlashPalette.tsx`

- [ ] **Replace `SlashPalette.tsx` entirely:**

```tsx
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '@utils';

export interface SlashCommand {
  command: string;
  description: string;
  detail: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/help',
    description: 'Show available commands',
    detail: 'Prints a list of all available slash commands to the chat.',
  },
  {
    command: '/clear',
    description: 'Start a new session',
    detail: 'Deletes the current session and starts a fresh one. Prompts for confirmation if the session has more than 5 turns.',
  },
  {
    command: '/compact',
    description: 'Summarize conversation with AI',
    detail: 'Compresses the conversation history by asking the AI to summarize it. Reduces context usage when approaching limits.',
  },
  {
    command: '/approve',
    description: 'Toggle auto-approve mode',
    detail: 'When enabled, destructive tool calls (file edits, bash) are automatically approved without prompting. Shown as ⚡ auto in the status bar.',
  },
  {
    command: '/audit',
    description: 'Show last N audit entries',
    detail: 'Prints the last N audit log entries for the current session. Usage: /audit 20. Defaults to 10 entries.',
  },
  {
    command: '/transcript',
    description: 'Show transcript file path',
    detail: 'Prints the path to the current session transcript file.',
  },
  {
    command: '/inspect',
    description: 'Open session inspector',
    detail: 'Opens the session history browser where you can view past sessions and their messages.',
  },
  {
    command: '/replay',
    description: 'Reload persisted messages',
    detail: 'Reloads the stored message history for the current session. Useful if the in-memory state drifts from disk.',
  },
];

const LEFT_WIDTH = 18;

interface Props {
  input: string;
  selectedIndex: number;
}

export const SlashPalette: React.FC<Props> = ({ input, selectedIndex }) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const rightWidth = Math.max(20, termWidth - LEFT_WIDTH - 6);

  const filtered = SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(input));
  if (filtered.length === 0) return null;

  const selected = filtered[selectedIndex] ?? filtered[0];

  const wrapText = (text: string, width: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > width) {
        if (line) lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const detailLines = wrapText(selected?.detail ?? '', rightWidth);

  return (
    <Box flexDirection="row" marginBottom={0}>
      {/* Left panel */}
      <Box flexDirection="column" width={LEFT_WIDTH} borderStyle="single" borderColor={PALETTE.faint}>
        {filtered.map((cmd, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={cmd.command} paddingX={1} backgroundColor={isSelected ? '#1a2a1a' : undefined}>
              <Text color={isSelected ? PALETTE.teal : PALETTE.muted} bold={isSelected}>
                {cmd.command}
              </Text>
            </Box>
          );
        })}
      </Box>
      {/* Right panel */}
      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor={PALETTE.faint} paddingX={1}>
        {selected && (
          <>
            <Text color={PALETTE.teal}>{selected.command}</Text>
            <Box flexDirection="column" marginTop={1}>
              {detailLines.map((line, i) => (
                <Text key={i} color={PALETTE.muted}>{line}</Text>
              ))}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};
```

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -i "SlashPalette\|SLASH" | head -10
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add apps/cli/src/elements/SlashPalette.tsx
git commit -m "feat(ui): SlashPalette two-panel layout with command descriptions"
```

---

## Task 16: Add ThinkingBlock component + wire extended thinking

**Files:**
- Create: `apps/cli/src/screens/chat/components/ThinkingBlock.tsx`
- Modify: `apps/cli/src/screens/chat/components/index.ts`
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

- [ ] **Create `apps/cli/src/screens/chat/components/ThinkingBlock.tsx`:**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

interface Props {
  text: string;
  collapsed: boolean;
}

export const ThinkingBlock: React.FC<Props> = ({ text, collapsed }) => {
  if (collapsed) {
    return (
      <Box marginBottom={1}>
        <Text color={PALETTE.faint} dimColor>╎ thinking  </Text>
        <Text color={PALETTE.faint} dimColor>[t to expand]</Text>
      </Box>
    );
  }

  const lines = text.split('\n');
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={PALETTE.faint} dimColor>╎ thinking</Text>
        <Text color={PALETTE.faint} dimColor>[t to collapse]</Text>
      </Box>
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={PALETTE.faint} dimColor>╎ </Text>
          <Text color={PALETTE.faint} dimColor>{line}</Text>
        </Box>
      ))}
    </Box>
  );
};
```

- [ ] **Export from `apps/cli/src/screens/chat/components/index.ts` — add line:**

```ts
export { ThinkingBlock } from './ThinkingBlock';
```

- [ ] **Update `Chat.tsx` to wire extended thinking:**

Add state near other useState declarations:
```ts
const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set());
const currentThinkingRef = useRef('');
```

In the `useEffect` EventBus subscription block, update the `llm:thinking` handler:
```ts
EventBus.on('llm:thinking', ({ sessionId, text }) => {
  if (sessionId !== id) return;
  // Accumulate thinking text for ThinkingBlock
  currentThinkingRef.current += text;
  // Still set phrase for WorkingLine
  setThinkingPhrase(text ? 'Thinking…' : null);
}),
```

In the `llm:end` handler, after promoting streaming text, also promote thinking:
```ts
EventBus.on('llm:end', ({ sessionId }) => {
  if (sessionId !== id) return;
  if (streamingRef.current) {
    const content = streamingRef.current;
    setStaticItems(prev => [...prev, { kind: 'ai', id: makeId(), content }]);
    streamingRef.current = '';
    setStreamingText('');
  }
  // Promote thinking block if we accumulated any
  if (currentThinkingRef.current) {
    const thinkingText = currentThinkingRef.current;
    const thinkingId = makeId();
    currentThinkingRef.current = '';
    setStaticItems(prev => [...prev, { kind: 'thinking', id: thinkingId, text: thinkingText }]);
    // Auto-collapse after turn ends
    setCollapsedThinking(prev => new Set([...prev, thinkingId]));
  }
  setIsLoading(false);
  setThinkingPhrase(null);
}),
```

Add `t` key handler in `useInput` to toggle collapsed thinking (add before `pendingApproval` check):
```ts
if (input === 't' && !isAgentBusy && !pendingApproval) {
  // Toggle most recent thinking block
  const lastThinking = [...staticItems].reverse().find(i => i.kind === 'thinking');
  if (lastThinking) {
    setCollapsedThinking(prev => {
      const next = new Set(prev);
      next.has(lastThinking.id) ? next.delete(lastThinking.id) : next.add(lastThinking.id);
      return next;
    });
  }
  return;
}
```

Update `renderStaticItem` to handle `'thinking'` kind:
```ts
case 'thinking':
  return (
    <ThinkingBlock
      key={item.id}
      text={item.text}
      collapsed={collapsedThinking.has(item.id)}
    />
  );
```

Import `ThinkingBlock` and add to the destructured imports from `'./components'`.

Also reset `currentThinkingRef.current = ''` in `resetTransientState`.

- [ ] **Type-check:**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | head -30
```

Expected: no errors.

- [ ] **Commit:**

```bash
git add apps/cli/src/screens/chat/components/ThinkingBlock.tsx apps/cli/src/screens/chat/components/index.ts apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat(ui): ThinkingBlock component for extended thinking display, t-key toggle"
```

---

## Task 17: Final wiring — run full typecheck + smoke test

- [ ] **Full type-check across all packages:**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json && \
npx tsc --noEmit --project packages/config/tsconfig.json && \
npx tsc --noEmit --project packages/agent/tsconfig.json && \
npx tsc --noEmit --project apps/cli/tsconfig.json
```

Expected: no errors.

- [ ] **Run all tests:**

```bash
pnpm test 2>&1 | tail -30
```

Expected: all existing tests pass + new cost.test.ts and turnSummary.test.ts pass.

- [ ] **Build all packages:**

```bash
pnpm build 2>&1 | tail -20
```

Expected: clean build.

- [ ] **Manual smoke test — launch the CLI and verify:**

```bash
pnpm dev
```

Verify:
1. WelcomeScreen shows `R O B O C O D E` text logo (no ASCII art)
2. Chat screen: separator line above input (no box border), placeholder "Message robocode…"
3. Status bar shows model · branch · 0 msgs (no fill bar when 0 tokens)
4. Type a message: WorkingLine shows "Thinking…" then "Reviewing results…" etc.
5. Tool activities show as `⏺ read_file(src/path) 0.3s…` with spinner
6. Completed tools show `✓ read_file(src/path) 0.3s`
7. After turn: TurnSummaryCard shows one-line compact summary
8. Status bar updates with token count and cost
9. Type `/` → two-panel slash palette appears
10. Approval prompt (if triggered) shows high-contrast bordered modal with Y/N/A

- [ ] **Commit if any last fixes applied:**

```bash
git add -p
git commit -m "fix(ui): post-smoke-test adjustments"
```

---

## Summary

| Task | Component | Key change |
|------|-----------|------------|
| 1 | `colors.ts` | VSCode Dark+ PALETTE |
| 2 | `config/constants.ts` | MODEL_CONTEXT + ALLOWED_TOOLS_PATH |
| 3 | `event.ts`, `chat.ts` | llm:usage event, thinking StaticItem, tokens/cost fields |
| 4 | `cost.ts` | computeCost util + tests |
| 5 | `agent_node.ts` | emit llm:usage + thinking blocks |
| 6 | `turnSummary.ts` | carry tokens/cost + tests |
| 7 | `StatusBar.tsx` | two-row + context fill bar |
| 8 | `WorkingLine.tsx` | contextual phrase cycling |
| 9 | `MessageCard.tsx` | CC-clean margins, remove paddingLeft |
| 10 | `LiveZone.tsx` | Tool(arg) format + timing + status icons |
| 11 | `ApprovalCard.tsx` | Prominent modal + Always-allow |
| 12 | `ChatInput.tsx` | Separator line, remove box border |
| 13 | `TurnSummaryCard.tsx` | Compact footer with tokens + cost |
| 14 | `WelcomeScreen.tsx` | Text logo |
| 15 | `SlashPalette.tsx` | Two-panel with descriptions |
| 16 | `ThinkingBlock.tsx` | Extended thinking display |
| 17 | — | Full typecheck + smoke test |
