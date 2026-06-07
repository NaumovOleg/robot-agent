import React from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  title: string;
  display: boolean;
  confirm: () => void;
  cancel?: () => void;
  name: string;
}

export const ConfirmDelete: React.FC<Props> = ({ title, display, confirm, cancel, name }) => {
  useInput(
    (input, key) => {
      if (!display) return;
      if (key.escape || input === 'n' || input === 'N') {
        cancel?.();
        return;
      }
      if (input === 'y' || input === 'Y') {
        confirm();
      }
    },
    { isActive: display }
  );

  return (
    <Box display={display ? 'flex' : 'none'} flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}>
        <Text color="red" bold>
          {title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text>Delete </Text>
        <Text color="yellow" bold>
          {name}
        </Text>
        <Text>? This cannot be undone.</Text>
      </Box>

      <Box gap={3} marginBottom={1}>
        <Text color="red" bold>
          Y yes, delete
        </Text>
        <Text color="gray">N cancel</Text>
      </Box>

      <Text dimColor>press Y or N ESC = cancel</Text>
    </Box>
  );
};
