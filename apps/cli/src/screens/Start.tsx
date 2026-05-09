import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface Props {
  isLoggedIn: boolean;
}

const commands = ['/help', '/login', '/agent', '/run', '/exit'];

export const StartScreen: React.FC<Props> = ({ isLoggedIn }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<string | null>(null);

  const suggestions = commands.filter((cmd) => cmd.startsWith(input));

  const submit = () => {
    if (!input.trim()) return;

    setOutput(input);
    setInput('');
  };

  useInput((_, key) => {
    if (key.escape) {
      setInput('');
      setOutput(null);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* HEADER BAR */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Robot Agent CLI
        </Text>

        <Text color="gray">{isLoggedIn ? ' ● connected' : ' ● not logged in'}</Text>
      </Box>

      {/* OUTPUT AREA */}
      {output && (
        <Box marginBottom={1}>
          <Text color="green">
            executing: <Text color="white">{output}</Text>
          </Text>
        </Box>
      )}

      {/* INPUT */}
      <Box borderStyle="round" paddingX={1}>
        <Text color="cyan">› </Text>

        <TextInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>

      {/* SUGGESTIONS */}
      {input.length > 0 && suggestions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {suggestions.slice(0, 5).map((cmd) => (
            <Text key={cmd} color="gray">
              {cmd}
            </Text>
          ))}
        </Box>
      )}

      {/* HELP */}
      <Box marginTop={2}>
        <Text color="gray">ESC clear • ENTER run • /help for commands</Text>
      </Box>
    </Box>
  );
};
