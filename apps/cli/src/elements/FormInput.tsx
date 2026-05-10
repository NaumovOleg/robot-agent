import React from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onEscape?: () => void;
  mask?: string;
  label?: string;
}

export const FormInput: React.FC<Props> = ({
  placeholder,
  value,
  onChange,
  onSubmit,
  onEscape,
  mask,
  label,
}) => {
  useInput((_, key) => {
    if (key.escape) {
      onEscape?.();
    }
  });

  return (
    <Box flexDirection="column">
      {label && (
        <Box marginBottom={1}>
          <Text color="white">{label}</Text>
        </Box>
      )}

      <Box borderStyle="round" borderColor="blueBright" paddingX={1}>
        <Text color="cyan">› </Text>
        <TextInput
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          onSubmit={onSubmit}
          mask={mask}
        />
      </Box>
    </Box>
  );
};
