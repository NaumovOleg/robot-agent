import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { SlashPalette, SLASH_COMMANDS } from './SlashPalette';
import { PALETTE } from '@utils';

interface Props {
  onSubmit: (value: string) => void;
  isActive?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSubmit, isActive }) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;

  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [paletteIndex, setPaletteIndex] = useState(0);

  const showPalette = value.startsWith('/') && !!isActive;
  const paletteCommands = showPalette
    ? SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(value))
    : [];

  useInput(
    (_, key) => {
      if (showPalette && paletteCommands.length > 0) {
        if (key.upArrow) { setPaletteIndex(p => Math.max(0, p - 1)); return; }
        if (key.downArrow) { setPaletteIndex(p => Math.min(paletteCommands.length - 1, p + 1)); return; }
        if (key.tab) {
          const sel = paletteCommands[paletteIndex];
          if (sel) { setValue(sel.command); setPaletteIndex(0); }
          return;
        }
        if (key.escape) { setValue(''); setPaletteIndex(0); return; }
        return;
      }
      if (key.upArrow && history.length > 0 && (historyIndex >= 0 || value.trim().length === 0)) {
        if (historyIndex === -1) setDraft(value);
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next] ?? '');
        return;
      }
      if (key.downArrow && historyIndex >= 0) {
        const next = historyIndex - 1;
        setHistoryIndex(next);
        setValue(next < 0 ? draft : (history[next] ?? ''));
      }
    },
    { isActive }
  );

  const handleSubmit = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed || !isActive) return;
    setHistory(prev => [trimmed, ...prev.slice(0, 49)]);
    setHistoryIndex(-1);
    setValue('');
    setDraft('');
    setPaletteIndex(0);
    onSubmit(trimmed);
  };

  const promptColor = isActive ? PALETTE.muted : PALETTE.faint;

  return (
    <Box flexDirection="column">
      {showPalette && paletteCommands.length > 0 && (
        <SlashPalette input={value} selectedIndex={paletteIndex} />
      )}
      <Text color={PALETTE.faint}>{'─'.repeat(Math.max(0, termWidth))}</Text>
      <Box paddingX={1} gap={1}>
        <Text color={promptColor}>❯</Text>
        <TextInput
          focus={!!isActive}
          value={value}
          placeholder="Message robocode…"
          onChange={(nextValue) => {
            setValue(nextValue);
            setDraft(nextValue);
            setPaletteIndex(0);
            if (historyIndex !== -1) setHistoryIndex(-1);
          }}
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
