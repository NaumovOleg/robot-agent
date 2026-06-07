import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '@utils';

export interface SlashCommand {
  command: string;
  description: string;
  detail: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/help',
    description: 'Show available commands',
    detail: 'Prints a list of all available slash commands to the chat.',
  },
  {
    command: '/clear',
    description: 'Start a new session',
    detail: 'Deletes the current session and starts a fresh one. Prompts for confirmation if the session has more than 5 turns.',
  },
  {
    command: '/compact',
    description: 'Summarize conversation with AI',
    detail: 'Compresses the conversation history by asking the AI to summarize it. Reduces context usage when approaching limits.',
  },
  {
    command: '/approve',
    description: 'Toggle auto-approve mode',
    detail: 'When enabled, destructive tool calls (file edits, bash) are automatically approved without prompting. Shown as ⚡ auto in the status bar.',
  },
  {
    command: '/audit',
    description: 'Show last N audit entries',
    detail: 'Prints the last N audit log entries for the current session. Usage: /audit 20. Defaults to 10 entries.',
  },
  {
    command: '/transcript',
    description: 'Show transcript file path',
    detail: 'Prints the path to the current session transcript file.',
  },
  {
    command: '/inspect',
    description: 'Open session inspector',
    detail: 'Opens the session history browser where you can view past sessions and their messages.',
  },
  {
    command: '/replay',
    description: 'Reload persisted messages',
    detail: 'Reloads the stored message history for the current session. Useful if the in-memory state drifts from disk.',
  },
];

const LEFT_WIDTH = 18;

interface Props {
  input: string;
  selectedIndex: number;
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export const SlashPalette: React.FC<Props> = ({ input, selectedIndex }) => {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const rightWidth = Math.max(20, termWidth - LEFT_WIDTH - 6);

  const filtered = SLASH_COMMANDS.filter((cmd) => cmd.command.startsWith(input));
  if (filtered.length === 0) return null;

  const selected = filtered[selectedIndex] ?? filtered[0];
  const detailLines = wrapText(selected?.detail ?? '', rightWidth);

  return (
    <Box flexDirection="row" marginBottom={0}>
      <Box flexDirection="column" width={LEFT_WIDTH} borderStyle="single" borderColor={PALETTE.faint}>
        {filtered.map((cmd, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={cmd.command} paddingX={1}>
              <Text
                color={isSelected ? PALETTE.teal : PALETTE.muted}
                bold={isSelected}
                backgroundColor={isSelected ? '#1a2a1a' : undefined}
              >
                {cmd.command}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor={PALETTE.faint} paddingX={1}>
        {selected && (
          <>
            <Text color={PALETTE.teal}>{selected.command}</Text>
            <Box flexDirection="column" marginTop={1}>
              {detailLines.map((line, i) => (
                <Text key={i} color={PALETTE.muted}>{line}</Text>
              ))}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};
