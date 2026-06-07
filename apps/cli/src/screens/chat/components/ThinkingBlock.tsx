import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

interface Props {
  text: string;
  collapsed: boolean;
}

export const ThinkingBlock: React.FC<Props> = ({ text, collapsed }) => {
  if (collapsed) {
    return (
      <Box marginBottom={1}>
        <Text color={PALETTE.faint} dimColor>╎ thinking  </Text>
        <Text color={PALETTE.faint} dimColor>[t to expand]</Text>
      </Box>
    );
  }

  const lines = text.split('\n');
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box gap={1}>
        <Text color={PALETTE.faint} dimColor>╎ thinking</Text>
        <Text color={PALETTE.faint} dimColor>[t to collapse]</Text>
      </Box>
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color={PALETTE.faint} dimColor>╎ </Text>
          <Text color={PALETTE.faint} dimColor>{line}</Text>
        </Box>
      ))}
    </Box>
  );
};
