import React from 'react';
import { Box, Text } from 'ink';

export const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <Box borderStyle="round" borderColor={color} paddingX={1}>
    <Text color={color} bold>
      {label}
    </Text>
  </Box>
);
