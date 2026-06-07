import React, { useEffect, useRef, useState } from 'react';
import { Box, Static, useInput } from 'ink';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import { execSync } from 'child_process';
import { canResume } from '@robocode-packages/agent';
import { AuditService, EventBus, MessageService, TranscriptService } from '@robocode-packages/core';
import { messageType, debug } from '@robocode-packages/shared';
import type { ClarificationSource } from '@robocode-packages/shared';
import { ChatInput } from '@elements';
import { useRouter, useSession, useProfile } from '@hooks';
import { buildTurnSummary } from '@utils';
import type { StaticItem, ToolActivity, ToolStreamChunk } from '@types';
import {
  LiveZone,
  ApprovalCard,
  PendingQuestion,
  StatusBar,
  TurnSummaryCard,
  SystemNoticeCard,
  MessageCard,
  WorkingLine,
  ThinkingBlock,
} from './components';

const TOOL_STREAM_LIMIT = 48;

const READ_TOOLS = new Set(['read_file','list_dir','glob','grep','search_files','find_definition','ast_analyzer','git_diff','git_log']);
const EDIT_TOOLS = new Set(['write_file','edit_file','patch_file','str_replace_editor','delete_file','rename_symbol']);

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
    const b = execSync('git branch --show-current', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
  const [clearGeneration, setClearGeneration] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalCost, setTotalCost] = useState(0);

  const [pendingQuestion, setPendingQuestion] = useState<{ question: string; source: ClarificationSource | null } | null>(null);
  const [collapsedThinking, setCollapsedThinking] = useState<Set<string>>(new Set());
  const currentThinkingRef = useRef('');

  const streamingRef = useRef('');
  const agentStartTimeRef = useRef<number | null>(null);
  const pendingClearRef = useRef(false);
  const lastCtrlCRef = useRef<number | null>(null);
  const turnTokensRef = useRef(0);
  const turnCostRef = useRef(0);

  useEffect(() => {
    setGitBranch(getGitBranch());
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    setStaticItems(messagesToStaticItems(MessageService.load(session.id)));
    setStreamingText('');
    streamingRef.current = '';
    setPendingApproval(null);
    setPendingQuestion(null);
    setActivities([]);
    setIsLoading(false);
    setThinkingPhrase(null);
    setGitDiffStat(null);
    agentStartTimeRef.current = null;
    setElapsed(0);
    pendingClearRef.current = false;
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    canResume(session.id)
      .then(resumable => {
        if (resumable) EventBus.emit('agent:resume', { sessionId: session.id, decision: 'approve' });
      })
      .catch(err => {
        debug('[canResume] error:', err);
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
        currentThinkingRef.current += text;
        setThinkingPhrase('Thinking…');
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
        if (currentThinkingRef.current) {
          const thinkingText = currentThinkingRef.current;
          const thinkingId = makeId();
          currentThinkingRef.current = '';
          setStaticItems(prev => [...prev, { kind: 'thinking', id: thinkingId, text: thinkingText }]);
          setCollapsedThinking(prev => new Set([...prev, thinkingId]));
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
        setThinkingPhrase('Planning…');
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
      EventBus.on('agent:question', ({ sessionId, question, source }) => {
        if (sessionId !== id) return;
        setPendingQuestion({ question, source: source ?? null });
        setIsLoading(false);
        setThinkingPhrase(null);
      }),
      EventBus.on('agent:compact_complete', ({ sessionId: sid, originalCount }) => {
        if (sid !== id) return;
        const updated = MessageService.load(sid);
        const noticeContent = `Compacted · ${originalCount} messages → 1 summary`;
        const notice = new SystemMessage(noticeContent);
        MessageService.add(sid, notice);
        setStaticItems([
          ...messagesToStaticItems(updated),
          { kind: 'system', id: makeId(), content: noticeContent },
        ]);
      }),
      EventBus.on('tool:start', ({ sessionId, name, input, callId }) => {
        if (sessionId !== id) return;
        const phrase =
          READ_TOOLS.has(name) ? 'Reading files…' :
          EDIT_TOOLS.has(name) ? 'Writing…' :
          name === 'bash' ? 'Running command…' :
          'Working…';
        setThinkingPhrase(phrase);
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
        setThinkingPhrase('Reviewing results…');
      }),
      EventBus.on('tool:error', ({ sessionId, callId, error, name }) => {
        if (sessionId !== id) return;
        const activityId = callId ?? name;
        setActivities(prev => prev.map(a =>
          a.id !== activityId ? a
            : { ...a, status: 'error', error, finishedAt: Date.now() }
        ));
      }),
      EventBus.on('llm:usage', ({ sessionId, inputTokens, outputTokens, cacheReadTokens, cost }) => {
        if (sessionId !== id) return;
        setTotalTokens(prev => prev + inputTokens + outputTokens + cacheReadTokens);
        setTotalCost(prev => prev + cost);
        turnTokensRef.current += inputTokens + outputTokens + cacheReadTokens;
        turnCostRef.current += cost;
      }),
      EventBus.on('agent:git_diff', ({ sessionId, gitDiffStat: stat }) => {
        if (sessionId !== id) return;
        setGitDiffStat(stat);
      }),
    ];

    return () => unsubs.forEach(u => u());
  }, [session?.id]);

  const isToolRunning = activities.some(a => a.status === 'running');
  const isAgentBusy = isLoading || !!pendingApproval || isToolRunning;

  useEffect(() => {
    if (!isAgentBusy) { agentStartTimeRef.current = null; setElapsed(0); return; }
    if (!agentStartTimeRef.current) agentStartTimeRef.current = Date.now();
    const start = agentStartTimeRef.current;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isAgentBusy]);

  useInput((input, key) => {
    if (input === 't' && !isAgentBusy && !pendingApproval) {
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
    if (key.ctrl && input === 'c') {
      const now = Date.now();
      const last = lastCtrlCRef.current;
      if (last !== null && now - last < 1500) {
        process.exit(0);
      }
      lastCtrlCRef.current = now;
      if (session?.id) EventBus.emit('agent:stop', { sessionId: session.id });
      appendNotice('Interrupted. Ctrl+C again to exit.');
      return;
    }
    if (pendingApproval) return;
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
    currentThinkingRef.current = '';
    setPendingApproval(null);
    setPendingQuestion(null);
    setActivities([]);
    setThinkingPhrase(null);
    setGitDiffStat(null);
    setIsLoading(false);
    agentStartTimeRef.current = null;
    setElapsed(0);
    pendingClearRef.current = false;
    setTotalTokens(0);
    setTotalCost(0);
    turnTokensRef.current = 0;
    turnCostRef.current = 0;
  };

  const promoteTurnSummary = () => {
    const completed = activities.filter(a => a.status !== 'running');
    if (completed.length === 0) return;
    const data = buildTurnSummary(completed, { tokens: turnTokensRef.current, cost: turnCostRef.current });
    setStaticItems(prev => [...prev, { kind: 'turn-summary', id: makeId(), data }]);
    turnTokensRef.current = 0;
    turnCostRef.current = 0;
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
      const next = !autoApprove;
      setAutoApprove(next);
      appendNotice(next ? '⚡ Auto-approve enabled.' : 'Auto-approve disabled.');
      return;
    }
    appendNotice(`Unknown command "${command}". Try /help.`);
  };

  const handleSubmit = (value: string) => {
    if (!session) return;
    pendingClearRef.current = false;

    if (pendingQuestion) {
      setPendingQuestion(null);
      setIsLoading(true);
      setThinkingPhrase('Thinking...');
      EventBus.emit('agent:answer', { sessionId: session.id, answer: value, source: pendingQuestion.source });
      return;
    }

    if (value.startsWith('/')) { executeCommand(value); return; }

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
      case 'thinking':
        return (
          <ThinkingBlock
            key={item.id}
            text={item.text}
            collapsed={collapsedThinking.has(item.id)}
          />
        );
    }
  };

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
        <Static key={clearGeneration} items={staticItems}>
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

        {pendingQuestion && (
          <PendingQuestion question={pendingQuestion.question} />
        )}
      </Box>

      <StatusBar
        model={modelName}
        branch={gitBranch}
        autoApprove={autoApprove}
        msgCount={humanCount}
        totalTokens={totalTokens}
        totalCost={totalCost}
      />

      <WorkingLine
        isActive={isAgentBusy && !pendingApproval}
        phrase={thinkingPhrase}
        elapsed={isAgentBusy && !pendingApproval ? elapsed : null}
      />

      <ChatInput
        isActive={!isAgentBusy}
        onSubmit={handleSubmit}
      />
    </Box>
  );
};
