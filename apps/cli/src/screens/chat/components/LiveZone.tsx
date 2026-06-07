import React from 'react';
import { Box, Text } from 'ink';
import { PALETTE, truncate } from '@utils';
import { useSpinner } from '@hooks';
import type { ToolActivity } from '@types';

function getPrimaryArg(_name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const val = args.path ?? args.file ?? args.command ?? args.input ?? args.pattern ?? args.target;
  return val ? truncate(String(val), 50) : '';
}

function formatToolLabel(name: string, input: unknown): string {
  const arg = getPrimaryArg(name, input);
  return arg ? `${name}(${arg})` : name;
}

function formatElapsedMs(startedAt: number | undefined, finishedAt: number | undefined): string {
  if (!startedAt) return '';
  const ms = (finishedAt ?? Date.now()) - startedAt;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

interface Props {
  streamingText: string;
  activities: ToolActivity[];
  gitDiffStat: string | null;
}

export const LiveZone: React.FC<Props> = ({ streamingText, activities, gitDiffStat }) => {
  const spinnerFrame = useSpinner(activities.some(a => a.status === 'running'));

  const hasContent = streamingText || activities.length > 0 || gitDiffStat;
  if (!hasContent) return null;

  return (
    <Box flexDirection="column">
      {streamingText && (
        <Box paddingLeft={2} marginBottom={1}>
          <Text color={PALETTE.aiText}>{streamingText}</Text>
        </Box>
      )}

      {activities.map(activity => {
        const label = formatToolLabel(activity.name, activity.input);
        const timing = formatElapsedMs(activity.startedAt, activity.finishedAt);
        const lastChunk = activity.stream?.at(-1)?.text ?? null;

        let icon: string;
        let iconColor: string;
        if (activity.status === 'running') {
          icon = spinnerFrame;
          iconColor = PALETTE.teal;
        } else if (activity.status === 'done') {
          icon = '✓';
          iconColor = PALETTE.sage;
        } else {
          icon = '✗';
          iconColor = PALETTE.rust;
        }

        return (
          <Box key={activity.id} flexDirection="column" paddingLeft={2}>
            <Box gap={1}>
              <Text color={iconColor}>{icon}</Text>
              <Text color={PALETTE.muted}>{label}</Text>
              {timing && <Text color={PALETTE.faint}>{timing}{activity.status === 'running' ? '…' : ''}</Text>}
            </Box>
            {activity.status === 'running' && lastChunk && (
              <Box paddingLeft={2}>
                <Text color={PALETTE.faint}>⎿  {truncate(lastChunk.replace(/\n/g, ' '), 80)}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {gitDiffStat && (
        <Box paddingLeft={2} marginBottom={1} gap={1}>
          <Text color={PALETTE.slate}>◉</Text>
          <Text color={PALETTE.muted}>git diff</Text>
          <Text color={PALETTE.muted} dimColor>{gitDiffStat}</Text>
        </Box>
      )}
    </Box>
  );
};
