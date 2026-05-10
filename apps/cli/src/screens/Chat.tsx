import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useRouter } from '@hooks';
import { CommandInput } from '@elements';

export const ChatScreen: React.FC = () => {
  const { navigate } = useRouter();

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Chat
        </Text>
        <Text color="gray"> session: Fix auth bug in Express</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} marginBottom={1}>
        <Box paddingLeft={2}>
          <Text color="gray">you </Text>
          <Text>how do I fix a JWT auth bug in Express?</Text>
        </Box>
        <Box paddingLeft={2} marginTop={1}>
          <Text color="cyan">ai </Text>
          <Text color="gray">
            Check your middleware order — auth must come before route handlers.
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color="gray">
          {'  '}
          {'─'.repeat(50)}
        </Text>
      </Box>

      <CommandInput
        placeholder="type a message..."
        onSubmit={(value) => {
          if (!value.trim()) return;
        }}
      />

      <Box paddingLeft={2} marginTop={1}>
        <Text dimColor>ENTER = send ESC = back to welcome Ctrl+C = exit</Text>
      </Box>
    </Box>
  );
};
