import React from 'react';
import { Box, Text } from 'ink';
import { ApproveFooter } from '@elements';
import { PendingToolCall } from '@robocode-packages/shared';
import { DiffView } from './DiffView';

type Props = { tool: PendingToolCall; isActive: boolean; confirm: (state: boolean) => void };

const RISK_COLOR: Record<string, string> = {
  safe: 'green',
  moderate: 'yellow',
  destructive: 'red',
};

const RISK_ICON: Record<string, string> = {
  safe: '●',
  moderate: '▲',
  destructive: '⚠',
};

export const PendingTool: React.FC<Props> = ({ tool, isActive, confirm }) => {
  const color = RISK_COLOR[tool.risk] ?? 'yellow';
  const icon = RISK_ICON[tool.risk] ?? '?';
  const isBash = tool.name === 'bash';
  const isEdit = tool.name === 'edit_file';
  const isWrite = tool.name === 'write_file';

  const writeLines = isWrite ? String(tool.args.content ?? '').split('\n') : [];
  const writePreview = writeLines.slice(0, 15);

  return (
    <Box flexDirection="column" marginY={1} padding={1} borderStyle="single" borderColor={color}>
      <Box gap={2}>
        <Text color={color} bold>
          {icon} {tool.name}
        </Text>
        <Text color={color} dimColor>
          {tool.risk}
        </Text>
      </Box>

      {isBash && (
        <Box marginTop={1}>
          <Text color="white" bold>
            ${' '}
          </Text>
          <Text color="yellow">{String(tool.args.command ?? '')}</Text>
        </Box>
      )}

      {isEdit && (
        <DiffView
          filePath={String(tool.args.path ?? '')}
          oldStr={String(tool.args.old_str ?? '')}
          newStr={String(tool.args.new_str ?? '')}
        />
      )}

      {isWrite && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan" bold>
            {String(tool.args.path ?? '')}
          </Text>
          <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
            {writePreview.map((line, i) => (
              <Text key={i} color="gray">
                {line}
              </Text>
            ))}
            {writeLines.length > 15 && (
              <Text dimColor>... {writeLines.length - 15} more lines</Text>
            )}
          </Box>
        </Box>
      )}

      {!isBash && !isEdit && !isWrite && (
        <Text color="gray" dimColor>
          {tool.description}
        </Text>
      )}

      <ApproveFooter isActive={isActive} confirm={confirm} />
    </Box>
  );
};
