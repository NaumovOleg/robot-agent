// apps/cli/src/screens/chat/components/GitDiffPreview.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

interface Props {
  stat: string | null;
}

export const GitDiffPreview: React.FC<Props> = ({ stat }) => {
  if (!stat) return null;
  return (
    <Box paddingLeft={2} marginBottom={1} gap={1}>
      <Text color={PALETTE.slate}>◉</Text>
      <Text color={PALETTE.muted}>git diff</Text>
      <Text color={PALETTE.muted} dimColor>{stat}</Text>
    </Box>
  );
};
