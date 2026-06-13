import React from 'react';
import { Box, Text } from 'ink';

export const FaqScreen: React.FC = () => {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1} gap={1}>
      <Text bold color="cyan">FAQ</Text>
      <Text>Frequently Asked Questions will be listed here.</Text>
    </Box>
  );
};
