import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

interface LoadingSpinnerProps {
  label?: string;
  color?: string;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ label = 'ai', color = 'cyan' }) => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box gap={2} marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Text color="gray">{SPINNER_FRAMES[frame]}</Text>
    </Box>
  );
};
