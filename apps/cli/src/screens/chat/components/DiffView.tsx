import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  oldStr: string;
  newStr: string;
  filePath?: string;
  maxLines?: number;
}

export const DiffView: React.FC<Props> = ({ oldStr, newStr, filePath, maxLines = 30 }) => {
  const removed = oldStr.split('\n').map((l) => ({ sign: '-', content: l, color: 'red' as const }));
  const added = newStr.split('\n').map((l) => ({ sign: '+', content: l, color: 'green' as const }));
  const all = [...removed, ...added];
  const truncated = all.length > maxLines;
  const visible = truncated ? all.slice(0, maxLines) : all;

  return (
    <Box flexDirection="column" marginTop={1}>
      {filePath && (
        <Text bold color="cyan">
          {filePath}
        </Text>
      )}
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        {visible.map((line, i) => (
          <Text key={i} color={line.color}>
            {line.sign} {line.content}
          </Text>
        ))}
        {truncated && <Text dimColor>... {all.length - maxLines} more lines</Text>}
      </Box>
    </Box>
  );
};
