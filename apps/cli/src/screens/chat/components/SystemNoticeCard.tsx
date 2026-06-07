// apps/cli/src/screens/chat/components/SystemNoticeCard.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE } from '@utils';

interface Props {
  content: string;
}

export const SystemNoticeCard: React.FC<Props> = ({ content }) => (
  <Box marginBottom={1} paddingLeft={2}>
    <Text color={PALETTE.slate} dimColor>◆ {content}</Text>
  </Box>
);
