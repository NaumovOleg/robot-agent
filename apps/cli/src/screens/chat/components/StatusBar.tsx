import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '@utils';
import { MODEL_CONTEXT } from '@robocode-packages/config';

function formatCost(cost: number): string {
  if (cost === 0) return '';
  return `~$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n === 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k tok`;
  return `${n} tok`;
}

interface Props {
  model: string;
  branch: string | null;
  autoApprove: boolean;
  msgCount: number;
  totalTokens: number;
  totalCost: number;
}

export const StatusBar: React.FC<Props> = ({
  model, branch, autoApprove, msgCount, totalTokens, totalCost,
}) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const barWidth = Math.max(10, termWidth - 2);

  const contextMax = MODEL_CONTEXT[model] ?? 200_000;
  const contextPct = totalTokens > 0 ? totalTokens / contextMax : 0;
  const fillCount = Math.round(contextPct * barWidth);
  const fillColor =
    contextPct > 0.9 ? PALETTE.ctxCrit :
    contextPct > 0.75 ? PALETTE.ctxWarn :
    PALETTE.ctxNormal;

  const sep = <Text color={PALETTE.faint}> · </Text>;
  const tokStr = formatTokens(totalTokens);
  const costStr = formatCost(totalCost);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={0}>
        <Text color={PALETTE.statusBar}>{model}</Text>
        {sep}
        <Text color={PALETTE.statusBar}>{branch ?? 'no git'}</Text>
        {sep}
        <Text color={PALETTE.statusBar}>{msgCount} msg{msgCount !== 1 ? 's' : ''}</Text>
        {tokStr ? <>{sep}<Text color={PALETTE.statusBar}>{tokStr}</Text></> : null}
        {costStr ? <>{sep}<Text color={PALETTE.statusBar}>{costStr}</Text></> : null}
        {autoApprove && <>{sep}<Text color={PALETTE.teal}>⚡ auto</Text></>}
      </Box>
      {totalTokens > 0 && (
        <Box>
          <Text color={fillColor}>{'█'.repeat(fillCount)}</Text>
          <Text color={PALETTE.faint}>{'░'.repeat(barWidth - fillCount)}</Text>
        </Box>
      )}
    </Box>
  );
};
