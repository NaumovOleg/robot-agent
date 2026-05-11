import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

const THINKING_VERBS = [
  'Thinking',
  'Pondering',
  'Reasoning',
  'Analyzing',
  'Jitterbugging',
  'Contemplating',
  'Deliberating',
  'Cogitating',
  'Mulling',
  'Strategizing',
  'Brainstorming',
  'Synthesizing',
  'Calculating',
  'Deducing',
  'Puzzling',
  'Sifting',
  'Exploring',
  'Scheming',
  'Ruminating',
  'Processing',
];

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

interface Props {
  isThinking: boolean;
  runningTool?: string | null;
  elapsed: number;
}

export const AgentStatus: React.FC<Props> = ({ isThinking, runningTool, elapsed }) => {
  const [frame, setFrame] = useState(0);
  const [verbIndex, setVerbIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_VERBS.length)
  );

  useEffect(() => {
    if (!isThinking) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 200);
    return () => clearInterval(t);
  }, [isThinking]);

  useEffect(() => {
    if (!isThinking) return;
    const t = setInterval(
      () => setVerbIndex(Math.floor(Math.random() * THINKING_VERBS.length)),
      4000
    );
    return () => clearInterval(t);
  }, [isThinking]);

  const phase = runningTool ? `using ${runningTool}` : isThinking ? 'thinking' : 'waiting';
  const label = runningTool ?? THINKING_VERBS[verbIndex];
  const color = isThinking ? 'yellow' : 'cyan';

  return (
    <Box gap={1} marginLeft={2}>
      <Text color={color}>{SPINNER[frame]}</Text>
      <Text color={color} bold>
        {label}…
      </Text>
      <Text color="gray" dimColor>
        ({formatElapsed(elapsed)} · {phase})
      </Text>
    </Box>
  );
};
