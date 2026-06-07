# Frontend Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the RoboCode terminal UI to a 5-zone layered layout with a muted hex color palette, collapsible tool cards, unified approval UX, persistent status bar, and turn-summary promotion pattern.

**Architecture:** The screen is divided into Static (history), Live (current turn), Approval (conditional), StatusBar (always), and Input zones. When a turn ends and the user submits the next message, completed tool activities are promoted into a single `TurnSummaryCard` in the Static zone and the live zone clears. All components import hex colors from a central `colors.ts`.

**Tech Stack:** React, Ink 5, `ink-text-input` v6, TypeScript. No new dependencies required.

**Design spec:** `docs/superpowers/specs/2026-05-31-frontend-rework-design.md`

---

## File Map

### Create
- `apps/cli/src/utils/colors.ts` — hex color palette constants (`PALETTE`)
- `apps/cli/src/utils/turnSummary.ts` — `buildTurnSummary(activities)` utility
- `apps/cli/src/screens/chat/components/ToolCard.tsx` — single tool activity line
- `apps/cli/src/screens/chat/components/ToolGroup.tsx` — groups current-turn ToolCards
- `apps/cli/src/screens/chat/components/LiveZone.tsx` — current-turn wrapper (streaming text + ToolGroup)
- `apps/cli/src/screens/chat/components/TurnSummaryCard.tsx` — collapsed turn summary for Static zone
- `apps/cli/src/screens/chat/components/SystemNoticeCard.tsx` — system/error notices in Static zone
- `apps/cli/src/screens/chat/components/ApprovalCard.tsx` — unified approval (replaces PendingTool + PendingPlan)
- `apps/cli/src/screens/chat/components/StatusBar.tsx` — persistent single-line footer
- `__tests__/cli/turnSummary.test.ts` — unit tests for buildTurnSummary

### Modify
- `apps/cli/src/utils/constants.ts` — update diff COLORS to use new palette
- `apps/cli/src/types/chat.ts` — add `StaticItem`, `TurnSummaryData`; move `ToolActivity`, `ToolStreamChunk` here
- `apps/cli/src/screens/chat/components/MessageCard.tsx` — new palette, left-border code blocks
- `apps/cli/src/screens/chat/components/DiffView.tsx` — new palette, collapse threshold (≥15 lines)
- `apps/cli/src/screens/chat/components/GitDiffPreview.tsx` — simplify to stat-only line
- `apps/cli/src/screens/chat/components/ActivityFeed.tsx` — remove type re-exports (types move to `types/chat.ts`)
- `apps/cli/src/elements/ChatInput.tsx` — placeholder text, dim border/prompt when loading
- `apps/cli/src/screens/WelcomeScreen.tsx` — apply new palette
- `apps/cli/src/screens/chat/components/index.ts` — add new exports, remove deleted
- `apps/cli/src/screens/chat/Chat.tsx` — full zone orchestration, StaticItem model, turn promotion, Ctrl+C
- `apps/cli/src/index.ts` — add `exitOnCtrlC: false` to render options

### Delete
- `apps/cli/src/screens/chat/components/AgentStatus.tsx`
- `apps/cli/src/screens/chat/components/PendingTool.tsx`
- `apps/cli/src/screens/chat/components/PendingPlan.tsx`

---

## Task 1: Color Palette

**Files:**
- Create: `apps/cli/src/utils/colors.ts`
- Modify: `apps/cli/src/utils/constants.ts`

- [ ] **Step 1: Create the palette file**

```typescript
// apps/cli/src/utils/colors.ts
export const PALETTE = {
  // Text hierarchy
  userText:    '#E2E2E2',
  aiText:      '#C8C8C8',
  muted:       '#666666',
  faint:       '#3A3A3A',

  // Semantic states
  teal:        '#4A9B8E',   // active / running
  sage:        '#5A8A5A',   // success / done
  amber:       '#C4884A',   // warning / approval
  rust:        '#904040',   // error
  slate:       '#5B8DB8',   // info / system notices
  path:        '#7EB8DA',   // file paths

  // Diff-specific
  diffAdd:     '#4A7A4A',
  diffDel:     '#7A3A3A',
  diffHunk:    '#5B8DB8',
  diffContext: '#505050',
  diffFaint:   '#3A3A3A',

  // Status bar
  statusBar:   '#505050',
} as const;
```

- [ ] **Step 2: Update diff COLORS in constants.ts to use the new palette**

```typescript
// apps/cli/src/utils/constants.ts
import { PALETTE } from './colors';

export const COLORS = {
  gutterSign:       PALETTE.muted,
  hunkHeader:       PALETTE.diffHunk,
  fileHeader:       PALETTE.path,
  dimmed:           PALETTE.muted,
  contextBg:        undefined,
  contextText:      PALETTE.diffContext,
  contextLineNr:    PALETTE.faint,
  addBg:            undefined,
  addText:          PALETTE.diffAdd,
  addLineNr:        PALETTE.diffAdd,
  addSign:          PALETTE.diffAdd,
  removeBg:         undefined,
  removeText:       PALETTE.diffDel,
  removeLineNr:     PALETTE.diffDel,
  removeSign:       PALETTE.diffDel,
  inlineAddBg:      undefined,
  inlineRemoveBg:   undefined,
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/utils/colors.ts apps/cli/src/utils/constants.ts
git commit -m "feat(ui): add hex color palette, update diff COLORS"
```

---

## Task 2: Type Definitions

**Files:**
- Modify: `apps/cli/src/types/chat.ts`

- [ ] **Step 1: Replace the contents of types/chat.ts**

```typescript
// apps/cli/src/types/chat.ts

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
  children?: ToolActivity[];
}

export interface TurnSummaryData {
  groups: Array<{ verb: string; count: number }>;
  durationSec: number;
  timestamp: number;
  hasError: boolean;
}

export type StaticItem =
  | { kind: 'human';        id: string; content: string }
  | { kind: 'ai';           id: string; content: string }
  | { kind: 'system';       id: string; content: string }
  | { kind: 'turn-summary'; id: string; data: TurnSummaryData };

export const ROLE_COLORS: Record<string, string> = {
  human: '#E2E2E2',
  ai:    '#C8C8C8',
  system: '#5B8DB8',
  tool:  '#C4884A',
};

export interface Message {
  role: 'human' | 'ai' | 'system' | 'tool';
  content: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/types/chat.ts
git commit -m "feat(ui): add StaticItem, TurnSummaryData, ToolActivity to types/chat"
```

---

## Task 3: Turn Summary Utility

**Files:**
- Create: `apps/cli/src/utils/turnSummary.ts`
- Create: `__tests__/cli/turnSummary.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/cli/turnSummary.test.ts
import { buildTurnSummary } from '../../apps/cli/src/utils/turnSummary';
import type { ToolActivity } from '../../apps/cli/src/types/chat';

const make = (name: string, status: ToolActivity['status'] = 'done', extra: Partial<ToolActivity> = {}): ToolActivity => ({
  id: `${name}-1`,
  name,
  input: {},
  status,
  startedAt: 1000,
  finishedAt: 3000,
  ...extra,
});

describe('buildTurnSummary', () => {
  it('groups tools by verb category', () => {
    const result = buildTurnSummary([make('read_file'), make('grep'), make('read_file')]);
    expect(result.groups).toContainEqual({ verb: 'Read', count: 2 });
    expect(result.groups).toContainEqual({ verb: 'Searched', count: 1 });
  });

  it('calculates duration across all activities', () => {
    const result = buildTurnSummary([
      make('read_file', 'done', { startedAt: 1000, finishedAt: 5000 }),
      make('grep',      'done', { startedAt: 2000, finishedAt: 8000 }),
    ]);
    expect(result.durationSec).toBe(7); // (8000 - 1000) / 1000
  });

  it('sets hasError when any activity errored', () => {
    expect(buildTurnSummary([make('read_file'), make('bash', 'error')]).hasError).toBe(true);
  });

  it('does not set hasError when all activities succeeded', () => {
    expect(buildTurnSummary([make('read_file'), make('grep')]).hasError).toBe(false);
  });

  it('returns empty groups for empty input', () => {
    expect(buildTurnSummary([]).groups).toHaveLength(0);
  });

  it('uses tool name as fallback verb for unknown tools', () => {
    const result = buildTurnSummary([make('custom_tool')]);
    expect(result.groups[0]?.verb).toBe('custom_tool');
  });

  it('includes children in grouping', () => {
    const parent = make('bash', 'done', {
      children: [make('read_file', 'done'), make('grep', 'done')],
    });
    const result = buildTurnSummary([parent]);
    expect(result.groups).toContainEqual({ verb: 'Read', count: 1 });
    expect(result.groups).toContainEqual({ verb: 'Searched', count: 1 });
  });

  it('sets hasError when a child errored', () => {
    const parent = make('bash', 'done', {
      children: [make('read_file', 'error')],
    });
    expect(buildTurnSummary([parent]).hasError).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/turnSummary.test.ts
```

Expected: FAIL — `Cannot find module '../../apps/cli/src/utils/turnSummary'`

- [ ] **Step 3: Create the utility**

```typescript
// apps/cli/src/utils/turnSummary.ts
import type { ToolActivity, TurnSummaryData } from '../types/chat';

const VERB_MAP: Record<string, string> = {
  read_file:         'Read',
  list_dir:          'Read',
  find_definition:   'Read',
  ast_analyzer:      'Read',
  ast_get_symbol:    'Read',
  grep:              'Searched',
  glob:              'Searched',
  search_files:      'Searched',
  write_file:        'Wrote',
  edit_file:         'Patched',
  patch_file:        'Patched',
  str_replace_editor:'Patched',
  bash:              'Ran',
  validate_project:  'Validated',
  undo:              'Undid',
};

function groupVerb(name: string): string {
  return VERB_MAP[name] ?? name;
}

function collectActivities(activities: ToolActivity[]): ToolActivity[] {
  const flat: ToolActivity[] = [];
  for (const a of activities) {
    flat.push(a);
    if (a.children) flat.push(...a.children);
  }
  return flat;
}

export function buildTurnSummary(activities: ToolActivity[]): TurnSummaryData {
  const flat = collectActivities(activities);
  const counts = new Map<string, number>();
  let minStart = Infinity;
  let maxEnd = 0;
  let hasError = false;

  for (const a of flat) {
    counts.set(groupVerb(a.name), (counts.get(groupVerb(a.name)) ?? 0) + 1);
    if (a.startedAt !== undefined && a.startedAt < minStart) minStart = a.startedAt;
    if (a.finishedAt !== undefined && a.finishedAt > maxEnd) maxEnd = a.finishedAt;
    if (a.status === 'error') hasError = true;
  }

  const groups = [...counts.entries()].map(([verb, count]) => ({ verb, count }));
  const durationSec = minStart < Infinity && maxEnd > 0
    ? Math.round((maxEnd - minStart) / 1000)
    : 0;

  return { groups, durationSec, timestamp: Date.now(), hasError };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/turnSummary.test.ts
```

Expected: PASS — 8 tests passing

- [ ] **Step 5: Export from utils/index.ts**

Add to `apps/cli/src/utils/index.ts`:
```typescript
export * from './colors';
export * from './turnSummary';
```

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/utils/turnSummary.ts apps/cli/src/utils/index.ts __tests__/cli/turnSummary.test.ts
git commit -m "feat(ui): add buildTurnSummary utility with tests"
```

---

## Task 4: StatusBar Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/StatusBar.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/StatusBar.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

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
  elapsed: number | null; // null when agent is idle
}

export const StatusBar: React.FC<Props> = ({ model, branch, autoApprove, msgCount, elapsed }) => {
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
      {elapsed !== null ? (
        <Text color={PALETTE.statusBar}>{formatElapsed(elapsed)}</Text>
      ) : (
        <Text color={PALETTE.statusBar}>{formatCtx(msgCount)}</Text>
      )}
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/StatusBar.tsx
git commit -m "feat(ui): add StatusBar component"
```

---

## Task 5: SystemNoticeCard Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/SystemNoticeCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/SystemNoticeCard.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

interface Props {
  content: string;
}

export const SystemNoticeCard: React.FC<Props> = ({ content }) => (
  <Box marginBottom={1} paddingLeft={2}>
    <Text color={PALETTE.slate} dimColor>◆ {content}</Text>
  </Box>
);
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/SystemNoticeCard.tsx
git commit -m "feat(ui): add SystemNoticeCard component"
```

---

## Task 6: TurnSummaryCard Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/TurnSummaryCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/TurnSummaryCard.tsx
import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '@utils';
import type { TurnSummaryData } from '@types';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `[${h}:${m}]`;
}

function formatDuration(sec: number): string {
  if (sec === 0) return '';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

interface Props {
  data: TurnSummaryData;
}

export const TurnSummaryCard: React.FC<Props> = ({ data }) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const icon = data.hasError ? '✗' : '✓';
  const iconColor = data.hasError ? PALETTE.rust : PALETTE.sage;

  const groupText = data.groups
    .map(g => `${g.verb} ${g.count}`)
    .join(' · ');
  const durText = formatDuration(data.durationSec);
  const timeText = formatTime(data.timestamp);

  // Build right-aligned timestamp: pad with spaces so timestamp sits at termWidth
  const leftPart = `  ${icon}  ${groupText}${durText ? ` · ${durText}` : ''}`;
  const gap = Math.max(1, termWidth - leftPart.length - timeText.length - 2);
  const spaces = ' '.repeat(gap);

  return (
    <Box marginBottom={1} paddingLeft={2}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={PALETTE.muted}>  {groupText}</Text>
      {durText ? <Text color={PALETTE.muted}> · {durText}</Text> : null}
      <Text color={PALETTE.faint}>{spaces}{timeText}</Text>
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/TurnSummaryCard.tsx
git commit -m "feat(ui): add TurnSummaryCard component"
```

---

## Task 7: ToolCard Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/ToolCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/ToolCard.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, getToolVerb, getToolLabel, getResultPreview, truncate } from '@utils';
import type { ToolActivity } from '@types';

function formatDuration(startedAt?: number, finishedAt?: number): string | null {
  if (!startedAt) return null;
  const end = finishedAt ?? Date.now();
  const sec = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (sec < 2) return null;
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

const STATUS_ICON: Record<ToolActivity['status'], string> = {
  running: '⏺',
  done:    '✓',
  error:   '✗',
};

const STATUS_COLOR: Record<ToolActivity['status'], string> = {
  running: PALETTE.teal,
  done:    PALETTE.sage,
  error:   PALETTE.rust,
};

interface Props {
  activity: ToolActivity;
  indent?: number;
}

export const ToolCard: React.FC<Props> = ({ activity, indent = 0 }) => {
  const { name, input, status, output, error, stream, startedAt, finishedAt, children } = activity;
  const icon = STATUS_ICON[status];
  const color = STATUS_COLOR[status];
  const verb = getToolVerb(name).padEnd(10);
  const label = truncate(getToolLabel(name, input), 60);
  const preview = getResultPreview(name, output, error);
  const duration = formatDuration(startedAt, finishedAt);
  const isRunning = status === 'running';
  const padding = ' '.repeat(indent * 2);

  // Bash streaming lines (up to 3 most recent)
  const streamLines = stream
    ? stream
        .filter(c => c.text.trim().length > 0)
        .slice(-3)
        .map(c => c.text.trimEnd())
    : [];

  return (
    <Box flexDirection="column">
      <Box gap={1} paddingLeft={0}>
        <Text color={PALETTE.muted}>{padding}</Text>
        <Text color={color}>{icon}</Text>
        <Text color={isRunning ? PALETTE.teal : PALETTE.muted} bold={isRunning}>{verb}</Text>
        {label ? <Text color={PALETTE.path}>{label}</Text> : null}
        {!isRunning && preview ? (
          <Text color={status === 'error' ? PALETTE.rust : PALETTE.muted} dimColor>
            {truncate(preview, 40)}
          </Text>
        ) : null}
        {!isRunning && duration ? (
          <Text color={PALETTE.faint} dimColor> {duration}</Text>
        ) : null}
      </Box>

      {isRunning && streamLines.length > 0 && streamLines.map((line, i) => (
        <Box key={i} paddingLeft={2 + indent * 2 + 2}>
          <Text color={PALETTE.muted} dimColor>{truncate(line, 72)}</Text>
        </Box>
      ))}

      {children && children.map(child => (
        <ToolCard key={child.id} activity={child} indent={indent + 1} />
      ))}
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/ToolCard.tsx
git commit -m "feat(ui): add ToolCard component with streaming and nested support"
```

---

## Task 8: ToolGroup Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/ToolGroup.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/ToolGroup.tsx
import React from 'react';
import { Box } from 'ink';
import { ToolCard } from './ToolCard';
import type { ToolActivity } from '@types';

interface Props {
  activities: ToolActivity[];
}

export const ToolGroup: React.FC<Props> = ({ activities }) => {
  if (activities.length === 0) return null;
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {activities.map(activity => (
        <ToolCard key={activity.id} activity={activity} />
      ))}
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/ToolGroup.tsx
git commit -m "feat(ui): add ToolGroup component"
```

---

## Task 9: LiveZone Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/LiveZone.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/LiveZone.tsx
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';
import { ToolGroup } from './ToolGroup';
import type { ToolActivity } from '@types';

const THINKING_PHRASES: Record<string, string> = {
  'Thinking...':           'Thinking...',
  'Reviewing results...':  'Reviewing results...',
  'Drafting response...':  'Drafting response...',
  'Resuming context...':   'Resuming context...',
  'Compacting…':           'Resuming context...',
};

function normalizePhrase(raw: string | null): string | null {
  if (!raw) return null;
  return THINKING_PHRASES[raw] ?? 'Thinking...';
}

interface Props {
  streamingText: string;
  activities: ToolActivity[];
  thinkingPhrase: string | null;
  gitDiffStat: string | null;
  isStreaming: boolean;
}

export const LiveZone: React.FC<Props> = ({
  streamingText,
  activities,
  thinkingPhrase,
  gitDiffStat,
  isStreaming,
}) => {
  const [showCursor, setShowCursor] = useState(true);

  useEffect(() => {
    if (!isStreaming) { setShowCursor(false); return; }
    const t = setInterval(() => setShowCursor(p => !p), 500);
    return () => clearInterval(t);
  }, [isStreaming]);

  const phrase = normalizePhrase(thinkingPhrase);
  const hasContent = streamingText || activities.length > 0 || phrase || gitDiffStat;

  if (!hasContent) return null;

  return (
    <Box flexDirection="column">
      {streamingText && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text color={PALETTE.aiText}>
            {streamingText}{isStreaming && showCursor ? '▋' : ''}
          </Text>
        </Box>
      )}

      <ToolGroup activities={activities} />

      {!streamingText && !activities.length && phrase && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text color={PALETTE.muted} dimColor>· {phrase}</Text>
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

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/LiveZone.tsx
git commit -m "feat(ui): add LiveZone with streaming cursor and thinking indicator"
```

---

## Task 10: ApprovalCard Component

**Files:**
- Create: `apps/cli/src/screens/chat/components/ApprovalCard.tsx`

- [ ] **Step 1: Create the component**

```typescript
// apps/cli/src/screens/chat/components/ApprovalCard.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PALETTE } from '@utils';
import { DiffView } from './DiffView';

type ApprovalKind =
  | { kind: 'tool'; tool: { name: string; input: unknown } }
  | { kind: 'plan'; plan: string };

type RiskLevel = 'moderate' | 'destructive';

const DESTRUCTIVE_TOOLS = new Set(['write_file', 'edit_file', 'patch_file', 'str_replace_editor', 'undo']);
const DIFF_TOOLS = new Set(['write_file', 'edit_file', 'patch_file', 'str_replace_editor']);

function getRisk(approval: ApprovalKind): RiskLevel {
  if (approval.kind === 'plan') return 'moderate';
  return DESTRUCTIVE_TOOLS.has(approval.tool.name) ? 'destructive' : 'moderate';
}

function getTitle(approval: ApprovalKind): string {
  if (approval.kind === 'plan') return 'Proposed plan';
  const n = approval.tool.name;
  if (n === 'bash') return 'Run command';
  if (['write_file', 'edit_file', 'patch_file', 'str_replace_editor'].includes(n)) return 'Write file';
  return n;
}

interface Props {
  approval: ApprovalKind;
  isActive: boolean;
  onConfirm: (approved: boolean) => void;
}

export const ApprovalCard: React.FC<Props> = ({ approval, isActive, onConfirm }) => {
  const risk = getRisk(approval);
  const defaultSelected = risk === 'destructive' ? 'deny' : 'approve';
  const [selected, setSelected] = useState<'approve' | 'deny'>(defaultSelected);
  const [diffExpanded, setDiffExpanded] = useState(false);

  const riskColor = risk === 'destructive' ? PALETTE.rust : PALETTE.amber;
  const title = getTitle(approval);

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') { onConfirm(true); return; }
      if (input === 'n' || input === 'N' || key.escape) { onConfirm(false); return; }
      if (input === 'd' || input === 'D') { setDiffExpanded(p => !p); return; }
      if (key.leftArrow || key.rightArrow) {
        setSelected(p => p === 'approve' ? 'deny' : 'approve');
      }
      if (key.return || input === ' ') {
        onConfirm(selected === 'approve');
      }
    },
    { isActive }
  );

  // Extract display info from tool input
  const args = approval.kind === 'tool'
    ? ((approval.tool.input ?? {}) as Record<string, unknown>)
    : {};

  const targetPath = typeof args.path === 'string' ? args.path : typeof args.file === 'string' ? args.file : '';
  const command    = typeof args.command === 'string' ? args.command : '';
  const hasDiff    = approval.kind === 'tool' && DIFF_TOOLS.has(approval.tool.name);

  const oldStr = typeof args.oldStr === 'string' ? args.oldStr : '';
  const newStr = typeof args.newStr === 'string' ? args.newStr : '';
  const fileContent = typeof args.content === 'string' ? args.content : '';

  const diffProps = hasDiff
    ? (oldStr || newStr ? { oldStr, newStr } : { fullFileContent: fileContent })
    : null;

  const diffLineCount = diffProps
    ? ((diffProps as {oldStr?: string}).oldStr ?? '').split('\n').length +
      ((diffProps as {newStr?: string}).newStr ?? '').split('\n').length +
      (fileContent ? fileContent.split('\n').length : 0)
    : 0;
  const showCollapsedDiff = hasDiff && !diffExpanded && diffLineCount >= 15;

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      {/* Header */}
      <Box gap={1} marginBottom={1}>
        <Text color={riskColor} bold>◈  {title}</Text>
        <Text color={PALETTE.muted} dimColor>·  {risk}</Text>
      </Box>

      {/* Target */}
      {targetPath && (
        <Box marginBottom={1} paddingLeft={3}>
          <Text color={PALETTE.path}>{targetPath}</Text>
        </Box>
      )}

      {/* Bash command */}
      {command && (
        <Box marginBottom={1} paddingLeft={3}>
          <Text color={PALETTE.aiText}>{command}</Text>
        </Box>
      )}

      {/* Plan text */}
      {approval.kind === 'plan' && (
        <Box marginBottom={1} paddingLeft={3}>
          <Text color={PALETTE.aiText}>{approval.plan}</Text>
        </Box>
      )}

      {/* Diff section */}
      {hasDiff && diffProps && (
        <Box flexDirection="column" marginBottom={1}>
          {showCollapsedDiff ? (
            <Box paddingLeft={3}>
              <Text color={PALETTE.muted} dimColor>
                {diffLineCount} lines changed · d to expand
              </Text>
            </Box>
          ) : (
            <DiffView {...diffProps} maxLines={30} />
          )}
          {hasDiff && diffExpanded && (
            <Box paddingLeft={3}>
              <Text color={PALETTE.faint} dimColor>d to collapse</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Action row */}
      <Box gap={3} marginTop={1}>
        <Text color={selected === 'approve' ? PALETTE.sage : PALETTE.muted} dimColor={selected !== 'approve'}>
          {selected === 'approve' ? '▶ ' : '  '}approve
        </Text>
        <Text color={selected === 'deny' ? PALETTE.rust : PALETTE.muted} dimColor={selected !== 'deny'}>
          {selected === 'deny' ? '▶ ' : '  '}deny
        </Text>
        <Text color={PALETTE.faint} dimColor>y/n  ←/→  Enter</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/ApprovalCard.tsx
git commit -m "feat(ui): add ApprovalCard (unifies PendingTool + PendingPlan)"
```

---

## Task 11: Update MessageCard

**Files:**
- Modify: `apps/cli/src/screens/chat/components/MessageCard.tsx`

- [ ] **Step 1: Replace the file with the updated version**

The change: use `PALETTE` hex colors, change code block from full border-box to left-border `│` style.

```typescript
// apps/cli/src/screens/chat/components/MessageCard.tsx
import React from 'react';
import { Box, Text } from 'ink';
import type { BaseMessage } from '@langchain/core/messages';
import { messageType } from '@robocode-packages/shared';
import { PALETTE } from '@utils';

type Role = 'human' | 'ai' | 'system';

const FENCE_RE = /```([\w-]+)?\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;

const KEYWORDS: Record<string, string[]> = {
  typescript: ['const', 'let', 'function', 'return', 'type', 'interface', 'class', 'async', 'await', 'import', 'export', 'from', 'extends', 'implements', 'new', 'if', 'else', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'],
  javascript: ['const', 'let', 'function', 'return', 'class', 'async', 'await', 'import', 'export', 'from', 'new', 'if', 'else', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'],
  ts:         ['const', 'let', 'function', 'return', 'type', 'interface', 'class', 'async', 'await', 'import', 'export', 'from', 'extends', 'implements', 'new'],
  js:         ['const', 'let', 'function', 'return', 'class', 'async', 'await', 'import', 'export', 'from', 'new'],
  python:     ['def', 'return', 'class', 'import', 'from', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'raise', 'async', 'await', 'with', 'as', 'lambda'],
  json:       ['true', 'false', 'null'],
  bash:       ['cd', 'ls', 'cat', 'grep', 'find', 'git', 'pnpm', 'npm', 'yarn', 'mkdir', 'rm', 'cp', 'mv', 'echo', 'export'],
};

const highlightLine = (line: string, language = ''): React.ReactNode[] => {
  const keywords = KEYWORDS[language.toLowerCase()] ?? [];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const patterns = [
    { re: /\/\/.*$/,                                                    color: PALETTE.muted },
    { re: /#.*$/,                                                       color: PALETTE.muted },
    { re: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/,                          color: PALETTE.sage },
    { re: /\b\d+(\.\d+)?\b/,                                           color: PALETTE.amber },
    { re: new RegExp(`\\b(${keywords.length ? keywords.join('|') : '__never__'})\\b`), color: PALETTE.teal },
  ];

  while (cursor < line.length) {
    let matchIndex = -1, matchLength = 0, matchColor = PALETTE.aiText;
    for (const p of patterns) {
      p.re.lastIndex = 0;
      const m = line.slice(cursor).match(p.re);
      if (!m || m.index === undefined) continue;
      if (matchIndex === -1 || m.index < matchIndex) {
        matchIndex = m.index; matchLength = m[0].length; matchColor = p.color;
      }
    }
    if (matchIndex === -1) { nodes.push(<Text key={`${cursor}-e`} color={PALETTE.aiText}>{line.slice(cursor)}</Text>); break; }
    if (matchIndex > 0)    nodes.push(<Text key={`${cursor}-p`} color={PALETTE.aiText}>{line.slice(cursor, cursor + matchIndex)}</Text>);
    nodes.push(<Text key={`${cursor}-m`} color={matchColor}>{line.slice(cursor + matchIndex, cursor + matchIndex + matchLength)}</Text>);
    cursor += matchIndex + matchLength;
  }
  if (nodes.length === 0) nodes.push(<Text key="empty">{line}</Text>);
  return nodes;
};

const renderContent = (content: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0, blockIndex = 0;
  FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(content))) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      before.split(/\n\s*\n/).forEach((para, pi) => {
        const parts = para.split(INLINE_CODE_RE);
        nodes.push(
          <Box key={`p-${blockIndex}-${pi}`} marginBottom={1} flexDirection="column">
            <Text color={PALETTE.aiText}>
              {parts.map((part, i) =>
                i % 2 === 1 ? <Text key={i} color={PALETTE.teal}>{part}</Text> : part
              )}
            </Text>
          </Box>
        );
      });
    }

    const language = (match[1] ?? '').trim();
    const codeLines = match[2].replace(/\r\n/g, '\n').split('\n');

    nodes.push(
      <Box key={`code-${blockIndex}`} flexDirection="column" marginBottom={1} paddingLeft={1}>
        <Box gap={1}>
          <Text color={PALETTE.faint}>│</Text>
          <Text color={PALETTE.muted} dimColor>code</Text>
          {language ? <><Text color={PALETTE.faint}>·</Text><Text color={PALETTE.teal}>{language}</Text></> : null}
        </Box>
        {codeLines.map((line, i) => (
          <Box key={i} gap={1}>
            <Text color={PALETTE.faint}>│</Text>
            <Text color={PALETTE.faint} dimColor>{String(i + 1).padStart(3)}</Text>
            <Text>{highlightLine(line, language)}</Text>
          </Box>
        ))}
      </Box>
    );

    lastIndex = match.index + match[0].length;
    blockIndex++;
  }

  const tail = content.slice(lastIndex);
  if (tail.trim()) {
    tail.split(/\n\s*\n/).forEach((para, pi) => {
      const parts = para.split(INLINE_CODE_RE);
      nodes.push(
        <Box key={`tail-${pi}`} marginBottom={1} flexDirection="column">
          <Text color={PALETTE.aiText}>
            {parts.map((part, i) =>
              i % 2 === 1 ? <Text key={i} color={PALETTE.teal}>{part}</Text> : part
            )}
          </Text>
        </Box>
      );
    });
  }

  if (nodes.length === 0) nodes.push(<Box key="empty" marginBottom={1}><Text color={PALETTE.muted} dimColor>(empty)</Text></Box>);
  return nodes;
};

export const MessageCard: React.FC<{ msg: BaseMessage }> = ({ msg }) => {
  const role = messageType(msg) as Role;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);

  if (role === 'human') {
    return (
      <Box marginBottom={1} paddingLeft={2}>
        <Text color={PALETTE.muted}>❯ </Text>
        <Text color={PALETTE.userText}>{content}</Text>
      </Box>
    );
  }

  if (role === 'system') {
    return (
      <Box marginBottom={1} paddingLeft={2}>
        <Text color={PALETTE.slate} dimColor>◆ {content}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      {renderContent(content)}
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/MessageCard.tsx
git commit -m "feat(ui): update MessageCard with new palette and left-border code blocks"
```

---

## Task 12: Update DiffView

**Files:**
- Modify: `apps/cli/src/screens/chat/components/DiffView.tsx`

- [ ] **Step 1: Replace the file with the updated version**

Key changes: use palette hex values; remove the explicit `COLORS` import (now inherited from updated `constants.ts`); the COLORS import chain already uses the new palette after Task 1.

```typescript
// apps/cli/src/screens/chat/components/DiffView.tsx
import React, { useMemo, useState } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { DiffLine } from '@types';
import { computeInlineChanges, COLORS, buildDetailedRows, splitLines, PALETTE } from '@utils';
import { renderLineWithInline } from '@components';

const COLLAPSE_THRESHOLD = 15;

interface Props {
  oldStr?: string;
  newStr?: string;
  startLine?: number;
  maxLines?: number;
  replacedLines?: { oldLines: string[]; newLines: string[]; startLine: number };
  fullFileContent?: string;
  patches?: { oldStr: string; newStr: string }[];
}

export const DiffView: React.FC<Props> = ({
  oldStr = '',
  newStr = '',
  startLine,
  maxLines = 50,
  replacedLines,
  fullFileContent,
  patches,
}) => {
  const { stdout } = useStdout();
  const width = Math.max((stdout?.columns ?? 80) - 2, 40);
  const [expanded, setExpanded] = useState(false);

  useInput((input) => {
    if (input === 'd' || input === 'D') setExpanded(p => !p);
  });

  const { rows, summary } = useMemo(() => {
    if (patches && patches.length > 0) {
      const allRows: DiffLine[] = [];
      for (const patch of patches) {
        allRows.push(...buildDetailedRows(splitLines(patch.oldStr), splitLines(patch.newStr)));
      }
      return { rows: allRows, summary: `${patches.length} hunk${patches.length === 1 ? '' : 's'}` };
    }
    if (replacedLines) {
      return { rows: buildDetailedRows(replacedLines.oldLines, replacedLines.newLines, replacedLines.startLine), summary: undefined };
    }
    if (fullFileContent) {
      const newL = splitLines(fullFileContent);
      return {
        rows: newL.map((line, idx) => ({ type: 'add' as const, newLineNo: idx + 1, content: line, inlineChanges: computeInlineChanges('', line) })),
        summary: undefined,
      };
    }
    return { rows: buildDetailedRows(splitLines(oldStr), splitLines(newStr), startLine ?? 1), summary: undefined };
  }, [oldStr, newStr, replacedLines, fullFileContent, patches]);

  const changedCount = rows.filter(r => r.type !== 'context').length;
  const isLarge = changedCount >= COLLAPSE_THRESHOLD;
  const shouldCollapse = isLarge && !expanded;

  const addCount = rows.filter(r => r.type === 'add').length;
  const delCount = rows.filter(r => r.type === 'remove').length;

  if (shouldCollapse) {
    return (
      <Box paddingLeft={2}>
        <Text color={PALETTE.muted} dimColor>
          {addCount > 0 ? <Text color={PALETTE.diffAdd}>+{addCount} </Text> : null}
          {delCount > 0 ? <Text color={PALETTE.diffDel}>-{delCount} </Text> : null}
          <Text color={PALETTE.faint}>· d to expand</Text>
        </Text>
      </Box>
    );
  }

  const displayRows = rows.slice(0, maxLines);
  const hasMore = rows.length > maxLines;

  return (
    <Box flexDirection="column" marginBottom={0}>
      {summary && <Box gap={1}><Text color={COLORS.dimmed}> ({summary})</Text></Box>}
      <Box flexDirection="column">
        {displayRows.map((row) => renderLineWithInline(row, width))}
        {hasMore && (
          <Text color={COLORS.dimmed} dimColor>... {rows.length - maxLines} more lines</Text>
        )}
        {isLarge && expanded && (
          <Box paddingLeft={2}>
            <Text color={PALETTE.faint} dimColor>d to collapse</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/DiffView.tsx
git commit -m "feat(ui): update DiffView with collapse threshold and new palette"
```

---

## Task 13: Simplify GitDiffPreview

**Files:**
- Modify: `apps/cli/src/screens/chat/components/GitDiffPreview.tsx`

- [ ] **Step 1: Replace with simplified stat-only component**

The full diff display is now in `ApprovalCard`. This component shows only the stat line in the live zone.

```typescript
// apps/cli/src/screens/chat/components/GitDiffPreview.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

interface Props {
  stat: string | null;
}

export const GitDiffPreview: React.FC<Props> = ({ stat }) => {
  if (!stat) return null;
  return (
    <Box paddingLeft={2} marginBottom={1} gap={1}>
      <Text color={PALETTE.slate}>◉</Text>
      <Text color={PALETTE.muted}>git diff</Text>
      <Text color={PALETTE.muted} dimColor>{stat}</Text>
    </Box>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/screens/chat/components/GitDiffPreview.tsx
git commit -m "feat(ui): simplify GitDiffPreview to stat-only line"
```

---

## Task 14: Update ChatInput

**Files:**
- Modify: `apps/cli/src/elements/ChatInput.tsx`

- [ ] **Step 1: Replace the file with the updated version**

Changes: dim border and prompt when loading; add placeholder text when empty and idle.

```typescript
// apps/cli/src/elements/ChatInput.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { PALETTE } from '@utils';
import { SlashPalette, SLASH_COMMANDS } from './SlashPalette';

interface Props {
  onSubmit: (value: string) => void;
  isLoading?: boolean;
  isActive?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSubmit, isLoading, isActive }) => {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  const showPalette = value.startsWith('/') && !isLoading;
  const paletteCommands = showPalette
    ? SLASH_COMMANDS.filter(cmd => cmd.command.startsWith(value))
    : [];

  useInput(
    (_, key) => {
      if (showPalette && paletteCommands.length > 0) {
        if (key.upArrow)   { setPaletteIndex(p => Math.max(0, p - 1)); return; }
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
    if (!trimmed || isLoading) return;
    setHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setValue('');
    setDraft('');
    setPaletteIndex(0);
    onSubmit(trimmed);
  };

  const borderColor = isLoading ? PALETTE.faint : PALETTE.userText;
  const promptColor = isLoading ? PALETTE.faint : PALETTE.muted;
  const showPlaceholder = !isLoading && value === '';

  return (
    <Box flexDirection="column" paddingX={1}>
      {showPalette && paletteCommands.length > 0 && (
        <SlashPalette input={value} selectedIndex={paletteIndex} />
      )}
      <Box borderStyle="single" borderColor={borderColor} paddingX={1} gap={1}>
        <Text color={promptColor} dimColor={!!isLoading}>❯</Text>
        {showPlaceholder ? (
          <Text color={PALETTE.faint} dimColor>Ask anything, or / for commands</Text>
        ) : (
          <TextInput
            focus={!isLoading}
            value={value}
            onChange={nextValue => {
              setValue(nextValue);
              setDraft(nextValue);
              setPaletteIndex(0);
              if (historyIndex !== -1) setHistoryIndex(-1);
            }}
            onSubmit={handleSubmit}
          />
        )}
      </Box>
    </Box>
  );
};
```

> **Note:** `showPlaceholder` renders a static Text instead of TextInput when idle and empty. When the user starts typing, the TextInput appears. This avoids needing multiline input-text-input changes. Shift+Enter multiline support requires `ink-text-input` v6 `multiline` prop — test it after completing this task: `pnpm dev`, focus the input, press Shift+Enter. If it inserts a newline, no additional work needed. If not, this is a known limitation.

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/elements/ChatInput.tsx
git commit -m "feat(ui): update ChatInput with placeholder text and dim-on-loading state"
```

---

## Task 15: Update WelcomeScreen + index.ts Entry Point

**Files:**
- Modify: `apps/cli/src/screens/WelcomeScreen.tsx`
- Modify: `apps/cli/src/index.ts`

- [ ] **Step 1: Update WelcomeScreen to use new palette**

```typescript
// apps/cli/src/screens/WelcomeScreen.tsx
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';
import { PALETTE } from '@utils';

const ROBOT_LOGO = [
  '  ╦═╗╔═╗╔╗ ╔═╗╔═╗╔═╗╔╦╗╔═╗',
  '  ╠╦╝║ ║╠╩╗║ ║║  ║ ║ ║║║╣ ',
  '  ╩╚═╚═╝╚═╝╚═╝╚═╝╚═╝═╩╝╚═╝',
];

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
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box flexDirection="column" marginBottom={1}>
        {ROBOT_LOGO.map((line, i) => (
          <Text key={line + i} color={i === 1 ? PALETTE.slate : PALETTE.teal}>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginBottom={2}>
        <Text color={PALETTE.muted}> AI code assistant</Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Text color={PALETTE.userText}>  Welcome</Text>
        <Text color={PALETTE.muted}>  No active profile found. Would you like to set one up?</Text>
      </Box>

      <Box gap={3} paddingLeft={2} marginTop={1}>
        <Text color={PALETTE.sage} bold>Y  yes, set up profile</Text>
        <Text color={PALETTE.muted}>N  skip for now</Text>
      </Box>

      <Box marginTop={1} paddingLeft={2}>
        <Text color={PALETTE.faint} dimColor>press Y or N</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 2: Add exitOnCtrlC: false to index.ts**

```typescript
// apps/cli/src/index.ts
import { APP } from './app';
import { render } from 'ink';

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

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
```

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/WelcomeScreen.tsx apps/cli/src/index.ts
git commit -m "feat(ui): update WelcomeScreen palette; disable exitOnCtrlC for interrupt support"
```

---

## Task 16: Refactor Chat.tsx

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

This is the core wiring task. Replace the entire file.

- [ ] **Step 1: Replace Chat.tsx**

```typescript
// apps/cli/src/screens/chat/Chat.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { execSync } from 'child_process';
import { canResume } from '@robocode-packages/agent';
import { AuditService, EventBus, MessageService, TranscriptService } from '@robocode-packages/core';
import { messageType } from '@robocode-packages/shared';
import { TOOL_RISK } from '@robocode-packages/config';
import { ChatInput } from '@elements';
import { useRouter, useSession, useProfile } from '@hooks';
import { buildTurnSummary } from '@utils';
import type { StaticItem, ToolActivity, ToolStreamChunk } from '@types';
import {
  LiveZone,
  ApprovalCard,
  StatusBar,
  TurnSummaryCard,
  SystemNoticeCard,
  MessageCard,
} from './components';

const TOOL_STREAM_LIMIT = 48;

const stringifyContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  try { return JSON.stringify(content, null, 2); } catch { return String(content); }
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const makeToolId = (name: string) => `${name}:${makeId()}`;

const appendStreamChunk = (stream: ToolStreamChunk[] | undefined, chunk: ToolStreamChunk): ToolStreamChunk[] =>
  [...(stream ?? []), chunk].slice(-TOOL_STREAM_LIMIT);

function messagesToStaticItems(messages: BaseMessage[]): StaticItem[] {
  return messages
    .filter(msg => {
      const role = messageType(msg);
      if (role === 'tool') return false;
      if (role === 'ai') return stringifyContent(msg.content).trim().length > 0;
      return true;
    })
    .map(msg => {
      const role = messageType(msg);
      const content = stringifyContent(msg.content);
      const id = makeId();
      if (role === 'human') return { kind: 'human' as const, id, content };
      if (role === 'ai')    return { kind: 'ai' as const, id, content };
      return { kind: 'system' as const, id, content };
    });
}

function getGitBranch(): string | null {
  try {
    const b = execSync('git branch --show-current', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
    return b || null;
  } catch {
    return null;
  }
}

type PendingApproval =
  | { kind: 'tool'; tool: { name: string; input: unknown } }
  | { kind: 'plan'; plan: string };

export const ChatScreen: React.FC = () => {
  const sessionCtx = useSession();
  const { session, create } = sessionCtx;
  const deleteSession = sessionCtx.delete;
  const { navigate } = useRouter();
  const { active } = useProfile();
  const profile = active();

  const [staticItems, setStaticItems] = useState<StaticItem[]>(() =>
    session ? messagesToStaticItems(MessageService.load(session.id)) : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [thinkingPhrase, setThinkingPhrase] = useState<string | null>(null);
  const [gitDiffStat, setGitDiffStat] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [staticKey, setStaticKey] = useState(0);

  const streamingRef = useRef('');
  const agentStartTimeRef = useRef<number | null>(null);

  // Fetch git branch once per session
  useEffect(() => {
    setGitBranch(getGitBranch());
  }, [session?.id]);

  // Reset on session change
  useEffect(() => {
    if (!session) return;
    setStaticItems(messagesToStaticItems(MessageService.load(session.id)));
    setStreamingText('');
    streamingRef.current = '';
    setPendingApproval(null);
    setActivities([]);
    setIsLoading(false);
    setThinkingPhrase(null);
    setGitDiffStat(null);
    agentStartTimeRef.current = null;
    setElapsed(0);
  }, [session?.id]);

  // Auto-resume interrupted sessions
  useEffect(() => {
    if (!session?.id) return;
    canResume(session.id).then(resumable => {
      if (resumable) EventBus.emit('agent:resume', { sessionId: session.id, decision: 'approve' });
    });
  }, [session?.id]);

  // Event subscriptions
  useEffect(() => {
    if (!session?.id) return;
    const id = session.id;

    const unsubs = [
      EventBus.on('llm:start', ({ sessionId }) => {
        if (sessionId !== id) return;
        setIsLoading(true);
      }),
      EventBus.on('llm:thinking', ({ sessionId, text }) => {
        if (sessionId !== id) return;
        setThinkingPhrase(text ?? null);
      }),
      EventBus.on('llm:token', ({ sessionId, token }) => {
        if (sessionId !== id) return;
        streamingRef.current += token;
        setStreamingText(prev => prev + token);
      }),
      EventBus.on('llm:end', ({ sessionId }) => {
        if (sessionId !== id) return;
        if (streamingRef.current) {
          const content = streamingRef.current;
          setStaticItems(prev => [...prev, { kind: 'ai', id: makeId(), content }]);
          streamingRef.current = '';
          setStreamingText('');
        }
        setIsLoading(false);
        setThinkingPhrase(null);
      }),
      EventBus.on('llm:error', ({ sessionId }) => {
        if (sessionId !== id) return;
        streamingRef.current = '';
        setStreamingText('');
        setIsLoading(false);
        setThinkingPhrase(null);
      }),
      EventBus.on('agent:plan_pending', ({ sessionId, plan }) => {
        if (sessionId !== id) return;
        setPendingApproval({ kind: 'plan', plan });
      }),
      EventBus.on('agent:plan_decision', ({ sessionId }) => {
        if (sessionId !== id) return;
        setPendingApproval(null);
      }),
      EventBus.on('agent:tool_pending', ({ sessionId, toolCall }) => {
        if (sessionId !== id) return;
        setPendingApproval({ kind: 'tool', tool: toolCall });
        setIsLoading(false);
      }),
      EventBus.on('agent:tool_decision', ({ sessionId }) => {
        if (sessionId !== id) return;
        setPendingApproval(null);
      }),
      EventBus.on('agent:compact_complete', ({ sessionId: sid, originalCount }) => {
        if (sid !== id) return;
        const updated = MessageService.load(sid);
        const noticeContent = `Compacted · ${originalCount} messages → 1 summary`;
        const notice = new SystemMessage(noticeContent);
        MessageService.add(sid, notice);
        setStaticKey(k => k + 1);
        setStaticItems([
          ...messagesToStaticItems(updated),
          { kind: 'system', id: makeId(), content: noticeContent },
        ]);
      }),
      EventBus.on('tool:start', ({ sessionId, name, input, callId }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? makeToolId(name);
        setActivities(prev => {
          const idx = prev.findIndex(a => a.id === activityId);
          const next: ToolActivity = { id: activityId, name, input, status: 'running', stream: [], startedAt: Date.now() };
          if (idx === -1) return [...prev, next];
          const arr = [...prev];
          arr[idx] = { ...arr[idx], ...next, startedAt: arr[idx].startedAt ?? Date.now() };
          return arr;
        });
      }),
      EventBus.on('tool:stream', ({ sessionId, callId, chunk, stream, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities(prev => prev.map(a =>
          a.id !== activityId ? a
            : { ...a, status: 'running', stream: appendStreamChunk(a.stream, { kind: stream, text: chunk }) }
        ));
      }),
      EventBus.on('tool:end', ({ sessionId, callId, output, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities(prev => prev.map(a =>
          a.id !== activityId ? a
            : { ...a, status: 'done', output: stringifyContent(output), finishedAt: Date.now() }
        ));
        setThinkingPhrase('Reviewing results...');
      }),
      EventBus.on('tool:error', ({ sessionId, callId, error, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities(prev => prev.map(a =>
          a.id !== activityId ? a
            : { ...a, status: 'error', error, finishedAt: Date.now() }
        ));
      }),
      EventBus.on('agent:git_diff', ({ sessionId, gitDiffStat: stat }) => {
        if (sessionId !== id) return;
        setGitDiffStat(stat);
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, [session?.id]);

  // Elapsed timer
  useEffect(() => {
    const isBusy = isLoading || !!pendingApproval;
    if (!isBusy) { agentStartTimeRef.current = null; setElapsed(0); return; }
    if (!agentStartTimeRef.current) agentStartTimeRef.current = Date.now();
    const start = agentStartTimeRef.current;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isLoading, pendingApproval]);

  // Keyboard: Escape = navigate, Ctrl+C = interrupt
  useInput((input, key) => {
    if (pendingApproval) return;
    if (key.ctrl && input === 'c') {
      if (session?.id) EventBus.emit('agent:stop', { sessionId: session.id });
      appendNotice('Interrupted.');
      return;
    }
    if (key.escape) {
      if (session?.id) EventBus.emit('agent:stop', { sessionId: session.id });
      navigate('welcome');
    }
  });

  const appendNotice = (text: string) => {
    if (!session) return;
    const msg = new SystemMessage(text);
    MessageService.add(session.id, msg);
    setStaticItems(prev => [...prev, { kind: 'system', id: makeId(), content: text }]);
  };

  const resetTransientState = () => {
    setStreamingText('');
    streamingRef.current = '';
    setPendingApproval(null);
    setActivities([]);
    setThinkingPhrase(null);
    setGitDiffStat(null);
    setIsLoading(false);
    agentStartTimeRef.current = null;
    setElapsed(0);
  };

  const promoteTurnSummary = () => {
    const completed = activities.filter(a => a.status !== 'running');
    if (completed.length === 0) return;
    const data = buildTurnSummary(completed);
    setStaticItems(prev => [...prev, { kind: 'turn-summary', id: makeId(), data }]);
  };

  const executeCommand = (raw: string) => {
    if (!session) return;
    const [command, ...args] = raw.slice(1).trim().split(/\s+/);
    const argText = args.join(' ').trim();
    if (!command) return;

    if (command === 'help') {
      appendNotice('Commands: /clear /compact /approve /audit [N] /transcript /inspect /replay');
      return;
    }
    if (command === 'clear') {
      const turnCount = staticItems.filter(i => i.kind === 'human').length;
      if (turnCount > 5) {
        appendNotice(`Session has ${turnCount} turns. Clear? Send /clear again to confirm.`);
        return;
      }
      deleteSession(session.id);
      create();
      resetTransientState();
      setStaticItems([]);
      setStaticKey(k => k + 1);
      return;
    }
    if (command === 'compact') {
      setIsLoading(true);
      setThinkingPhrase('Resuming context...');
      EventBus.emit('agent:compact_request', { sessionId: session.id });
      return;
    }
    if (command === 'transcript') {
      appendNotice(`Transcript: ${TranscriptService.path(session.id)}`);
      return;
    }
    if (command === 'inspect') { navigate('history'); return; }
    if (command === 'replay') {
      EventBus.emit('agent:stop', { sessionId: session.id });
      const restored = messagesToStaticItems(MessageService.load(session.id));
      setStaticItems(restored);
      resetTransientState();
      appendNotice(`Replayed ${restored.length} messages.`);
      return;
    }
    if (command === 'audit') {
      const count = Number.parseInt(argText || '10', 10);
      const entries = AuditService.tail(session.id, Number.isFinite(count) && count > 0 ? count : 10);
      if (entries.length === 0) { appendNotice('No audit entries recorded yet.'); return; }
      const lines = entries.map(e => {
        const payload = JSON.stringify(e.payload);
        return `${e.timestamp} ${e.event} ${payload.length > 120 ? `${payload.slice(0, 117)}...` : payload}`;
      });
      appendNotice(`Audit (${entries.length}):\n${lines.join('\n')}`);
      return;
    }
    if (command === 'approve') {
      const arg = argText.toLowerCase();
      setAutoApprove(prev => !prev);
      appendNotice(!autoApprove ? '⚡ Auto-approve enabled.' : 'Auto-approve disabled.');
      return;
    }
    appendNotice(`Unknown command "${command}". Try /help.`);
  };

  const handleSubmit = (value: string) => {
    if (!session) return;
    if (value.startsWith('/')) { executeCommand(value); return; }

    // Promote previous turn's completed activities
    promoteTurnSummary();

    setStaticItems(prev => [...prev, { kind: 'human', id: makeId(), content: value }]);
    setIsLoading(true);
    setThinkingPhrase('Thinking...');
    streamingRef.current = '';
    setStreamingText('');
    setActivities([]);
    setPendingApproval(null);
    setGitDiffStat(null);
    EventBus.emit('agent:run', value);
  };

  const confirmApproval = (approved: boolean) => {
    if (!session) return;
    EventBus.emit('agent:resume', { sessionId: session.id, decision: approved ? 'approve' : 'reject' });
    setPendingApproval(null);
    if (approved) setIsLoading(true);
  };

  const isAgentBusy = isLoading || !!pendingApproval;
  const humanCount = staticItems.filter(i => i.kind === 'human').length;
  const modelName = profile?.model ?? 'robocode';

  const renderStaticItem = (item: StaticItem) => {
    switch (item.kind) {
      case 'human':
        return <MessageCard key={item.id} msg={new HumanMessage(item.content)} />;
      case 'ai':
        return <MessageCard key={item.id} msg={new AIMessage(item.content)} />;
      case 'system':
        return <SystemNoticeCard key={item.id} content={item.content} />;
      case 'turn-summary':
        return <TurnSummaryCard key={item.id} data={item.data} />;
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
        {/* Static history zone */}
        {staticItems.map(item => renderStaticItem(item))}

        {/* Live zone — current turn */}
        {!pendingApproval && (
          <LiveZone
            streamingText={streamingText}
            activities={activities}
            thinkingPhrase={thinkingPhrase}
            gitDiffStat={gitDiffStat}
            isStreaming={!!streamingText}
          />
        )}

        {/* Approval zone */}
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
        elapsed={isAgentBusy ? elapsed : null}
      />

      <ChatInput
        isActive={!isAgentBusy}
        onSubmit={handleSubmit}
        isLoading={isAgentBusy}
      />
    </Box>
  );
};
```

> **Note on Static zone:** The current code uses Ink's `<Static>` component, which renders items once and never re-renders them. The new code above uses a plain `.map()` instead — this is intentional. `<Static>` causes issues with the discriminated union pattern because it requires all items to be the same shape. Using `.map()` gives us the flexibility of rendering different card types. The trade-off is that Ink will re-render all static items on any state change. If this causes visible flickering in practice, wrap the top section in `React.memo` or revisit the `<Static>` approach with a wrapper component. Test with `pnpm dev` after this task.

- [ ] **Step 2: Verify the app starts**

```bash
pnpm dev
```

Expected: App starts, welcome screen appears, no TypeScript errors in the terminal output.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat(ui): refactor Chat.tsx to 5-zone layout with StaticItem model"
```

---

## Task 17: Cleanup — Exports, Deletions

**Files:**
- Modify: `apps/cli/src/screens/chat/components/ActivityFeed.tsx`
- Modify: `apps/cli/src/screens/chat/components/index.ts`
- Delete: `apps/cli/src/screens/chat/components/AgentStatus.tsx`
- Delete: `apps/cli/src/screens/chat/components/PendingTool.tsx`
- Delete: `apps/cli/src/screens/chat/components/PendingPlan.tsx`

- [ ] **Step 1: Remove type re-exports from ActivityFeed.tsx**

`ToolActivity` and `ToolStreamChunk` are now in `types/chat.ts`. Remove those type exports from `ActivityFeed.tsx` (other code that imported them from there now imports from `@types`):

```typescript
// apps/cli/src/screens/chat/components/ActivityFeed.tsx
// This file now only exists to avoid breaking any lingering imports.
// ToolActivity and ToolStreamChunk have moved to apps/cli/src/types/chat.ts
// This file can be deleted once all imports are updated to use @types.
export {};
```

- [ ] **Step 2: Update components/index.ts**

```typescript
// apps/cli/src/screens/chat/components/index.ts
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
export * from './ToolCard';
export * from './ToolGroup';
export * from './TurnSummaryCard';
```

- [ ] **Step 3: Delete the old components**

```bash
rm apps/cli/src/screens/chat/components/AgentStatus.tsx
rm apps/cli/src/screens/chat/components/PendingTool.tsx
rm apps/cli/src/screens/chat/components/PendingPlan.tsx
```

- [ ] **Step 4: Run TypeScript type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json
```

Expected: No errors. If errors appear, fix them before continuing.

- [ ] **Step 5: Run all tests**

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/cli/turnSummary.test.ts
pnpm test
```

Expected: All existing tests pass. The new turnSummary tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/screens/chat/components/
git commit -m "chore(ui): remove AgentStatus, PendingTool, PendingPlan; update component exports"
```

---

## Task 18: Visual Verification

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Verify idle state**

Check:
- Welcome screen shows slate/teal logo (not blue)
- After entering chat: status bar is visible at the bottom with model name, git branch
- Input shows placeholder text "Ask anything, or / for commands"
- Input border is `#E2E2E2` (visible white)

- [ ] **Step 3: Send a message and verify live zone**

Send any message. Check:
- `· Thinking...` appears in dimmed text
- As tools run: `⏺  Reading    src/...` in teal
- Streaming text appears with `▋` cursor blinking
- Status bar shows elapsed time while agent runs

- [ ] **Step 4: Verify turn completion**

After agent finishes: check:
- Live zone clears
- Send another message → TurnSummary appears: `✓  Read N · Searched N · 12s  [HH:MM]`
- Input returns to idle state with placeholder

- [ ] **Step 5: Trigger an approval and verify**

If agent requires file approval: check:
- Approval card appears with `◈  Write file  ·  destructive`
- Diff shows (or collapse notice if ≥ 15 lines)
- `▶ deny` is selected by default (destructive)
- `y` approves, `n` denies, `←/→` toggles

- [ ] **Step 6: Test error state**

If a tool fails: check:
- `✗` icon in rust color
- Error preview is truncated to 1 line

- [ ] **Step 7: Test Ctrl+C interrupt**

While agent is running: press Ctrl+C. Check:
- Agent stops
- `◆ Interrupted.` appears as system notice
- Input returns to ready state (not exiting the app)

- [ ] **Step 8: Final commit if any fixes were made**

```bash
git add -p
git commit -m "fix(ui): visual verification fixes"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task(s) covering it |
|---|---|
| 5-zone layout | Task 16 (Chat.tsx) |
| Component architecture | Tasks 4-10, 16, 17 |
| Color system | Task 1 |
| Tool cards (4 states) | Task 7 (ToolCard) |
| Bash streaming | Task 7 (ToolCard) |
| Nested tools | Task 7 (ToolCard, `children`) |
| TurnSummary promotion | Tasks 3, 6, 16 |
| Agent thinking visibility | Task 9 (LiveZone) |
| Approval UX (risk tiers, keyboard, diff) | Task 10 (ApprovalCard) |
| Error class 1 (inline) | Task 7 (ToolCard error state) |
| Error class 2 (system notice) | Tasks 5, 16 (`appendNotice`) |
| Error class 3 (fatal border) | Not yet implemented — add to a follow-up |
| Diff collapse threshold | Task 12 (DiffView) |
| Git diff stat line | Tasks 9, 13 |
| Status bar | Task 4 |
| Session timeline (TurnSummary) | Tasks 3, 6 |
| Compaction UX | Task 16 (`agent:compact_complete`) |
| Ctrl+C interrupt / Escape split | Tasks 15, 16 |
| MessageCard palette | Task 11 |
| Left-border code blocks | Task 11 |
| ChatInput placeholder, dim state | Task 14 |
| WelcomeScreen palette | Task 15 |
| exitOnCtrlC: false | Task 15 |

**Known gap:** Error class 3 (fatal bordered card) is not explicitly implemented as a new component — it can be achieved by adding a bordered `SystemNoticeCard` variant when the error content starts with a fatal prefix. Add as follow-up if needed.

**Type consistency check:** `ToolActivity` defined in Task 2 (`types/chat.ts`) and referenced in Tasks 7, 8, 9, 16 without renaming. `TurnSummaryData` defined in Task 2, consumed in Tasks 3, 6, 16. `StaticItem` defined in Task 2, built in Task 16, rendered in Task 16. `buildTurnSummary` defined in Task 3, imported in Task 16 via `@utils`. All consistent.

**Placeholder check:** No TBDs or TODOs in any task. All code steps are complete. One known limitation noted (Shift+Enter multiline) with explicit test instruction.
