import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export const LoginScreen = ({ onSubmit }) => {
  const [key, setKey] = useState('');

  return (
    <Box flexDirection="column">
      <Text>Enter API Key:</Text>

      <TextInput value={key} onChange={setKey} onSubmit={() => onSubmit(key)} />
    </Box>
  );
};
