import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  onSubmit: (value: string) => void;
  isLoading?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSubmit, isLoading }) => {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((_, key) => {
    if (key.upArrow && history.length > 0) {
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setValue(history[next] ?? '');
      return;
    }
    if (key.downArrow && historyIndex >= 0) {
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(next < 0 ? '' : (history[next] ?? ''));
      return;
    }
  });

  const handleSubmit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed || isLoading) return;
    setHistory((prev) => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setValue('');
    onSubmit(trimmed);
  };

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={isLoading ? 'gray' : 'blueBright'} paddingX={1}>
        <Text color={isLoading ? 'gray' : 'cyan'}>❯ </Text>
        <Box flexGrow={12} width={'100%'}>
          <TextInput
            value={value}
            placeholder={isLoading ? 'waiting...' : 'message...'}
            onChange={setValue}
            onSubmit={handleSubmit}
          />
        </Box>
      </Box>
    </Box>
  );
};
