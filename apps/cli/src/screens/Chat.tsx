import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useRouter, useSession } from '@hooks';
import { ChatInput } from '@elements';
import { EventBus, MessageService } from '@robocode-packages/core';

export const ChatScreen: React.FC = () => {
  const { navigate } = useRouter();
  const { active } = useSession();
  const [messages, setMessages] = useState(() => (active ? MessageService.load(active.id) : []));

  console.log(messages);

  const [isLoading, setIsLoading] = React.useState(false);

  useEffect(() => {
    const unsubscribe = EventBus.on(
      'llm:token',
      ({ sessionId, token }: { sessionId: string; token: string }) => {
        if (sessionId !== active?.id) return;
      }
    );

    return unsubscribe;
  });

  useInput((_, key) => {
    if (key.escape) navigate('welcome');
  });

  const handleSubmit = (value: string) => {
    setMessages((prev) => [...prev, { role: 'human', content: value }]);
    setIsLoading(true);

    setTimeout(() => {
      setMessages((prev) => [...prev, { role: 'ai', content: '...' }]);
      setIsLoading(false);
    }, 1000);
  };

  return (
    <Box flexDirection="column" height="100%">
      {/* HEADER */}
      <Box paddingX={2} paddingY={0} borderStyle="single" borderColor="gray">
        <Text color="cyan" bold>
          robocode
        </Text>
        <Text color="gray"> / </Text>
        <Text color="white">{active?.name ?? 'new session'}</Text>
        {isLoading && <Text color="yellow"> ⠋ thinking...</Text>}
      </Box>

      {/* MESSAGES */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1} overflowY="hidden">
        {messages.map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Box gap={2}>
              <Text color={ROLE_COLORS[msg.role] ?? 'white'} bold>
                {ROLE_LABELS[msg.role] ?? msg.role}
              </Text>
              <Box flexGrow={1} flexWrap="wrap">
                <Text
                  color={msg.role === 'human' ? 'white' : msg.role === 'system' ? 'gray' : 'white'}
                  dimColor={msg.role === 'system' || msg.role === 'tool'}
                >
                  {msg.content}
                </Text>
              </Box>
            </Box>
          </Box>
        ))}

        {isLoading && (
          <Box gap={2}>
            <Text color="cyan" bold>
              {' '}
              ai
            </Text>
            <Text color="gray">▋</Text>
          </Box>
        )}
      </Box>

      {/* DIVIDER */}
      <Box paddingX={2}>
        <Text color="gray">{'─'.repeat(50)}</Text>
      </Box>

      {/* INPUT */}
      <Box paddingX={1} paddingY={1}>
        <Box flexGrow={1}>
          <ChatInput onSubmit={handleSubmit} isLoading={isLoading} />
        </Box>
      </Box>
    </Box>
  );
};
