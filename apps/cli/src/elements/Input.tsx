import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const COMMANDS = [
  { cmd: '/login', description: 'authenticate with API key' },
  { cmd: '/help', description: 'show all commands' },
  { cmd: '/provider', description: 'change AI provider' },
  { cmd: '/exit', description: 'quit the app' },
];

interface Props {
  placeholder?: string;
  onSubmit: (value: string) => void;
}

export const CommandInput: React.FC<Props> = ({ placeholder = 'type command...', onSubmit }) => {
  const [value, setValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const showSuggestions = value.startsWith('/');
  const filtered = COMMANDS.filter((c) => c.cmd.startsWith(value));

  useInput((input, key) => {
    if (!showSuggestions || filtered.length === 0) return;

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(i - 1, 0));
    }
    if (key.tab || input === ' ') {
      setValue(filtered[selectedIndex]?.cmd ?? value);
    }
  });

  const handleSubmit = (v: string) => {
    if (showSuggestions && filtered.length > 0) {
      onSubmit(filtered[selectedIndex]?.cmd ?? v);
    } else {
      onSubmit(v);
    }
    setValue('');
    setSelectedIndex(0);
  };

  return (
    <Box flexDirection="column">
      {showSuggestions && filtered.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          {filtered.map((item, i) => (
            <Box key={item.cmd} gap={2}>
              <Text bold={i === selectedIndex} color={i === selectedIndex ? 'blueBright' : 'white'}>
                {i === selectedIndex ? '▶ ' : '  '}
                {item.cmd}
              </Text>
              <Text color="gray">{item.description}</Text>
            </Box>
          ))}
        </Box>
      )}

      <Box borderStyle="round" borderColor={showSuggestions ? 'blueBright' : 'gray'} paddingX={1}>
        <Text color="cyan">› </Text>
        <TextInput
          value={value}
          placeholder={placeholder}
          onChange={(v) => {
            setValue(v);
            setSelectedIndex(0);
          }}
          onSubmit={handleSubmit}
        />
      </Box>

      {showSuggestions && filtered.length > 0 && (
        <Box paddingX={1}>
          <Text dimColor>↑↓ navigate SPACE/TAB select ENTER confirm</Text>
        </Box>
      )}
    </Box>
  );
};
