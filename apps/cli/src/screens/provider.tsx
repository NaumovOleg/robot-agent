import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

export const ProviderScreen = ({ onSelect }) => {
  const items = [
    { label: 'OpenAI', value: 'openai' },
    { label: 'Anthropic', value: 'anthropic' },
  ];

  return (
    <Box flexDirection="column">
      <Text>Select Provider:</Text>
      <SelectInput items={items} onSelect={onSelect} />
    </Box>
  );
};
