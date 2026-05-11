import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useSession, useRouter } from '@hooks';
import { ChatInput } from '@elements';
import { EventBus, MessageService } from '@robocode-packages/core';
import { runAgent, resumeAgent, stopAgent } from '@robocode-packages/agent';
import { BaseMessage, AIMessage, HumanMessage } from '@langchain/core/messages';
import { messageType, Plan, PendingToolCall } from '@robocode-packages/shared';
import { ROLE_LABELS, ROLE_COLORS } from '@types';
import {
  PendingPlan,
  PendingTool,
  ActivityFeed,
  AgentStatus,
  type ToolActivity,
} from './components';

export const ChatScreen: React.FC = () => {
  const { session } = useSession();
  const { navigate } = useRouter();

  const [messages, setMessages] = useState<BaseMessage[]>(() =>
    session ? MessageService.load(session.id) : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingTool, setPendingTool] = useState<PendingToolCall | null>(null);
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [activities, setActivities] = useState<ToolActivity[]>([]);
  const [elapsed, setElapsed] = useState(0);

  const streamingRef = useRef('');
  const agentStartTimeRef = useRef<number | null>(null);

  // Reset on session change
  useEffect(() => {
    if (!session) return;
    setMessages(MessageService.load(session.id));
    setStreamingText('');
    streamingRef.current = '';
    setPendingTool(null);
    setPendingPlan(null);
    setActivities([]);
    setIsLoading(false);
    agentStartTimeRef.current = null;
    setElapsed(0);
  }, [session?.id]);

  // Event subscriptions — no stale closures: streaming text lives in a ref
  useEffect(() => {
    if (!session?.id) return;
    const id = session.id;

    const unsubs = [
      EventBus.on('llm:start', ({ sessionId }) => {
        if (sessionId !== id) return;
        setIsLoading(true);
      }),

      EventBus.on('llm:token', ({ sessionId, token }) => {
        if (sessionId !== id) return;
        streamingRef.current += token;
        setStreamingText((prev) => prev + token);
      }),

      EventBus.on('llm:end', ({ sessionId }) => {
        if (sessionId !== id) return;
        if (streamingRef.current) {
          const msg = new AIMessage(streamingRef.current);
          setMessages((prev) => [...prev, msg]);
          streamingRef.current = '';
          setStreamingText('');
        }
        setIsLoading(false);
      }),

      EventBus.on('llm:error', ({ sessionId }) => {
        if (sessionId !== id) return;
        streamingRef.current = '';
        setStreamingText('');
        setIsLoading(false);
      }),

      EventBus.on('agent:plan_pending', ({ plan }) => setPendingPlan(plan)),
      EventBus.on('agent:plan_decision', () => setPendingPlan(null)),
      EventBus.on('agent:tool_pending', ({ toolCall }) => setPendingTool(toolCall)),
      EventBus.on('agent:tool_decision', () => setPendingTool(null)),

      EventBus.on('tool:start', ({ sessionId, name, input, callId }) => {
        if (sessionId !== id) return;
        setActivities((prev) => [...prev, { id: callId, name, input, status: 'running' }]);
      }),

      EventBus.on('tool:end', ({ sessionId, callId }) => {
        if (sessionId !== id) return;
        setActivities((prev) => prev.map((a) => (a.id === callId ? { ...a, status: 'done' } : a)));
      }),

      EventBus.on('tool:error', ({ sessionId, callId }) => {
        if (sessionId !== id) return;
        setActivities((prev) => prev.map((a) => (a.id === callId ? { ...a, status: 'error' } : a)));
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [session?.id]);

  useInput((_, key) => {
    if (key.escape) {
      session?.id && stopAgent(session.id);
      navigate('welcome');
    }
  });

  const isBusy = isLoading || !!pendingTool || !!pendingPlan;

  // Elapsed time tracking
  useEffect(() => {
    if (!isBusy) {
      agentStartTimeRef.current = null;
      setElapsed(0);
      return;
    }
    if (agentStartTimeRef.current === null) {
      agentStartTimeRef.current = Date.now();
    }
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - agentStartTimeRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [isBusy]);

  const handleSubmit = (value: string) => {
    if (!session) return;
    setMessages((prev) => [...prev, new HumanMessage(value)]);
    setIsLoading(true);
    streamingRef.current = '';
    setStreamingText('');
    setActivities([]);
    runAgent(session.id, value);
  };

  const confirmTool = (approved: boolean) => {
    if (!session) return;
    resumeAgent(session.id, approved ? 'approve' : 'reject');
    setPendingTool(null);
  };

  const confirmPlan = (approved: boolean) => {
    if (!session) return;
    resumeAgent(session.id, approved ? 'approve' : 'reject');
    setPendingPlan(null);
  };

  // Hide tool messages and empty AI messages — tools are shown via ActivityFeed
  const visibleMessages = messages.filter((msg) => {
    const role = messageType(msg);
    if (role === 'tool') return false;
    if (role === 'ai') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return content.trim().length > 0;
    }
    return true;
  });

  const runningTool = activities.find((a) => a.status === 'running')?.name ?? null;

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box paddingX={2} borderStyle="single" borderColor="gray">
        <Text color="cyan" bold>
          robocode
        </Text>
        <Text color="gray"> / </Text>
        <Text color="white">{session?.name ?? 'new session'}</Text>
      </Box>

      {/* Conversation */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} overflowY="hidden">
        {visibleMessages.map((msg) => {
          const role = messageType(msg);
          const content =
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return (
            <Box key={msg.id} flexDirection="column" marginBottom={1}>
              <Box gap={2}>
                <Text color={ROLE_COLORS[role] ?? 'white'} bold>
                  {ROLE_LABELS[role] ?? role}
                </Text>
                <Box flexGrow={1} flexWrap="wrap">
                  <Text dimColor={role === 'system'}>{content}</Text>
                </Box>
              </Box>
            </Box>
          );
        })}

        {/* Streaming text */}
        {streamingText && (
          <Box flexDirection="column" marginBottom={1}>
            <Box gap={2}>
              <Text color={ROLE_COLORS['ai']} bold>
                {ROLE_LABELS['ai']}
              </Text>
              <Box flexGrow={1} flexWrap="wrap">
                <Text>{streamingText}</Text>
              </Box>
            </Box>
          </Box>
        )}

        {/* Live tool activity */}
        <ActivityFeed activities={activities} />

        {pendingTool && (
          <PendingTool tool={pendingTool} isActive={!!pendingTool} confirm={confirmTool} />
        )}
        {pendingPlan && (
          <PendingPlan isActive={!!pendingPlan} confirm={confirmPlan} plan={pendingPlan} />
        )}

        {isBusy && (
          <AgentStatus
            isThinking={isLoading}
            runningTool={!isLoading ? runningTool : null}
            elapsed={elapsed}
          />
        )}
      </Box>

      {/* Input */}
      <Box paddingX={1} paddingY={1}>
        <ChatInput isActive={!isBusy} onSubmit={handleSubmit} isLoading={isBusy} />
      </Box>
    </Box>
  );
};
