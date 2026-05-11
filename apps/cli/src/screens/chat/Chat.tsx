import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter, useSession } from '@hooks';
import { ChatInput } from '@elements';
import { EventBus, MessageService } from '@robocode-packages/core';
import { runAgent, resumeAgent } from '@robocode-packages/agent';
import { BaseMessage, AIMessage, HumanMessage } from '@langchain/core/messages';
import { messageType } from '@robocode-packages/shared';
import { ROLE_LABELS, ROLE_COLORS } from '@types';

export const ChatScreen: React.FC = () => {
  const { navigate } = useRouter();
  const { session } = useSession();
  const [messages, setMessages] = useState<BaseMessage[]>(() =>
    session ? MessageService.load(session.id) : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingTool, setPendingTool] = useState<any>(null);
  const [plan, setPlan] = useState<any>(null);
  const [selectedAction, setSelectedAction] = useState<'approve' | 'reject'>('approve');

  useEffect(() => {
    if (session) {
      const loaded = MessageService.load(session.id);
      setMessages(loaded);
      setStreamingText('');
      setPendingTool(null);
      setPlan(null);
      setIsLoading(false);
      setSelectedAction('approve');
    }
  }, [session]);

  useEffect(() => {
    const unsubscribePlan = EventBus.on('agent:plan', ({ plan: planData }) => {
      setPlan(planData);
      setSelectedAction('approve');
    });
    const unsubscribeTool = EventBus.on('agent:tool_pending', ({ toolCall }) => {
      setPendingTool(toolCall);
      setSelectedAction('approve');
    });
    const unsubscribeToken = EventBus.on(
      'llm:token',
      ({ sessionId, token }: { sessionId: string; token: string }) => {
        if (sessionId !== session?.id) return;
        setStreamingText((prev) => prev + token);
      }
    );
    const unsubscribeEnd = EventBus.on('llm:end', ({ sessionId }: { sessionId: string }) => {
      if (sessionId !== session?.id) return;
      if (streamingText) {
        const aiMessage = new AIMessage(streamingText);
        MessageService.add(session.id, aiMessage);
        setMessages((prev) => [...prev, aiMessage]);
        setStreamingText('');
      }
      setIsLoading(false);
    });

    return () => {
      unsubscribePlan();
      unsubscribeTool();
      unsubscribeToken();
      unsubscribeEnd();
    };
  }, [session?.id, streamingText]);

  const handleSubmit = async (value: string) => {
    if (!session) return;
    const userMessage = new HumanMessage(value);
    MessageService.add(session.id, userMessage);
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingText('');
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
    setPlan(null);
  };

  useInput((input, key) => {
    if (pendingTool || plan) {
      if (key.downArrow || key.upArrow) {
        setSelectedAction((prev) => (prev === 'approve' ? 'reject' : 'approve'));
      } else if (key.return || input === ' ') {
        if (pendingTool) confirmTool(selectedAction === 'approve');
        if (plan) confirmPlan(selectedAction === 'approve');
      } else if (key.escape) {
        if (pendingTool) confirmTool(false);
        if (plan) confirmPlan(false);
      }
      return;
    }

    if (key.escape) navigate('welcome');
  });

  const renderToolPrompt = () => {
    if (!pendingTool) return null;
    return (
      <Box flexDirection="column" marginY={1} padding={1} borderStyle="single" borderColor="yellow">
        <Text color="yellow" bold>
          Tool call requires approval:
        </Text>
        <Text>Name: {pendingTool.name}</Text>
        <Text>Arguments: {JSON.stringify(pendingTool.args, null, 2)}</Text>
        <Box marginTop={1} gap={2}>
          <Text color={selectedAction === 'approve' ? 'greenBright' : 'green'}>
            {selectedAction === 'approve' ? '▶' : ' '} ✓ Approve
          </Text>
          <Text color={selectedAction === 'reject' ? 'redBright' : 'red'}>
            {selectedAction === 'reject' ? '▶' : ' '} ✗ Reject
          </Text>
        </Box>
        <Text dimColor>↑/↓ select, Enter/Space confirm, Escape = reject</Text>
      </Box>
    );
  };

  const renderPlanPrompt = () => {
    if (!plan) return null;
    return (
      <Box flexDirection="column" marginY={1} padding={1} borderStyle="single" borderColor="blue">
        <Text color="blue" bold>
          Agent plan:
        </Text>
        <Text>{plan.description || JSON.stringify(plan)}</Text>
        <Box marginTop={1} gap={2}>
          <Text color={selectedAction === 'approve' ? 'greenBright' : 'green'}>
            {selectedAction === 'approve' ? '▶' : ' '} ✓ Execute plan
          </Text>
          <Text color={selectedAction === 'reject' ? 'redBright' : 'red'}>
            {selectedAction === 'reject' ? '▶' : ' '} ✗ Cancel
          </Text>
        </Box>
        <Text dimColor>↑/↓ select, Enter/Space confirm, Escape = cancel</Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* HEADER */}
      <Box paddingX={2} paddingY={0} borderStyle="single" borderColor="gray">
        <Text color="cyan" bold>
          robocode
        </Text>
        <Text color="gray"> / </Text>
        <Text color="white">{session?.name ?? 'new session'}</Text>
        {isLoading && <Text color="yellow"> ⠋ thinking...</Text>}
      </Box>

      {/* MESSAGES */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} overflowY="hidden">
        {messages.map((msg, idx) => {
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
                  <Text
                    color={role === 'human' ? 'white' : role === 'system' ? 'gray' : 'white'}
                    dimColor={role === 'system' || role === 'tool'}
                  >
                    {content}
                  </Text>
                </Box>
              </Box>
            </Box>
          );
        })}

        {isLoading && streamingText && (
          <Box gap={2} marginBottom={1}>
            <Text color="cyan" bold>
              ai
            </Text>
            <Text color="white">{streamingText}</Text>
          </Box>
        )}
        {isLoading && !streamingText && (
          <Box gap={2} marginBottom={1}>
            <Text color="cyan" bold>
              ai
            </Text>
            <Text color="gray">▋</Text>
          </Box>
        )}

        {renderToolPrompt()}
        {renderPlanPrompt()}
      </Box>

      {/* DIVIDER */}
      <Box paddingX={2}>
        <Text color="gray">{'─'.repeat(50)}</Text>
      </Box>

      <Box paddingX={1} paddingY={1}>
        <Box flexGrow={1}>
          <ChatInput onSubmit={handleSubmit} isLoading={isLoading || !!pendingTool || !!plan} />
        </Box>
      </Box>
    </Box>
  );
};
