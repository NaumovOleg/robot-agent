import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, formatElapsed } from '@utils';
import type { TurnSummaryData } from '@types';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
}

function formatCostStr(cost: number): string {
  return cost > 0 ? ` · ~$${cost.toFixed(2)}` : '';
}

function formatTokensStr(n: number): string {
  if (n <= 0) return '';
  if (n >= 1000) return ` · ${(n / 1000).toFixed(1)}k tok`;
  return ` · ${n} tok`;
}

export const TurnSummaryCard: React.FC<{ data: TurnSummaryData }> = ({ data }) => {
  const icon = data.hasError ? '✗' : '⏺';
  const iconColor = data.hasError ? PALETTE.rust : PALETTE.teal;

  const groupText = data.groups.map(g => `${g.verb.toLowerCase()} ${g.count}`).join(' · ');
  const durText = data.durationSec > 0 ? formatElapsed(data.durationSec) : '';
  const tokStr = formatTokensStr(data.tokens);
  const costStr = formatCostStr(data.cost);
  const timeText = formatTime(data.timestamp);

  const rightParts = [durText, tokStr.replace(/^ · /, ''), costStr.replace(/^ · /, '')].filter(Boolean).join(' · ');

  return (
    <Box marginBottom={1} gap={1}>
      <Text color={iconColor}>{icon}</Text>
      <Text color={PALETTE.statusBar}>{groupText}</Text>
      {rightParts ? (
        <>
          <Text color={PALETTE.faint}> · </Text>
          <Text color={PALETTE.statusBar}>{rightParts}</Text>
        </>
      ) : null}
      <Box flexGrow={1} />
      <Text color={PALETTE.faint}>{timeText}</Text>
    </Box>
  );
};
