import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, formatElapsed } from '@utils';
import { useSpinner } from '@hooks';

interface Props {
  isActive: boolean;
  phrase: string | null;
  elapsed: number | null;
}

export const WorkingLine: React.FC<Props> = ({ isActive, phrase, elapsed }) => {
  const spinnerFrame = useSpinner(isActive);

  if (!isActive) return null;

  return (
    <Box paddingX={1} gap={1}>
      <Text color={PALETTE.teal}>{spinnerFrame}</Text>
      <Text color={PALETTE.muted}>{phrase ?? 'Working…'}</Text>
      {elapsed !== null && elapsed >= 2 && (
        <Text color={PALETTE.faint}>{formatElapsed(elapsed)}</Text>
      )}
    </Box>
  );
};
