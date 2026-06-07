# UI Rework — Claude Code Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the entire CLI UI to match Claude Code's console-style aesthetic — flat/borderless rendering, slash-command palette, inline streaming, auto-continue session, `/clear` deletes session, `/compact` triggers LLM summarization, and `<Static>` rendering to eliminate terminal blinking.

**Architecture:** Top-down systematic rework: backend compact events first, then app routing (auto-navigate, no footer), then element-level visual components (SlashPalette, ChatInput, AgentStatus, MessageCard, ActivityFeed), then approval components, then main Chat.tsx wiring (Static wrap, new commands, streaming inline).

**Tech Stack:** React/Ink (terminal UI), `ink-text-input`, LangChain `SystemMessage`/`HumanMessage`, EventBus (typed EventEmitter), `MessageService`/`SessionService` from `@robocode-packages/core`, Zod, TypeScript.

---

## File Map

### New files
| File | Responsibility |
|---|---|
| `apps/cli/src/elements/SlashPalette.tsx` | Filtered slash command list with keyboard selection |

### Modified files
| File | Change |
|---|---|
| `packages/shared/src/types/event.ts` | Add `agent:compact_request`, `agent:compact_complete` events |
| `packages/agent/src/context/compressor.ts` | Add `compactConversation` function |
| `packages/agent/src/index.ts` | Add `compact` method + `agent:compact_request` listener to RoboAgent |
| `apps/cli/src/app.tsx` | Remove `<Navigation>`, auto-navigate to chat on mount, key ChatScreen on session id |
| `apps/cli/src/screens/WelcomeScreen.tsx` | Remove SessionList, profile-setup only |
| `apps/cli/src/components/index.ts` | Remove Navigation and Session exports |
| `apps/cli/src/elements/index.ts` | Add SlashPalette, remove ApproveFooter |
| `apps/cli/src/elements/ChatInput.tsx` | Remove border, integrate SlashPalette, update prompt glyph |
| `apps/cli/src/screens/chat/components/AgentStatus.tsx` | Single line, hidden when idle, remove suggestions prop |
| `apps/cli/src/screens/chat/components/MessageCard.tsx` | Flat styles, no borders |
| `apps/cli/src/screens/chat/components/ActivityFeed.tsx` | Single-line format, error-only preview |
| `apps/cli/src/screens/chat/components/PendingPlan.tsx` | Flat, inline y/n, no ApproveFooter |
| `apps/cli/src/screens/chat/components/PendingTool.tsx` | Flat, inline y/n, no ApproveFooter |
| `apps/cli/src/screens/chat/components/PendingReplan.tsx` | Flat, inline y/n, no ApproveFooter |
| `apps/cli/src/screens/chat/components/QuestionPrompt.tsx` | Flat, no border |
| `apps/cli/src/screens/chat/Chat.tsx` | Static wrap, /clear, /compact, streaming inline, command cleanup |

### Deleted files
| File | Reason |
|---|---|
| `apps/cli/src/components/Navigation.tsx` | Footer removed — slash commands replace navigation |
| `apps/cli/src/components/Session.tsx` | Session list removed — auto-continue session |
| `apps/cli/src/elements/ApproveFooter.tsx` | Replaced by inline y/n in each approval component |

---

## Task 1: Backend — compact events + `compactConversation`

**Files:**
- Modify: `packages/shared/src/types/event.ts`
- Modify: `packages/agent/src/context/compressor.ts`

- [ ] **Step 1: Add compact events to AppEvents**

In `packages/shared/src/types/event.ts`, add two new events at the end of the `AppEvents` interface (before the closing `}`):

```typescript
  'agent:compact_request': { sessionId: string };
  'agent:compact_complete': { sessionId: string; originalCount: number };
```

- [ ] **Step 2: Add `compactConversation` to compressor**

Replace the full content of `packages/agent/src/context/compressor.ts` with:

```typescript
import { trimMessages, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { RootStateType } from '../main/root/state';
import type { ReaderStateType, EditorStateType } from '../main';
import type { GitStateType } from '../main/subagents/git/state';
import { sanitizeToolChain, messageType } from '../utils/messages';
import { createBaseModel } from '../utils';

export const compressHistoryJson = async (
  state: RootStateType | ReaderStateType | EditorStateType | GitStateType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  maxTokens = 5_000
) => {
  const safeMessages = sanitizeToolChain(state.messages);
  const trimmed = await trimMessages(safeMessages, {
    maxTokens,
    strategy: 'last',
    tokenCounter: model,
    includeSystem: true,
    allowPartial: false,
  });

  return sanitizeToolChain(trimmed);
};

export const compactConversation = async (messages: BaseMessage[]): Promise<SystemMessage> => {
  const relevant = messages.filter((msg) => {
    const role = messageType(msg);
    return role === 'human' || role === 'ai';
  });

  if (relevant.length === 0) {
    return new SystemMessage('[Conversation compacted — no prior history]');
  }

  const transcript = relevant
    .map((msg) => {
      const role = messageType(msg);
      const content =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${role.toUpperCase()}: ${content}`;
    })
    .join('\n\n');

  const model = createBaseModel(false);
  const response = await model.invoke([
    new HumanMessage(
      `Summarize the following conversation into a concise context block. Preserve: goals, key decisions, findings, current state, and any unresolved questions.\n\n${transcript}`
    ),
  ]);

  const summary =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
  return new SystemMessage(`[Conversation compacted]\n\n${summary}`);
};
```

- [ ] **Step 3: Check that `messageType` is exported from `../utils/messages`**

Run:
```bash
grep -n "messageType" packages/agent/src/utils/messages.ts
```

If `messageType` is NOT found there, it's from `@robocode-packages/shared`. Fix the import in `compressor.ts`:

```typescript
// replace:
import { sanitizeToolChain, messageType } from '../utils/messages';
// with:
import { sanitizeToolChain } from '../utils/messages';
import { messageType } from '@robocode-packages/shared';
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep -E "error|compressor"
```

Expected: no errors in `compressor.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/event.ts packages/agent/src/context/compressor.ts
git commit -m "feat: add compact events and compactConversation backend"
```

---

## Task 2: RoboAgent — compact listener

**Files:**
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Add compact method and listener to RoboAgent**

In `packages/agent/src/index.ts`, add the import for `compactConversation` at the top:

```typescript
import { compactConversation } from './context/compressor';
```

In the `RoboAgent` constructor, add the listener after the existing `EventBus.on('agent:run', ...)` line:

```typescript
EventBus.on('agent:compact_request', this.compact.bind(this));
```

Add the `compact` method to the `RoboAgent` class, after the `deleteCheckpoint` method:

```typescript
  async compact({ sessionId }: { sessionId: string }) {
    const messages = MessageService.load(sessionId);
    const originalCount = messages.length;

    EventBus.emit('llm:start', { sessionId });
    try {
      const summaryMsg = await compactConversation(messages);
      MessageService.clear(sessionId);
      MessageService.add(sessionId, summaryMsg);
      EventBus.emit('agent:compact_complete', { sessionId, originalCount });
    } catch (err) {
      EventBus.emit('llm:error', { sessionId, error: String(err) });
    } finally {
      EventBus.emit('llm:end', { sessionId });
    }
  }
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project packages/agent/tsconfig.json 2>&1 | grep "error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/index.ts
git commit -m "feat: RoboAgent compact method and agent:compact_request listener"
```

---

## Task 3: App routing — auto-navigate, remove session selection

**Files:**
- Modify: `apps/cli/src/app.tsx`
- Modify: `apps/cli/src/screens/WelcomeScreen.tsx`
- Modify: `apps/cli/src/components/index.ts`
- Delete: `apps/cli/src/components/Navigation.tsx`
- Delete: `apps/cli/src/components/Session.tsx`

- [ ] **Step 1: Replace `app.tsx` completely**

```typescript
import { Box, Text } from 'ink';
import {
  WelcomeScreen,
  ProfileScreen,
  ChatScreen,
  SessionInspector,
  SettingsScreen,
} from '@screens';
import { RouterProvider, ProfileProvider, SessionProvider } from '@providers';
import { useRouter, useProfile, useSession } from '@hooks';
import { useEffect } from 'react';

const Screen = () => {
  const { route, navigate } = useRouter();
  const { list, active } = useProfile();
  const { session, create } = useSession();

  const profiles = list();
  const activeProfile = profiles.length > 0 ? active() : null;

  useEffect(() => {
    if (!activeProfile) return;
    if (!session) {
      create();
      return;
    }
    if (route === 'welcome' || route === 'profile') {
      navigate('assistant');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id, session?.id, route]);

  if (!activeProfile) {
    if (route !== 'welcome') navigate('welcome');
    return <WelcomeScreen key="welcome" />;
  }

  switch (route) {
    case 'assistant':
      return <ChatScreen key={session?.id ?? 'chat'} />;
    case 'history':
      return <SessionInspector key="history" />;
    case 'profile':
      return <ProfileScreen key="profile" />;
    case 'settings':
      return <SettingsScreen key="settings" />;
    default:
      return <Text>Loading...</Text>;
  }
};

const App = () => (
  <Box flexDirection="column" height="100%">
    <Screen />
  </Box>
);

export const APP = (
  <RouterProvider>
    <ProfileProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </ProfileProvider>
  </RouterProvider>
);
```

- [ ] **Step 2: Replace `WelcomeScreen.tsx` (profile-setup only)**

```typescript
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useProfile } from '@hooks';

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
          <Text key={line + i} color={i === 1 ? 'blue' : 'blueBright'}>
            {line}
          </Text>
        ))}
      </Box>

      <Box marginBottom={2}>
        <Text color="gray"> AI code assistant</Text>
      </Box>

      <Box flexDirection="column" gap={1}>
        <Text>  Welcome 👋</Text>
        <Text color="gray">  No active profile found. Would you like to set one up?</Text>
      </Box>

      <Box gap={3} paddingLeft={2} marginTop={1}>
        <Text color="green" bold>Y yes, set up profile</Text>
        <Text color="gray">N skip for now</Text>
      </Box>

      <Box marginTop={1} paddingLeft={2}>
        <Text dimColor>press Y or N</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 3: Update `components/index.ts`**

Replace the full content with:

```typescript
export * from './Lines';
```

- [ ] **Step 4: Delete Navigation.tsx and Session.tsx**

```bash
rm apps/cli/src/components/Navigation.tsx apps/cli/src/components/Session.tsx
```

- [ ] **Step 5: Type-check CLI**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep "error"
```

Expected: no errors (Navigation/Session were only used in app.tsx and WelcomeScreen which we just replaced).

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/app.tsx apps/cli/src/screens/WelcomeScreen.tsx \
  apps/cli/src/components/index.ts
git rm apps/cli/src/components/Navigation.tsx apps/cli/src/components/Session.tsx
git commit -m "feat: auto-navigate to chat on startup, remove footer navigation and session list"
```

---

## Task 4: SlashPalette component

**Files:**
- Create: `apps/cli/src/elements/SlashPalette.tsx`
- Modify: `apps/cli/src/elements/index.ts`

- [ ] **Step 1: Create `SlashPalette.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export interface SlashCommand {
  command: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/help', description: 'Show available commands' },
  { command: '/clear', description: 'Start a new session' },
  { command: '/compact', description: 'Summarize conversation with AI' },
  { command: '/approve', description: 'Toggle auto-approve mode' },
  { command: '/audit', description: 'Show last N audit entries' },
  { command: '/transcript', description: 'Show transcript file path' },
  { command: '/inspect', description: 'Open session inspector' },
  { command: '/replay', description: 'Reload persisted messages' },
];

interface Props {
  input: string;
  selectedIndex: number;
}

export const SlashPalette: React.FC<Props> = ({ input, selectedIndex }) => {
  const filtered = SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(input));

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" paddingLeft={1} marginBottom={0}>
      {filtered.map((cmd, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={cmd.command} gap={2}>
            <Text color={isSelected ? 'white' : undefined} bold={isSelected} dimColor={!isSelected}>
              {isSelected ? '❯ ' : '  '}
              {cmd.command}
            </Text>
            <Text color="gray" dimColor>
              {cmd.description}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
```

- [ ] **Step 2: Add SlashPalette to elements barrel**

In `apps/cli/src/elements/index.ts`, add:

```typescript
export * from './SlashPalette';
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -E "SlashPalette|error"
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/elements/SlashPalette.tsx apps/cli/src/elements/index.ts
git commit -m "feat: SlashPalette component with filtered command list"
```

---

## Task 5: AgentStatus rewrite

**Files:**
- Modify: `apps/cli/src/screens/chat/components/AgentStatus.tsx`

- [ ] **Step 1: Rewrite AgentStatus**

Replace the full content of `apps/cli/src/screens/chat/components/AgentStatus.tsx`:

```typescript
import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

interface Props {
  runningTool?: string | null;
  elapsed: number;
  thinkingText?: string | null;
}

export const AgentStatus: React.FC<Props> = React.memo(({ runningTool, elapsed, thinkingText }) => {
  const [frame, setFrame] = useState(0);
  const isBusy = !!runningTool || !!thinkingText;

  useEffect(() => {
    if (!isBusy) {
      setFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER.length);
    }, 200);
    return () => clearInterval(interval);
  }, [isBusy]);

  if (!isBusy) return null;

  const label = runningTool ?? thinkingText ?? '';

  return (
    <Box paddingX={1} gap={1}>
      <Text color="cyan">{SPINNER[frame]}</Text>
      <Text color="gray" dimColor>
        {label}
      </Text>
      {elapsed > 0 && (
        <Text color="gray" dimColor>
          ({formatElapsed(elapsed)})
        </Text>
      )}
    </Box>
  );
});

AgentStatus.displayName = 'AgentStatus';
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -E "AgentStatus|error"
```

Expected: no errors. Note: `Chat.tsx` still passes `isThinking` and `suggestions` which will cause type errors — that's fine, they'll be cleaned up in Task 10.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/components/AgentStatus.tsx
git commit -m "feat: AgentStatus single-line, hidden when idle, no suggestions row"
```

---

## Task 6: MessageCard rewrite

**Files:**
- Modify: `apps/cli/src/screens/chat/components/MessageCard.tsx`

- [ ] **Step 1: Rewrite MessageCard with flat console styles**

Replace the full content of `apps/cli/src/screens/chat/components/MessageCard.tsx`:

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import type { BaseMessage } from '@langchain/core/messages';
import { messageType } from '@robocode-packages/shared';

type Role = 'human' | 'ai' | 'system';

const FENCE_RE = /```([\w-]+)?\n([\s\S]*?)```/g;
const INLINE_CODE_RE = /`([^`]+)`/g;

const KEYWORDS: Record<string, string[]> = {
  typescript: ['const', 'let', 'function', 'return', 'type', 'interface', 'class', 'async', 'await', 'import', 'export', 'from', 'extends', 'implements', 'new', 'if', 'else', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'],
  javascript: ['const', 'let', 'function', 'return', 'class', 'async', 'await', 'import', 'export', 'from', 'new', 'if', 'else', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'],
  ts: ['const', 'let', 'function', 'return', 'type', 'interface', 'class', 'async', 'await', 'import', 'export', 'from', 'extends', 'implements', 'new'],
  js: ['const', 'let', 'function', 'return', 'class', 'async', 'await', 'import', 'export', 'from', 'new'],
  python: ['def', 'return', 'class', 'import', 'from', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'raise', 'async', 'await', 'with', 'as', 'lambda'],
  json: ['true', 'false', 'null'],
  bash: ['cd', 'ls', 'cat', 'grep', 'find', 'git', 'pnpm', 'npm', 'yarn', 'mkdir', 'rm', 'cp', 'mv', 'echo', 'export'],
};

const highlightLine = (line: string, language = ''): React.ReactNode[] => {
  const keywords = KEYWORDS[language.toLowerCase()] ?? [];
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const patterns = [
    { re: /\/\/.*$/, color: 'gray' },
    { re: /#.*$/, color: 'gray' },
    { re: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/, color: 'green' },
    { re: /\b\d+(\.\d+)?\b/, color: 'yellow' },
    { re: new RegExp(`\\b(${keywords.join('|')})\\b`), color: 'cyanBright' },
  ].filter((p) => p.re.source !== '\\b()\\b');

  while (cursor < line.length) {
    let matchIndex = -1;
    let matchLength = 0;
    let color = 'white';

    for (const pattern of patterns) {
      pattern.re.lastIndex = 0;
      const slice = line.slice(cursor);
      const match = slice.match(pattern.re);
      if (!match || match.index === undefined) continue;
      if (matchIndex === -1 || match.index < matchIndex) {
        matchIndex = match.index;
        matchLength = match[0].length;
        color = pattern.color;
      }
    }

    if (matchIndex === -1) {
      nodes.push(<Text key={`${cursor}-end`} color="white">{line.slice(cursor)}</Text>);
      break;
    }
    if (matchIndex > 0) {
      nodes.push(<Text key={`${cursor}-plain`} color="white">{line.slice(cursor, cursor + matchIndex)}</Text>);
    }
    nodes.push(<Text key={`${cursor}-match`} color={color}>{line.slice(cursor + matchIndex, cursor + matchIndex + matchLength)}</Text>);
    cursor += matchIndex + matchLength;
  }

  if (nodes.length === 0) nodes.push(<Text key="empty">{line}</Text>);
  return nodes;
};

const renderContent = (content: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let blockIndex = 0;
  FENCE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(content))) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      before.split(/\n\s*\n/).forEach((para, pi) => {
        const parts = para.split(INLINE_CODE_RE);
        nodes.push(
          <Box key={`p-${blockIndex}-${pi}`} marginBottom={1} flexDirection="column">
            <Text>
              {parts.map((part, i) =>
                i % 2 === 1
                  ? <Text key={i} color="cyanBright">{part}</Text>
                  : part
              )}
            </Text>
          </Box>
        );
      });
    }

    const language = (match[1] ?? '').trim();
    const codeLines = match[2].replace(/\r\n/g, '\n').split('\n');

    nodes.push(
      <Box key={`code-${blockIndex}`} flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Box gap={1}>
          <Text color="gray" dimColor>code</Text>
          {language ? <><Text color="gray">·</Text><Text color="cyanBright">{language}</Text></> : null}
        </Box>
        {codeLines.map((line, i) => (
          <Box key={i} gap={1}>
            <Text color="gray" dimColor>{String(i + 1).padStart(4)}</Text>
            <Text color="gray" dimColor>│</Text>
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
          <Text>
            {parts.map((part, i) =>
              i % 2 === 1
                ? <Text key={i} color="cyanBright">{part}</Text>
                : part
            )}
          </Text>
        </Box>
      );
    });
  }

  if (nodes.length === 0) {
    nodes.push(<Box key="empty" marginBottom={1}><Text color="gray" dimColor>(empty)</Text></Box>);
  }

  return nodes;
};

export const MessageCard: React.FC<{ msg: BaseMessage }> = ({ msg }) => {
  const role = messageType(msg) as Role;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2);

  if (role === 'human') {
    return (
      <Box marginBottom={1} paddingLeft={2}>
        <Text color="gray" dimColor>❯ </Text>
        <Text color="white">{content}</Text>
      </Box>
    );
  }

  if (role === 'system') {
    return (
      <Box marginBottom={1} paddingLeft={2}>
        <Text color="gray" dimColor>◆ {content}</Text>
      </Box>
    );
  }

  // ai
  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      {renderContent(content)}
    </Box>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -E "MessageCard|error"
```

Expected: no errors. (Note: `showBorders` prop is removed — `Chat.tsx` doesn't pass it, so no issue.)

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/components/MessageCard.tsx
git commit -m "feat: MessageCard flat console style — no borders, role-prefixed lines"
```

---

## Task 7: ActivityFeed rewrite

**Files:**
- Modify: `apps/cli/src/screens/chat/components/ActivityFeed.tsx`

- [ ] **Step 1: Rewrite ActivityFeed**

Replace the full content of `apps/cli/src/screens/chat/components/ActivityFeed.tsx`:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

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

const getLabel = (name: string, input: unknown): string => {
  const args = (input ?? {}) as Record<string, unknown>;
  if (name === 'bash') return String(args.command ?? '').slice(0, 60);
  const path = args.path ?? args.file ?? args.target;
  if (path) return String(path);
  return '';
};

const durationLabel = (startedAt?: number, finishedAt?: number): string | null => {
  if (!startedAt) return null;
  const end = finishedAt ?? Date.now();
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (seconds < 1) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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
        const icon = STATUS_ICON[activity.status];
        const color = STATUS_COLOR[activity.status];
        const label = getLabel(activity.name, activity.input);
        const duration = durationLabel(activity.startedAt, activity.finishedAt);

        return (
          <Box key={activity.id} flexDirection="column">
            <Box gap={2}>
              <Text color={color}>{icon}</Text>
              <Text color="gray" dimColor={activity.status === 'done'}>
                {activity.name}
              </Text>
              {label ? (
                <Text color="gray" dimColor>
                  {label}
                </Text>
              ) : null}
              {duration ? (
                <Text color="gray" dimColor>
                  {duration}
                </Text>
              ) : null}
            </Box>
            {activity.status === 'error' && activity.error && (
              <Box paddingLeft={4} flexDirection="column">
                {activity.error
                  .split('\n')
                  .slice(0, 3)
                  .map((line, i) => (
                    <Text key={i} color="red" dimColor>
                      {line}
                    </Text>
                  ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -E "ActivityFeed|error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/screens/chat/components/ActivityFeed.tsx
git commit -m "feat: ActivityFeed single-line format, error-only preview"
```

---

## Task 8: ChatInput rewrite

**Files:**
- Modify: `apps/cli/src/elements/ChatInput.tsx`

- [ ] **Step 1: Rewrite ChatInput**

Replace the full content of `apps/cli/src/elements/ChatInput.tsx`:

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
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
    ? SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(value))
    : [];

  useInput(
    (_, key) => {
      if (showPalette && paletteCommands.length > 0) {
        if (key.upArrow) {
          setPaletteIndex((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.downArrow) {
          setPaletteIndex((prev) => Math.min(paletteCommands.length - 1, prev + 1));
          return;
        }
        if (key.tab) {
          const selected = paletteCommands[paletteIndex];
          if (selected) {
            setValue(selected.command);
            setPaletteIndex(0);
          }
          return;
        }
        if (key.escape) {
          setValue('');
          setPaletteIndex(0);
          return;
        }
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

    setHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setValue('');
    setDraft('');
    setPaletteIndex(0);
    onSubmit(trimmed);
  };

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
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep -E "ChatInput|error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/elements/ChatInput.tsx
git commit -m "feat: ChatInput borderless with SlashPalette — arrow/tab navigation in palette"
```

---

## Task 9: Approval components — flat, inline y/n, remove ApproveFooter

**Files:**
- Modify: `apps/cli/src/screens/chat/components/PendingPlan.tsx`
- Modify: `apps/cli/src/screens/chat/components/PendingTool.tsx`
- Modify: `apps/cli/src/screens/chat/components/PendingReplan.tsx`
- Modify: `apps/cli/src/screens/chat/components/QuestionPrompt.tsx`
- Delete: `apps/cli/src/elements/ApproveFooter.tsx`
- Modify: `apps/cli/src/elements/index.ts`

- [ ] **Step 1: Rewrite PendingPlan**

Replace `apps/cli/src/screens/chat/components/PendingPlan.tsx`:

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Plan } from '@robocode-packages/shared';

interface Props {
  plan: Plan;
  isActive: boolean;
  confirm: (approved: boolean) => void;
}

const RISK_COLOR: Record<string, string> = { low: 'green', medium: 'yellow', high: 'red' };

export const PendingPlan: React.FC<Props> = ({ plan, isActive, confirm }) => {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');
  const riskColor = plan.risk ? (RISK_COLOR[plan.risk] ?? 'yellow') : 'gray';

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') { confirm(true); return; }
      if (input === 'n' || input === 'N' || key.escape) { confirm(false); return; }
      if (key.leftArrow || key.rightArrow) {
        setSelected((prev) => (prev === 'yes' ? 'no' : 'yes'));
      }
      if (key.return || input === ' ') {
        confirm(selected === 'yes');
        setSelected('yes');
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box gap={2} marginBottom={1}>
        <Text color="blue" bold>Plan</Text>
        <Text color="gray" dimColor>·</Text>
        <Text color="white">{plan.goal}</Text>
        {plan.risk && (
          <Text color={riskColor} dimColor>[{plan.risk}]</Text>
        )}
      </Box>

      {plan.steps && plan.steps.length > 0 && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
          {plan.steps.map((step, i) => (
            <Box key={step.id ?? i} gap={1}>
              <Text color="gray" dimColor>{i + 1}.</Text>
              <Text color="gray" dimColor>{step.kind}</Text>
              <Text color="white">{step.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box gap={3}>
        <Text color={selected === 'yes' ? 'green' : 'gray'} dimColor={selected !== 'yes'}>
          {selected === 'yes' ? '❯ ' : '  '}yes
        </Text>
        <Text color={selected === 'no' ? 'red' : 'gray'} dimColor={selected !== 'no'}>
          {selected === 'no' ? '❯ ' : '  '}no
        </Text>
        <Text color="gray" dimColor>y/n ←/→</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 2: Rewrite PendingReplan**

Replace `apps/cli/src/screens/chat/components/PendingReplan.tsx`:

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Plan } from '@robocode-packages/shared';

interface Props {
  plan: Plan & { reason?: string; attempt?: number };
  isActive: boolean;
  confirm: (approved: boolean) => void;
}

export const PendingReplan: React.FC<Props> = ({ plan, isActive, confirm }) => {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') { confirm(true); return; }
      if (input === 'n' || input === 'N' || key.escape) { confirm(false); return; }
      if (key.leftArrow || key.rightArrow) {
        setSelected((prev) => (prev === 'yes' ? 'no' : 'yes'));
      }
      if (key.return || input === ' ') {
        confirm(selected === 'yes');
        setSelected('yes');
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box gap={2} marginBottom={1}>
        <Text color="yellow" bold>⟳ Replanning</Text>
        {!!plan.attempt && (
          <Text color="gray" dimColor>attempt {plan.attempt}/3</Text>
        )}
      </Box>

      {plan.reason && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>reason: </Text>
          <Text color="white">{plan.reason}</Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="gray" dimColor>goal: </Text>
        <Text color="white">{plan.goal}</Text>
      </Box>

      {plan.steps && plan.steps.length > 0 && (
        <Box flexDirection="column" marginBottom={1} paddingLeft={1}>
          {plan.steps.map((step, i) => (
            <Box key={step.id ?? i} gap={1}>
              <Text color="gray" dimColor>{i + 1}.</Text>
              <Text color="gray" dimColor>{step.kind}</Text>
              <Text color="white">{step.title}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box gap={3}>
        <Text color={selected === 'yes' ? 'green' : 'gray'} dimColor={selected !== 'yes'}>
          {selected === 'yes' ? '❯ ' : '  '}yes
        </Text>
        <Text color={selected === 'no' ? 'red' : 'gray'} dimColor={selected !== 'no'}>
          {selected === 'no' ? '❯ ' : '  '}no
        </Text>
        <Text color="gray" dimColor>y/n ←/→</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 3: Rewrite PendingTool**

Read the current PendingTool to preserve DiffView and other inner logic. The key changes are: remove `<Box>` wrapper with border, remove `<ApproveFooter>`, add inline `useInput` y/n, add `useState` for selected.

Replace `apps/cli/src/screens/chat/components/PendingTool.tsx`:

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { PendingToolCall } from '@robocode-packages/shared';
import { DiffView } from './DiffView';
import { COLORS } from '@utils';

interface Props {
  tool: PendingToolCall;
  isActive: boolean;
  confirm: (approved: boolean) => void;
}

const RISK_COLOR: Record<string, string> = {
  safe: '#518546',
  moderate: '#e2a712',
  destructive: '#b05959',
};

const RISK_ICON: Record<string, string> = {
  safe: '•',
  moderate: '◦',
  destructive: '!',
};

export const PendingTool: React.FC<Props> = ({ tool, isActive, confirm }) => {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput(
    (input, key) => {
      if (input === 'y' || input === 'Y') { confirm(true); return; }
      if (input === 'n' || input === 'N' || key.escape) { confirm(false); return; }
      if (key.leftArrow || key.rightArrow) {
        setSelected((prev) => (prev === 'yes' ? 'no' : 'yes'));
      }
      if (key.return || input === ' ') {
        confirm(selected === 'yes');
        setSelected('yes');
      }
    },
    { isActive }
  );

  const color = RISK_COLOR[tool.risk] ?? 'yellow';
  const icon = RISK_ICON[tool.risk] ?? '?';
  const isBash = tool.name === 'bash';
  const isEdit = tool.name === 'edit_file';
  const isPatch = tool.name === 'patch_file';
  const isWrite = tool.name === 'write_file';
  const isDelete = tool.name === 'delete_file';
  const isRename = tool.name === 'rename_file';

  const targetPath = String(tool.args.path ?? '').trim();
  const command = String(tool.args.command ?? '').trim();

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box gap={1} marginBottom={1}>
        <Text color={color} bold>{icon} {tool.name}</Text>
        {!isBash && targetPath && (
          <>
            <Text color="gray" dimColor>·</Text>
            <Text color={COLORS.fileHeader}>{targetPath}</Text>
          </>
        )}
      </Box>

      {isBash && command && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray" dimColor>shell</Text>
          <Text color="white">{command}</Text>
        </Box>
      )}

      {isEdit && (
        <DiffView
          oldStr={String(tool.args.old_str ?? '')}
          newStr={String(tool.args.new_str ?? '')}
          startLine={tool.metadata?.startLine}
        />
      )}

      {isPatch && (
        <DiffView
          patches={
            Array.isArray(tool.args.patches)
              ? tool.args.patches.map((patch) => ({
                  oldStr: String((patch as Record<string, unknown>).old_str ?? ''),
                  newStr: String((patch as Record<string, unknown>).new_str ?? ''),
                }))
              : []
          }
        />
      )}

      {isWrite && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="gray" dimColor>content ({String(tool.args.content ?? '').split('\n').length} lines)</Text>
        </Box>
      )}

      {isDelete && (
        <Box marginBottom={1}>
          <Text color="red" dimColor>will delete {targetPath}</Text>
        </Box>
      )}

      {isRename && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>rename to </Text>
          <Text color={COLORS.fileHeader}>{String(tool.args.new_path ?? '')}</Text>
        </Box>
      )}

      <Box gap={3}>
        <Text color={selected === 'yes' ? 'green' : 'gray'} dimColor={selected !== 'yes'}>
          {selected === 'yes' ? '❯ ' : '  '}yes
        </Text>
        <Text color={selected === 'no' ? 'red' : 'gray'} dimColor={selected !== 'no'}>
          {selected === 'no' ? '❯ ' : '  '}no
        </Text>
        <Text color="gray" dimColor>y/n ←/→</Text>
      </Box>
    </Box>
  );
};
```

- [ ] **Step 4: Rewrite QuestionPrompt**

Replace `apps/cli/src/screens/chat/components/QuestionPrompt.tsx`:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export interface QuestionPromptProps {
  question: string;
  label?: string;
  questionIndex?: number;
  totalQuestions?: number;
}

export const QuestionPrompt: React.FC<QuestionPromptProps> = ({
  question,
  label = 'clarification needed',
  questionIndex,
  totalQuestions,
}) => {
  const hasProgress =
    questionIndex !== undefined && totalQuestions !== undefined && totalQuestions > 1;

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2}>
      <Box gap={1} marginBottom={1}>
        <Text color="yellow">?</Text>
        <Text color="gray" dimColor>{label}</Text>
        {hasProgress && (
          <Text color="gray" dimColor>({questionIndex}/{totalQuestions})</Text>
        )}
      </Box>
      <Text color="white">{question}</Text>
    </Box>
  );
};
```

- [ ] **Step 5: Delete ApproveFooter and update elements/index.ts**

```bash
rm apps/cli/src/elements/ApproveFooter.tsx
```

In `apps/cli/src/elements/index.ts`, remove the `ApproveFooter` export. The full file should now be:

```typescript
export * from './FormInput';
export * from './Input';
export * from './ConfirmDelete';
export * from './ChatInput';
export * from './Loading';
export * from './Badge';
export * from './SlashPalette';
```

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep "error"
```

Expected: no errors (or only errors in Chat.tsx from Task 10 pending changes — those are fine).

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/screens/chat/components/PendingPlan.tsx \
  apps/cli/src/screens/chat/components/PendingTool.tsx \
  apps/cli/src/screens/chat/components/PendingReplan.tsx \
  apps/cli/src/screens/chat/components/QuestionPrompt.tsx \
  apps/cli/src/elements/index.ts
git rm apps/cli/src/elements/ApproveFooter.tsx
git commit -m "feat: approval components flat style, inline y/n, remove ApproveFooter"
```

---

## Task 10: Chat.tsx — Static wrap, /clear, /compact, streaming inline, command cleanup

**Files:**
- Modify: `apps/cli/src/screens/chat/Chat.tsx`

This is the largest task. We rewrite Chat.tsx completely.

- [ ] **Step 1: Replace Chat.tsx**

Replace the full content of `apps/cli/src/screens/chat/Chat.tsx`:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, Static, useInput } from 'ink';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { canResume } from '@robocode-packages/agent';
import { AuditService, EventBus, MessageService, TranscriptService } from '@robocode-packages/core';
import { messageType, type PendingToolCall, type Plan } from '@robocode-packages/shared';
import { ChatInput } from '@elements';
import { useRouter, useSession } from '@hooks';
import {
  ActivityFeed,
  AgentStatus,
  GitDiffPreview,
  MessageCard,
  PendingPlan,
  PendingReplan,
  PendingTool,
  QuestionPrompt,
  type ToolActivity,
  type ToolStreamChunk,
} from './components';

const TOOL_STREAM_LIMIT = 48;

const stringifyContent = (content: unknown) => {
  if (typeof content === 'string') return content;
  try { return JSON.stringify(content, null, 2); } catch { return String(content); }
};

const messageSignature = (msg: BaseMessage) => {
  const role = messageType(msg);
  const content = stringifyContent(msg.content).trim();
  return `${role}:${content.slice(0, 120)}`;
};

const compactMessages = (items: BaseMessage[]) => {
  const compacted: BaseMessage[] = [];
  let prev: string | null = null;
  for (const item of items) {
    const sig = messageSignature(item);
    if (sig === prev) continue;
    compacted.push(item);
    prev = sig;
  }
  return compacted;
};

const makeToolId = (name: string) =>
  `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

const appendStreamChunk = (stream: ToolStreamChunk[] | undefined, chunk: ToolStreamChunk) =>
  [...(stream ?? []), chunk].slice(-TOOL_STREAM_LIMIT);

type PendingApproval =
  | { kind: 'tool'; tool: PendingToolCall; source: 'root' | 'editor' | 'executor' | 'git' }
  | { kind: 'plan'; plan: Plan }
  | { kind: 'replan'; plan: Plan & { reason?: string; attempt?: number } }
  | {
      kind: 'question';
      source: string;
      answerEvent: string | null;
      question: string;
      questionIndex?: number;
      totalQuestions?: number;
    }
  | { kind: 'step_blocked'; stepId: string; stepTitle: string; error: string };

export const ChatScreen: React.FC = () => {
  const { session, create, delete: deleteSession } = useSession();
  const { navigate } = useRouter();

  const [messages, setMessages] = useState<BaseMessage[]>(() =>
    session ? MessageService.load(session.id) : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [previewTool, setPreviewTool] = useState<PendingToolCall | null>(null);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [gitDiffStat, setGitDiffStat] = useState<string | null>(null);
  const [gitDiffPreview, setGitDiffPreview] = useState<string | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);

  const streamingRef = useRef('');
  const agentStartTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!session) return;
    setMessages(MessageService.load(session.id));
    setStreamingText('');
    streamingRef.current = '';
    setPendingApproval(null);
    setPreviewTool(null);
    setActivities([]);
    setIsLoading(false);
    setThinkingText(null);
    setGitDiffStat(null);
    setGitDiffPreview(null);
    agentStartTimeRef.current = null;
    setElapsed(0);
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    canResume(session.id).then((resumable) => {
      if (resumable) EventBus.emit('agent:interrupted', { sessionId: session.id });
    });
  }, [session?.id]);

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
        setThinkingText(text);
      }),
      EventBus.on('llm:token', ({ sessionId, token }) => {
        if (sessionId !== id) return;
        streamingRef.current += token;
        setStreamingText((prev) => prev + token);
      }),
      EventBus.on('llm:end', ({ sessionId }) => {
        if (sessionId !== id) return;
        if (streamingRef.current) {
          setMessages((prev) => [...prev, new AIMessage(streamingRef.current)]);
          streamingRef.current = '';
          setStreamingText('');
        }
        setIsLoading(false);
        setThinkingText(null);
      }),
      EventBus.on('llm:error', ({ sessionId }) => {
        if (sessionId !== id) return;
        streamingRef.current = '';
        setStreamingText('');
        setIsLoading(false);
        setThinkingText(null);
      }),
      EventBus.on('agent:plan_pending', ({ sessionId, plan }) => {
        if (sessionId !== id) return;
        setPendingApproval(plan ? { kind: 'plan', plan } : null);
      }),
      EventBus.on('agent:plan_decision', ({ sessionId }) => {
        if (sessionId !== id) return;
        setPendingApproval(null);
      }),
      EventBus.on('agent:tool_pending', ({ sessionId, toolCall, source }) => {
        if (sessionId !== id) return;
        setPendingApproval({ kind: 'tool', tool: toolCall, source: source ?? 'root' });
        setIsLoading(false);
      }),
      EventBus.on('agent:tool_decision', ({ sessionId }) => {
        if (sessionId !== id) return;
        setPendingApproval(null);
      }),
      EventBus.on('agent:replan', ({ sessionId, plan, attempt }) => {
        if (sessionId !== id) return;
        setPendingApproval({ kind: 'replan', plan: { ...plan, attempt } });
        setIsLoading(false);
      }),
      EventBus.on('agent:question_pending', ({ sessionId, question, questionIndex, totalQuestions, type }) => {
        if (sessionId !== id) return;
        const source = type === 'router_intent' ? 'router-intent' : 'planner';
        setPendingApproval({ kind: 'question', source, answerEvent: null, question, questionIndex, totalQuestions });
        setIsLoading(false);
      }),
      EventBus.onPattern('agent:clarification:*:question', (event, payload) => {
        const { sessionId, question } = payload as { sessionId: string; question: string };
        if (sessionId !== id) return;
        const source = event.match(/^agent:clarification:(.+):question$/)?.[1] ?? 'unknown';
        setPendingApproval({ kind: 'question', source, answerEvent: `agent:clarification:${source}:answer`, question });
        setIsLoading(false);
      }),
      EventBus.on('agent:question_clear', ({ sessionId }) => {
        if (sessionId !== id) return;
        setPendingApproval(null);
      }),
      EventBus.on('agent:editor_complete', ({ sessionId: sid, applied, failed, skipped, files, errors }) => {
        if (sid !== id) return;
        setIsLoading(false);
        const lines = [
          applied > 0 ? `✓ Applied ${applied} edit${applied !== 1 ? 's' : ''}: ${files.join(', ')}` : null,
          skipped > 0 ? `◦ Skipped ${skipped}` : null,
          failed > 0 ? `✗ Failed ${failed}: ${errors.join('; ')}` : null,
        ].filter(Boolean).join('\n');
        appendNotice(lines || 'Editor finished with no changes.');
      }),
      EventBus.on('agent:executor_start', ({ sessionId: sid, stepCount }) => {
        if (sid !== id) return;
        setThinkingText(`Executing ${stepCount} step${stepCount !== 1 ? 's' : ''}…`);
      }),
      EventBus.on('agent:execution_complete', ({ sessionId: sid, summary }) => {
        if (sid !== id) return;
        setIsLoading(false);
        setThinkingText(null);
        appendNotice(summary);
      }),
      EventBus.on('agent:step_blocked', ({ sessionId: sid, stepId, stepTitle, error }) => {
        if (sid !== id) return;
        setPendingApproval({ kind: 'step_blocked', stepId, stepTitle, error });
        setIsLoading(false);
        setThinkingText(null);
      }),
      EventBus.on('agent:compact_complete', ({ sessionId: sid, originalCount }) => {
        if (sid !== id) return;
        const updated = MessageService.load(sid);
        const notice = new SystemMessage(`Conversation compacted · ${originalCount} messages → 1 summary`);
        MessageService.add(sid, notice);
        setMessages([...updated, notice]);
      }),
      EventBus.on('tool:start', ({ sessionId, name, input, callId }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? makeToolId(name);
        setActivities((prev) => {
          const index = prev.findIndex((item) => item.id === activityId);
          const nextItem: ToolActivity = {
            id: activityId, name, input, status: 'running',
            output: undefined, error: undefined, stream: [], startedAt: Date.now(),
          };
          if (index === -1) return [...prev, nextItem];
          const next = [...prev];
          next[index] = {
            ...next[index], id: activityId, name, input, status: 'running',
            error: undefined, finishedAt: undefined,
            startedAt: next[index].startedAt ?? Date.now(),
            stream: next[index].stream ?? nextItem.stream,
          };
          return next;
        });
      }),
      EventBus.on('tool:stream', ({ sessionId, callId, chunk, stream, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities((prev) =>
          prev.map((item) =>
            item.id !== activityId ? item
              : { ...item, status: 'running', stream: appendStreamChunk(item.stream, { kind: stream, text: chunk }) }
          )
        );
      }),
      EventBus.on('tool:end', ({ sessionId, callId, output, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities((prev) =>
          prev.map((item) =>
            item.id !== activityId ? item
              : { ...item, status: 'done', output: stringifyContent(output), finishedAt: Date.now() }
          )
        );
        setThinkingText(null);
      }),
      EventBus.on('tool:error', ({ sessionId, callId, error, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities((prev) =>
          prev.map((item) =>
            item.id !== activityId ? item
              : { ...item, status: 'error', error, finishedAt: Date.now() }
          )
        );
        setThinkingText(null);
      }),
      EventBus.on('agent:git_diff', ({ sessionId, gitDiffStat, gitDiffPreview }) => {
        if (sessionId !== id) return;
        setGitDiffStat(gitDiffStat);
        setGitDiffPreview(gitDiffPreview);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [session?.id]);

  useInput((_, key) => {
    if (pendingApproval || previewTool) return;
    if (key.escape) {
      if (session?.id) EventBus.emit('agent:stop', { sessionId: session.id });
      navigate('welcome');
    }
  });

  const isAgentBusy = isLoading || (!!pendingApproval && pendingApproval.kind !== 'question');
  const isBusy = isAgentBusy || !!previewTool;

  useEffect(() => {
    if (!isAgentBusy) {
      agentStartTimeRef.current = null;
      setElapsed(0);
      return;
    }
    if (!agentStartTimeRef.current) agentStartTimeRef.current = Date.now();
    const startTime = agentStartTimeRef.current;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isAgentBusy]);

  const appendNotice = (text: string) => {
    if (!session) return;
    const notice = new SystemMessage(text);
    MessageService.add(session.id, notice);
    setMessages((prev) => [...prev, notice]);
  };

  const resetTransientState = () => {
    setStreamingText('');
    streamingRef.current = '';
    setPendingApproval(null);
    setPreviewTool(null);
    setActivities([]);
    setThinkingText(null);
    setGitDiffStat(null);
    setGitDiffPreview(null);
    setIsLoading(false);
    agentStartTimeRef.current = null;
    setElapsed(0);
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
      EventBus.emit('agent:stop', { sessionId: session.id });
      deleteSession(session.id);
      create();
      resetTransientState();
      setMessages([]);
      return;
    }

    if (command === 'compact') {
      setIsLoading(true);
      setThinkingText('Compacting…');
      EventBus.emit('agent:compact_request', { sessionId: session.id });
      return;
    }

    if (command === 'transcript') {
      appendNotice(`Transcript: ${TranscriptService.path(session.id)}`);
      return;
    }

    if (command === 'inspect') {
      navigate('history');
      return;
    }

    if (command === 'replay') {
      EventBus.emit('agent:stop', { sessionId: session.id });
      const restored = MessageService.load(session.id);
      setMessages(restored);
      resetTransientState();
      appendNotice(`Replayed ${restored.length} messages.`);
      return;
    }

    if (command === 'audit') {
      const count = Number.parseInt(argText || '10', 10);
      const entries = AuditService.tail(session.id, Number.isFinite(count) && count > 0 ? count : 10);
      if (entries.length === 0) { appendNotice('No audit entries recorded yet.'); return; }
      const lines = entries.map((e) => {
        const payload = JSON.stringify(e.payload);
        return `${e.timestamp} ${e.event} ${payload.length > 120 ? `${payload.slice(0, 117)}...` : payload}`;
      });
      appendNotice(`Audit (${entries.length}):\n${lines.join('\n')}`);
      return;
    }

    if (command === 'approve') {
      const next = !autoApprove;
      setAutoApprove(next);
      appendNotice(next ? '⚡ Auto-approve enabled.' : 'Auto-approve disabled.');
      return;
    }

    appendNotice(`Unknown command "${command}". Try /help.`);
  };

  const handleSubmit = (value: string) => {
    if (!session) return;

    if (value.startsWith('/')) {
      executeCommand(value);
      return;
    }

    if (pendingApproval?.kind === 'question') {
      setMessages((prev) => [...prev, new HumanMessage(value)]);
      setIsLoading(true);
      setThinkingText('Planning...');
      setPendingApproval(null);
      if (pendingApproval.answerEvent) {
        EventBus.emitDynamic(pendingApproval.answerEvent, { sessionId: session.id, answer: value });
      } else {
        EventBus.emit('agent:resume:clarification', { sessionId: session.id, answer: value });
      }
      return;
    }

    if (pendingApproval?.kind === 'step_blocked') {
      const trimmed = value.trim().toLowerCase();
      confirmStepBlocked(trimmed === 's' || trimmed === 'skip' ? null : value);
      return;
    }

    setMessages((prev) => [...prev, new HumanMessage(value)]);
    setIsLoading(true);
    setThinkingText('Drafting response...');
    streamingRef.current = '';
    setStreamingText('');
    setActivities([]);
    setPendingApproval(null);
    setPreviewTool(null);
    setGitDiffStat(null);
    setGitDiffPreview(null);
    EventBus.emit('agent:run', value);
  };

  const confirmTool = (approved: boolean) => {
    if (previewTool) { setPreviewTool(null); return; }
    if (!session) return;
    const source = pendingApproval?.kind === 'tool' ? pendingApproval.source : 'root';
    const decision = approved ? 'approve' : 'reject';
    if (source === 'editor') EventBus.emit('agent:resume:editor', { sessionId: session.id, decision });
    else if (source === 'executor') EventBus.emit('agent:resume:executor', { sessionId: session.id, decision });
    else if (source === 'git') EventBus.emit('agent:resume:git', { sessionId: session.id, decision });
    else EventBus.emit('agent:resume', { sessionId: session.id, decision });
    setPendingApproval(null);
  };

  const confirmStepBlocked = (hint: string | null) => {
    if (!session) return;
    const decision = hint === null ? { action: 'skip' as const } : { action: 'retry' as const, hint };
    EventBus.emit('agent:resume:executor', { sessionId: session.id, decision });
    setPendingApproval(null);
    if (hint !== null) setIsLoading(true);
  };

  const confirmPlan = (approved: boolean) => {
    if (!session) return;
    EventBus.emit('agent:resume', { sessionId: session.id, decision: approved ? 'approve' : 'reject' });
    setPendingApproval(null);
    if (approved) setIsLoading(true);
  };

  const confirmReplan = (approved: boolean) => {
    if (!session) return;
    EventBus.emit('agent:resume', { sessionId: session.id, decision: approved ? 'approve' : 'reject' });
    setPendingApproval(null);
    if (approved) setIsLoading(true);
  };

  const visibleMessages = messages.filter((msg) => {
    const role = messageType(msg);
    if (role === 'tool') return false;
    if (role === 'ai') return stringifyContent(msg.content).trim().length > 0;
    return true;
  });
  const dedupedMessages = compactMessages(visibleMessages);

  const runningTool = activities.find((a) => a.status === 'running')?.name ?? null;

  const renderApproval = () => {
    if (!pendingApproval) return null;
    switch (pendingApproval.kind) {
      case 'tool': return <PendingTool tool={pendingApproval.tool} isActive confirm={confirmTool} />;
      case 'plan': return <PendingPlan plan={pendingApproval.plan} isActive confirm={confirmPlan} />;
      case 'replan': return <PendingReplan plan={pendingApproval.plan} isActive confirm={confirmReplan} />;
      case 'question':
        return (
          <QuestionPrompt
            question={pendingApproval.question}
            questionIndex={pendingApproval.questionIndex}
            totalQuestions={pendingApproval.totalQuestions}
            label={pendingApproval.source === 'router-intent' ? 'need more info' : 'clarification needed'}
          />
        );
      case 'step_blocked':
        return (
          <QuestionPrompt
            question={`Step "${pendingApproval.stepTitle}" failed:\n${pendingApproval.error}\n\nType a hint to retry, or "s" to skip.`}
            label="step blocked"
          />
        );
      default: return null;
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
        <Static items={dedupedMessages}>
          {(msg, index) => (
            <MessageCard key={`${messageSignature(msg)}:${index}`} msg={msg} />
          )}
        </Static>

        {streamingText && (
          <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
            <Text color="white">{streamingText}</Text>
          </Box>
        )}

        <ActivityFeed activities={activities} />
        <GitDiffPreview stat={gitDiffStat} preview={gitDiffPreview} />
        {renderApproval()}
        {previewTool && <PendingTool tool={previewTool} isActive confirm={confirmTool} />}
      </Box>

      <Box flexDirection="column">
        <AgentStatus
          runningTool={runningTool}
          elapsed={elapsed}
          thinkingText={previewTool ? 'previewing edit_file' : thinkingText}
        />
        {autoApprove && (
          <Box paddingX={1}>
            <Text color="#e2a712" dimColor>⚡ auto-approve</Text>
          </Box>
        )}
        <ChatInput isActive={!isBusy} onSubmit={handleSubmit} isLoading={isBusy} />
      </Box>
    </Box>
  );
};
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit --project apps/cli/tsconfig.json 2>&1 | grep "error"
```

Expected: no errors. Common issues to fix:
- If `'delete'` destructuring fails, use: `const sessionCtx = useSession(); const { session, create } = sessionCtx; const deleteSession = sessionCtx['delete'];`
- If `Static` import fails from 'ink': verify `import { Box, Text, Static, useInput } from 'ink'` is correct
- If `agent:compact_request` or `agent:compact_complete` events cause type errors, rebuild shared first: `pnpm --filter @robocode-packages/shared build`

- [ ] **Step 3: Build to verify no compile errors**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build completes without TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/screens/chat/Chat.tsx
git commit -m "feat: Chat.tsx Static wrap, /clear, /compact, inline streaming, command cleanup"
```

---

## Final: type-check + build verification

- [ ] **Step 1: Full type-check across all packages**

```bash
npx tsc --noEmit --project packages/shared/tsconfig.json && \
npx tsc --noEmit --project packages/agent/tsconfig.json && \
npx tsc --noEmit --project apps/cli/tsconfig.json
```

Expected: no errors.

- [ ] **Step 2: Full build**

```bash
pnpm build 2>&1 | tail -30
```

Expected: all packages build successfully.

- [ ] **Step 3: Run tests**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all existing tests pass (we haven't changed any agent logic — only compressor and RoboAgent constructor).

- [ ] **Step 4: Final commit**

```bash
git add -p
git commit -m "chore: UI rework complete — Claude Code style"
```
